/** One canonical finish/certification candidate, not a set of expiring receipts. */

import { canonicalJson } from './canonical-json.js';
import { isGitObjectId, sameGitObjectFormat } from './git-oid.js';
import { compareRequiredCheckIds } from './required-checks.js';

const CERTIFICATION_EVIDENCE = Object.freeze([
  'required_checks', 'return', 'review', 'audit', 'closeout',
]);

/** Typed local refusal for a caller that has no exact return identity to bind. */
export class FinishCandidateIdentityError extends TypeError {
  constructor() {
    super('finish return identity is missing, degenerate, or not exact');
    this.name = 'FinishCandidateIdentityError';
    this.code = 'role_return.invalid';
    this.evidenceState = 'malformed';
  }
}

function sortedUnique(values, label, { allowEmpty = false, compare = undefined } = {}) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value)) {
    throw new TypeError(`${label} must be non-empty strings`);
  }
  if (!allowEmpty && values.length === 0) throw new TypeError(`${label} must not be empty`);
  const sorted = [...new Set(values)].sort(compare);
  if (canonicalJson(sorted) !== canonicalJson(values)) {
    throw new TypeError(`${label} must be canonical sorted unique strings`);
  }
  return sorted;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

/**
 * The identity is deliberately closed.  A truthy object was not an identity:
 * `{}` let unrelated callers claim they had consumed a finish result.
 */
function exactReturnIdentity(backend, identity, candidateHead) {
  const invalid = () => {
    throw new FinishCandidateIdentityError();
  };
  if (backend === 'files') {
    if (!exactKeys(identity, ['taskId', 'packetId', 'returnId']) ||
        typeof identity.taskId !== 'string' || !identity.taskId.trim() ||
        !/^dispatch:[0-9a-f-]{36}$/.test(String(identity.packetId ?? '')) ||
        !/^return:[0-9a-f-]{36}$/.test(String(identity.returnId ?? ''))) invalid();
  } else if (!exactKeys(identity, ['taskId', 'pr', 'head']) ||
      typeof identity.taskId !== 'string' || !identity.taskId.trim() ||
      !Number.isSafeInteger(identity.pr) || identity.pr <= 0 || identity.head !== candidateHead) {
    invalid();
  }
  return Object.freeze({ ...identity });
}

/**
 * Derive every fact a finish exposes to certification consumers together. The
 * backend supplies an already authenticated reachable range projection; this
 * function neither mints nor refreshes an independent receipt per output.
 */
/** @param {any} input */
export function deriveFinishCandidate(input = {}) {
  const {
    backend,
    productRange,
    productChangedPaths,
    workflowChangedPaths,
    requiredChecks,
    returnIdentity,
    candidateHead,
    observedCandidateHead = candidateHead,
  } = input;
  if (!['files', 'github'].includes(backend)) throw new TypeError('finish backend is invalid');
  if (!productRange || !isGitObjectId(productRange.base) || !isGitObjectId(productRange.head) ||
      !sameGitObjectFormat([productRange.base, productRange.head])) {
    throw new TypeError('finish requires one reachable product range with full same-format endpoints');
  }
  const commits = productRange.commits ?? [];
  if (!Array.isArray(commits) || commits.some(commit => !isGitObjectId(commit)) || new Set(commits).size !== commits.length) {
    throw new TypeError('finish product-range commits must be unique full Git identities');
  }
  const productPaths = sortedUnique(productChangedPaths, 'finish product changed paths', { allowEmpty: true });
  const workflowPaths = sortedUnique(workflowChangedPaths, 'finish workflow changed paths', { allowEmpty: true });
  if (productPaths.some(path => workflowPaths.includes(path))) {
    throw new TypeError('finish changed-path verdict cannot classify one path as both product and workflow');
  }
  const checkIds = sortedUnique((requiredChecks ?? []).map(check => String(check?.id ?? '').trim()), 'finish required checks', {
    allowEmpty: true,
    compare: compareRequiredCheckIds,
  });
  if (!isGitObjectId(candidateHead) || !isGitObjectId(observedCandidateHead) ||
      !sameGitObjectFormat([productRange.base, candidateHead, observedCandidateHead]) || candidateHead !== productRange.head) {
    throw new TypeError('finish candidate must equal the full product-range head in one Git object format');
  }
  const exactIdentity = exactReturnIdentity(backend, returnIdentity, candidateHead);
  const invalidated = observedCandidateHead !== candidateHead;
  return Object.freeze({
    productRange: Object.freeze({ base: productRange.base, head: productRange.head, commits: Object.freeze([...commits]) }),
    changedPathVerdict: Object.freeze({
      state: 'current', productPaths: Object.freeze(productPaths), workflowPaths: Object.freeze(workflowPaths),
    }),
    requiredCheckSet: Object.freeze(checkIds),
    returnIdentity: exactIdentity,
    certificationInvalidation: Object.freeze({
      state: invalidated ? 'invalidated' : 'current', candidateHead, observedCandidateHead,
      invalidatedEvidence: Object.freeze(invalidated ? [...CERTIFICATION_EVIDENCE] : []),
      preservedEvidence: Object.freeze(invalidated ? ['unrelated_workflow'] : []),
    }),
  });
}

