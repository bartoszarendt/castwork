/** Protected-host authentication for one files-backed Maintainer outcome. */

import { canonicalJson, canonicalSha256 } from './canonical-json.js';
import {
  HOST_SIGNATURE_ALGORITHM,
  signHostPayload,
  targetRepositoryIdentity,
  verifyHostPayload,
} from './host-trust.js';
import { satisfiesIndependentReview } from './review-provenance.js';

export const MAINTAINER_REVIEW_OUTCOME_RECEIPT_KIND = 'agenticloop.maintainer-review-outcome-receipt';
export const MAINTAINER_REVIEW_OUTCOME_RECEIPT_SCHEMA_VERSION = 1;
export const MAINTAINER_REVIEW_OUTCOME_RECEIPT_MAX_VALIDITY_MS = 900_000;
export const MAINTAINER_REVIEW_INITIAL_AUTHENTICATION_BOUNDARY_KIND = 'agenticloop.maintainer-review-outcome-initial-authentication-boundary';
export const MAINTAINER_REVIEW_INITIAL_AUTHENTICATION_BOUNDARY_SCHEMA_VERSION = 1;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const CONTRACT_DIGEST_RE = /^sha256:v1:[a-f0-9]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exactKeys(value, expected) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
}

function instant(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && (new Date(epoch).toISOString() === value || new Date(epoch).toISOString().replace('.000Z', 'Z') === value)
    ? epoch : null;
}

function bindingDigest(projection) {
  return `sha256:agenticloop.maintainer-review-outcome-binding.v1:${canonicalSha256(projection)}`;
}

function reviewOutcomeProjection(outcome) {
  if (!outcome || outcome.type !== 'outcome' || outcome.roleId !== 'maintainer' ||
      typeof outcome.actorAccount !== 'string' || !outcome.actorAccount.trim() ||
      typeof outcome.status !== 'string' || !outcome.status || typeof outcome.mode !== 'string' || !outcome.mode ||
      typeof outcome.artifact !== 'string' || !outcome.artifact || !Array.isArray(outcome.findingIds) ||
      outcome.findingIds.some(id => typeof id !== 'string') ||
      (outcome.classification !== null && typeof outcome.classification !== 'string') ||
      typeof outcome.sourceReference !== 'string' || !outcome.sourceReference) {
    throw new TypeError('Maintainer review outcome is incomplete or malformed');
  }
  return {
    status: outcome.status,
    mode: outcome.mode,
    artifact: outcome.artifact,
    findingIds: [...outcome.findingIds],
    classification: outcome.classification,
    roleId: outcome.roleId,
    actorAccount: outcome.actorAccount,
    sourceReference: outcome.sourceReference,
  };
}

/** Derive the exact outcome binding a protected host signs and consumers rederive. */
/** @param {any} input */
export function maintainerReviewOutcomeBinding(input = {}) {
  const { taskId, taskContractDigest, returnVerification, candidate, reviewOutcome } = input;
  if (typeof taskId !== 'string' || !taskId || typeof taskContractDigest !== 'string' || !CONTRACT_DIGEST_RE.test(taskContractDigest) ||
      typeof returnVerification?.recordId !== 'string' || !returnVerification.recordId ||
      typeof returnVerification?.digest !== 'string' || !returnVerification.digest ||
      typeof returnVerification?.returnGenerationDigest !== 'string' || !returnVerification.returnGenerationDigest ||
      typeof candidate?.productRange?.head !== 'string' || !candidate.productRange.head) {
    throw new TypeError('Maintainer review outcome binding requires the exact task, return verification, and candidate');
  }
  const projection = {
    taskId,
    taskContractDigest,
    returnVerification: {
      recordId: returnVerification.recordId,
      digest: returnVerification.digest,
      returnGenerationDigest: returnVerification.returnGenerationDigest,
    },
    candidate: {
      head: candidate.productRange.head,
      digest: `sha256:agenticloop.finish-candidate.v1:${canonicalSha256(candidate)}`,
    },
    outcome: reviewOutcomeProjection(reviewOutcome),
  };
  return Object.freeze({ ...projection, digest: bindingDigest(projection) });
}

