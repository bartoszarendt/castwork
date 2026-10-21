/**
 * The install lifecycle: setup, update, remove, doctor.
 *
 * Ownership is the whole model. `.castwork/generated.json` lists every
 * generated file with its digest. A file whose digest still matches is ours to
 * regenerate or delete; anything else is yours. An update that would have to
 * leave a file of yours in place refuses before writing anything, unless
 * `--force-generated` names that file.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { compareVersions, generateAll, packageVersion, sourceDigest, toolkitRoot } from './adapter-generation.js';
import { readConfig, writeConfig } from './config.js';
import { containedPath, digest, diskDigest, installPath, ownership, readLocalManifest, readManifest, writeLocalManifest, writeManifest } from './generated.js';
import {
  CONFIG_FILE,
  DECISIONS_DIRECTORY,
  FINDINGS_DIRECTORY,
  GENERATED_MANIFEST,
  HOSTS,
  LAYOUT_VERSION,
  LOCAL_CONFIG_FILE,
  LOCAL_DIRECTORY,
  PROJECT_FILE,
  REVIEWS_DIRECTORY,
  RUNS_DIRECTORY,
  STATE_DIRECTORY,
  TASKS_DIRECTORY,
} from './layout.js';
import { PublicError } from './public-error.js';

const STATE_DIRECTORIES = Object.freeze([STATE_DIRECTORY, TASKS_DIRECTORY, DECISIONS_DIRECTORY, FINDINGS_DIRECTORY, REVIEWS_DIRECTORY, LOCAL_DIRECTORY]);

/**
 * A file where a state directory belongs would be kept and the directory never
 * made, so refuse before anything is written.
 * @param {string} root
 */
function refuseStateConflicts(root) {
  const conflicts = STATE_DIRECTORIES.filter((directory) => {
    const stat = fs.statSync(installPath(root, directory), { throwIfNoEntry: false });
    return stat !== undefined && !stat.isDirectory();
  });
  if (conflicts.length) {
    throw new PublicError(`nothing was written: ${conflicts.join(', ')} ${conflicts.length === 1 ? 'is' : 'are'} not a directory`, {
      hint: 'Move or rename what is there, then run setup again.',
    });
  }
}

/**
 * Seed the target-owned state.
 *
 * Every path is resolved through `installPath` first, so a link standing where
 * one of these belongs is refused before anything is created rather than
 * followed out of the repository.
 *
 * @param {string} root
 */
function seedState(root) {
  const created = [];
  for (const directory of STATE_DIRECTORIES) {
    const full = installPath(root, directory);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      created.push(directory);
    }
  }
  const project = installPath(root, PROJECT_FILE);
  if (!fs.existsSync(project)) {
    fs.copyFileSync(path.join(toolkitRoot(), 'memory', 'scaffold', 'project.md'), project);
    created.push(PROJECT_FILE);
  }
  return created;
}

/**
 * The paths Git would show as changes: those it does not ignore. Generated
 * host folders are often gitignored, and then a file carrying this machine's
 * models is nothing Git sees. Without Git, or outside a repository, every path
 * counts as seen, so nothing is called safe that has not been checked.
 *
 * @param {string} root
 * @param {string[]} paths
 * @returns {string[]}
 */
function gitVisible(root, paths) {
  if (paths.length === 0) return [];
  try {
    const ignored = execFileSync('git', ['--no-optional-locks', '-C', root, 'check-ignore', '--stdin', '-z'], {
      encoding: 'utf8',
      input: `${paths.join('\0')}\0`,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).split('\0');
    return paths.filter((relative) => !ignored.includes(relative));
  } catch {
    // Exit 1 is check-ignore's answer that none of them is ignored.
    return paths;
  }
}

/**
 * How Git treats one path: tracked, ignored, or neither (`visible`). Null
 * outside a repository or without Git, where there is nothing to commit.
 *
 * @param {string} root
 * @param {string} relative
 * @returns {'tracked'|'ignored'|'visible'|null}
 */
function gitState(root, relative) {
  /** @param {string[]} args @returns {number|null} exit status, or null when Git could not answer */
  const status = (args) => {
    try {
      execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { stdio: 'ignore', timeout: 10000 });
      return 0;
    } catch (error) {
      const code = /** @type {{status?: number|null}} */ (error).status;
      return code === 1 ? 1 : null;
    }
  };
  const tracked = status(['ls-files', '--error-unmatch', '--', relative]);
  if (tracked === null) return null;
  if (tracked === 0) return 'tracked';
  const ignored = status(['check-ignore', '-q', '--', relative]);
  if (ignored === null) return null;
  return ignored === 0 ? 'ignored' : 'visible';
}

