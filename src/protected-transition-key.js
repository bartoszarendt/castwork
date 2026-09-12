import { canonicalSha256 } from './canonical-json.js';

export const PROTECTED_TRANSITION_KEY_KIND = 'agenticloop.transition.start';
export const PROTECTED_TRANSITION_KEY_SCHEMA_VERSION = 1;

/**
 * Stable identity for one protected transition evaluation.  This deliberately
 * excludes clocks and mutable carrier renderings: callers persist an accepted
 * result under this identity rather than attempting to recreate old state.
 */
export function protectedTransitionKey({
  kind = PROTECTED_TRANSITION_KEY_KIND,
  schemaVersion = PROTECTED_TRANSITION_KEY_SCHEMA_VERSION,
  repositoryIdentity,
  taskId,
  attemptId,
  actionId,
  protectedInputDigest,
} = {}) {
  if (kind !== PROTECTED_TRANSITION_KEY_KIND || schemaVersion !== PROTECTED_TRANSITION_KEY_SCHEMA_VERSION) {
    throw new TypeError('protected transition key kind or schemaVersion is invalid');
  }
  for (const [field, value] of Object.entries({ repositoryIdentity, taskId, attemptId, actionId, protectedInputDigest })) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`protected transition key ${field} is required`);
  }
  return canonicalSha256({
    actionId,
    attemptId,
    kind,
    protectedInputDigest,
    repositoryIdentity,
    schemaVersion,
    taskId,
  });
}
