import {
  SEMANTIC_ACTION_FACT_IDS,
  SEMANTIC_INPUT_KIND,
  SEMANTIC_INPUT_SCHEMA_VERSION,
  SEMANTIC_METHOD_ID,
  evaluateSemanticInput,
} from './semantic-evaluator.js';

const ASSOCIATED_EVALUATIONS = new WeakMap();

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function text(value, fallback = null) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function semanticState(validation) {
  if (validation?.evidenceState === 'not_applicable') return 'not_applicable';
  if (validation?.ok === true) return 'current';
  return {
    missing: 'missing',
    malformed: 'invalid',
    negative: 'negative',
    stale: 'stale',
    changed: 'stale',
    unsupported: 'unsupported',
    unavailable: 'unavailable',
    unknown: 'unknown',
    not_applicable: 'not_applicable',
  }[validation?.evidenceState] ?? 'unknown';
}

export function evaluateSemanticValidation({
  actionId,
  validation,
  backend = 'files',
  repositoryId = 'repository:unavailable',
  taskId = 'task:unavailable',
  workUnitId = null,
  roleId = 'orchestrator',
  actorId = null,
  authoritySource = 'protected_command',
  hostEnforcement = 'unavailable',
  requestedAssurance = null,
  bindings = {},
  scopeKind = 'task_contract',
  scopeKey = null,
  sourceKind = 'protected_validation',
  sourceId = null,
  factOwner = null,
} = {}) {
  const factIds = SEMANTIC_ACTION_FACT_IDS[actionId];
  if (!Array.isArray(factIds) || factIds.length !== 1) {
    throw new TypeError(`semantic validation normalizer requires one registered fact for '${String(actionId)}'`);
  }
  const state = semanticState(validation);
  const codes = [...new Set((validation?.diagnostics ?? []).map(item => item?.code).filter(Boolean))].sort();
  const resolvedScopeKey = text(scopeKey, `${repositoryId}:${taskId}:${actionId}`);
  return evaluateSemanticInput(deepFreeze({
    kind: SEMANTIC_INPUT_KIND,
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    methodId: SEMANTIC_METHOD_ID,
    request: {
      actionId,
      actor: {
        roleId,
        actorId: text(actorId, roleId),
        authoritySource,
        hostEnforcement,
      },
      target: {
        repositoryId: text(repositoryId, 'repository:unavailable'),
        backend: backend === 'github' ? 'github' : 'files',
        taskId: text(taskId, 'task:unavailable'),
        workUnitId: text(workUnitId, null),
      },
      bindings: {
        protectedContractId: text(bindings.protectedContractId, null),
        grantId: text(bindings.grantId, null),
        attemptId: text(bindings.attemptId, null),
        checkInvocationId: text(bindings.checkInvocationId, null),
        candidateId: text(bindings.candidateId, null),
        reviewRoundId: text(bindings.reviewRoundId, null),
        auditRunId: text(bindings.auditRunId, null),
        closeoutId: text(bindings.closeoutId, null),
        correctionOf: text(bindings.correctionOf, null),
      },
      requestedAssurance: text(requestedAssurance, null),
    },
    facts: [{
      id: factIds[0],
      state,
      value: {
        policyCodes: codes,
        disposition: text(validation?.disposition, null),
        detail: validation?.detail ?? null,
      },
      owner: factOwner && typeof factOwner.kind === 'string' && typeof factOwner.id === 'string'
        ? { kind: factOwner.kind, id: factOwner.id }
        : { kind: 'semantic_boundary', id: actionId },
      scope: { kind: scopeKind, key: resolvedScopeKey },
      source: {
        kind: sourceKind,
        id: text(sourceId, `${actionId}:validation`),
        state: state === 'unavailable' ? 'unavailable' : 'available',
      },
      observedAt: null,
      derivation: {
        methodId: 'agenticloop.validation-normalizer/v1',
        observationIds: codes.length > 0 ? codes : [`${actionId}:${state}`],
      },
    }],
  }));
}

export function associateSemanticEvaluation(value, evaluation) {
  if (value && typeof value === 'object') ASSOCIATED_EVALUATIONS.set(value, evaluation);
  return value;
}

export function semanticEvaluationFor(value) {
  return value && typeof value === 'object' ? ASSOCIATED_EVALUATIONS.get(value) ?? null : null;
}