/** @param {string} root */
function ensureGitignore(root) {
  const file = installPath(root, '.gitignore');
  const line = `${LOCAL_DIRECTORY}/`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.split(/\r?\n/).some((entry) => entry.trim() === line)) return false;
  const next = existing === '' || existing.endsWith('\n') ? `${existing}${line}\n` : `${existing}\n${line}\n`;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

/**
 * @typedef {{
 *   version: string,
 *   toolkit: string,
 *   source_digest: string,
 *   manifest_version: string|null,
 *   manifest_source_digest: string|null,
 *   downgrade: boolean,
 *   identity_changed: boolean,
 *   unchanged: string[],
 *   changed: string[],
 *   added: string[],
 *   removed: string[],
 *   modified: string[],
 *   collisions: string[],
 *   manifest: 'added'|'changed'|null,
 *   local: string[],
 *   local_conflicts: string[],
 *   commit: boolean,
 *   files: Record<string, string>,
 *   contents: Record<string, string>,
 *   local_files: Record<string, string>,
 * }} GenerationPlan
 */

/**
 * What this machine writes, and what the project generates. They differ only
 * where `.castwork/local/castwork.json` chooses other models; the project's output is
 * what the tracked manifest records.
 *
 * @param {import('./config.js').Config} config
 */
function generatedFiles(config) {
  const shared = generateAll(config.hosts, { roleSettings: config.role_settings, roleRoutes: config.role_routes, roleLevels: config.role_levels });
  if (config.local === null) return { files: shared, shared };
  try {
    return {
      files: generateAll(config.hosts, { roleSettings: config.local.role_settings, roleRoutes: config.local.role_routes, roleLevels: config.local.role_levels }),
      shared,
    };
  } catch (error) {
    if (!(error instanceof PublicError)) throw error;
    throw new PublicError(error.message, {
      hint: [error.hint, `${CONFIG_FILE} alone generates, so the value that fails is one ${LOCAL_CONFIG_FILE} sets.`].filter(Boolean).join(' '),
    });
  }
}

/**
 * Compare what this toolkit would generate with what is on disk. Reads only.
 *
 * Every generated path lands in exactly one list. `modified` (a generated file
 * you edited, or one no longer generated that you edited) and `collisions` (a
 * file of yours standing where one would be generated) block an update unless
 * `--force-generated` names them; a forced path is planned as a change, or as
 * a removal when it is no longer generated. A file that already holds exactly
 * what would be generated is `unchanged` whoever wrote it, so a lost manifest
 * or a hand-synced file is adopted instead of refused. `manifest` says whether
 * `.castwork/generated.json` itself would be written, since it is tracked
 * like the files it lists and has to be committed with them.
 *
 * `shared` is what the project generates, when `files` carries this machine's
 * models from `.castwork/local/castwork.json`. The manifest records the project's
 * digests, so it reads the same on every machine; `local` lists the files
 * written with this machine's models instead, which stay out of commits.
 *
 * @param {string} root
 * @param {{path: string, content: string}[]} files
 * @param {{force?: string[], shared?: {path: string, content: string}[]}} [options]
 * @returns {GenerationPlan}
 */
