/**
 * Generic filesystem mutation kernel.
 *
 * This module owns the target-bound path validation, atomic writes, snapshots,
 * rollback, and transaction-created empty-directory cleanup shared by every
 * mutation flow in the package. Domain layers (adapter generation with its
 * ownership manifest and collision rules in `generation-transaction.js`, and
 * lifecycle plan apply in `lifecycle-plan.js`) build on these primitives; no
 * second transaction service may be created beside this kernel.
 *
 * Every public function is free of adapter identity, manifest, and ownership
 * concepts. The mutating entry point (`executeMutationBatch`) genuinely owns
 * target-bound validation and rollback: it accepts only target-relative
 * mutation paths, resolves each through one canonical validator, and never
 * trusts an absolute caller-resolved path.
 *
 * Snapshot state is explicit: a path is either `absent`, a `file` with exact
 * bytes, or a `directory`. Directory snapshots are never passed to the atomic
 * writer. Recursive directory-removal mutations are rejected so a later batch
 * failure can never lose a directory tree; pruning callers enumerate owned
 * files and use reversible, non-recursive `rmdir-empty` actions. Primary
 * errors are returned separately from genuine rollback failures.
 */

import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import {
  durableMutationIntentSignaturePayload,
  HOST_SIGNATURE_ALGORITHM,
  targetRepositoryIdentity,
  verifyHostPayload,
} from './host-trust.js';

const RECOVERABLE_MUTATION_INTENT_KIND = 'agenticloop.recoverable-mutation-intent';
const RECOVERABLE_MUTATION_INTENT_SCHEMA_VERSION = 1;
export const SIMULATED_MUTATION_TERMINATION_CODE = 'fs.mutation.simulated_termination';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recoverableIntentDigest(intent) {
  const projection = { ...intent };
  delete projection.digest;
  // Authentication is deliberately outside the self-checksum because its value
  // is produced only after the writer has assembled the complete image. The
  // host signature, not this unkeyed digest, authenticates that value.
  if (isPlainObject(projection.authentication)) {
    projection.authentication = { ...projection.authentication, value: null };
  }
  return `sha256:agenticloop.recoverable-mutation-intent.v1:${createHash('sha256').update(canonicalJson(projection)).digest('hex')}`;
}

function encodedFileState(bytes) {
  return { state: 'file', bytes: Buffer.from(bytes).toString('base64') };
}

function encodedSnapshot(snapshot) {
  return snapshot.state === 'file'
    ? { path: snapshot.path, ...encodedFileState(snapshot.bytes) }
    : { path: snapshot.path, state: snapshot.state };
}

function decodeFileState(value) {
  if (!isPlainObject(value) || value.state !== 'file' || typeof value.bytes !== 'string' ||
      Buffer.from(value.bytes, 'base64').toString('base64') !== value.bytes) return null;
  return Buffer.from(value.bytes, 'base64');
}

function stateShapeIsValid(value) {
  if (!isPlainObject(value) || !['absent', 'file'].includes(value.state)) return false;
  return typeof value.path === 'string' && (value.state !== 'file' || decodeFileState(value) !== null);
}

function currentPathMatchesState(path, state) {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (state.state === 'absent') return !stats;
  return Boolean(stats?.isFile()) && readFileSync(path).equals(decodeFileState(state));
}

function restoreEncodedState(path, state) {
  if (state.state === 'file') {
    atomicWriteFile(path, decodeFileState(state));
    return;
  }
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats) return;
  if (!stats.isFile()) throw new Error(`recovery cannot remove non-file path: ${path}`);
  rmSync(path, { force: true });
}

function simulatedTermination(error) {
  return error?.code === SIMULATED_MUTATION_TERMINATION_CODE;
}

