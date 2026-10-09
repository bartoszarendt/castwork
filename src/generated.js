/**
 * Ownership of generated files.
 *
 * `.castwork/generated.json` lists every generated file with its digest and
 * is tracked alongside the files it describes. That is the whole model: no
 * certificate, no layout negotiation, no repair path.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ARCHIVE_SUFFIX, GENERATED_MANIFEST, LAYOUT_VERSION, STATE_DIRECTORY, TASKS_DIRECTORY, USER_OWNED } from './layout.js';
import { PublicError } from './public-error.js';

/**
 * Resolve a manifest-declared path inside the target, refusing anything that
 * escapes it.
 *
 * The manifest is an ordinary tracked file, so its contents are untrusted
 * input: a `../` entry, an absolute path, or a symlinked parent would let
 * `update` or `remove` write to or delete files outside the repository. Every
 * caller resolves through here before touching the filesystem.
 *
 * @param {string} root
 * @param {string} relative
 * @returns {string} the absolute path, guaranteed to be inside root
 */
export function containedPath(root, relative) {
  return resolveContained(root, relative, GENERATED_MANIFEST, true);
}

/**
 * Resolve a path the installer itself writes: the state directories,
 * `project.md`, `.gitignore`, and `castwork.json`.
 *
 * These were the writes that used a bare `path.join` and so followed a link
 * placed at `.castwork`. They share every containment rule with a generated
 * path except one: they are allowed to be user-owned, because seeding them is
 * exactly their job.
 *
 * @param {string} root
 * @param {string} relative
 * @returns {string} the absolute path, guaranteed to be inside root
 */
export function installPath(root, relative) {
  return resolveContained(root, relative, 'the installation', false);
}

/**
 * Resolve a record directory such as `tasks/` or `decisions/`.
 *
 * Git keeps no empty directory, so a fresh clone of an installed project lacks
 * one until a record in it is committed. Require an ordinary `.castwork/`
 * directory and validate containment for both existing and missing paths.
 * With `create`, make a missing record directory; otherwise leave it absent
 * for readers to treat as holding no records. Invalid entries and filesystem
 * errors are not an empty store.
 *
 * @param {string} root
 * @param {string} relative
 * @param {{create?: boolean}} [options]
 * @returns {string}
 */