export function planGenerated(root, files, options = {}) {
  const manifest = readManifest(root);
  const localManifest = readLocalManifest(root);
  const shared = new Map((options.shared ?? files).map((file) => [file.path, digest(file.content)]));
  // One spelling per path, so `./x` and `x`, or `a\\b` and `a/b`, name the same file.
  const force = new Set((options.force ?? []).map((relative) => path.posix.normalize(relative.replace(/\\/g, '/'))));
  /** @type {GenerationPlan} */
  const plan = {
    version: packageVersion(),
    toolkit: toolkitRoot(),
    source_digest: sourceDigest(),
    manifest_version: manifest === null || manifest.version === '' ? null : manifest.version,
    manifest_source_digest: manifest?.source_digest ?? null,
    downgrade: false,
    identity_changed: false,
    unchanged: [],
    changed: [],
    added: [],
    removed: [],
    modified: [],
    collisions: [],
    manifest: null,
    local: [],
    local_conflicts: [],
    commit: false,
    files: {},
    contents: {},
    local_files: {},
  };
  /** Changed paths whose change is this machine's models arriving or leaving. @type {Set<string>} */
  const localChanges = new Set();

  for (const file of files) {
    const wanted = digest(file.content);
    const recorded = shared.get(file.path);
    if (recorded === undefined) throw new Error(`generated ${file.path} for this machine but not for the project`);
    plan.files[file.path] = recorded;
    plan.contents[file.path] = file.content;
    if (wanted !== recorded) {
      plan.local.push(file.path);
      plan.local_files[file.path] = wanted;
      // The project's own output for this file changed too, so what is
      // committed for it has to be the project's, not this machine's.
      if (manifest?.files?.[file.path] !== recorded) plan.local_conflicts.push(file.path);
    }
    const state = ownership(root, file.path, manifest, localManifest);
    if (state === 'absent') {
      plan.added.push(file.path);
      continue;
    }
    const actual = diskDigest(containedPath(root, file.path));
    if (wanted !== recorded || actual === localManifest[file.path]) localChanges.add(file.path);
    if (actual === wanted) plan.unchanged.push(file.path);
    else if (state === 'owned_unchanged' || force.has(file.path)) plan.changed.push(file.path);
    else if (state === 'owned_modified') plan.modified.push(file.path);
    else plan.collisions.push(file.path);
  }

  // Files we used to own and no longer generate.
  for (const [relative, recorded] of Object.entries(manifest?.files ?? {})) {
    if (plan.files[relative] !== undefined) continue;
    const full = containedPath(root, relative);
    if (!fs.existsSync(full)) continue;
    const actual = diskDigest(full);
    if (actual === recorded || actual === localManifest[relative] || force.has(relative)) plan.removed.push(relative);
    else plan.modified.push(relative);
  }

  // A force naming nothing this installation generates or recorded would
  // otherwise be dropped in silence, and the refusal it was meant to lift would
  // read as if the flag had not worked.
  const unknown = [...force].filter((relative) => plan.files[relative] === undefined && manifest?.files?.[relative] === undefined);
  if (unknown.length > 0) {
    throw new PublicError(`--force-generated names a path this installation neither generates nor recorded: ${unknown.join(', ')}`, {
      hint: 'Name the path exactly as update or doctor printed it. Nothing was written.',
    });
  }

  // A manifest written by a newer copy is refused rather than rewritten by an
  // older one: an old pinned CLI regenerating over newer output silently takes
  // back whatever the newer presets fixed.
  if (plan.manifest_version !== null) plan.downgrade = (compareVersions(plan.manifest_version, plan.version) ?? 0) > 0;
  // Which generator wrote the manifest. Differing alone is not behind: the
  // files may be exactly what this copy generates. A write records it.
  plan.identity_changed = manifest !== null
    && (plan.manifest_version !== plan.version || plan.manifest_source_digest !== plan.source_digest);

  if (manifest === null) plan.manifest = 'added';
  else if (manifest.layout_version !== LAYOUT_VERSION
    || JSON.stringify(sortedEntries(manifest.files)) !== JSON.stringify(sortedEntries(plan.files))) plan.manifest = 'changed';

  // Whether applying this plan leaves something to commit. Applying, switching
  // or dropping this machine's models leaves the manifest as it is and is
  // never committed; anything else is the project's output changing.
  plan.commit = plan.manifest !== null
    || plan.identity_changed
    || plan.added.length > 0
    || plan.removed.length > 0
    || plan.changed.some((relative) => !localChanges.has(relative));
  return plan;
}

/** @param {Record<string, string>} files */
function sortedEntries(files) {
  return Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1));
}

/** @param {GenerationPlan} plan */
function planIsBlocked(plan) {
  return plan.downgrade || plan.modified.length > 0 || plan.collisions.length > 0;
}

/** @param {GenerationPlan} plan */
function planIsCurrent(plan) {
  return !planIsBlocked(plan)
    && plan.changed.length === 0
    && plan.added.length === 0
    && plan.removed.length === 0
    && plan.manifest === null;
}

/**
 * A plan without file contents, for printing, `--json`, and `doctor`.
 * @param {GenerationPlan} plan
 */
export function publicPlan(plan) {
  const { files: _files, contents: _contents, local_files: _localFiles, ...rest } = plan;
  return { ...rest, current: planIsCurrent(plan), blocked: planIsBlocked(plan) };
}

/**
 * Refuse, before anything is written, a plan that would leave some generated
 * files old and others new: an agent reading a half-updated installation cannot
 * tell which half it has.
 *
 * @param {GenerationPlan} plan
 */
function refuseBlocked(plan) {
  if (!planIsBlocked(plan)) return;
  if (plan.downgrade) {
    throw new PublicError(
      `nothing was written: ${GENERATED_MANIFEST} was written by castwork ${plan.manifest_version}, newer than this copy, ${plan.version}, at ${plan.toolkit}`,
      {
        hint: [
          'Run the newer copy instead: move the version this repository pins, or run the',
          'checkout that wrote it with node <checkout>/bin/castwork.js. Check which copy',
          'runs with npx --no castwork version.',
        ].join('\n'),
      },
    );
  }
  const lines = [
    ...plan.modified.map((relative) => `  ${relative} (generated, then modified locally)`),
    ...plan.collisions.map((relative) => `  ${relative} (yours; not generated by this installation)`),
  ];
  throw new PublicError(`nothing was written: ${lines.length} generated path(s) would be left as they are\n${lines.join('\n')}`, {
    hint: [
      'Restore or move each file and run the command again, or name each one with',
      '--force-generated <path> to replace it with the generated version, or to',
      'delete it when it is no longer generated.',
    ].join('\n'),
  });
}

