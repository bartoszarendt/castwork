import {
  SEMANTIC_ACTION_FACT_IDS,
  SEMANTIC_INPUT_KIND,
  SEMANTIC_INPUT_SCHEMA_VERSION,
  SEMANTIC_METHOD_ID,
  evaluateSemanticInput,
} from './semantic-evaluator.js';

const TRANSITION_ACTION = Object.freeze({
  role_start: 'role_start',
  review_entry: 'review_prepare',
  // These transitions establish the same shared fact. Their feature-specific
  // callers separately evaluate review, integration, or closeout legality.
  acceptance: 'verify_return',
  integration: 'verify_return',
  closeout: 'verify_return',
});

const ASSOCIATED_EVALUATIONS = new WeakMap();

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function text(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function factState(diagnostics, evidenceState) {
  if (diagnostics.length === 0) return 'current';
  if (diagnostics.some(item => item?.code === 'handoff.evidence.unsupported')) return 'unsupported';
  if (diagnostics.some(item => item?.code === 'handoff.evidence.malformed')) return 'invalid';
  if (diagnostics.some(item => [
    'handoff.evidence.freshness_expired',
    'handoff.evidence.schema_retired',
    'handoff.evidence.revalidation_failed',
    'handoff.evidence.ambiguous_return',
    'handoff.evidence.replayed',
    'handoff.evidence.mismatched',
  ].includes(item?.code))) return 'stale';
  return {
    missing: 'missing',
    malformed: 'invalid',
    stale: 'stale',
    changed: 'stale',
    negative: 'negative',
  }[evidenceState] ?? 'unknown';
}

export function evaluateSemanticHandoff({ transition, requirement, diagnostics = [], evidenceState = null, identity = {}, observedGrade = null }) {
  const actionId = TRANSITION_ACTION[transition];
  if (!actionId) return null;
  const repositoryId = text(identity.repositoryIdentity, 'repository:unavailable');
  const taskId = text(identity.taskId, 'task:unavailable');
  const state = factState(diagnostics, evidenceState);
  return evaluateSemanticInput(deepFreeze({
    kind: SEMANTIC_INPUT_KIND,
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    methodId: SEMANTIC_METHOD_ID,
    request: {
      actionId,
      actor: {
        roleId: text(identity.roleId, actionId === 'role_start' ? 'engineer' : 'orchestrator'),
        actorId: text(identity.roleId, actionId === 'role_start' ? 'engineer' : 'orchestrator'),
        authoritySource: 'protected_handoff',
        hostEnforcement: observedGrade === 'host_signed' || observedGrade === 'host_receipt'
          ? 'enforced'
          : observedGrade === null ? 'unavailable' : 'advisory',
      },
      target: {
        repositoryId,
        backend: identity.backend === 'github' ? 'github' : 'files',
        taskId,
        workUnitId: typeof identity.workUnitIdentity === 'string' && identity.workUnitIdentity
          ? identity.workUnitIdentity
          : null,
      },
      bindings: {
        protectedContractId: text(identity.taskContractDigest, null),
        grantId: null,
        attemptId: text(identity.invocationId, null),
        checkInvocationId: null,
        candidateId: text(identity.productHead ?? identity.candidateHead, null),
        reviewRoundId: null,
        auditRunId: null,
        closeoutId: null,
        correctionOf: null,
      },
      requestedAssurance: observedGrade,
    },
    facts: [{
      id: SEMANTIC_ACTION_FACT_IDS[actionId][0],
      state,
      value: {
        requirement,
        policyCodes: [...new Set(diagnostics.map(item => item?.code).filter(Boolean))].sort(),
      },
      owner: state === 'current'
        ? { kind: 'workflow_role', id: actionId === 'role_start' ? 'orchestrator' : 'maintainer' }
        : { kind: 'evidence_producer', id: 'handoff_boundary' },
      scope: {
        kind: requirement === 'prepared_dispatch' ? 'task_attempt' : 'candidate',
        key: text(identity.packetId ?? identity.returnId, `${repositoryId}:${taskId}:${actionId}`),
      },
      source: {
        kind: 'handoff_recognition',
        id: text(identity.packetId ?? identity.returnId, `${actionId}:unavailable`),
        state: state === 'unavailable' ? 'unavailable' : 'available',
      },
      observedAt: null,
      derivation: {
        methodId: 'agenticloop.handoff-normalizer/v1',
        observationIds: diagnostics.length > 0
          ? diagnostics.map((item, index) => `${item?.code ?? 'unknown'}:${index}`)
          : [`${requirement}:current`],
      },
    }],
  }));
}

export function associateHandoffSemanticEvaluation(recognition, evaluation) {
  if (evaluation === null) return recognition;
  ASSOCIATED_EVALUATIONS.set(recognition, evaluation);
  return recognition;
}

export function semanticEvaluationForHandoff(recognition) {
  return ASSOCIATED_EVALUATIONS.get(recognition) ?? null;
}
