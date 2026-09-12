/**
 * Evaluate whether a supervisor may adopt already-created product work without
 * consuming the task attempt that originally authorized the bounded change.
 *
 * This is intentionally an evaluator, not a Git mutator: adoption records the
 * existing object identities and invalidates their dependent certifications; it
 * never rebases, cherry-picks, rewrites, or otherwise changes authorship.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalSha256 } from './canonical-json.js';
import { isGitObjectId, sameGitObjectFormat } from './git-oid.js';
import { fileMatchesScopePattern } from './scope-matcher.js';

const INVALIDATED_CERTIFICATION = Object.freeze(['required_checks', 'review', 'audit', 'closeout']);
const REQUIRED_RERUNS = Object.freeze(['required_checks', 'review', 'audit']);

export const COMMIT_ADOPTION_KIND = 'agenticloop.commit-adoption';
export const COMMIT_ADOPTION_SCHEMA_VERSION = 2;
export const COMMIT_ADOPTION_ASSURANCE = 'non_authenticated_claim';
export const COMMIT_ADOPTION_ACTOR_CLASSES = Object.freeze(['operator', 'delegated-agent', 'unknown']);
export const COMMIT_ADOPTION_CONSUMERS = Object.freeze({
  'files-return-evidence.deriveReturnTopology': 'validates malformed display records only; never range attribution, permission, origin, or certification',
  'dispatch-envelope.adoptionAtWorkflowHead': 'validates malformed display records only; never range attribution, permission, origin, or certification',
  'commit-range.deriveCommitRange': 'does not consume adoption records; derives Git range and canonical trailers independently',
});

const RECORD_FIELDS = Object.freeze([
  'kind', 'schemaVersion', 'backend', 'repositoryIdentity', 'taskId', 'taskContractDigest', 'riskClass', 'adoptedAt',
  'assurance', 'ok', 'nextOwner', 'reasons', 'diagnostics', 'adoption', 'preserved', 'certification', 'semanticDigest',
]);
const ADOPTION_FUTURE_SKEW_MS = 5_000;

function result(reasons, detail = {}, diagnostics = []) {
  if (reasons.length > 0) {
    return Object.freeze({
      ok: false, nextOwner: 'owner', reasons: Object.freeze(reasons), diagnostics: Object.freeze(diagnostics), ...detail,
    });
  }
  return Object.freeze({ ok: true, nextOwner: null, reasons: Object.freeze([]), diagnostics: Object.freeze([]), ...detail });
}

function lines(value) {
  return String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function gitOk(runGit, args) {
  try {
    const response = runGit(args);
    return response && typeof response.status === 'number' ? response : null;
  } catch {
    return null;
  }
}

function validActor(actor) {
  return actor && COMMIT_ADOPTION_ACTOR_CLASSES.includes(actor.class) &&
    typeof actor.id === 'string' && actor.id.trim();
}

function matchingAuthorizationIdentity(value) {
  return value && typeof value.authorized === 'string' && value.authorized.trim() &&
    typeof value.current === 'string' && value.current.trim();
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function adoptionDigest(record) {
  const { semanticDigest: ignored, ...projection } = record;
  return `sha256:${COMMIT_ADOPTION_KIND}.v${COMMIT_ADOPTION_SCHEMA_VERSION}:${canonicalSha256(projection)}`;
}

function canonicalInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? epoch : null;
}

/**
 * Build the only persisted adoption shape. This is integrity-bound, not an
 * authenticated origin receipt: no shipped host can produce one for adoption.
 */
