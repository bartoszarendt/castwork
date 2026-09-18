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

import { GENERATED_MANIFEST, LAYOUT_VERSION } from './layout.js';
import { PublicError } from './public-error.js';

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
    return {
      layout_version: Number(parsed.layout_version ?? 0),
      version: String(parsed.version ?? ''),
      files: typeof parsed.files === 'object' && parsed.files !== null ? parsed.files : {},
    };
  } catch (error) {
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
  const file = path.join(root, relative);
  const recorded = manifest?.files?.[relative];
  if (!fs.existsSync(file)) return recorded ? 'absent' : 'absent';
  if (!recorded) return 'user_owned';
  return digest(fs.readFileSync(file, 'utf8')) === recorded ? 'owned_unchanged' : 'owned_modified';
}