function receiptDigest(receipt) {
  return `sha256:agenticloop.maintainer-review-outcome-receipt.v1:${canonicalSha256(receipt)}`;
}

function initialAuthenticationProjection(receipt, context, authenticatedAt) {
  const binding = maintainerReviewOutcomeBinding(context);
  return {
    kind: 'agenticloop.maintainer-review-outcome-initial-authentication.v1',
    receiptDigest: receiptDigest(receipt),
    receiptId: receipt.receiptId,
    bindingDigest: binding.digest,
    taskId: binding.taskId,
    taskContractDigest: binding.taskContractDigest,
    returnVerification: binding.returnVerification,
    candidate: binding.candidate,
    outcome: binding.outcome,
    authenticatedAt,
  };
}

/** Exact payload the protected host signs after successful fresh ingestion. */
export function maintainerReviewInitialAuthenticationSignaturePayload(attestation) {
  return {
    ...attestation,
    authentication: {
      algorithm: attestation?.authentication?.algorithm,
      keyId: attestation?.authentication?.keyId,
    },
  };
}

/**
 * Create the auditable record persisted only after a fresh authenticated
 * ingestion. Its receipt digest makes a later re-presentation of altered wire
 * material fail even when the signed binding itself happens to be unchanged.
 */
function createMaintainerReviewOutcomeInitialAuthentication(receipt, context, authenticatedAt) {
  if (instant(authenticatedAt) === null) {
    throw new TypeError('Maintainer review initial authentication time is invalid');
  }
  const adapter = context.trustedAdapter;
  if (!adapter || typeof context.hostAuthority !== 'function') {
    throw new TypeError('protected host signer for Maintainer review initial authentication is unavailable');
  }
  const unsigned = {
    ...initialAuthenticationProjection(receipt, context, authenticatedAt),
    authentication: {
      algorithm: adapter.algorithm,
      keyId: adapter.keyId,
    },
  };
  let response;
  try {
    response = context.hostAuthority({
      kind: MAINTAINER_REVIEW_INITIAL_AUTHENTICATION_BOUNDARY_KIND,
      schemaVersion: MAINTAINER_REVIEW_INITIAL_AUTHENTICATION_BOUNDARY_SCHEMA_VERSION,
      attestation: unsigned,
    });
  } catch {
    throw new TypeError('protected host signer for Maintainer review initial authentication is unavailable');
  }
  if (!exactKeys(response, ['kind', 'schemaVersion', 'attestation', 'signature']) ||
      response.kind !== MAINTAINER_REVIEW_INITIAL_AUTHENTICATION_BOUNDARY_KIND ||
      response.schemaVersion !== MAINTAINER_REVIEW_INITIAL_AUTHENTICATION_BOUNDARY_SCHEMA_VERSION ||
      canonicalJson(response.attestation) !== canonicalJson(unsigned) ||
      !verifyHostPayload(maintainerReviewInitialAuthenticationSignaturePayload(unsigned), response.signature, adapter.publicKey)) {
    throw new TypeError('protected host signer returned an invalid Maintainer review initial-authentication attestation');
  }
  return Object.freeze({ ...unsigned, authentication: { ...unsigned.authentication, value: response.signature } });
}