export function createCommitAdoptionRecord({ repositoryIdentity, taskId, taskContractDigest, riskClass, evaluation, adoptedAt = new Date().toISOString() } = {}) {
  const record = {
    kind: COMMIT_ADOPTION_KIND,
    schemaVersion: COMMIT_ADOPTION_SCHEMA_VERSION,
    backend: 'files',
    repositoryIdentity,
    taskId,
    taskContractDigest,
    riskClass,
    adoptedAt,
    assurance: COMMIT_ADOPTION_ASSURANCE,
    ok: evaluation?.ok,
    nextOwner: evaluation?.nextOwner,
    reasons: evaluation?.reasons,
    diagnostics: evaluation?.diagnostics,
    adoption: evaluation?.adoption,
    preserved: evaluation?.preserved,
    certification: evaluation?.certification,
    semanticDigest: null,
  };
  record.semanticDigest = adoptionDigest(record);
  const checked = validateCommitAdoptionRecord(record, { repositoryIdentity });
  if (!checked.ok) throw new TypeError(`invalid commit adoption record: ${checked.errors.join('; ')}`);
  return Object.freeze(record);
}

/**
 * Validate a durable, non-authenticated display claim. Its digest is unkeyed
 * integrity, not provenance: consumers must never use this record to substitute
 * for Git attribution, permission, origin, or renewed certification.
 */
export function validateCommitAdoptionRecord(record, {
  taskId = null,
  taskContractDigest = null,
  baseHead = null,
  head = null,
  repositoryIdentity = null,
  attemptId = null,
  now = Date.now(),
} = {}) {
  const errors = [];
  if (!exactKeys(record, RECORD_FIELDS)) return { ok: false, errors: ['commit adoption record fields must equal the closed schema'] };
  if (record.kind !== COMMIT_ADOPTION_KIND || record.schemaVersion !== COMMIT_ADOPTION_SCHEMA_VERSION || record.backend !== 'files') {
    errors.push('commit adoption record identity is invalid');
  }
  if (typeof record.repositoryIdentity !== 'string' || !record.repositoryIdentity ||
      (repositoryIdentity !== null && record.repositoryIdentity !== repositoryIdentity)) {
    errors.push('commit adoption record repository identity does not match the current target');
  }
  if (typeof record.taskId !== 'string' || !record.taskId.trim() || (taskId !== null && record.taskId !== taskId)) {
    errors.push('commit adoption record task identity does not match the current return');
  }
  if (typeof record.taskContractDigest !== 'string' || !record.taskContractDigest ||
      (taskContractDigest !== null && record.taskContractDigest !== taskContractDigest)) {
    errors.push('commit adoption record protected contract does not match the current return');
  }
  const adoptedAt = canonicalInstant(record.adoptedAt);
  if (typeof record.riskClass !== 'string' || !record.riskClass.trim() || adoptedAt === null) {
    errors.push('commit adoption record risk or timestamp is malformed');
  }
  if (!Number.isFinite(now) || (adoptedAt !== null && adoptedAt > now + ADOPTION_FUTURE_SKEW_MS)) {
    errors.push('commit adoption record timestamp is future-dated');
  }
  if (record.assurance !== COMMIT_ADOPTION_ASSURANCE) {
    errors.push('commit adoption record assurance must be explicitly non-authenticated');
  }
  if (record.ok !== true || record.nextOwner !== null || !Array.isArray(record.reasons) || record.reasons.length !== 0 || !Array.isArray(record.diagnostics)) {
    errors.push('commit adoption record must preserve one successful evaluation');
  }
  const adoption = record.adoption;
  if (!adoption || !exactKeys(adoption, ['range', 'commits', 'changedPaths', 'actor', 'reason']) ||
      !exactKeys(adoption.range, ['base', 'head']) || !isGitObjectId(adoption.range.base) || !isGitObjectId(adoption.range.head) ||
      !sameGitObjectFormat([adoption.range.base, adoption.range.head]) ||
      !Array.isArray(adoption.commits) || adoption.commits.length === 0 ||
      adoption.commits.some(commit => !isGitObjectId(commit)) || new Set(adoption.commits).size !== adoption.commits.length ||
      !Array.isArray(adoption.changedPaths) || adoption.changedPaths.some(path => typeof path !== 'string' || !path) ||
      !validActor(adoption.actor) || typeof adoption.reason !== 'string' || !adoption.reason.trim()) {
    errors.push('commit adoption record attribution is malformed');
  } else if ((baseHead !== null && adoption.range.base !== baseHead) || (head !== null && adoption.range.head !== head)) {
    errors.push('commit adoption record range does not exactly match the current return');
  }
  if (!exactKeys(record.preserved, ['attempt', 'originalBase']) ||
      !exactKeys(record.preserved?.attempt, ['id', 'authorization']) ||
      typeof record.preserved.attempt.id !== 'string' || !record.preserved.attempt.id ||
      typeof record.preserved.attempt.authorization !== 'string' || !record.preserved.attempt.authorization ||
      record.preserved.originalBase !== record.adoption?.range?.base ||
      (attemptId !== null && record.preserved.attempt.id !== attemptId)) {
    errors.push('commit adoption record does not preserve the original bounded attempt');
  }
  if (!exactKeys(record.certification, ['invalidated', 'rerun', 'maintainerReviewRequired']) ||
      JSON.stringify(record.certification?.invalidated) !== JSON.stringify(INVALIDATED_CERTIFICATION) ||
      JSON.stringify(record.certification?.rerun) !== JSON.stringify(REQUIRED_RERUNS) ||
      record.certification.maintainerReviewRequired !== true) {
    errors.push('commit adoption record does not require renewed certification');
  }
  if (record.semanticDigest !== adoptionDigest(record)) {
    errors.push('commit adoption record semantic digest is invalid');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Resolve a display-only claim for an exact return range. A valid record can be
 * shown or classified, but cannot establish commit provenance: range attribution
 * remains independently derived from canonical Git trailers.
 */
export function resolveCommitAdoption(target, { taskId, taskContractDigest, baseHead, head, repositoryIdentity, attemptId, now } = {}) {
  const relPath = `.agenticloop/adoptions/commits/${String(taskId ?? '')}/${String(head ?? '')}.json`;
  const path = join(target, ...relPath.split('/'));
  if (!existsSync(path)) return { ok: true, record: null, relPath };
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, relPath, errors: [`commit adoption record '${relPath}' is missing or corrupt`] };
  }
  const checked = validateCommitAdoptionRecord(record, { taskId, taskContractDigest, baseHead, head, repositoryIdentity, attemptId, now });
  if (!checked.ok) return { ok: false, relPath, errors: checked.errors };
  return {
    ok: true,
    relPath,
    record,
    display: record,
  };
}

