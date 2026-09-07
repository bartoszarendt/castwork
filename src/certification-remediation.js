/** Exact-candidate certification freshness and bounded remediation authority. */

import { canonicalJson, canonicalSha256 } from './canonical-json.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listAuditRecordFiles, parseAuditRecord, validateAuditRecord } from './audit-record.js';
import { deriveFinishCandidate, finishCandidateIsCurrent } from './finish-candidate.js';
import { parseFilesReviewHistory } from './review-history.js';
import { listReturnVerifications } from './return-verification.js';
import { taskContractDigest } from './task-contract-baseline.js';

function refusal(reasons, diagnostics = []) {
  return Object.freeze({ ok: false, reasons: Object.freeze(reasons), diagnostics: Object.freeze(diagnostics) });
}

function nonBlankString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function canonicalFinishCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const identity = candidate.returnIdentity;
  const backend = exactKeys(identity, ['taskId', 'packetId', 'returnId']) ? 'files'
    : exactKeys(identity, ['taskId', 'pr', 'head']) ? 'github' : null;
  if (!backend) return false;
  try {
    const derived = deriveFinishCandidate({
      backend,
      productRange: candidate.productRange,
      productChangedPaths: candidate.changedPathVerdict?.productPaths,
      workflowChangedPaths: candidate.changedPathVerdict?.workflowPaths,
      requiredChecks: candidate.requiredCheckSet?.map(id => ({ id })),
      returnIdentity: identity,
      candidateHead: candidate.certificationInvalidation?.candidateHead,
      observedCandidateHead: candidate.certificationInvalidation?.observedCandidateHead,
    });
    return canonicalJson(derived) === canonicalJson(candidate) &&
      finishCandidateIsCurrent(candidate, candidate.productRange?.head);
  } catch {
    return false;
  }
}

