/**
 * Compatibility classification and protected-boundary migration support for
 * persisted lifecycle evidence.
 *
 * Retained readers may continue supported v3/v4 dispatch-consumption semantics
 * without rewriting their active records. Current records whose bound schema set
 * is unavailable can be atomically migrated only by a protected transition;
 * unsupported versions remain typed incompatibilities and are never rewritten.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalSha256 } from './canonical-json.js';
import { DISPATCH_CONSUMPTION_SCHEMA_VERSION } from './handoff-consumption.js';
import { TASK_CARRIER_MUTATION_RECEIPT_SCHEMA_VERSION } from './task-evidence-contract.js';
import { RETURN_VERIFICATION_SCHEMA_VERSION } from './return-verification.js';
import { DISPATCH_PREPARATION_SCHEMA_VERSION } from './dispatch-envelope.js';
import { EXECUTION_ATTEMPT_ABANDONMENT_SCHEMA_VERSION } from './execution-attempt.js';

export const LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION = 1;
export const LIFECYCLE_SCHEMA_SET_KIND = 'agenticloop.lifecycle-schema-set';
export const LIFECYCLE_SCHEMA_SET_SCHEMA_VERSION = 2;

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

// Resolve imported bindings only when a record is classified. This preserves
// canonical derivation while allowing the readers of these records to import
// this classifier without an ESM initialization cycle.
function currentVersions() {
  return {
    'agenticloop.dispatch-consumption': DISPATCH_CONSUMPTION_SCHEMA_VERSION,
    // Records persisted below handoffs/task-mutations are role-owned carrier
    // receipts. Their v3 contract is deliberately distinct from historical v2
    // publication/readiness mutation receipts with the same kind string.
    'agenticloop.task-mutation-receipt': TASK_CARRIER_MUTATION_RECEIPT_SCHEMA_VERSION,
    'agenticloop.return-verification': RETURN_VERIFICATION_SCHEMA_VERSION,
    'agenticloop.dispatch-preparation': DISPATCH_PREPARATION_SCHEMA_VERSION,
    'agenticloop.execution-attempt-abandonment': EXECUTION_ATTEMPT_ABANDONMENT_SCHEMA_VERSION,
  };
}

function schemaSet(schemaVersion, versions) {
  return Object.freeze({
    kind: LIFECYCLE_SCHEMA_SET_KIND,
    schemaVersion,
    records: Object.freeze(Object.entries(versions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, recordSchemaVersion]) => Object.freeze({ kind, schemaVersion: recordSchemaVersion }))),
  });
}

// This is the exact schema-set shipped when v5 dispatch consumptions first
// gained lifecycle bindings. Keep retained schema sets as data, not as a
// comparison with whatever versions the running CLI currently imports.
const RETAINED_LIFECYCLE_SCHEMA_SETS = Object.freeze([
  Object.freeze({
    reader: 'retained-v1',
    schemaSet: schemaSet(1, {
      'agenticloop.dispatch-consumption': 5,
      'agenticloop.dispatch-preparation': 8,
      'agenticloop.execution-attempt-abandonment': 2,
      'agenticloop.return-verification': 5,
      'agenticloop.task-mutation-receipt': 3,
    }),
  }),
]);

/**
 * The versioned registry of persisted records whose semantics an attempt uses.
 * A digest of this registry is retained with each newly started attempt, rather
 * than silently substituting whatever a later CLI happens to ship.
 */
export function lifecycleSchemaSet() {
  return schemaSet(LIFECYCLE_SCHEMA_SET_SCHEMA_VERSION, currentVersions());
}

export function lifecycleSchemaSetDigest(schemaSet = lifecycleSchemaSet()) {
  return `sha256:${LIFECYCLE_SCHEMA_SET_KIND}.v${schemaSet.schemaVersion}:${canonicalSha256(schemaSet)}`;
}

/**
 * The canonical schema-set registry. Each retained digest is coupled to its
 * reader identity, so a later CLI can read a live attempt under the semantics
 * it bound at start instead of silently substituting current semantics.
 */
export function lifecycleSchemaSetRegistry() {
  const current = lifecycleSchemaSet();
  return Object.freeze([
    Object.freeze({ digest: lifecycleSchemaSetDigest(current), schemaSet: current, reader: 'current' }),
    ...RETAINED_LIFECYCLE_SCHEMA_SETS.map(entry => Object.freeze({
      digest: lifecycleSchemaSetDigest(entry.schemaSet),
      schemaSet: entry.schemaSet,
      reader: entry.reader,
    })),
  ]);
}

/** Read one bound schema set using only the retained registry. */
export function readLifecycleSchemaSet(digest) {
  const entry = lifecycleSchemaSetRegistry().find(candidate => candidate.digest === digest) ?? null;
  if (entry) return Object.freeze({ ok: true, state: entry.reader === 'current' ? 'current' : 'retained', ...entry });
  return Object.freeze({
    ok: false,
    state: 'unavailable',
    digest: typeof digest === 'string' ? digest : null,
    reader: null,
    schemaSet: null,
  });
}