/**
 * Apply a plan that is not blocked. Writes only what differs, and rewrites the
 * manifest only when its contents change, so an update with nothing to do
 * leaves the working tree untouched.
 *
 * Writes are not transactional: a write that fails partway, such as on a full
 * disk, leaves some files new and the manifest old. Running update again
 * finishes the job, because a file that already holds what would be generated
 * is adopted. There is deliberately no rollback.
 *
 * @param {string} root
 * @param {GenerationPlan} plan
 */
function applyPlan(root, plan) {
  refuseBlocked(plan);
  for (const relative of [...plan.added, ...plan.changed]) {
    const full = containedPath(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, plan.contents[relative], 'utf8');
  }
  for (const relative of plan.removed) fs.rmSync(containedPath(root, relative));

  // Dropping a host from the config and running `update` is the documented way
  // to stop generating for it, so the directories it owned should not be left
  // standing empty afterwards, looking installed.
  pruneEmptyDirectories(root, plan.removed);

  const manifest = plan.manifest ?? (plan.identity_changed ? 'changed' : null);
  if (manifest !== null) {
    writeManifest(root, { layout_version: LAYOUT_VERSION, version: plan.version, source_digest: plan.source_digest, files: plan.files });
  }
  // Untracked bookkeeping, kept in step on every write so a later change to
  // .castwork/local/castwork.json finds the files it wrote still ours.
  writeLocalManifest(root, plan.local_files);
  return { added: plan.added, changed: plan.changed, removed: plan.removed, unchanged: plan.unchanged, manifest, local: plan.local, commit: plan.commit };
}

/**
 * Install, or add a host to an installation.
 *
 * Naming a host adds it to the recorded set; it never replaces it. Under the
 * previous rule `setup --host claude` in a repository that already generated
 * for Codex left `hosts` as `["claude"]`, and the ownership pass then deleted
 * every Codex file it still owned. That is a tracked deletion nobody asked for,
 * and it made a contributor's own host choice a change to the whole repository.
 * Dropping a host is a deliberate edit to `castwork.json` followed by
 * `update`, which removes what it no longer generates.
 *
 * @param {string} root
 * @param {{hosts?: string[], force?: string[]}} [options]
 */
export function setup(root, options = {}) {
  // The project's hosts alone: the local file is checked below, against the
  // hosts with any added, so `setup --host` can add the host a local route names.
  const existing = readConfig(root, { local: false });
  const added = [];
  for (const host of options.hosts ?? []) {
    if (!existing.hosts.includes(host) && !added.includes(host)) added.push(host);
  }
  const hosts = [...existing.hosts, ...added];
  if (hosts.length === 0) {
    throw new PublicError('no hosts selected', {
      hint: `Pass --host <name> (one or more of ${HOSTS.join(', ')}), or list them under "hosts" in ${CONFIG_FILE}.`,
    });
  }

  // Planned before anything is seeded, so a refusal leaves the tree as it was.
  const config = readConfig(root, { hosts });
  const { files, shared } = generatedFiles(config);
  const plan = planGenerated(root, files, { force: options.force, shared });
  refuseBlocked(plan);
  refuseStateConflicts(root);

  const created = seedState(root);
  writeConfig(root, hosts);
  const ignored = ensureGitignore(root);
  return { hosts, added_hosts: added, created, ignored, version: plan.version, ...applyPlan(root, plan), ...gitReview(root, plan), reapply: false };
}

/**
 * Regenerate for the recorded hosts, refusing before any write when a file
 * would have to be left as it is. `check` plans and writes
 * nothing: it is how an agent or CI learns whether this repository is behind
 * the toolkit it just ran, which the package version alone cannot say, since
 * it does not change between unreleased builds.
 *
 * `shared` generates the project's output alone, as if there were no
 * `.castwork/local/castwork.json`: the way to write files that match the manifest
 * before committing a change to the project's output, after which a plain
 * `update` puts this machine's models back.
 *
 * @param {string} root
 * @param {{force?: string[], check?: boolean, shared?: boolean}} [options]
 */
export function update(root, options = {}) {
  // --shared never reads .castwork/local/castwork.json, so a stale override cannot stop
  // the project's own output from being written.
  const config = readConfig(root, { local: options.shared !== true });
  if (config.hosts.length === 0) {
    throw new PublicError(`${CONFIG_FILE} lists no hosts`, { hint: 'Run setup first.' });
  }
  const { files, shared } = generatedFiles(config);
  const plan = planGenerated(root, files, { force: options.force, shared });
  const review = gitReview(root, plan);
  const reapply = options.shared === true && fs.existsSync(path.join(root, LOCAL_CONFIG_FILE));
  if (options.check) return { hosts: config.hosts, plan: { ...publicPlan(plan), ...review, reapply } };
  return { hosts: config.hosts, version: plan.version, ...applyPlan(root, plan), ...review, reapply };
}