/**
 * Evaluate one proposed reachable range. The caller supplies the frozen task
 * values that are already authority-bound; Git supplies reachability, commit
 * topology, and changed paths immediately before adoption.
 */
export function evaluateCommitAdoption(input = {}) {
  const reasons = [];
  const diagnostics = [];
  const runGit = input.runGit;
  const { range = {}, protectedContract, riskClass, attempt = {}, actor = {} } = input;
  const base = String(range.base ?? '');
  const head = String(range.head ?? '');
  const currentHead = String(input.currentHead ?? '');

  if (typeof runGit !== 'function') reasons.push('repository ancestry cannot be evaluated without a Git runner');
  if (!isGitObjectId(base) || !isGitObjectId(head) || !isGitObjectId(currentHead) || !sameGitObjectFormat([base, head, currentHead])) {
    reasons.push('adoption requires full same-format base, head, and current repository identities');
  }
  if (input.originalBase !== base) {
    // The original base is not advisory. Letting it move would record an
    // innocent-looking adoption while widening the task's product lineage.
    reasons.push('adoption base does not equal the original bounded authorization base');
  }
  if (typeof attempt.id !== 'string' || !attempt.id || typeof attempt.authorization !== 'string' || !attempt.authorization) {
    reasons.push('adoption requires the original attempt and bounded authorization identities');
  }
  if (input.executor !== 'supervisor') reasons.push('only the supervisor may execute adoption under the existing authorization');
  if (!validActor(actor)) reasons.push(`adoption requires a claimed actor class in: ${COMMIT_ADOPTION_ACTOR_CLASSES.join(', ')}, and an identity`);
  if (typeof input.reason !== 'string' || !input.reason.trim()) reasons.push('adoption requires an explicit recorded reason');
  if (!matchingAuthorizationIdentity(protectedContract)) {
    reasons.push('protected contract identity is missing or malformed under the existing authorization');
    diagnostics.push(Object.freeze({ type: 'protected_contract_missing', evidenceState: 'malformed' }));
  } else if (protectedContract.authorized !== protectedContract.current) {
    reasons.push('protected contract changed or widened under the existing authorization');
  }
  if (!matchingAuthorizationIdentity(riskClass)) {
    reasons.push('risk class identity is missing or malformed under the existing authorization');
    diagnostics.push(Object.freeze({ type: 'risk_class_missing', evidenceState: 'malformed' }));
  } else if (riskClass.authorized !== riskClass.current) {
    reasons.push('risk class changed under the existing authorization');
  }
  const allowedPaths = Array.isArray(input.allowedPaths) ? input.allowedPaths.filter(path => typeof path === 'string' && path) : [];
  if (allowedPaths.length === 0) reasons.push('adoption requires an allowed-path scope');

  if (reasons.length > 0) return result(reasons, {}, diagnostics);

  const baseReachable = gitOk(runGit, ['merge-base', '--is-ancestor', base, head]);
  const headReachable = gitOk(runGit, ['merge-base', '--is-ancestor', head, currentHead]);
  if (!baseReachable || baseReachable.status !== 0) reasons.push('proposed adoption base is not an ancestor of its head');
  if (!headReachable || headReachable.status !== 0) reasons.push('proposed adoption head is not reachable from current repository state');
  if (reasons.length > 0) return result(reasons);

  const commitList = gitOk(runGit, ['rev-list', '--reverse', `${base}..${head}`]);
  const commits = commitList?.status === 0 ? lines(commitList.stdout) : [];
  if (commits.length === 0 || commits.some(commit => !isGitObjectId(commit) || !sameGitObjectFormat([base, commit]))) {
    reasons.push('adoption cannot derive one non-empty exact task-relevant commit range');
  }
  for (const commit of commits) {
    const parents = gitOk(runGit, ['rev-list', '--parents', '-n', '1', commit]);
    const parentIds = parents?.status === 0 ? lines(parents.stdout)[0]?.split(/\s+/).slice(1) ?? [] : [];
    if (parentIds.length !== 1) {
      reasons.push(`adoption refuses merge or ambiguous ancestry at commit ${commit}`);
      break;
    }
  }
  // Do not compare just the endpoint trees here. A bounded-range commit can
  // touch an out-of-scope path and a later commit can restore it, making it
  // disappear from `base..head` despite being part of the ancestry adoption
  // would exempt from normal attribution. The adoption record must attest the
  // union of every path touched by every exact, already non-merge commit.
  const changedPathSet = new Set();
  for (const commit of commits) {
    const changed = gitOk(runGit, [
      'diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-m', commit,
    ]);
    if (!changed || changed.status !== 0) {
      reasons.push(`adoption cannot derive changed paths for commit ${commit}`);
      break;
    }
    for (const path of lines(changed.stdout)) changedPathSet.add(path);
  }
  const changedPaths = [...changedPathSet].sort();
  if (changedPaths.some(path => !allowedPaths.some(pattern => fileMatchesScopePattern(path, pattern)))) {
    reasons.push('proposed adoption contains a changed path that is not allowed by the bounded scope');
  }
  if (reasons.length > 0) return result(reasons);

  return result([], {
    assurance: COMMIT_ADOPTION_ASSURANCE,
    adoption: Object.freeze({
      range: Object.freeze({ base, head }), commits: Object.freeze(commits), changedPaths: Object.freeze(changedPaths),
      actor: Object.freeze({ class: actor.class, id: actor.id }), reason: input.reason.trim(),
    }),
    // These are preserved verbatim rather than regenerated so adoption cannot
    // silently consume a new attempt or invent a wider authorization.
    preserved: Object.freeze({ attempt: Object.freeze({ id: attempt.id, authorization: attempt.authorization }), originalBase: base }),
    certification: Object.freeze({
      invalidated: INVALIDATED_CERTIFICATION,
      rerun: REQUIRED_RERUNS,
      maintainerReviewRequired: true,
    }),
  });
}