function buildRecoverableIntent(root, prepared, snapshots, transaction) {
  if (!isPlainObject(transaction) || typeof transaction.intentPath !== 'string' ||
      !isPlainObject(transaction.binding) || !isPlainObject(transaction.transition) ||
      typeof transaction.commitPath !== 'string' ||
      !isPlainObject(transaction.intentAuthenticator) ||
      typeof transaction.intentAuthenticator.adapterId !== 'string' ||
      typeof transaction.intentAuthenticator.keyId !== 'string' ||
      typeof transaction.intentAuthenticator.publicKey !== 'string' ||
      typeof transaction.intentAuthenticator.authenticate !== 'function') {
    return { ok: false, error: 'recoverable transaction configuration is malformed' };
  }
  let intentPath;
  try {
    intentPath = resolveTargetPath(root, transaction.intentPath);
    assertSafeRelativePath(transaction.commitPath);
  } catch (error) {
    return { ok: false, error: `recoverable transaction configuration is unsafe: ${error.message}` };
  }
  const paths = new Set();
  const mutations = [];
  for (const item of prepared) {
    if (!['write', 'create'].includes(item.type) || paths.has(item.relPath) ||
        typeof item.content !== 'string' && !Buffer.isBuffer(item.content)) {
      return { ok: false, error: 'recoverable transactions require unique write/create file mutations with byte content' };
    }
    paths.add(item.relPath);
    mutations.push({ path: item.relPath, type: item.type, ...encodedFileState(item.content) });
  }
  const commit = mutations.find(item => item.path === transaction.commitPath && item.type === 'create');
  if (!commit || mutations.filter(item => item.path === transaction.commitPath).length !== 1) {
    return { ok: false, error: 'recoverable transaction commitPath must name exactly one exclusive-create mutation' };
  }
  if (paths.has(transaction.intentPath) || existsSync(intentPath)) {
    return { ok: false, error: `recoverable transaction intent is already present: ${transaction.intentPath}` };
  }
  const intent = {
    kind: RECOVERABLE_MUTATION_INTENT_KIND,
    schemaVersion: RECOVERABLE_MUTATION_INTENT_SCHEMA_VERSION,
    // Bind this signed recovery image to the same carrier-root identity the
    // packet and host-trust paths use. A pinned key may legitimately recur at
    // another target, so the key alone must never make its preimages portable.
    targetRepositoryIdentity: targetRepositoryIdentity(root),
    binding: transaction.binding,
    transition: transaction.transition,
    commitPath: transaction.commitPath,
    mutations,
    snapshots: snapshots.map(snapshot => encodedSnapshot({
      ...snapshot,
      path: prepared.find(item => item.absPath === snapshot.path)?.relPath,
    })),
    authentication: {
      algorithm: HOST_SIGNATURE_ALGORITHM,
      adapterId: transaction.intentAuthenticator.adapterId,
      keyId: transaction.intentAuthenticator.keyId,
      value: null,
    },
    digest: null,
  };
  intent.digest = recoverableIntentDigest(intent);
  intent.authentication.value = transaction.intentAuthenticator.authenticate(intent);
  if (!verifyHostPayload(
    durableMutationIntentSignaturePayload(intent), intent.authentication.value,
    transaction.intentAuthenticator.publicKey
  )) {
    return { ok: false, error: 'recoverable transaction intent could not be authenticated by the protected host' };
  }
  return { ok: true, intentPath, intent };
}

/**
 * Recover a persisted mutation intent. Before its exclusive commit file exists,
 * recovery restores the exact pre-write bytes; after it exists, recovery only
 * accepts the fully-written post-state and removes the completed intent. Any
 * malformed or mixed state fails closed without mutation.
 */