/**
 * What a plan leaves to commit, judged against the last commit rather than
 * the manifest on disk, which an earlier update may already have moved on.
 *
 * - `local_visible`: files carrying this machine's models that Git would show.
 * - `local_conflicts`: those whose committed version is not what the manifest
 *   records. Leaving one out of a commit is not enough: the committed manifest
 *   would name output the clone lacks. Only `update --shared` writes it.
 * - `pending`: files holding the project's output whose committed version is
 *   not what the manifest records, such as a model the project adopted from
 *   this machine. They are committed with the manifest, though this update
 *   may not have written them.
 * - `commit`: whether anything is left to commit at all.
 *
 * Without Git, or before a first commit, the plan alone decides.
 *
 * @param {string} root
 * @param {GenerationPlan} plan
 */
function gitReview(root, plan) {
  const visible = gitVisible(root, plan.local);
  const committed = committedFiles(root, [GENERATED_MANIFEST, ...Object.keys(plan.files)]);
  if (committed === null) {
    return { local_visible: visible, local_conflicts: visible.filter((relative) => plan.local_conflicts.includes(relative)), pending: [], commit: plan.commit };
  }
  const differs = (/** @type {string} */ relative) => committed.has(relative) && digest(committed.get(relative) ?? '') !== plan.files[relative];
  const local = new Set(plan.local);
  const conflicts = visible.filter((relative) => plan.local_conflicts.includes(relative) || differs(relative));
  const pending = Object.keys(plan.files).filter((relative) => !local.has(relative) && differs(relative)).sort();

  let manifestDiffers = false;
  const text = committed.get(GENERATED_MANIFEST);
  if (text !== undefined) {
    try {
      const head = JSON.parse(text);
      manifestDiffers = head.version !== plan.version
        || head.source_digest !== plan.source_digest
        || JSON.stringify(sortedEntries(head.files ?? {})) !== JSON.stringify(sortedEntries(plan.files));
    } catch {
      manifestDiffers = true;
    }
  }
  return { local_visible: visible, local_conflicts: conflicts, pending, commit: plan.commit || manifestDiffers || pending.length > 0 || conflicts.length > 0 };
}

/**
 * The committed text of each path that has one, line endings read as LF, from
 * one `git cat-file --batch`. Null outside a repository or without Git.
 *
 * @param {string} root
 * @param {string[]} paths
 * @returns {Map<string, string>|null}
 */
function committedFiles(root, paths) {
  /** @param {string[]} args @param {string} [input] */
  const run = (args, input) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    input,
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10000,
  });
  /** @type {Map<string, string>} */
  const found = new Map();
  try {
    // Paths are relative to the target, which may sit below the repository root.
    const prefix = run(['rev-parse', '--show-prefix']).toString('utf8').trim();
    const out = run(['cat-file', '--batch'], paths.map((relative) => `HEAD:${prefix}${relative}\n`).join(''));
    let at = 0;
    for (const relative of paths) {
      const end = out.indexOf(0x0a, at);
      if (end === -1) break;
      const header = out.subarray(at, end).toString('utf8');
      at = end + 1;
      const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
      if (!match) continue;
      const size = Number(match[1]);
      found.set(relative, out.subarray(at, at + size).toString('utf8').replace(/\r\n/g, '\n'));
      at += size + 1;
    }
  } catch {
    return null;
  }
  return found;
}

/**
 * Deletes only manifest entries whose digest still matches. Never touches
 * project.md, tasks/, or decisions/.
 * @param {string} root
 */
export function remove(root) {
  const manifest = readManifest(root);
  if (!manifest) {
    throw new PublicError('nothing to remove: no generated manifest found');
  }
  const local = readLocalManifest(root);
  const removed = [];
  const kept = [];
  for (const [relative, recorded] of Object.entries(manifest.files)) {
    const full = containedPath(root, relative);
    if (!fs.existsSync(full)) continue;
    const actual = diskDigest(full);
    if (actual === recorded || actual === local[relative]) {
      fs.rmSync(full);
      removed.push(relative);
    } else {
      kept.push(relative);
    }
  }
  pruneEmptyDirectories(root, removed);
  fs.rmSync(containedPath(root, GENERATED_MANIFEST), { force: true });
  writeLocalManifest(root, {});
  return { removed, kept };
}