function sameCandidate(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function artifactHead(value) {
  return String(value ?? '').trim().replace(/^commit:/, '');
}

const FILES_REVIEW_ENTRY_FIELDS = Object.freeze([
  'kind', 'schemaVersion', 'backend', 'taskId', 'taskContractDigest',
  'dispatchCarrierDigest', 'currentCarrierDigest', 'productHead', 'workflowHead',
  'candidateHead', 'verifiedReturn', 'carrierLineageTerminalDigest',
  'handoffRecognitionDigest', 'reviewHistory', 'observedAt', 'digest',
  'maintainerOutcome',
]);

function reviewHistoryBinding(history) {
  return {
    digest: `sha256:agenticloop.files-review-history.v1:${canonicalSha256(history.events)}`,
    eventCount: history.events.length,
  };
}

async function reviewEntryMatches(target, taskId, returnVerification, history, latestReview, verifyMaintainerOutcome, independentReviewRequired) {
  const directory = join(target, '.agenticloop', 'reviews', 'entries', taskId);
  if (!existsSync(directory)) return { matched: false, authenticated: false };
  const returnToken = String(returnVerification.recordId ?? '').replace(/^return-verification:/, '');
  let names;
  try { names = readdirSync(directory).filter(name => name.endsWith('.json')); } catch { return { matched: false, authenticated: false }; }
  let matched = false;
  let authenticationFailed = false;
  for (const name of names) {
    try {
      const entry = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      const { digest, ...projection } = entry ?? {};
      const structurallyMatches = Object.keys(entry ?? {}).length === FILES_REVIEW_ENTRY_FIELDS.length &&
        Object.keys(entry ?? {}).every(key => FILES_REVIEW_ENTRY_FIELDS.includes(key)) &&
        entry.kind === 'agenticloop.files-review-entry-receipt' && entry.schemaVersion === 3 &&
        entry.backend === 'files' && entry.taskId === taskId &&
        name === `${returnToken}.json` &&
        entry.productHead === returnVerification.productHead &&
        entry.workflowHead === returnVerification.workflowHead &&
        entry.candidateHead === returnVerification.candidateHead &&
        entry.verifiedReturn?.recordId === returnVerification.recordId &&
        entry.verifiedReturn?.digest === returnVerification.digest &&
        entry.verifiedReturn?.returnGenerationDigest === returnVerification.returnGenerationDigest &&
        Number.isSafeInteger(entry.reviewHistory?.eventCount) && entry.reviewHistory.eventCount >= 0 &&
        entry.reviewHistory.eventCount <= history.events.length &&
        entry.reviewHistory.digest === reviewHistoryBinding({ events: history.events.slice(0, entry.reviewHistory.eventCount) }).digest &&
        digest === `sha256:agenticloop.files-review-entry-receipt.v3:${canonicalSha256(projection)}`;
      if (!structurallyMatches) continue;
      matched = true;
      if (typeof verifyMaintainerOutcome !== 'function' || !latestReview) {
        authenticationFailed = true;
        continue;
      }
      const authenticated = await verifyMaintainerOutcome({
        receipt: entry.maintainerOutcome,
        taskId,
        taskContractDigest: entry.taskContractDigest,
        returnVerification,
        candidate: returnVerification.finishCandidate,
        history,
        reviewOutcome: latestReview,
        independentReviewRequired,
      });
      if (authenticated?.ok === true) return { matched: true, authenticated: true };
      authenticationFailed = true;
      if (authenticated?.diagnosticType === 'maintainer_review_independence_required') {
        return { matched: true, authenticated: false, authenticationDiagnosticType: authenticated.diagnosticType };
      }
    } catch {
      // A malformed entry is not a competing authority. Continue so a valid
      // uniquely named receipt may still be evaluated.
    }
  }
  return { matched, authenticated: false, authenticationFailed };
}

/**
 * Resolve certification authority from the stores that produce it. Callers may
 * select a task and candidate, but cannot manufacture reviewer/auditor roles or
 * identities: those always come from the validated return, review history,
 * review-entry receipt, and audit record.
 */
export async function resolveDurableCertificationEvidence({
  target, taskId, taskRecord, candidate, revalidateReturn = null, verifyAuditorRecord = null, verifyMaintainerOutcome = null,
} = {}) {
  const reasons = [];
  const diagnostics = [];
  if (typeof target !== 'string' || !target || typeof taskId !== 'string' || !taskId || !canonicalFinishCandidate(candidate)) {
    return refusal(['durable certification resolution requires a target, task, and canonical candidate'], [
      Object.freeze({ type: 'certification_resolution_input_malformed', evidenceState: 'malformed' }),
    ]);
  }
  const returns = listReturnVerifications(target, taskId);
  if (!returns.ok) {
    reasons.push(`validated return evidence is unavailable: ${returns.errors.join('; ')}`);
  }
  const exactReturns = [];
  for (const record of returns.records ?? []) {
    if (record.disposition !== 'successful_current' || !sameCandidate(record.finishCandidate, candidate)) continue;
    if (typeof revalidateReturn !== 'function') {
      reasons.push('protected return revalidation is unavailable for remediation authority');
      diagnostics.push(Object.freeze({ type: 'return_revalidation_unavailable', evidenceState: 'missing' }));
      continue;
    }
    let revalidated;
    try {
      revalidated = await revalidateReturn(record);
    } catch (error) {
      revalidated = { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    if (!revalidated?.ok) {
      reasons.push(`return verification '${record.recordId}' failed protected revalidation: ${(revalidated?.errors ?? ['unknown revalidation failure']).join('; ')}`);
      diagnostics.push(Object.freeze({ type: 'return_revalidation_failed', evidenceState: 'stale' }));
      continue;
    }
    exactReturns.push(record);
  }
  if (exactReturns.length !== 1) {
    reasons.push(exactReturns.length === 0
      ? 'no validated return record binds the requested exact candidate'
      : 'multiple validated return records bind the requested exact candidate');
    diagnostics.push(Object.freeze({ type: 'candidate_return_binding_missing', evidenceState: 'malformed' }));
  }
  const history = parseFilesReviewHistory(taskRecord);
  const outcomes = history.events.filter(event => event.type === 'outcome');
  const latestReview = outcomes.at(-1) ?? null;
  const contract = taskContractDigest(taskRecord);
  const independentReviewRequired = contract.ok && contract.projection.independent_review_required === 'true';
  const verifiedReturn = exactReturns.length === 1 ? exactReturns[0] : null;
  const reviewEntry = verifiedReturn
    ? await reviewEntryMatches(target, taskId, verifiedReturn, history, latestReview, verifyMaintainerOutcome, independentReviewRequired)
    : { matched: false, authenticated: false };
  if (verifiedReturn && !reviewEntry.matched) {
    reasons.push('no protected review-entry receipt binds the validated return and current review history for the requested exact candidate');
    diagnostics.push(Object.freeze({ type: 'review_entry_unverified', evidenceState: 'malformed' }));
  }
  if (verifiedReturn && reviewEntry.matched && !reviewEntry.authenticated) {
      reasons.push('Maintainer review outcome authentication is missing, mismatched, forged, or unavailable for the requested exact candidate');
      diagnostics.push(Object.freeze({
        type: reviewEntry.authenticationDiagnosticType ?? (typeof verifyMaintainerOutcome === 'function' ? 'maintainer_review_authentication_failed' : 'maintainer_review_receipt_verification_unavailable'),
        evidenceState: 'malformed',
      }));
  }

  if (history.errors.length > 0) reasons.push(`persisted Maintainer review history is malformed: ${history.errors.join('; ')}`);
  const candidateHead = candidate.productRange?.head;
  if (!latestReview || artifactHead(latestReview.artifact) !== candidateHead || latestReview.roleId !== 'maintainer' ||
      !nonBlankString(latestReview.actorAccount)) {
    reasons.push('no fresh independent Maintainer review record binds the requested exact candidate');
    diagnostics.push(Object.freeze({ type: 'maintainer_review_missing_or_stale', evidenceState: 'stale' }));
  }

  const auditMatches = [];
  for (const entry of listAuditRecordFiles(target)) {
    const record = parseAuditRecord(entry.content);
    if (!record.coveredTasks.includes(taskId) || artifactHead(record.candidateArtifact) !== candidateHead) continue;
    const errors = validateAuditRecord(entry.content, entry.relPath);
    const latest = record.history.at(-1) ?? null;
    let authenticated = null;
    if (errors.length === 0 && latest && typeof verifyAuditorRecord === 'function') {
      try {
        authenticated = await verifyAuditorRecord({ entry, record, latest, taskId, candidate });
      } catch (error) {
        authenticated = { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    }
    if (errors.length > 0 || !latest || artifactHead(latest.auditedArtifact) !== candidateHead ||
        authenticated?.ok !== true) {
      reasons.push(`Auditor record '${entry.relPath}' is missing, malformed, unauthenticated, or stale for the requested candidate`);
      diagnostics.push(Object.freeze({
        type: typeof verifyAuditorRecord !== 'function' ? 'auditor_receipt_verification_unavailable' : 'auditor_record_authentication_failed',
        evidenceState: errors.length ? 'malformed' : 'stale',
      }));
      continue;
    }
    auditMatches.push({ entry, record, latest });
  }
  if (auditMatches.length !== 1) {
    reasons.push(auditMatches.length === 0
      ? 'no authenticated Auditor record binds the requested exact candidate'
      : 'multiple authenticated Auditor records bind the requested exact candidate');
    diagnostics.push(Object.freeze({ type: 'auditor_record_missing_or_ambiguous', evidenceState: 'malformed' }));
  }

  if (reasons.length > 0) return refusal(reasons, diagnostics);
  const audit = auditMatches[0];
  return Object.freeze({
    ok: true,
    candidate: verifiedReturn.finishCandidate,
    producer: Object.freeze({ role: verifiedReturn.producerRole, id: verifiedReturn.recordId }),
    review: Object.freeze({ candidate: verifiedReturn.finishCandidate, role: 'maintainer', id: latestReview.actorAccount, fresh: true }),
    audit: Object.freeze({
      candidate: verifiedReturn.finishCandidate,
      role: 'auditor',
      id: `${audit.record.auditId}/run:${audit.latest.runNumber}`,
      fresh: true,
    }),
    records: Object.freeze({
      returnVerification: verifiedReturn.recordId,
      review: latestReview.sourceReference,
      audit: `${audit.record.auditId}/run:${audit.latest.runNumber}`,
    }),
    reasons: Object.freeze([]), diagnostics: Object.freeze([]),
  });
}

function roleRecord(record, expectedRole, candidate, label, producer, diagnostics) {
  const reasons = [];
  if (!record || !canonicalFinishCandidate(record.candidate) || !sameCandidate(record.candidate, candidate)) {
    reasons.push(`${label} is not bound to the current candidate`);
  }
  if (record?.role !== expectedRole) reasons.push(`${label} must be produced by an independent ${expectedRole}`);
  if (!nonBlankString(record?.id)) {
    reasons.push(`${label} identity is required`);
    diagnostics.push(Object.freeze({ type: `${expectedRole}_identity_missing`, evidenceState: 'malformed' }));
  }
  if (record?.id === producer?.id || record?.role === producer?.role) reasons.push(`${label} cannot be certified by the producing role`);
  if (record?.fresh === false) reasons.push(`${label} is not fresh for the current candidate`);
  return reasons;
}

/**
 * Review and audit are separate independent certifications for one immutable
 * candidate. A candidate change never carries either verdict forward.
 */
export function evaluateCertificationFreshness({ candidate, persistedCandidate, producer, review, audit } = {}) {
  const reasons = [];
  const diagnostics = [];
  const candidateIsCanonical = canonicalFinishCandidate(candidate);
  const persistedIsCanonical = canonicalFinishCandidate(persistedCandidate);
  if (!candidateIsCanonical) {
    reasons.push('current candidate must use the canonical persisted finish-candidate shape');
    diagnostics.push(Object.freeze({ type: 'candidate_not_canonical', evidenceState: 'malformed' }));
  }
  if (!persistedIsCanonical) {
    reasons.push('persisted finish candidate is missing or malformed');
    diagnostics.push(Object.freeze({ type: 'persisted_candidate_missing', evidenceState: 'malformed' }));
  }
  if (candidateIsCanonical && persistedIsCanonical && !sameCandidate(candidate, persistedCandidate)) {
    reasons.push('current candidate does not equal the persisted canonical finish candidate');
    diagnostics.push(Object.freeze({ type: 'candidate_persisted_mismatch', evidenceState: 'changed' }));
  }
  if (!producer || !nonBlankString(producer.role) || !nonBlankString(producer.id)) {
    reasons.push('producing role identity is required');
    diagnostics.push(Object.freeze({ type: 'producer_identity_missing', evidenceState: 'malformed' }));
  }
  if (candidateIsCanonical && persistedIsCanonical && sameCandidate(candidate, persistedCandidate)) {
    reasons.push(...roleRecord(review, 'maintainer', candidate, 'Maintainer review', producer, diagnostics));
    reasons.push(...roleRecord(audit, 'auditor', candidate, 'formal audit', producer, diagnostics));
  }
  if (review?.id === audit?.id) reasons.push('Maintainer review and formal audit must have independent identities');
  return reasons.length === 0
    ? Object.freeze({ ok: true, reasons: Object.freeze([]), diagnostics: Object.freeze([]) })
    : refusal(reasons, diagnostics);
}

/**
 * A finding may start a correction cycle without reauthorization only when it
 * stays inside the frozen protected contract and risk class. The decision is an
 * authority result, not a certification: review and audit still rerun.
 */
export function evaluateRemediationAuthority({ authorization = {}, finding = {} } = {}) {
  const reasons = [];
  const diagnostics = [];
  if (typeof authorization.contract !== 'string' || !authorization.contract || typeof authorization.risk !== 'string' || !authorization.risk ||
      typeof authorization.attempt !== 'string' || !authorization.attempt) {
    reasons.push('existing bounded authorization identity is incomplete');
  }
  if (finding.widensIntent !== false) {
    reasons.push(finding.widensIntent === true
      ? 'finding widens task intent and requires owner action'
      : 'finding must explicitly confirm that it does not widen task intent');
    diagnostics.push(Object.freeze({
      type: finding.widensIntent === true ? 'finding_widens_intent' : 'finding_widens_intent_unconfirmed',
      evidenceState: finding.widensIntent === true ? 'changed' : 'malformed',
    }));
  }
  if (finding.contract !== authorization.contract) reasons.push('finding changes the protected contract and requires owner action');
  if (finding.risk !== authorization.risk) reasons.push('finding changes the risk class and requires owner action');
  if (reasons.length > 0) {
    return Object.freeze({
      authorized: false, nextOwner: 'owner', reasons: Object.freeze(reasons), diagnostics: Object.freeze(diagnostics), cycle: null,
    });
  }
  return Object.freeze({
    authorized: true,
    nextOwner: null,
    cycle: Object.freeze({
      attempt: authorization.attempt,
      preservesAuthorization: true,
      invalidates: Object.freeze(['review', 'audit', 'closeout']),
    }),
    reasons: Object.freeze([]),
  });
}