export function recoverDurableMutationBatch(targetRoot, { intentPath, binding, intentAuthenticator } = {}) {
  let path;
  try {
    path = resolveTargetPath(targetRoot, intentPath);
  } catch (error) {
    return { ok: false, recovered: false, code: 'verification.context.malformed', errors: [error.message] };
  }
  if (!existsSync(path)) return { ok: true, recovered: false, committed: false, errors: [] };

  let intent;
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) throw new Error('intent is not a regular file');
    intent = JSON.parse(readFileSync(path, 'utf8'));
    const exactKeys = ['kind', 'schemaVersion', 'targetRepositoryIdentity', 'binding', 'transition', 'commitPath', 'mutations', 'snapshots', 'authentication', 'digest'];
    if (!isPlainObject(intent) || Object.keys(intent).length !== exactKeys.length ||
        Object.keys(intent).some(key => !exactKeys.includes(key)) ||
        intent.kind !== RECOVERABLE_MUTATION_INTENT_KIND ||
        intent.schemaVersion !== RECOVERABLE_MUTATION_INTENT_SCHEMA_VERSION ||
        intent.targetRepositoryIdentity !== targetRepositoryIdentity(targetRoot) ||
        !isPlainObject(intent.binding) || canonicalJson(intent.binding) !== canonicalJson(binding) ||
        !isPlainObject(intent.transition) || !/^[a-f0-9]{64}$/.test(String(intent.transition.transitionKey ?? '')) ||
        !/^[a-f0-9]{64}$/.test(String(intent.transition.protectedInputDigest ?? '')) ||
        typeof intent.commitPath !== 'string' || !Array.isArray(intent.mutations) || !Array.isArray(intent.snapshots) ||
        !isPlainObject(intentAuthenticator) ||
        intent.authentication?.algorithm !== HOST_SIGNATURE_ALGORITHM ||
        intent.authentication?.adapterId !== intentAuthenticator.adapterId ||
        intent.authentication?.keyId !== intentAuthenticator.keyId ||
        typeof intent.authentication?.value !== 'string' ||
        !verifyHostPayload(durableMutationIntentSignaturePayload(intent), intent.authentication.value, intentAuthenticator.publicKey) ||
        intent.digest !== recoverableIntentDigest(intent)) {
      throw new Error('intent does not match the requested recoverable transaction');
    }
    const mutationPaths = new Set();
    for (const mutation of intent.mutations) {
      assertSafeRelativePath(mutation?.path);
      const mutationKeys = mutation?.state === 'file'
        ? ['path', 'type', 'state', 'bytes']
        : ['path', 'type', 'state'];
      if (!isPlainObject(mutation) || Object.keys(mutation).length !== mutationKeys.length ||
          Object.keys(mutation).some(key => !mutationKeys.includes(key)) ||
          !['write', 'create'].includes(mutation.type) || !stateShapeIsValid(mutation) ||
          mutationPaths.has(mutation.path)) throw new Error('intent mutations are malformed');
      mutationPaths.add(mutation.path);
    }
    const snapshots = new Map();
    for (const snapshot of intent.snapshots) {
      assertSafeRelativePath(snapshot?.path);
      const snapshotKeys = snapshot?.state === 'file' ? ['path', 'state', 'bytes'] : ['path', 'state'];
      if (!isPlainObject(snapshot) || Object.keys(snapshot).length !== snapshotKeys.length ||
          Object.keys(snapshot).some(key => !snapshotKeys.includes(key)) ||
          !stateShapeIsValid(snapshot) || snapshots.has(snapshot.path)) throw new Error('intent snapshots are malformed');
      snapshots.set(snapshot.path, snapshot);
    }
    if (snapshots.size !== mutationPaths.size || [...mutationPaths].some(item => !snapshots.has(item))) {
      throw new Error('intent snapshots do not cover the exact mutation set');
    }
    const commit = intent.mutations.find(item => item.path === intent.commitPath && item.type === 'create');
    if (!commit || intent.mutations.filter(item => item.path === intent.commitPath).length !== 1) {
      throw new Error('intent does not name one exclusive commit mutation');
    }
  } catch (error) {
    return { ok: false, recovered: false, code: 'verification.context.malformed', errors: [error.message] };
  }

  try {
    const commitPath = resolveTargetPath(targetRoot, intent.commitPath);
    if (currentPathMatchesState(commitPath, intent.mutations.find(item => item.path === intent.commitPath))) {
      const complete = intent.mutations.every(mutation =>
        currentPathMatchesState(resolveTargetPath(targetRoot, mutation.path), mutation));
      if (!complete) {
        return { ok: false, recovered: false, code: 'verification.context.malformed',
          errors: ['recoverable transaction reached its commit point with an incomplete post-state'] };
      }
      rmSync(path, { force: true });
      return { ok: true, recovered: true, committed: true, errors: [] };
    }
    const knownState = intent.mutations.every(mutation => {
      const current = resolveTargetPath(targetRoot, mutation.path);
      return currentPathMatchesState(current, mutation) || currentPathMatchesState(current, intent.snapshots.find(item => item.path === mutation.path));
    });
    if (!knownState) {
      return { ok: false, recovered: false, code: 'verification.context.malformed',
        errors: ['recoverable transaction state changed outside its persisted pre/post images'] };
    }
    for (const snapshot of intent.snapshots) {
      restoreEncodedState(resolveTargetPath(targetRoot, snapshot.path), snapshot);
    }
    rmSync(path, { force: true });
    return { ok: true, recovered: true, committed: false, errors: [] };
  } catch (error) {
    return { ok: false, recovered: false, code: 'verification.context.malformed', errors: [error.message] };
  }
}

/**
 * Canonical target-relative path validator. Accepts only forward-slash
 * relative paths without `.`/`..`/empty segments, drive letters, absolute
 * roots, backslashes, or NUL bytes. Throws a descriptive Error on violation;
 * returns the path unchanged on success.
 *
 * This is the single validator reused by `resolveTargetPath`, lifecycle plan
 * validation, and every caller that needs target-relative path safety.
 *
 * @param {string} value
 * @returns {string}
 */