function initialAuthenticationMatches(receipt, context, initialAuthentication) {
  if (!exactKeys(initialAuthentication, [
    'kind', 'receiptDigest', 'receiptId', 'bindingDigest', 'taskId', 'taskContractDigest',
    'returnVerification', 'candidate', 'outcome', 'authenticatedAt', 'authentication',
  ]) || instant(initialAuthentication.authenticatedAt) === null) return false;
  const adapter = context.trustedAdapter;
  if (!adapter || initialAuthentication.authentication?.algorithm !== adapter.algorithm ||
      initialAuthentication.authentication?.keyId !== adapter.keyId ||
      typeof initialAuthentication.authentication?.value !== 'string') return false;
  let expected;
  try {
    expected = initialAuthenticationProjection(receipt, context, initialAuthentication.authenticatedAt);
  } catch {
    return false;
  }
  const { authentication, ...projection } = initialAuthentication;
  return canonicalJson(projection) === canonicalJson(expected) &&
    verifyHostPayload(maintainerReviewInitialAuthenticationSignaturePayload(initialAuthentication), authentication.value, adapter.publicKey);
}

function validateBinding(binding) {
  if (!exactKeys(binding, ['taskId', 'taskContractDigest', 'returnVerification', 'candidate', 'outcome', 'digest']) ||
      !exactKeys(binding.returnVerification, ['recordId', 'digest', 'returnGenerationDigest']) ||
      !exactKeys(binding.candidate, ['head', 'digest']) ||
      !exactKeys(binding.outcome, ['status', 'mode', 'artifact', 'findingIds', 'classification', 'roleId', 'actorAccount', 'sourceReference']) ||
      typeof binding.taskId !== 'string' || !binding.taskId || !CONTRACT_DIGEST_RE.test(binding.taskContractDigest) ||
      typeof binding.returnVerification.recordId !== 'string' || !binding.returnVerification.recordId ||
      typeof binding.returnVerification.digest !== 'string' || !binding.returnVerification.digest ||
      typeof binding.returnVerification.returnGenerationDigest !== 'string' || !binding.returnVerification.returnGenerationDigest ||
      typeof binding.candidate.head !== 'string' || !binding.candidate.head || typeof binding.candidate.digest !== 'string' || !binding.candidate.digest ||
      !Array.isArray(binding.outcome.findingIds) || binding.outcome.findingIds.some(id => typeof id !== 'string') ||
      binding.outcome.roleId !== 'maintainer' || typeof binding.outcome.actorAccount !== 'string' || !binding.outcome.actorAccount.trim() ||
      typeof binding.outcome.status !== 'string' || !binding.outcome.status || typeof binding.outcome.mode !== 'string' || !binding.outcome.mode ||
      typeof binding.outcome.artifact !== 'string' || !binding.outcome.artifact ||
      (binding.outcome.classification !== null && typeof binding.outcome.classification !== 'string') ||
      typeof binding.outcome.sourceReference !== 'string' || !binding.outcome.sourceReference) {
    return false;
  }
  const { digest, ...projection } = binding;
  return digest === bindingDigest(projection);
}

/** Payload signed outside the target repository at the protected host boundary. */
export function maintainerReviewOutcomeReceiptSignaturePayload(receipt) {
  return {
    ...receipt,
    authentication: {
      algorithm: receipt?.authentication?.algorithm,
      keyId: receipt?.authentication?.keyId,
    },
  };
}

