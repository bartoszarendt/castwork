/**
 * Candidate snapshots: an uncommitted working tree named by a git tree object.
 *
 * Projects often forbid commits until the work is closed, and a symbolic name
 * such as `worktree-T005` resolves to nothing, so an uncommitted candidate had
 * no reference anyone could check. A snapshot is the tree git itself would
 * commit: `git add -A` into a temporary index, so ignored files stay out and
 * the repository's own line-ending rules apply, then `git write-tree`. It has
 * no ref. The real index, HEAD, refs, and working tree are never touched, and
 * nothing is written into `.git` except the objects the tree needs, which
 * `git gc` may prune once they are older than `gc.pruneExpire`.
 *
 * Every git call takes an argument array, never a shell string, and every path
 * handed to git as a pathspec is `:(literal)`.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LOCAL_DIRECTORY, STATE_DIRECTORY, TASKS_DIRECTORY } from './layout.js';
import { PublicError } from './public-error.js';

/** Paths a snapshot leaves out: the records that describe it, and machine-local state. */
export const SNAPSHOT_EXCLUDES = Object.freeze([TASKS_DIRECTORY, LOCAL_DIRECTORY]);

/** The prefix a snapshot candidate reference carries. */
export const TREE_PREFIX = 'tree:';

/**
 * The object name in a `tree:<sha>` reference, lowercased, or null when the
 * reference is not one. Only hex is accepted, so a reference can never become
 * a git option.
 * @param {string} ref
 */
export function snapshotTree(ref) {
  if (!ref.startsWith(TREE_PREFIX)) return null;
  const sha = ref.slice(TREE_PREFIX.length);
  return /^[0-9a-f]{7,64}$/i.test(sha) ? sha.toLowerCase() : null;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{env?: NodeJS.ProcessEnv, input?: string}} [options]
 */