export function assertSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('planned path must be a non-empty string');
  }
  if (value.includes('\\')) {
    throw new Error(`unsafe planned path (backslash): ${value}`);
  }
  if (value.includes('\0')) {
    throw new Error(`unsafe planned path (NUL byte): ${value}`);
  }
  if (value.startsWith('/')) {
    throw new Error(`unsafe planned path (absolute): ${value}`);
  }
  if (/^[a-zA-Z]:/.test(value)) {
    throw new Error(`unsafe planned path (drive-qualified): ${value}`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe planned path (dot/empty/traversal segment): ${value}`);
  }
  return value;
}

/** True when `relPath` equals or sits under the `/`-delimited `root`. */
export function isUnderRoot(relPath, root) {
  return relPath === root || relPath.startsWith(`${root}/`);
}

/**
 * Resolve a validated target-relative path to an absolute path inside
 * targetRoot through one canonical validator. Rejects lexical escapes
 * (absolute, drive-qualified, backslash, NUL, dot/empty/traversal segments)
 * and verifies both lexical and real-path containment so a symlinked or
 * junctioned ancestor cannot carry a mutation outside the target.
 *
 * @param {string} targetRoot
 * @param {string} relPath
 * @returns {string} absolute path inside targetRoot
 */
export function resolveTargetPath(targetRoot, relPath) {
  const safe = assertSafeRelativePath(relPath);
  const root = resolve(targetRoot);
  const candidate = resolve(root, safe);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`planned path escapes target: ${relPath}`);
  }
  // Walk each existing ancestor segment to detect symlink/junction escape.
  const segments = relative(root, candidate).split(/[\\/]/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stats = lstatSync(current, { throwIfNoEntry: false });
    if (!stats) break;
    if (stats.isSymbolicLink()) {
      throw new Error(`planned path crosses a symlink or junction: ${relPath}`);
    }
  }
  return candidate;
}

/**
 * Resolve and read one existing target-owned regular file.  Unlike a lexical
 * selector this rejects both a leaf link and every linked ancestor, then checks
 * the real filesystem identity before returning bytes.  It is deliberately
 * shared by readers of signed artifact selectors as well as mutation paths.
 */
export function readConfinedTargetFile(targetRoot, relPath, encoding = 'utf8') {
  const path = resolveTargetPath(targetRoot, relPath);
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`target artifact is not a confined regular file: ${relPath}`);
  }
  const root = realpathSync.native?.(resolve(targetRoot)) ?? realpathSync(resolve(targetRoot));
  const actual = realpathSync.native?.(path) ?? realpathSync(path);
  const fromRoot = relative(root, actual);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`target artifact escapes the selected target: ${relPath}`);
  }
  return { path: actual, content: readFileSync(actual, encoding) };
}

/**
 * Stable state fingerprint for one validated target-relative path:
 * `null` when absent, `directory` for a directory, and the SHA-256 digest for
 * a regular file. Other filesystem object types are rejected.
 *
 * @param {string} targetRoot
 * @param {string} relPath
 * @returns {string|null}
 */
export function fingerprintTargetPath(targetRoot, relPath) {
  const path = resolveTargetPath(targetRoot, relPath);
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats) return null;
  if (stats.isSymbolicLink()) {
    throw new Error(`planned path crosses a symlink or junction: ${relPath}`);
  }
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  throw new Error(`unsupported filesystem object at planned path: ${relPath}`);
}

/**
 * Atomically write `content` to `path` (parent directories are created;
 * a temp file in the same directory is renamed into place). Low-level
 * primitive operating on an already-validated absolute path.
 *
 * @param {string} path  Absolute destination path.
 * @param {string|Buffer} content
 */
export function atomicWriteFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

/** Atomically create a new file without ever replacing an existing path. */
export function atomicCreateFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx' });
    // `link` is an exclusive, same-directory commit: EEXIST leaves the
    // contender untouched, unlike rename on platforms that replace targets.
    linkSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/**
 * Capture pre-transaction state for one absolute path. The snapshot is an
 * explicit discriminated record so rollback never has to guess:
 *   { state: 'absent',     path }
 *   { state: 'file',       path, bytes: Buffer }
 *   { state: 'directory',  path }
 *
 * Directory snapshots carry no bytes and are never handed to the atomic
 * writer; a pre-existing directory is left in place on rollback.
 *
 * @param {string} path  Absolute path.
 * @returns {{path: string, state: 'absent'|'file'|'directory', bytes: Buffer|null}}
 */
export function snapshotPath(path) {
  if (!existsSync(path)) return { path, state: 'absent', bytes: null };
  const stats = statSync(path);
  if (stats.isDirectory()) return { path, state: 'directory', bytes: null };
  return { path, state: 'file', bytes: readFileSync(path) };
}

/** Capture pre-transaction state for every absolute path. */
export function snapshotPaths(paths) {
  return [...paths].map(path => snapshotPath(path));
}

/** Remove a directory only when it exists, is a directory, and is empty. */
export function removeEmptyDirectory(path) {
  if (!existsSync(path) || !statSync(path).isDirectory() || readdirSync(path).length !== 0) return false;
  rmSync(path, { recursive: true });
  return true;
}

/**
 * Restore snapshots in reverse order. Never throws and never passes a
 * directory snapshot to the atomic writer. Returns per-path error messages
 * (`"<path>: <message>"`), empty when the restore was clean.
 *
 * @param {Array<{path: string, state: string, bytes: Buffer|null}>} snapshots
 * @returns {string[]} rollback error descriptions
 */
export function rollbackSnapshots(snapshots) {
  const errors = [];
  for (const item of [...snapshots].reverse()) {
    try {
      if (item.state === 'file') {
        atomicWriteFile(item.path, item.bytes);
      } else if (item.state === 'absent') {
        if (!existsSync(item.path)) continue;
        // A transaction-created directory is removed by the created-directory
        // cleanup after its contents are restored; removing it here with a
        // file-only rm would produce a spurious EISDIR rollback error.
        if (statSync(item.path).isDirectory()) continue;
        rmSync(item.path, { force: true });
      }
      // state === 'directory': pre-existing directory is left in place; never
      // remove it during rollback (it predates the transaction).
    } catch (error) {
      errors.push(`${item.path}: ${error.message}`);
    }
  }
  return errors;
}

/** Remove empty ancestor directories of `paths`, up to (not including) `target`. */
export function removeEmptyParents(target, paths) {
  const root = resolve(target);
  for (const path of paths) {
    let current = dirname(resolve(path));
    while (current !== root && current.startsWith(root + sep) && removeEmptyDirectory(current)) {
      current = dirname(current);
    }
  }
}

/**
 * Directories under `targetRoot` that a batch would create (deepest first),
 * so rollback can remove only directories the transaction itself created.
 */
export function missingAncestorDirectories(targetRoot, paths) {
  const root = resolve(targetRoot);
  const missing = new Set();
  for (const path of paths) {
    let current = dirname(resolve(path));
    while (current !== root && current.startsWith(root + sep)) {
      if (!existsSync(current)) missing.add(current);
      current = dirname(current);
    }
  }
  return [...missing].sort((left, right) => right.length - left.length);
}

/**
 * Validate the shape of one mutation and resolve its target-relative path to
 * an absolute path inside `targetRoot`. Conditional mutations may additionally
 * bind the exact file kind and pre-write digest the planner observed.
 *
 * @private
 */
function prepareMutation(targetRoot, mutation) {
  if (!mutation || typeof mutation !== 'object') {
    throw new Error(`mutation must be an object: ${JSON.stringify(mutation)}`);
  }
  const { type, path, content, expectedDigest = undefined, expectedKind = undefined, validateCurrent = undefined } = mutation;
  if (type !== 'write' && type !== 'create' && type !== 'remove' && type !== 'mkdir' && type !== 'rmdir-empty') {
    throw new Error(`unsupported mutation type '${type}' for ${String(path)}`);
  }
  const absPath = resolveTargetPath(targetRoot, path);
  if (expectedDigest !== undefined && (typeof expectedDigest !== 'string' || !/^(?:sha256:)?[0-9a-f]{64}$/.test(expectedDigest))) {
    throw new Error(`mutation '${String(path)}' expectedDigest must be a SHA-256 digest`);
  }
  if (expectedKind !== undefined && !['file', 'absent'].includes(expectedKind)) {
    throw new Error(`mutation '${String(path)}' expectedKind must be 'file' or 'absent'`);
  }
  if (validateCurrent !== undefined && typeof validateCurrent !== 'function') {
    throw new Error(`mutation '${String(path)}' validateCurrent must be a function`);
  }
  return { type, relPath: path, absPath, content, expectedDigest, expectedKind, validateCurrent };
}

function verifyExpectedMutationState(root, item) {
  if (item.expectedDigest === undefined && item.expectedKind === undefined) return null;
  const current = fingerprintTargetPath(root, item.relPath);
  const kind = current === null ? 'absent' : current === 'directory' ? 'directory' : 'file';
  if (item.expectedKind !== undefined && kind !== item.expectedKind) {
    return `conditional mutation '${item.relPath}' is stale: expected ${item.expectedKind}, found ${kind}`;
  }
  if (item.expectedDigest !== undefined) {
    const expected = item.expectedDigest.replace(/^sha256:/, '');
    if (current !== expected) {
      return `conditional mutation '${item.relPath}' is stale: expected digest ${item.expectedDigest}, found ${current === null ? 'absent' : current}`;
    }
  }
  if (item.validateCurrent !== undefined) {
    const validation = item.validateCurrent(readFileSync(item.absPath));
    if (validation?.ok !== true) {
      const detail = Array.isArray(validation?.diagnostics)
        ? validation.diagnostics.map(item => item.message ?? item.code).join('; ')
        : validation?.error ?? 'current carrier failed its required integrity check';
      return `conditional mutation '${item.relPath}' is stale or malformed: ${detail}`;
    }
  }
  return null;
}

/**
 * Execute one generic mutation batch with snapshot/rollback semantics.
 *
 * Mutations use **target-relative paths** resolved inside the kernel through
 * one canonical validator:
 *   { type: 'write',  path: 'relative/path', content }   atomic write
 *   { type: 'create', path: 'relative/path', content }   atomic exclusive create
 *   { type: 'remove', path: 'relative/path' }            removal of a FILE only
 *   { type: 'mkdir',  path: 'relative/path' }            recursive directory creation
 *   { type: 'rmdir-empty', path: 'relative/path' }        reversible empty-dir removal
 *
 * Recursive directory-removal mutations are rejected: a later batch failure
 * must never lose a directory tree. Pruning callers enumerate owned files as
 * individual remove actions and may use `rmdir-empty` for directories known
 * at plan time. Those removals are non-recursive and recreated on rollback.
 *
 * @param {string} targetRoot
 * @param {Array<{type: string, path: string, content?: string|Buffer, expectedDigest?: string, expectedKind?: 'file'|'absent', validateCurrent?: Function}>} mutations
 * @param {{beforeWrite?: Function, afterMutation?: Function, afterDurableIntent?: Function, recoverableTransaction?: object}} [options]
 *   Testable boundaries plus an optional persisted-intent transaction. A
 *   recoverable transaction writes its intent before replacements and commits
 *   only when its designated exclusive-create mutation is written last.
 * @returns {{ ok: boolean, stale: boolean, errors: string[], rollbackErrors: string[], writtenFiles: string[], committedPaths: string[] }}
 *   `errors` holds the primary failure; `rollbackErrors` reports genuine
 *   rollback failures separately. `writtenFiles` is empty on failure.
 *   `committedPaths` lists the target-relative paths that were committed
 *   before any failure (empty unless this batch succeeds).
 */
export function executeMutationBatch(targetRoot, mutations, options = {}) {
  const root = resolve(targetRoot);

  // Phase 1: validate and resolve every mutation through the canonical
  // validator BEFORE any snapshot or write. Unsafe paths fail closed here.
  const prepared = [];
  for (const mutation of mutations ?? []) {
    try {
      prepared.push(prepareMutation(root, mutation));
    } catch (error) {
      return {
        ok: false,
        stale: false,
        errors: [error.message],
        rollbackErrors: [],
        writtenFiles: [],
        committedPaths: [],
      };
    }
  }

  // Phase 2: reject directory-removal mutations. A remove whose target is an
  // existing directory would be unrestorable on rollback; pruning callers
  // must enumerate owned files instead.
  for (const item of prepared) {
    if (item.type !== 'remove') continue;
    if (existsSync(item.absPath) && statSync(item.absPath).isDirectory()) {
      return {
        ok: false,
        stale: false,
        errors: [`refusing directory-removal mutation '${item.relPath}'; enumerate owned files as individual remove actions`],
        rollbackErrors: [],
        writtenFiles: [],
        committedPaths: [],
      };
    }
  }

  const mkdirs = prepared.filter(item => item.type === 'mkdir');
  const removes = prepared.filter(item => item.type === 'remove');
  const emptyDirRemoves = prepared.filter(item => item.type === 'rmdir-empty');
  const writes = prepared.filter(item => item.type === 'write');
  const creates = prepared.filter(item => item.type === 'create');

  for (const item of creates) {
    if (existsSync(item.absPath)) {
      return {
        ok: false,
        stale: false,
        errors: [`refusing exclusive create '${item.relPath}'; path already exists`],
        rollbackErrors: [],
        writtenFiles: [],
        committedPaths: [],
      };
    }
  }

  for (const item of emptyDirRemoves) {
    if (existsSync(item.absPath) && !statSync(item.absPath).isDirectory()) {
      return {
        ok: false,
        stale: false,
        errors: [`refusing empty-directory removal '${item.relPath}'; path is not a directory`],
        rollbackErrors: [],
        writtenFiles: [],
        committedPaths: [],
      };
    }
  }

  try {
    options.beforeWrite?.();
  } catch (error) {
    return { ok: false, stale: false, errors: [error.message], rollbackErrors: [], writtenFiles: [], committedPaths: [] };
  }
  // This is the last common boundary before any mutation in the batch. Every
  // conditional carrier is re-read here, after planning and immediately before
  // the first mkdir/remove/write, so a concurrent edit cannot be overwritten.
  for (const item of prepared) {
    try {
      const stale = verifyExpectedMutationState(root, item);
      if (stale) {
        return { ok: false, stale: true, errors: [stale], rollbackErrors: [], writtenFiles: [], committedPaths: [] };
      }
    } catch (error) {
      return { ok: false, stale: false, errors: [error.message], rollbackErrors: [], writtenFiles: [], committedPaths: [] };
    }
  }

  const affectedPaths = [...new Set(prepared.map(item => item.absPath))];
  const snapshots = snapshotPaths(affectedPaths);
  const snapshotState = new Map(snapshots.map(item => [item.path, item.state]));
  // Directories this transaction would create: mkdir targets that were absent
  // before the batch plus every missing ancestor of an affected path. Rollback
  // removes only these (deepest first); pre-existing directories are kept.
  const createdDirs = new Set(missingAncestorDirectories(root, affectedPaths));
  for (const item of mkdirs) {
    if (snapshotState.get(item.absPath) === 'absent') createdDirs.add(item.absPath);
  }
  const createdDirsOrdered = [...createdDirs].sort((left, right) => right.length - left.length);
  const removedDirs = [];
  const createdFiles = new Set();
  const recoverable = options.recoverableTransaction
    ? buildRecoverableIntent(root, prepared, snapshots, options.recoverableTransaction)
    : null;
  if (recoverable && !recoverable.ok) {
    return {
      ok: false, stale: false, errors: [recoverable.error], rollbackErrors: [], writtenFiles: [], committedPaths: [],
    };
  }
  const commitCreate = recoverable
    ? creates.find(item => item.relPath === options.recoverableTransaction.commitPath)
    : null;
  const nonCommitCreates = commitCreate ? creates.filter(item => item !== commitCreate) : creates;
  let intentWritten = false;

  try {
    if (recoverable) {
      atomicCreateFile(recoverable.intentPath, `${JSON.stringify(recoverable.intent, null, 2)}\n`);
      intentWritten = true;
      options.afterDurableIntent?.({
        intentPath: options.recoverableTransaction.intentPath,
        binding: options.recoverableTransaction.binding,
        transition: options.recoverableTransaction.transition,
      });
    }
    for (const item of mkdirs) {
      mkdirSync(item.absPath, { recursive: true });
    }
    for (const item of removes) {
      if (existsSync(item.absPath)) rmSync(item.absPath, { force: true });
    }
    for (const item of emptyDirRemoves) {
      if (!existsSync(item.absPath)) continue;
      if (!removeEmptyDirectory(item.absPath)) {
        throw new Error(`refusing to remove non-empty directory '${item.relPath}'`);
      }
      removedDirs.push(item.absPath);
    }
    for (const item of writes) {
      atomicWriteFile(item.absPath, item.content);
      options.afterMutation?.({ path: item.relPath, type: item.type, phase: 'replacement' });
    }
    for (const item of nonCommitCreates) {
      atomicCreateFile(item.absPath, item.content);
      createdFiles.add(item.absPath);
      options.afterMutation?.({ path: item.relPath, type: item.type, phase: 'replacement' });
    }
    removeEmptyParents(root, removes.map(item => item.absPath));
    if (commitCreate) {
      atomicCreateFile(commitCreate.absPath, commitCreate.content);
      createdFiles.add(commitCreate.absPath);
      options.afterMutation?.({ path: commitCreate.relPath, type: commitCreate.type, phase: 'commit' });
    }
    if (recoverable) {
      try {
        rmSync(recoverable.intentPath, { force: true });
      } catch {
        // The exclusive commit exists and all post-images were written. Leave
        // the intent for deterministic cleanup by the next role-start retry.
      }
    }
    return {
      ok: true,
      stale: false,
      errors: [],
      rollbackErrors: [],
      writtenFiles: [...writes, ...creates].map(item => item.relPath),
      committedPaths: prepared.map(item => item.relPath),
    };
  } catch (error) {
    // Fault injection models process termination, not an ordinary catchable
    // failure. The durable intent and every written post-image intentionally
    // survive so the public retry path exercises restart recovery.
    if (simulatedTermination(error)) throw error;
    // Do not remove a competing creator's file when our exclusive link failed
    // with EEXIST after snapshotting. Only roll back create paths this batch
    // actually linked.
    const rollbackErrors = rollbackSnapshots(snapshots.filter(item =>
      item.state !== 'absent' || !creates.some(create => create.absPath === item.path) || createdFiles.has(item.path)
    ));
    // Recreate pre-existing empty directories removed by this batch. File
    // restoration above may already have recreated some parents.
    for (const dir of [...removedDirs].sort((left, right) => left.length - right.length)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (dirError) {
        rollbackErrors.push(`directory restore ${dir}: ${dirError.message}`);
      }
    }
    // Remove only directories the transaction itself created, deepest first.
    // Pre-existing directories are never removed here.
    for (const dir of createdDirsOrdered) {
      try {
        if (existsSync(dir) && !removeEmptyDirectory(dir)) {
          rollbackErrors.push(`dir rollback ${dir}: transaction-created directory is not empty`);
        }
      } catch (dirError) {
        rollbackErrors.push(`dir rollback ${dir}: ${dirError.message}`);
      }
    }
    if (intentWritten && recoverable) {
      try {
        rmSync(recoverable.intentPath, { force: true });
      } catch (intentError) {
        rollbackErrors.push(`intent rollback ${recoverable.intentPath}: ${intentError.message}`);
      }
    }
    return {
      ok: false,
      stale: false,
      errors: [error.message],
      rollbackErrors,
      writtenFiles: [],
      committedPaths: [],
    };
  }
}

/**
 * Atomically execute one target-relative rename segment. Both path states are
 * rechecked immediately before mutation, destination parents created by this
 * function are removed on failure, and rollback failures are reported
 * separately from the primary error.
 *
 * @param {string} targetRoot
 * @param {{from: string, to: string, fromBaseHash: string|null, toBaseHash: string|null}} descriptor
 * @param {{rename?: (from: string, to: string) => void}} [options]
 * @returns {{ok: boolean, changed: boolean, stale: boolean, rolledBack: boolean, errors: string[], rollbackErrors: string[]}}
 */
export function executeRenameMutation(targetRoot, descriptor, options = {}) {
  const root = resolve(targetRoot);
  let from;
  let to;
  try {
    from = resolveTargetPath(root, descriptor.from);
    to = resolveTargetPath(root, descriptor.to);
    const fromState = fingerprintTargetPath(root, descriptor.from);
    const toState = fingerprintTargetPath(root, descriptor.to);
    if (fromState !== descriptor.fromBaseHash || toState !== descriptor.toBaseHash) {
      return {
        ok: false,
        changed: false,
        stale: true,
        rolledBack: true,
        errors: [
          `rename state changed since the plan was computed: ${descriptor.from} -> ${descriptor.to}`,
        ],
        rollbackErrors: [],
      };
    }
  } catch (error) {
    return {
      ok: false,
      changed: false,
      stale: false,
      rolledBack: true,
      errors: [error instanceof Error ? error.message : String(error)],
      rollbackErrors: [],
    };
  }

  const createdDirs = missingAncestorDirectories(root, [to]);
  try {
    mkdirSync(dirname(to), { recursive: true });
    (options.rename ?? renameSync)(from, to);
    return {
      ok: true,
      changed: true,
      stale: false,
      rolledBack: true,
      errors: [],
      rollbackErrors: [],
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const dir of createdDirs) {
      try {
        if (existsSync(dir) && !removeEmptyDirectory(dir)) {
          rollbackErrors.push(`dir rollback ${dir}: transaction-created directory is not empty`);
        }
      } catch (dirError) {
        rollbackErrors.push(`dir rollback ${dir}: ${dirError.message}`);
      }
    }
    return {
      ok: false,
      changed: false,
      stale: false,
      rolledBack: rollbackErrors.length === 0,
      errors: [`${descriptor.from}: ${error instanceof Error ? error.message : String(error)}`],
      rollbackErrors,
    };
  }
}
