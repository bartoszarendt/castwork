/**
 * Ownership of generated files.
 *
 * `.agenticloop/generated.json` lists every generated file with its digest and
 * is tracked alongside the files it describes. That is the whole model: no
 * certificate, no layout negotiation, no repair path.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_MANIFEST, LAYOUT_VERSION, USER_OWNED } from './layout.js';
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
  if (typeof relative !== 'string' || relative.trim() === '') {
    throw new PublicError(`${GENERATED_MANIFEST} contains an empty generated path`);
  }
  // Normalise separators first: a backslash is a path separator on Windows, so
  // `.agenticloop\\tasks\\T-001.md` and `.agenticloop/tasks/T-001.md` are the
  // same file and must be judged the same way.
  const unified = relative.replace(/\\/g, '/');
  if (path.posix.isAbsolute(unified) || /^[A-Za-z]:/.test(unified) || unified.startsWith('\\\\')) {
    throw new PublicError(`${GENERATED_MANIFEST} contains an absolute generated path: ${relative}`, {
      hint: 'Generated paths are relative to the repository root. Fix the manifest and run setup again.',
    });
  }

  const realRoot = safeRealpath(path.resolve(root)) ?? path.resolve(root);
  const target = path.resolve(realRoot, unified);
  const inside = target === realRoot || target.startsWith(realRoot + path.sep);
  if (!inside) {
    throw new PublicError(`${GENERATED_MANIFEST} contains a generated path outside the repository: ${relative}`, {
      hint: 'Generated paths may never escape the repository root. Fix the manifest and run setup again.',
    });
  }

  // Compare the *normalised* path against the user-owned roots, so `./x`,
  // `a/../x` and backslash spellings cannot slip past the check.
  const normalised = path.relative(realRoot, target).split(path.sep).join('/');
  if (USER_OWNED.some((owned) => normalised === owned || normalised.startsWith(`${owned}/`))) {
    throw new PublicError(`${GENERATED_MANIFEST} claims a user-owned path as generated: ${relative}`, {
      hint: 'project.md, tasks/ and decisions/ are yours and are never generated. Fix the manifest.',
    });
  }

  assertNoSymlinkComponent(realRoot, target, relative);
  return target;
}

/**
 * Refuse any symlink between the repository root and the target, including the
 * target itself.
 *
 * Resolving only the parent was not enough: a link whose descendants do not
 * exist yet resolved to nothing and was allowed, and a generated path that was
 * itself a link let a write follow it to an arbitrary file. Agentic Loop never
 * generates a symlink, so encountering one on a generated path is always either
 * a mistake or an attack, and it fails closed either way.
 *
 * @param {string} realRoot
 * @param {string} target
 * @param {string} relative
 */
function assertNoSymlinkComponent(realRoot, target, relative) {
  const segments = path.relative(realRoot, target).split(path.sep).filter((segment) => segment !== '');
  let current = realRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = lstat(current);
    if (stats === null) return; // nothing exists from here down; nothing to follow
    if (stats.isSymbolicLink()) {
      throw new PublicError(`${GENERATED_MANIFEST} resolves through a symbolic link: ${relative}`, {
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
 * @typedef {{layout_version: number, version: string, files: Record<string, string>}} Manifest
 */

/** @param {string} root @returns {Manifest|null} */
export function readManifest(root) {
  const file = path.join(root, GENERATED_MANIFEST);
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
  const file = path.join(root, GENERATED_MANIFEST);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ordered = {
    layout_version: LAYOUT_VERSION,
    version: manifest.version,
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
  return digest(fs.readFileSync(file, 'utf8')) === recorded ? 'owned_unchanged' : 'owned_modified';
}