/**
 * The persisted return-evidence seam is the sole files return projection.  Its
 * consumers receive this value, rather than each assembling an advisory subset
 * of the range, paths, checks, and return identity.
 */
export function deriveFinishCandidateForRoleReturn({ backend, roleReturn, observedCandidateHead } = {}) {
  return deriveFinishCandidate({
    backend,
    productRange: {
      ...roleReturn?.productAttribution?.range,
      commits: roleReturn?.productAttribution?.commits,
    },
    productChangedPaths: roleReturn?.productChangedPaths,
    workflowChangedPaths: roleReturn?.workflowChangedPaths,
    requiredChecks: roleReturn?.checks,
    returnIdentity: backend === 'files'
      ? {
          taskId: roleReturn?.task?.id,
          packetId: roleReturn?.packet?.packetId,
          returnId: roleReturn?.returnId,
        }
      : {
          taskId: roleReturn?.task?.id,
          pr: roleReturn?.pr?.number,
          head: roleReturn?.productHead,
        },
    candidateHead: roleReturn?.productHead,
    observedCandidateHead: observedCandidateHead ?? roleReturn?.productHead,
  });
}

/** Review, audit, and closeout consumers must reject a candidate that moved. */
export function finishCandidateIsCurrent(finish, observedCandidateHead) {
  return Boolean(
    finish?.certificationInvalidation?.state === 'current' &&
    finish?.certificationInvalidation?.candidateHead === observedCandidateHead &&
    finish?.certificationInvalidation?.observedCandidateHead === observedCandidateHead
  );
}

/**
 * Compare the persisted finish candidate with live certification facts without
 * deriving a replacement candidate. Returns the exact fact that moved, or null
 * when the persisted candidate remains current.
 */
export function finishCandidateCurrentnessMismatch(finish, { head, base, productPaths, productCommits } = {}) {
  if (!finishCandidateIsCurrent(finish, head)) return 'head';
  if (finish?.productRange?.base !== base) return 'base';
  const livePaths = Array.isArray(productPaths) && productPaths.every(path => typeof path === 'string' && path)
    ? [...new Set(productPaths)].sort()
    : null;
  if (livePaths === null || canonicalJson(finish?.changedPathVerdict?.productPaths) !== canonicalJson(livePaths)) {
    return 'changed_paths';
  }
  if (productCommits !== undefined) {
    const persistedCommits = finish?.productRange?.commits;
    const liveCommits = Array.isArray(productCommits) && productCommits.every(isGitObjectId) &&
      new Set(productCommits).size === productCommits.length
      ? [...productCommits].sort()
      : null;
    if (!Array.isArray(persistedCommits) || persistedCommits.some(commit => !isGitObjectId(commit)) ||
        new Set(persistedCommits).size !== persistedCommits.length || liveCommits === null ||
        canonicalJson([...persistedCommits].sort()) !== canonicalJson(liveCommits)) {
      return 'commits';
    }
  }
  return null;
}
