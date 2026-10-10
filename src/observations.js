/**
 * Local observations, gathered by the CLI and handed to the pure checks.
 *
 * Optional and local only. Nothing is fetched from a remote. Whatever is not
 * gathered is left out of the maps entirely, and the checks report it as
 * `not_checked`, which is a different thing from `unavailable`: one means
 * nothing was looked at, the other means it was looked at and was not there.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isRelativePath } from './checks.js';
import { recordEntries } from './record.js';
import { git, snapshotDrift, snapshotTree } from './snapshot.js';

/** @param {string} target */
function realpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/**
 * Does this path really live inside the checkout?
 *
 * The real path of the link itself answers it when the link exists. When it
 * does not, the deepest existing ancestor answers instead, so a missing file
 * under a linked directory is skipped for the same reason an existing one is.
 * A path whose destination cannot be established at all is skipped, exactly as
 * an escaping path is.
 *
 * @param {string} realRoot
 * @param {string} resolved
 */
function resolvesInside(realRoot, resolved) {
  let current = resolved;
  for (;;) {
    const real = realpath(current);
    if (real !== null) return real === realRoot || real.startsWith(realRoot + path.sep);
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * What one CLI run has already looked up, so a lint over many records starts
 * one git process for all their references rather than one per candidate, and
 * compares the working tree with each snapshot once.
 *
 * @typedef {{root: string, repository: boolean|null, objects: Map<string, {oid: string, type: string}|null>, drift: Map<string, string[]|null>}} ObservationContext
 */

/** @param {string} root @returns {ObservationContext} */
export function observationContext(root) {
  return { root, repository: null, objects: new Map(), drift: new Map() };
}

/** @param {ObservationContext} context */
function isRepository(context) {
  if (context.repository === null) {
    try {
      git(context.root, ['rev-parse', '--git-dir']);
      context.repository = true;
    } catch {
      context.repository = false;
    }
  }
  return context.repository;
}

/**
 * The object lookups a record needs: each candidate as a commit, or as the
 * tree a `tree:<sha>` names, and, when the record has a snapshot, each commit
 * candidate's tree, so a commit made from the snapshot can be recognised.
 * A reference that cannot be one line of input is never looked up.
 *
 * @param {import('./record.js').ParsedRecord} record
 * @returns {string[]}
 */
function lookups(record) {
  const refs = recordEntries(record).candidates.map((candidate) => String(candidate.ref ?? '')).filter((ref) => ref !== '' && !/[\r\n\0]/.test(ref));
  const hasSnapshot = refs.some((ref) => snapshotTree(ref) !== null);
  const queries = [];
  for (const ref of refs) {
    if (ref.startsWith('tree:')) {
      const tree = snapshotTree(ref);
      if (tree !== null) queries.push(tree);
      continue;
    }
    queries.push(`${ref}^{commit}`);
    if (hasSnapshot) queries.push(`${ref}^{tree}`);
  }
  return queries;
}

/**
 * Resolve every lookup the records need that this run has not made yet, with
 * one `git cat-file --batch-check`. Each input line is read whole as an object
 * name, so a reference is data to git, never an option.
 *
 * @param {ObservationContext} context
 * @param {import('./record.js').ParsedRecord[]} records
 */
export function prefetchObjects(context, records) {
  if (!isRepository(context)) return;
  const pending = [...new Set(records.flatMap(lookups))].filter((query) => !context.objects.has(query));
  if (pending.length === 0) return;
  let lines = [];
  try {
    lines = git(context.root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: `${pending.join('\n')}\n` }).split('\n');
  } catch {
    // Nothing was looked up; each reference is asked about on its own below.
    return;
  }
  pending.forEach((query, index) => {
    const match = /^([0-9a-f]{40,64}) (commit|tree|blob|tag)$/.exec(lines[index] ?? '');
    context.objects.set(query, match ? { oid: match[1], type: match[2] } : null);
  });
}

/**
 * @param {ObservationContext} context
 * @param {string} query
 */
function object(context, query) {
  if (!context.objects.has(query)) {
    try {
      const [oid, type] = git(context.root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: `${query}\n` }).trim().split(' ');
      context.objects.set(query, /^[0-9a-f]{40,64}$/.test(oid) && type ? { oid, type } : null);
    } catch {
      context.objects.set(query, null);
    }
  }
  return context.objects.get(query) ?? null;
}