/** @param {string} root @param {string[]} relatives */
function pruneEmptyDirectories(root, relatives) {
  const directories = new Set();
  for (const relative of relatives) {
    let dir = path.dirname(relative);
    while (dir && dir !== '.' && dir !== path.sep) {
      directories.add(dir);
      dir = path.dirname(dir);
    }
  }
  for (const dir of [...directories].sort((a, b) => b.length - a.length)) {
    /** @type {string} */
    let full;
    try {
      full = containedPath(root, dir);
    } catch {
      continue;
    }
    try {
      if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } catch {
      // A directory that will not go is not a failure worth reporting.
    }
  }
}

/**
 * Read-only diagnosis.
 * @param {string} root
 */
export function doctor(root) {
  const manifest = readManifest(root);
  const config = readConfig(root);
  const findings = [];

  if (!fs.existsSync(path.join(root, STATE_DIRECTORY))) {
    findings.push({ level: 'error', message: `${STATE_DIRECTORY}/ is missing`, next: 'Run setup.' });
  }
  if (config.hosts.length === 0) {
    findings.push({ level: 'warn', message: `${CONFIG_FILE} lists no hosts`, next: 'Run setup and select a host.' });
  }
  if (!manifest) {
    // update rebuilds a lost manifest, adopting files that already match, so
    // it is the command to run once hosts are recorded.
    findings.push({ level: 'warn', message: `${GENERATED_MANIFEST} is missing`, next: config.hosts.length > 0 ? 'Run update.' : 'Run setup.' });
  } else if (manifest.layout_version !== LAYOUT_VERSION) {
    findings.push({
      level: 'error',
      message: `${GENERATED_MANIFEST} declares layout_version ${manifest.layout_version}, expected ${LAYOUT_VERSION}`,
    });
  }

  // The same plan `update --check` prints, so the two never disagree about
  // whether this repository is current.
  /** @type {'current'|'behind'|'blocked'|null} */
  let generated = null;
  /** @type {string[]} */
  let local = [];
  let seen = { local_visible: /** @type {string[]} */ ([]), local_conflicts: /** @type {string[]} */ ([]), pending: /** @type {string[]} */ ([]) };
  const layoutSpoken = manifest === null || manifest.layout_version === LAYOUT_VERSION;
  if (layoutSpoken && config.hosts.length > 0 && fs.existsSync(path.join(root, STATE_DIRECTORY))) {
    const { files, shared } = generatedFiles(config);
    const plan = planGenerated(root, files, { shared });
    // This copy is older than the one that wrote the manifest, and refuses to
    // update, so neither update nor --force-generated is the way forward.
    const newer = plan.downgrade
      ? `Run the newer copy, castwork ${plan.manifest_version}, that wrote ${GENERATED_MANIFEST}; this copy, ${plan.version}, refuses to update.`
      : null;
    for (const relative of plan.modified) {
      findings.push({
        level: 'warn',
        message: `generated file modified locally: ${relative}`,
        next: newer ?? `update writes nothing until you restore it or pass --force-generated ${relative}, which overwrites the edit. `
          + 'A host reads its files when a session starts, so an edit takes effect only in a new session. '
          + `Change the canonical source or ${CONFIG_FILE} instead.`,
      });
    }
    for (const relative of plan.collisions) {
      findings.push({ level: 'warn', message: `a file of yours stands where one is generated: ${relative}`, next: newer ?? `update writes nothing until you move it or pass --force-generated ${relative}` });
    }
    const review = gitReview(root, plan);
    seen = { local_visible: review.local_visible, local_conflicts: review.local_conflicts, pending: review.pending };
    const differing = plan.changed.length + plan.added.length + plan.removed.length;
    if (differing > 0 && !review.commit) {
      // Applying, switching or dropping this machine's models: the manifest
      // stays as it is and nothing is committed.
      findings.push({
        level: 'warn',
        message: `${differing} generated file(s) differ only in this machine's models and routes from ${LOCAL_CONFIG_FILE}`,
        next: newer ?? 'Run update, then start a new host session. There is nothing to commit.',
      });
    } else if (differing > 0) {
      findings.push({
        level: 'warn',
        message: `${differing} generated file(s) differ from what castwork ${plan.version} generates`,
        next: newer ?? 'Run update --check to list them, then update. Commit the result on its own and start a new host session.',
      });
    } else if (plan.manifest === 'changed') {
      findings.push({
        level: 'warn',
        message: `${GENERATED_MANIFEST} does not match the generated files`,
        next: newer ?? 'Run update to rewrite it, then commit it.',
      });
    }
    if (seen.local_conflicts.length > 0) {
      findings.push({
        level: 'warn',
        message: `the project's output changed under files carrying this machine's models and routes: ${seen.local_conflicts.join(', ')}`,
        next: `Committing the manifest without the project's version of these leaves a clone that refuses to update. Run update --shared, commit, then run update to put your models back.`,
      });
    }
    if (review.pending.length > 0) {
      findings.push({
        level: 'warn',
        message: `generated file(s) not yet committed as the manifest records them: ${review.pending.join(', ')}`,
        next: `Commit them with ${GENERATED_MANIFEST}; a clone of the last commit refuses to update until they agree.`,
      });
    }
    generated = planIsBlocked(plan) ? 'blocked' : planIsCurrent(plan) ? 'current' : 'behind';
    local = plan.local;
  }

  if (fs.existsSync(path.join(root, LOCAL_CONFIG_FILE))) {
    const state = gitState(root, LOCAL_CONFIG_FILE);
    if (state === 'tracked') {
      findings.push({
        level: 'warn',
        message: `${LOCAL_CONFIG_FILE} is tracked by Git`,
        next: `It holds this machine's models and routes and stays out of commits. Run git rm --cached ${LOCAL_CONFIG_FILE} and commit that.`,
      });
    } else if (state === 'visible') {
      findings.push({
        level: 'warn',
        message: `${LOCAL_CONFIG_FILE} is not ignored by Git`,
        next: `It holds this machine's models and routes and stays out of commits. Run setup, which adds ${LOCAL_DIRECTORY}/ to .gitignore, and check no other rule brings the file back.`,
      });
    }
  }
  if (manifest !== null) findings.push(...identityFindings(manifest));
  const project = projectFinding(root);
  if (project) findings.push(project);
  findings.push(...writtenFindings(root));

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    hosts: config.hosts,
    version: manifest?.version ?? null,
    source_digest: manifest?.source_digest ?? null,
    toolkit_version: packageVersion(),
    toolkit_location: toolkitRoot(),
    toolkit_source_digest: sourceDigest(),
    generated,
    generated_files: manifest ? Object.keys(manifest.files).length : 0,
    local_models: local,
    ...seen,
    findings,
  };
}

