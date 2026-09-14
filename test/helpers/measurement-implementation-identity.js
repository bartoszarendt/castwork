import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJson } from '../../src/canonical-json.js';

// This is measurement-only tooling. Its identity describes canonical textual
// content, not host checkout bytes, so historical remeasurement is portable.
export const PACKAGED_SURFACE_MEASUREMENT_SCHEMA = 'agenticloop.packaged-surface-baseline/v3';
export const PACKAGED_SURFACE_MEASUREMENT_SOURCES = Object.freeze([
  'scripts/measure-adapter-words.mjs',
  'scripts/canonical-word-count.mjs',
]);
const NORMALIZATION = Object.freeze({ encoding: 'UTF-8', lineEndings: 'LF' });

function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function canonicalText(path, root) {
  return readFileSync(join(root, path), 'utf8').replace(/\r\n?/g, '\n');
}

/**
 * Identity for a measurement implementation that has not yet been committed.
 * Source digests are calculated from normalized UTF-8 text, never Git objects
 * or checkout bytes, so installed and shallow use remains self-contained.
 */
export function packagedSurfaceMeasurementIdentity(root) {
  const sources = PACKAGED_SURFACE_MEASUREMENT_SOURCES.map(path => ({
    path,
    sha256: sha256(canonicalText(path, root)),
  }));
  const contentDigest = sha256(canonicalJson({
    schema: PACKAGED_SURFACE_MEASUREMENT_SCHEMA,
    normalization: NORMALIZATION,
    sources,
  }));
  return Object.freeze({
    identityKind: 'canonical-text',
    contentDigest,
    normalization: NORMALIZATION,
    schema: PACKAGED_SURFACE_MEASUREMENT_SCHEMA,
    sources: Object.freeze(sources.map(Object.freeze)),
  });
}