/** @param {any} receipt @param {{ allowUnsigned?: boolean }} [options] */
export function validateMaintainerReviewOutcomeReceiptShape(receipt, { allowUnsigned = false } = {}) {
  const fields = [
    'kind', 'schemaVersion', 'receiptId', 'producerRole', 'source', 'adapterId', 'targetRepository',
    'invocation', 'binding', 'issuedAt', 'expiresAt', 'authentication',
  ];
  /** @type {string[]} */
  const errors = [];
  if (!exactKeys(receipt, fields)) return { ok: false, errors: ['Maintainer review outcome receipt fields must equal the closed schema'] };
  if (receipt.kind !== MAINTAINER_REVIEW_OUTCOME_RECEIPT_KIND || receipt.schemaVersion !== MAINTAINER_REVIEW_OUTCOME_RECEIPT_SCHEMA_VERSION) errors.push('Maintainer review outcome receipt identity is invalid');
  for (const [label, value] of [['receiptId', receipt.receiptId], ['adapterId', receipt.adapterId]]) {
    if (typeof value !== 'string' || !ID_RE.test(value)) errors.push(`Maintainer review outcome receipt ${label} is invalid`);
  }
  if (receipt.producerRole !== 'maintainer' || receipt.source !== 'host_adapter') errors.push('Maintainer review outcome receipt producer is invalid');
  if (typeof receipt.targetRepository !== 'string' || !receipt.targetRepository.startsWith('file:')) errors.push('Maintainer review outcome receipt target repository is invalid');
  if (!exactKeys(receipt.invocation, ['reference', 'mode']) || typeof receipt.invocation.reference !== 'string' || !receipt.invocation.reference.trim() || typeof receipt.invocation.mode !== 'string' || !receipt.invocation.mode.trim()) errors.push('Maintainer review outcome receipt invocation is invalid');
  if (!validateBinding(receipt.binding)) errors.push('Maintainer review outcome receipt protected binding is invalid');
  if (instant(receipt.issuedAt) === null || instant(receipt.expiresAt) === null) errors.push('Maintainer review outcome receipt liveness timestamps are invalid');
  if (!exactKeys(receipt.authentication, ['algorithm', 'keyId', 'value']) || receipt.authentication.algorithm !== HOST_SIGNATURE_ALGORITHM || typeof receipt.authentication.keyId !== 'string' || !ID_RE.test(receipt.authentication.keyId) || (!allowUnsigned && (typeof receipt.authentication.value !== 'string' || !receipt.authentication.value))) errors.push('Maintainer review outcome receipt authentication is invalid');
  return { ok: errors.length === 0, errors };
}

/** Host-only producer helper; callers supply an already-derived protected binding. */
/** @param {any} input @param {any} privateKey */
export function createMaintainerReviewOutcomeReceipt(input = {}, privateKey) {
  /** @type {any} */
  const receipt = {
    kind: MAINTAINER_REVIEW_OUTCOME_RECEIPT_KIND,
    schemaVersion: MAINTAINER_REVIEW_OUTCOME_RECEIPT_SCHEMA_VERSION,
    receiptId: input.receiptId,
    producerRole: 'maintainer',
    source: 'host_adapter',
    adapterId: input.adapterId,
    targetRepository: input.targetRepository,
    invocation: { reference: input.invocationReference, mode: input.invocationMode },
    binding: input.binding,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt,
    authentication: { algorithm: HOST_SIGNATURE_ALGORITHM, keyId: input.keyId, value: null },
  };
  const shape = validateMaintainerReviewOutcomeReceiptShape(receipt, { allowUnsigned: true });
  if (!shape.ok) throw new TypeError(shape.errors.join('; '));
  receipt.authentication.value = signHostPayload(maintainerReviewOutcomeReceiptSignaturePayload(receipt), privateKey);
  return Object.freeze(receipt);
}