/**
 * Whether the copy running now is the one that wrote the manifest. A newer
 * manifest makes `setup` and `update` refuse; a different generator under
 * the same version is only worth knowing.
 *
 * @param {import('./generated.js').Manifest} manifest
 * @returns {{level: 'warn', message: string, next: string}[]}
 */
function identityFindings(manifest) {
  const running = packageVersion();
  const location = toolkitRoot();
  const order = manifest.version === '' ? null : compareVersions(manifest.version, running);
  if (order !== null && order > 0) {
    return [{
      level: 'warn',
      message: `${GENERATED_MANIFEST} was written by castwork ${manifest.version}, newer than the copy running now, ${running} at ${location}`,
      next: `setup and update refuse to write with this copy. Run the newer copy, castwork ${manifest.version}, or move the version this repository pins.`,
    }];
  }
  if (manifest.version !== running) {
    return [{
      level: 'warn',
      message: `${GENERATED_MANIFEST} was written by castwork ${manifest.version || 'an unknown version'}; the copy running now is ${running} at ${location}`,
      next: 'Check this is the copy you meant to run (npx --no castwork version), then run update --check.',
    }];
  }
  if (manifest.source_digest !== sourceDigest()) {
    return [{
      level: 'warn',
      message: manifest.source_digest === null
        ? `${GENERATED_MANIFEST} records no source_digest, so the build that wrote it is unknown`
        : `${GENERATED_MANIFEST} was written by a different build of castwork ${running} (${manifest.source_digest}); the copy running now is ${sourceDigest()} at ${location}`,
      next: 'Check this is the copy you meant to run. update records this build in the manifest.',
    }];
  }
  return [];
}

/** Past this, every role pays for project.md at every start. */
const LARGE_PROJECT_BYTES = 12 * 1024;

/**
 * `project.md` missing, empty, or still holding what `setup` seeded. Agents
 * read it for the working policy, the checks, and the plan, and a scaffold
 * says none of that. Whether what it says is still true is the agents' call;
 * this only spots what is plainly unwritten. A section the project removed is
 * its choice, and a file with headings of its own is not compared. Every role
 * reads it, so a written one that has grown large is a finding too.
 *
 * @param {string} root
 * @returns {{level: 'warn', message: string, next: string}|null}
 */