/**
 * Does this reference resolve in the local repository?
 * @param {ObservationContext} context
 * @param {string} ref
 */
function refResolves(context, ref) {
  if (/[\r\n\0]/.test(ref)) return false;
  if (ref.startsWith('tree:')) {
    const tree = snapshotTree(ref);
    return tree !== null && object(context, tree)?.type === 'tree';
  }
  return object(context, `${ref}^{commit}`)?.type === 'commit';
}

/**
 * Gather what can be observed locally about one record.
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} root
 * @param {ObservationContext} [context] shared across the records of one run
 * @param {{drift?: boolean}} [options] `drift: false` leaves the working tree uncompared
 * @returns {import('./checks.js').Observations}
 */
export function observe(record, root, context = observationContext(root), options = {}) {
  const { candidates, evidence, assessments } = recordEntries(record);
  // Null prototypes, because every key here comes from a record. On a plain
  // object `refs['__proto__'] = false` is a silent no-op and the later read
  // answers with Object.prototype, which reported an unresolvable ref as
  // available.
  /** @type {Record<string, boolean>} */
  const refs = Object.create(null);
  /** @type {Record<string, boolean>} */
  const files = Object.create(null);
  /** @type {Record<string, string[]>} */
  const drift = Object.create(null);
  /** @type {Record<string, string>} */
  const trees = Object.create(null);

  // Outside a repository nothing is recorded, because nothing was checked.
  // Recording `false` there would have reported every reference absent on the
  // strength of a lookup that never ran.
  if (isRepository(context)) {
    prefetchObjects(context, [record]);
    for (const candidate of candidates) {
      const ref = candidate.ref === undefined || candidate.ref === null ? '' : String(candidate.ref);
      if (ref === '') continue;
      refs[ref] = refResolves(context, ref);
    }

    // Drift only for the current candidate: it is the one evidence and
    // assessments are still being recorded against. Reading it compares the
    // working tree with a temporary index and writes nothing into `.git`.
    const current = candidates.length > 0 ? String(candidates[candidates.length - 1].ref ?? '') : '';
    const currentTree = snapshotTree(current);
    if (options.drift !== false && currentTree !== null && refs[current] === true) {
      if (!context.drift.has(currentTree)) context.drift.set(currentTree, snapshotDrift(root, currentTree));
      const paths = context.drift.get(currentTree);
      if (paths) drift[current] = paths;
    }

    // A commit made from a snapshot, recorded as a later candidate, can be
    // recognised as the same bytes. Only a record with a snapshot asks.
    if (candidates.some((candidate) => snapshotTree(String(candidate.ref ?? '')) !== null)) {
      for (const candidate of candidates) {
        const ref = String(candidate.ref ?? '');
        if (ref === '' || ref.startsWith('tree:') || refs[ref] !== true) continue;
        const tree = object(context, `${ref}^{tree}`);
        if (tree?.type === 'tree') trees[ref] = tree.oid;
      }
    }
  }

  const realRoot = realpath(path.resolve(root)) ?? path.resolve(root);
  for (const entry of [...evidence, ...assessments]) {
    const link = entry.output ?? entry.findings;
    if (typeof link !== 'string' || !isRelativePath(link)) continue;
    // Linked paths are repository-root relative, which is why no `..` is
    // needed and none is accepted. Resolving against the record's own directory
    // would have required traversal to reach anything useful, and traversal is
    // what lets a record ask whether an arbitrary file exists on the machine
    // running the checks.
    const resolved = path.resolve(realRoot, link);
    if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) continue;
    // Spelling is not destination. `logs/known.txt` with `logs` linked out of
    // the checkout resolves cleanly and still names a file the record does not
    // own, so the real destination has to be inside the root as well.
    if (!resolvesInside(realRoot, resolved)) continue;
    files[link] = fs.existsSync(resolved);
  }

  return { refs, files, drift, trees };
}