export function currentToolkitPackageVersion() {
  try {
    const version = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')).version;
    return typeof version === 'string' && version ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The immutable runtime binding written when an execution attempt starts. */
export function currentLifecycleBinding() {
  return Object.freeze({
    toolkitPackageVersion: currentToolkitPackageVersion(),
    lifecycleSchemaSetDigest: lifecycleSchemaSetDigest(),
  });
}

const LIFECYCLE_SCHEMA_SET_DIGEST_RE =
  /^sha256:agenticloop\.lifecycle-schema-set\.v[1-9]\d*:[a-f0-9]{64}$/;

/**
 * Validate a retained attempt binding. The package version intentionally need
 * not equal the running CLI version: that difference is the update case this
 * binding preserves.
 */
export function validateLifecycleBinding(binding) {
  const errors = [];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { ok: false, errors: ['lifecycle binding is missing'] };
  }
  if (typeof binding.toolkitPackageVersion !== 'string' || !binding.toolkitPackageVersion.trim()) {
    errors.push('lifecycle binding toolkitPackageVersion is invalid');
  }
  if (!LIFECYCLE_SCHEMA_SET_DIGEST_RE.test(String(binding.lifecycleSchemaSetDigest ?? ''))) {
    errors.push('lifecycle binding lifecycleSchemaSetDigest is invalid');
  }
  const resolved = errors.length === 0
    ? readLifecycleSchemaSet(binding.lifecycleSchemaSetDigest)
    : null;
  if (resolved !== null && !resolved.ok) {
    errors.push('lifecycle binding names a schema set whose retained semantics are unavailable');
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    schemaSet: resolved?.schemaSet ?? null,
    reader: resolved?.reader ?? null,
    migrationRequired: resolved !== null && !resolved.ok,
  });
}

function supportedPreviousVersion(kind, version) {
  // Dispatch-consumption v3 and v4 are the only active-attempt records whose
  // exact reader is retained. This is deliberately registry-based, not a
  // filename or directory exception.
  return kind === 'agenticloop.dispatch-consumption' && [3, 4].includes(version);
}

/** Classify a persisted lifecycle record without changing it. */
export function classifyLifecycleCompatibility(record, expectedKind = null) {
  const kind = typeof record?.kind === 'string' ? record.kind : expectedKind;
  const version = record?.schemaVersion;
  const current = currentVersions()[kind];
  if (!kind || current === undefined || (expectedKind !== null && kind !== expectedKind)) {
    return Object.freeze({
      kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION,
      state: 'incompatible', route: 'resume_with_current_evidence', reason: 'unknown_kind', observedVersion: version ?? null,
    });
  }
  if (!Number.isSafeInteger(version)) {
    return Object.freeze({
      kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION,
      state: 'incompatible', route: 'resume_with_current_evidence', reason: 'malformed_version', observedVersion: version ?? null,
    });
  }
  if (version === current) {
    return Object.freeze({
      kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION,
      state: 'current', route: null, reason: null, observedVersion: version,
    });
  }
  const bound = readLifecycleSchemaSet(record?.lifecycleSchemaSetDigest);
  const boundVersion = bound.schemaSet?.records.find(entry => entry.kind === kind)?.schemaVersion;
  if (bound.ok && boundVersion === version) {
    return Object.freeze({
      kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION,
      state: 'readable', route: 'read_bound_schema_set', reason: 'retained_schema_set', observedVersion: version,
    });
  }
  if (supportedPreviousVersion(kind, version)) {
    return Object.freeze({
      kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION,
      state: 'readable', route: 'read_bound_semantics', reason: 'supported_previous_version', observedVersion: version,
    });
  }
  return Object.freeze({
    kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION,
    state: 'incompatible', route: 'resume_with_current_evidence',
    reason: version > current ? 'unsupported_new_version' : 'unsupported_legacy_version', observedVersion: version,
  });
}

export function compatibilityMessage(result, label = 'lifecycle record') {
  if (result.state === 'readable') {
    return `${label} uses supported previous schemaVersion ${String(result.observedVersion)}; reading its retained semantics without rewriting it`;
  }
  return `${label} has ${result.reason} schemaVersion ${String(result.observedVersion)}; resume with current evidence`;
}

/** Enumerate persisted lifecycle evidence without mutating or reserializing it. */
export function diagnoseLifecycleCompatibility(target) {
  const { existsSync, readdirSync, readFileSync } = requireFs();
  const { join, relative } = requirePath();
  const roots = [
    ['.agenticloop/handoffs/dispatch', 'agenticloop.dispatch-consumption'],
    ['.agenticloop/handoffs/task-mutations', 'agenticloop.task-mutation-receipt'],
    ['.agenticloop/returns/verifications', 'agenticloop.return-verification'],
  ];
  const findings = [];
  const visit = (directory, expectedKind) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, expectedKind);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const display = relative(target, path).replaceAll('\\', '/');
        try {
          const classification = classifyLifecycleCompatibility(JSON.parse(readFileSync(path, 'utf8')), expectedKind);
          if (classification.state !== 'current') findings.push({ path: display, ...classification });
        } catch (error) {
          findings.push({ path: display, kind: 'agenticloop.lifecycle-compatibility', schemaVersion: LIFECYCLE_COMPATIBILITY_SCHEMA_VERSION, state: 'incompatible', route: 'resume_with_current_evidence', reason: 'unreadable_record', observedVersion: null, error: error.message });
        }
      }
    }
  };
  for (const [root, kind] of roots) visit(join(target, ...root.split('/')), kind);
  return findings.sort((left, right) => left.path.localeCompare(right.path));
}

// Node builtins are loaded lazily so this pure classifier stays browser-testable.
function requireFs() { return globalThis.process.getBuiltinModule('node:fs'); }
function requirePath() { return globalThis.process.getBuiltinModule('node:path'); }