function projectFinding(root) {
  if (!fs.existsSync(path.join(root, STATE_DIRECTORY))) return null;
  const fill = 'what the project is, its working policy, its checks, its setup facts, and the documents that say what comes next';
  const file = path.join(root, PROJECT_FILE);
  if (!fs.existsSync(file)) {
    return { level: 'warn', message: `${PROJECT_FILE} is missing`, next: `Run setup to seed it, then fill in ${fill}.` };
  }
  const normalise = (/** @type {string} */ text) => text.replace(/\r\n/g, '\n').trim();
  const text = normalise(fs.readFileSync(file, 'utf8'));
  if (text === '') {
    return { level: 'warn', message: `${PROJECT_FILE} is empty`, next: `Write ${fill}.` };
  }
  const scaffold = normalise(fs.readFileSync(path.join(toolkitRoot(), 'memory', 'scaffold', 'project.md'), 'utf8'));
  if (text === scaffold) {
    return { level: 'warn', message: `${PROJECT_FILE} is still the scaffold setup wrote`, next: `Fill in ${fill}.` };
  }
  const written = sections(text);
  const unwritten = [...sections(scaffold)]
    .filter(([heading, body]) => written.has(heading) && (written.get(heading) === '' || written.get(heading) === body))
    .map(([heading]) => heading);
  if (unwritten.length === 0) {
    const size = Buffer.byteLength(text);
    if (size <= LARGE_PROJECT_BYTES) return null;
    return {
      level: 'warn',
      message: `${PROJECT_FILE} is ${Math.round(size / 1024)} KB, and every role reads it`,
      next: `Keep each fact to a line: move the detail into the documents it points to, saying what each holds and when to read it, and facts about this machine into ${LOCAL_DIRECTORY}/setup.md.`,
    };
  }
  return {
    level: 'warn',
    message: `${PROJECT_FILE} has sections still as setup wrote them, or empty: ${unwritten.join(', ')}`,
    next: 'Fill them in, or remove a section that does not apply here.',
  };
}

/** Past this, findings hold run output rather than what records link. */
const LARGE_FINDINGS_BYTES = 20 * 1024 * 1024;

/**
 * Findings and reviews are read from every clone: a record's link into
 * findings, and the next plan's look at earlier reviews, find nothing Git
 * left out. What makes findings large is run output, which no clone needs.
 *
 * @param {string} root
 * @returns {{level: 'warn', message: string, next: string}[]}
 */
function writtenFindings(root) {
  const out = [];
  for (const directory of [FINDINGS_DIRECTORY, REVIEWS_DIRECTORY]) {
    // Contained like every path the installer seeds: a link standing where
    // the directory belongs would have the scan report files from elsewhere.
    let start;
    try {
      start = installPath(root, directory);
    } catch (error) {
      out.push({
        level: 'warn',
        message: `${directory}/ was not checked: ${error instanceof Error ? error.message : String(error)}`,
        next: 'Keep it an ordinary directory inside the repository.',
      });
      continue;
    }
    const files = filesUnder(start).map((file) => ({ ...file, relative: `${directory}/${file.relative}` }));
    if (files.length === 0) continue;
    const visible = new Set(gitVisible(root, files.map((file) => file.relative)));
    const ignored = files.filter((file) => !visible.has(file.relative)).length;
    if (ignored > 0 && directory === REVIEWS_DIRECTORY) {
      out.push({
        level: 'warn',
        message: `${ignored} of ${files.length} file(s) in ${directory}/ are ignored by Git`,
        next: 'Reviews are read when later work is planned, in every clone: remove the rule that ignores them.',
      });
    } else if (ignored > 0) {
      out.push({
        level: 'warn',
        message: `${ignored} of ${files.length} file(s) in ${directory}/ are ignored by Git, so a record linking one breaks in every other clone`,
        next: `Keep what records link in Git, by narrowing the rule that ignores it or adding it with git add -f. Run output no record needs goes in ${RUNS_DIRECTORY}/, which is ignored already.`,
      });
    }
    const size = files.reduce((total, file) => total + file.size, 0);
    if (directory === FINDINGS_DIRECTORY && size > LARGE_FINDINGS_BYTES) {
      out.push({
        level: 'warn',
        message: `${directory}/ holds ${files.length} files, ${Math.round(size / (1024 * 1024))} MB`,
        next: `It is for notes and the files records link because a failure, an acceptance or a reproduction rests on them. Run output no record needs goes in ${RUNS_DIRECTORY}/, which Git ignores and snapshots leave out.`,
      });
    }
  }
  return out;
}

/**
 * Every regular file below a directory, relative to it with `/`, never
 * following a link. None when the directory is missing.
 * @param {string} directory
 * @returns {{relative: string, size: number}[]}
 */
function filesUnder(directory) {
  /** @type {{relative: string, size: number}[]} */
  const files = [];
  /** @param {string} relative */
  const walk = (relative) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(directory, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push({ relative: child, size: fs.statSync(path.join(directory, child)).size });
    }
  };
  walk('');
  return files;
}

/** Each `## ` section's body by heading. @param {string} text */
function sections(text) {
  /** @type {Map<string, string>} */
  const byHeading = new Map();
  for (const part of text.split(/^## /m).slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    byHeading.set(heading, newline === -1 ? '' : part.slice(newline + 1).trim());
  }
  return byHeading;
}