export function recordDirectory(root, relative, options = {}) {
  const state = fs.statSync(installPath(root, STATE_DIRECTORY), { throwIfNoEntry: false });
  if (!state) {
    throw new PublicError(`${STATE_DIRECTORY}/ does not exist`, { hint: 'Run setup first.' });
  }
  if (!state.isDirectory()) throw new PublicError(`${STATE_DIRECTORY}/ is not a directory`);

  const directory = installPath(root, relative);
  const existing = fs.statSync(directory, { throwIfNoEntry: false });
  if (existing && !existing.isDirectory()) throw new PublicError(`${relative}/ is not a directory`);
  if (!existing && options.create) fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * The Markdown records in a record directory, sorted by file name. A missing
 * directory holds no records and is not created.
 *
 * Each entry passes the same containment check as the directory, so a record
 * that is a link is refused rather than read from wherever it points. An entry
 * that is not a regular file, such as a directory named `x.md`, is no record
 * and is passed over.
 * @param {string} root
 * @param {string} relative
 * @returns {string[]}
 */
export function recordFiles(root, relative) {
  const directory = recordDirectory(root, relative);
  const tasks = path.posix.normalize(relative.replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase() === TASKS_DIRECTORY;
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.md') && (!tasks || !name.endsWith(ARCHIVE_SUFFIX)))
    .sort()
    .map((name) => installPath(root, `${relative}/${name}`))
    .filter((file) => fs.lstatSync(file).isFile());
}

/**
 * @param {string} root
 * @param {string} relative
 * @param {string} subject what a refusal names as the source of the path
 * @param {boolean} refuseUserOwned
 * @returns {string}
 */
function resolveContained(root, relative, subject, refuseUserOwned) {
  if (typeof relative !== 'string' || relative.trim() === '') {
    throw new PublicError(`${subject} contains an empty generated path`);
  }
  // Normalise separators first: a backslash is a path separator on Windows, so
  // `.castwork\\tasks\\T-001.md` and `.castwork/tasks/T-001.md` are the
  // same file and must be judged the same way.
  const unified = relative.replace(/\\/g, '/');
  if (path.posix.isAbsolute(unified) || /^[A-Za-z]:/.test(unified) || unified.startsWith('\\\\')) {
    throw new PublicError(`${subject} contains an absolute generated path: ${relative}`, {
      hint: 'Generated paths are relative to the repository root. Fix the manifest and run setup again.',
    });
  }

  const realRoot = safeRealpath(path.resolve(root)) ?? path.resolve(root);
  const target = path.resolve(realRoot, unified);
  const inside = target === realRoot || target.startsWith(realRoot + path.sep);
  if (!inside) {
    throw new PublicError(`${subject} contains a generated path outside the repository: ${relative}`, {
      hint: 'Generated paths may never escape the repository root. Fix the manifest and run setup again.',
    });
  }

  // Compare the *normalised* path against the user-owned roots, so `./x`,
  // `a/../x` and backslash spellings cannot slip past the check.
  const normalised = path.relative(realRoot, target).split(path.sep).join('/');
  if (refuseUserOwned && isUserOwned(normalised)) {
    throw new PublicError(`${subject} claims a user-owned path as generated: ${relative}`, {
      hint: 'project.md, tasks/ and decisions/ are yours and are never generated. Fix the manifest.',
    });
  }

  assertNoSymlinkComponent(realRoot, target, relative, subject);
  return target;
}

/**
 * Is this normalised path a user-owned one, whatever its case?
 *
 * The comparison is case-insensitive on every platform, not only where the
 * filesystem is. A generated path never legitimately differs from a user-owned
 * path by case alone, so `.CASTWORK/TASKS/T-001.md` is refused on Linux too:
 * refusing costs nothing and being case-sensitive cost the real record on
 * Windows and macOS.
 *
 * @param {string} normalised
 */
function isUserOwned(normalised) {
  const lowered = normalised.toLowerCase();
  return USER_OWNED.some((owned) => {
    const target = owned.toLowerCase();
    return lowered === target || lowered.startsWith(`${target}/`);
  });
}

/**
 * Refuse any symlink between the repository root and the target, including the
 * target itself.
 *
 * Resolving only the parent was not enough: a link whose descendants do not
 * exist yet resolved to nothing and was allowed, and a generated path that was
 * itself a link let a write follow it to an arbitrary file. Castwork never
 * generates a symlink, so encountering one on a generated path is always either
 * a mistake or an attack, and it fails closed either way.
 *
 * @param {string} realRoot
 * @param {string} target
 * @param {string} relative
 * @param {string} subject
 */
function assertNoSymlinkComponent(realRoot, target, relative, subject) {
  const segments = path.relative(realRoot, target).split(path.sep).filter((segment) => segment !== '');
  let current = realRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = lstat(current);
    if (stats === null) return; // nothing exists from here down; nothing to follow
    if (stats.isSymbolicLink()) {
      throw new PublicError(`${subject} resolves through a symbolic link: ${relative}`, {
        hint: 'Generated files are never symbolic links. Remove the link and run setup again.',
      });
    }
  }
}

/** @param {string} target */
function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/** @param {string} target */
function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/** @param {string} content */
export function digest(content) {
  return `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/**
 * The digest of a generated file as it stands on disk, with CRLF read as LF.
 *
 * Generated content is always LF, but Git with `core.autocrlf=true` checks a
 * tracked generated file out with CRLF. Hashing the raw bytes would call every
 * such file modified on a fresh Windows clone or branch switch, and update
 * would refuse. Line endings are not an edit; any other change still is.
 *
 * @param {string} file absolute path, already contained
 */
export function diskDigest(file) {
  return digest(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
}

/**
 * `source_digest` names the generator that wrote it, which `version` alone
 * cannot: unreleased builds share a version. A manifest written before the
 * field existed reads as `null`.
 *
 * @typedef {{layout_version: number, version: string, source_digest: string|null, files: Record<string, string>}} Manifest
 */

/** @param {string} root @returns {Manifest|null} */
export function readManifest(root) {
  // Contained before it is read, so a linked `.castwork` is refused before
  // any caller has written anything rather than at the closing write.
  const file = containedPath(root, GENERATED_MANIFEST);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const files = typeof parsed.files === 'object' && parsed.files !== null ? parsed.files : {};
    // Fail closed: refuse the whole manifest rather than act on part of it.
    for (const relative of Object.keys(files)) containedPath(root, relative);
    return {
      layout_version: Number(parsed.layout_version ?? 0),
      version: String(parsed.version ?? ''),
      source_digest: typeof parsed.source_digest === 'string' && parsed.source_digest !== '' ? parsed.source_digest : null,
      files,
    };
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(`${GENERATED_MANIFEST} could not be read: ${String(error)}`, {
      hint: 'Fix or delete the file and run setup again.',
    });
  }
}

/** @param {string} root @param {Manifest} manifest */
export function writeManifest(root, manifest) {
  // containedPath has already walked every component, so the parent it names
  // carries no link either and creating it follows nothing.
  const file = containedPath(root, GENERATED_MANIFEST);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ordered = {
    layout_version: LAYOUT_VERSION,
    version: manifest.version,
    source_digest: manifest.source_digest,
    files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

/**
 * How a file on disk relates to what the manifest expects.
 * @param {string} root
 * @param {string} relative
 * @param {Manifest|null} manifest
 * @returns {'absent'|'owned_unchanged'|'owned_modified'|'user_owned'}
 */
export function ownership(root, relative, manifest) {
  const file = containedPath(root, relative);
  const recorded = manifest?.files?.[relative];
  if (!fs.existsSync(file)) return recorded ? 'absent' : 'absent';
  if (!recorded) return 'user_owned';
  return diskDigest(file) === recorded ? 'owned_unchanged' : 'owned_modified';
}