export function git(cwd, args, options = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    // Nothing is ever fetched: a partial clone would otherwise fetch a missing
    // object on lookup.
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', ...options.env },
    encoding: 'utf8',
    input: options.input,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * A git call on the temporary index. A split index would write a shared index
 * file into `.git`, and an optional lock would rewrite an index; neither may
 * happen, so both are switched off for every such call. The file system
 * monitor is off too: its answers describe the real index, not this one.
 * @param {string} top
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function indexGit(top, args, env) {
  return git(top, ['-c', 'core.splitIndex=false', '-c', 'core.fsmonitor=false', '--no-optional-locks', ...args], { env });
}

/**
 * The top of the working tree containing root, or null outside one.
 * @param {string} root
 */
export function workTreeTop(root) {
  try {
    return git(root, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

/**
 * What a snapshot covers: everything under the project root, relative to the
 * top of the working tree where every call runs, and the excluded paths under
 * it. The project root is normally the top itself.
 * @param {string} top
 * @param {string} root
 */
export function snapshotScope(top, root) {
  const prefix = path.relative(fs.realpathSync(top), fs.realpathSync(root)).split(path.sep).join('/');
  const under = (/** @type {string} */ relative) => (prefix === '' ? relative : `${prefix}/${relative}`);
  return {
    covered: prefix === '' ? '.' : `:(literal)${prefix}`,
    excludes: SNAPSHOT_EXCLUDES.map(under),
  };
}

/**
 * Run `work` with GIT_INDEX_FILE pointing at a fresh temporary index outside
 * the repository, and always delete it afterwards. The path is absolute: git
 * resolves a relative GIT_INDEX_FILE against the top of the working tree.
 * @template T
 * @param {(env: NodeJS.ProcessEnv, file: string) => T} work
 * @returns {T}
 */
export function withTemporaryIndex(work) {
  const file = path.join(os.tmpdir(), `agenticloop-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    return work({ GIT_INDEX_FILE: file }, file);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.lock`, { force: true });
  }
}

/**
 * Which of the boolean settings named are on. A value git cannot read counts
 * as on, so a doubtful setting takes the cautious path.
 * @param {string} top
 * @param {string[]} keys lowercase
 */
function settingsOn(top, keys) {
  const pattern = `^(${keys.map((key) => key.replace(/\./g, '\\.')).join('|')})$`;
  try {
    const found = git(top, ['config', '-z', '--type=bool', '--get-regexp', pattern]);
    return found.split('\0').filter((entry) => entry.endsWith('\ntrue')).map((entry) => entry.slice(0, entry.indexOf('\n')));
  } catch (error) {
    // Exit 1 means none is set; anything else is a value git could not read.
    return /** @type {{status?: number}} */ (error).status === 1 ? [] : keys;
  }
}

/**
 * Whether the working tree is a sparse checkout, where files outside the
 * checkout cone are absent on purpose.
 * @param {string} top
 */
function isSparse(top) {
  return settingsOn(top, ['core.sparsecheckout', 'index.sparse']).length > 0;
}

/**
 * The repository's own index, when a copy of it can seed a temporary one: not
 * split into a shared file, not sparse, present, and with no entry marked
 * assume-unchanged or skip-worktree, since a merged entry keeps those marks
 * and git would then not look at the file.
 * @param {string} top
 * @returns {string|null}
 */
function copyableIndex(top) {
  try {
    const [index, shared] = git(top, ['rev-parse', '--git-path', 'index', '--shared-index-path']).split(/\r?\n/);
    if ((shared ?? '').trim() !== '') return null;
    if (settingsOn(top, ['core.sparsecheckout', 'index.sparse', 'core.ignorestat']).length > 0) return null;
    const file = path.resolve(top, index.trim());
    if (!fs.existsSync(file)) return null;
    const entries = git(top, ['ls-files', '-v', '-z']).split('\0');
    return entries.some((entry) => /^([a-z]|S) /.test(entry)) ? null : file;
  } catch {
    return null;
  }
}

/**
 * Fill the temporary index with `tree`. A copy of the real index, merged with
 * the tree by `read-tree -m`, keeps the real index's stat data for every entry
 * the tree has unchanged, so git re-reads only files that changed. A fresh
 * `read-tree` has no stat data, and every file is hashed again. The result
 * holds the same entries either way.
 * @param {string} top
 * @param {NodeJS.ProcessEnv} env
 * @param {string} file the temporary index
 * @param {string} tree a tree-ish
 * @param {boolean} reuse
 */
function seedIndex(top, env, file, tree, reuse) {
  const real = reuse ? copyableIndex(top) : null;
  if (real !== null) {
    try {
      fs.copyFileSync(real, file);
      indexGit(top, ['read-tree', '-m', tree], env);
      return;
    } catch {
      // An index with unresolved conflicts cannot be merged; start empty.
      fs.rmSync(file, { force: true });
    }
  }
  indexGit(top, ['read-tree', tree], env);
}

/**
 * Snapshot the working tree under the project root.
 * @param {string} root the project root
 * @param {{reuseIndex?: boolean}} [options] reuseIndex false always starts from an empty index
 * @returns {{ref: string, tree: string, base: string|null, paths: string[]}}
 */
export function takeSnapshot(root, options = {}) {
  const top = workTreeTop(root);
  if (top === null) {
    throw new PublicError('snapshot needs a git working tree', {
      hint: 'A snapshot is a git tree object. Outside git, describe the candidate in the record instead.',
    });
  }
  // Every other command reads the project from where it runs, so run from a
  // subdirectory, a snapshot would have named only that subdirectory's files.
  if (!fs.existsSync(path.join(root, STATE_DIRECTORY))) {
    throw new PublicError(`${STATE_DIRECTORY}/ does not exist here`, {
      hint: 'Run snapshot from the project root, where setup created .agenticloop/. Nothing was written.',
    });
  }
  let base = null;
  try {
    base = git(top, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).trim() || null;
  } catch {
    base = null;
  }
  const scope = snapshotScope(top, root);
  return withTemporaryIndex((env, file) => {
    if (base === null) indexGit(top, ['read-tree', '--empty'], env);
    else seedIndex(top, env, file, base, options.reuseIndex !== false);
    // No exclusion goes to `git add`: one naming an ignored path that holds
    // tracked files makes it refuse. Everything is added, then each excluded
    // path is put back as the base has it.
    indexGit(top, ['add', '-A', '--', scope.covered], env);
    for (const excluded of scope.excludes) {
      indexGit(top, base === null
        ? ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', `:(literal)${excluded}`]
        : ['reset', '-q', base, '--', `:(literal)${excluded}`], env);
    }
    const tree = indexGit(top, ['write-tree'], env).trim();
    const changed = base === null
      ? git(top, ['ls-tree', '-r', '-z', '--name-only', tree])
      : git(top, ['diff', '--name-only', '-z', '--no-renames', base, tree]);
    const paths = changed.split('\0').filter((entry) => entry !== '');
    return { ref: `${TREE_PREFIX}${tree}`, tree, base, paths };
  });
}

/**
 * The paths where the working tree under root differs from a snapshot, under
 * the same exclusions: changed, deleted, or untracked and not ignored. Reads
 * only; writes nothing into `.git`.
 * @param {string} root
 * @param {string} tree
 * @param {{reuseIndex?: boolean}} [options]
 * @returns {string[]|null} null when it could not be established
 */
export function snapshotDrift(root, tree, options = {}) {
  const top = workTreeTop(root);
  if (top === null) return null;
  // In a sparse checkout, files outside the cone are absent on purpose, and
  // would all read as deleted. Nothing was checked, so nothing is reported.
  if (isSparse(top)) return null;
  const scope = snapshotScope(top, root);
  const pathspec = [scope.covered, ...scope.excludes.map((excluded) => `:(exclude,literal)${excluded}`)];
  try {
    return withTemporaryIndex((env, file) => {
      seedIndex(top, env, file, tree, options.reuseIndex !== false);
      const status = indexGit(top, [
        'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=dirty', '--', ...pathspec,
      ], env);
      const paths = [];
      for (const entry of status.split('\0')) {
        if (entry.length < 4) continue;
        const code = entry.slice(0, 2);
        // The second column is the working tree against the temporary index,
        // which holds exactly the snapshot; the first compares it with HEAD.
        if (code === '??' || code[1] !== ' ') paths.push(entry.slice(3));
      }
      return paths;
    });
  } catch {
    return null;
  }
}
