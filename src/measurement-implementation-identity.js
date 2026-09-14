import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJson } from './canonical-json.js';

export const PACKAGED_SURFACE_MEASUREMENT_SCHEMA = 'agenticloop.packaged-surface-baseline/v2';
export const PACKAGED_SURFACE_MEASUREMENT_SOURCES = Object.freeze([
  'scripts/measure-adapter-words.mjs',
  'src/canonical-word-count.js',
]);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Identity for a measurement implementation that has not yet been committed.
 * The sorted source-byte inventory is stable across a detached subject checkout
 * and becomes independently resolvable when a later commit contains it.
 */
export function packagedSurfaceMeasurementIdentity(root) {
  const sources = PACKAGED_SURFACE_MEASUREMENT_SOURCES.map(path => ({
    path,
    sha256: sha256(readFileSync(join(root, path))),
  }));
  const contentDigest = sha256(canonicalJson({
    schema: PACKAGED_SURFACE_MEASUREMENT_SCHEMA,
    sources,
  }));
  return Object.freeze({
    identityKind: 'content',
    contentDigest,
    schema: PACKAGED_SURFACE_MEASUREMENT_SCHEMA,
    sources: Object.freeze(sources.map(Object.freeze)),
  });
}
