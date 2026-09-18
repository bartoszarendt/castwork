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
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
    throw new PublicError(`${GENERATED_MANIFEST} contains an absolute generated path: ${relative}`, {
      hint: 'Generated paths are relative to the repository root. Fix the manifest and run setup again.',
    });
  }
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  const inside = target === base || target.startsWith(base + path.sep);
  if (!inside) {
    throw new PublicError(`${GENERATED_MANIFEST} contains a generated path outside the repository: ${relative}`, {
      hint: 'Generated paths may never escape the repository root. Fix the manifest and run setup again.',
    });
  }
  // A symlinked parent could still point outside; resolve what exists on disk.
  const realBase = safeRealpath(base);
  const realTarget = safeRealpath(path.dirname(target));
  if (realTarget !== null && realBase !== null && realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
    throw new PublicError(`${GENERATED_MANIFEST} resolves outside the repository through a link: ${relative}`, {
      hint: 'Generated paths may never escape the repository root.',
    });
  }
  if (USER_OWNED.some((owned) => relative === owned || relative.startsWith(`${owned}/`))) {
    throw new PublicError(`${GENERATED_MANIFEST} claims a user-owned path as generated: ${relative}`, {
      hint: 'project.md, tasks/ and decisions/ are yours and are never generated. Fix the manifest.',
    });
  }
  return target;
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