/** Verify signature first, then rederive the exact outcome binding at consumption. */
/** @param {any} receiptWire @param {any} context */
export function verifyMaintainerReviewOutcomeReceipt(receiptWire, context = {}) {
  let receipt;
  try { receipt = typeof receiptWire === 'string' ? JSON.parse(receiptWire) : receiptWire; } catch { return { verified: false, state: 'untrusted', error: 'Maintainer review outcome receipt is not valid JSON' }; }
  const shape = validateMaintainerReviewOutcomeReceiptShape(receipt);
  if (!shape.ok) return { verified: false, state: 'untrusted', error: shape.errors.join('; ') };
  const adapter = context.trustedAdapter;
  if (!adapter || adapter.capabilities?.returnReceipt !== 'supported' || receipt.adapterId !== adapter.adapterId || receipt.authentication.keyId !== adapter.keyId || receipt.authentication.algorithm !== adapter.algorithm || !verifyHostPayload(maintainerReviewOutcomeReceiptSignaturePayload(receipt), receipt.authentication.value, adapter.publicKey)) {
    return { verified: false, state: 'untrusted', error: 'Maintainer review outcome receipt signature did not verify against the pinned host adapter' };
  }
  let expected;
  try { expected = maintainerReviewOutcomeBinding(context); } catch (error) { return { verified: false, state: 'untrusted', error: error.message }; }
  if (receipt.targetRepository !== adapter.repositoryIdentity || receipt.targetRepository !== targetRepositoryIdentity(context.target) || receipt.producerRole !== 'maintainer' || context.role !== 'maintainer' || receipt.invocation.reference !== context.invocationReference || receipt.invocation.mode !== context.invocationMode || canonicalJson(receipt.binding) !== canonicalJson(expected)) {
    return { verified: false, state: 'untrusted', error: 'Maintainer review outcome receipt does not match the protected review, return, candidate, and history binding' };
  }
  if (context.independentReviewRequired === true && !satisfiesIndependentReview(receipt.binding.outcome.mode)) {
    return {
      verified: false,
      state: 'independence_required',
      error: 'independent review is required but the signed Maintainer review outcome uses single_agent_fallback',
    };
  }
  const issuedAt = /** @type {number} */ (instant(receipt.issuedAt));
  const expiresAt = /** @type {number} */ (instant(receipt.expiresAt));
  const now = context.now === undefined || context.now === null ? Date.now() : Number(context.now);
  if (!Number.isFinite(now) || issuedAt >= expiresAt || issuedAt > now + 5_000 || expiresAt <= now || expiresAt - issuedAt > MAINTAINER_REVIEW_OUTCOME_RECEIPT_MAX_VALIDITY_MS || now - issuedAt > MAINTAINER_REVIEW_OUTCOME_RECEIPT_MAX_VALIDITY_MS) {
    return { verified: false, state: 'stale', error: 'Maintainer review outcome receipt is expired or outside its liveness window' };
  }
  return {
    verified: true,
    state: 'current',
    receiptId: receipt.receiptId,
    bindingDigest: receipt.binding.digest,
    authenticatedAt: new Date(now).toISOString(),
  };
}

/**
 * Fresh ingestion is the sole producer of an initial-authentication record.
 * The record is never accepted from caller input during initial submission.
 */
export function authenticateFreshMaintainerReviewOutcomeReceipt(receiptWire, context = {}) {
  const verified = verifyMaintainerReviewOutcomeReceipt(receiptWire, context);
  if (verified.verified !== true) return verified;
  let receipt;
  try { receipt = typeof receiptWire === 'string' ? JSON.parse(receiptWire) : receiptWire; } catch { return { verified: false, state: 'untrusted', error: 'Maintainer review outcome receipt is not valid JSON' }; }
  try {
    return {
      ...verified,
      initialAuthentication: createMaintainerReviewOutcomeInitialAuthentication(receipt, context, verified.authenticatedAt),
    };
  } catch (error) {
    return { verified: false, state: 'untrusted', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reauthenticate an already persisted outcome. This is deliberately a
 * separate entry point: expiry may be bypassed only by an exact protected
 * initial-authentication record, never by a caller-selected receipt mode.
 */
export function verifyRecordedMaintainerReviewOutcomeReceipt(receiptWire, context = {}) {
  let receipt;
  try { receipt = typeof receiptWire === 'string' ? JSON.parse(receiptWire) : receiptWire; } catch { return { verified: false, state: 'untrusted', error: 'Maintainer review outcome receipt is not valid JSON' }; }
  if (!initialAuthenticationMatches(receipt, context, context.initialAuthentication)) {
    return { verified: false, state: 'untrusted', error: 'Maintainer review initial-authentication record is missing, altered, or not bound to this exact receipt' };
  }
  const authenticatedAt = /** @type {number} */ (instant(context.initialAuthentication.authenticatedAt));
  const verified = verifyMaintainerReviewOutcomeReceipt(receipt, { ...context, now: authenticatedAt });
  return verified.verified === true
    ? { ...verified, state: 'recorded' }
    : verified;
}
