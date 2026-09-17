import {
  PREPARE_DISPATCH_DIMENSIONS,
  SEMANTIC_INPUT_KIND,
  SEMANTIC_INPUT_SCHEMA_VERSION,
  SEMANTIC_METHOD_ID,
  evaluateSemanticInput,
} from './semantic-evaluator.js';

const FACT_OWNER = Object.freeze({
  task_identity: ['workflow_role', 'maintainer'],
  lifecycle: ['workflow_role', 'maintainer'],
  task_contract: ['human_authority', 'human_authority'],
  contract_baseline: ['workflow_role', 'maintainer'],
  required_checks: ['workflow_role', 'maintainer'],
  activation: ['human_actor', 'operator'],
  activation_assurance: ['human_actor', 'operator'],
  readiness: ['workflow_role', 'maintainer'],
  dependency_evidence: ['workflow_role', 'maintainer'],
  decomposition: ['workflow_role', 'maintainer'],
  work_unit_membership: ['workflow_role', 'maintainer'],
  maintainer_attribution: ['workflow_role', 'maintainer'],
  task_eligibility: ['workflow_role', 'maintainer'],
  repository_identity: ['human_actor', 'operator'],
  base_identity: ['workflow_role', 'maintainer'],
  clean_state: ['workflow_role', 'orchestrator'],
  assignment: ['workflow_role', 'orchestrator'],
  host_role_capability: ['human_actor', 'operator'],
  return_capability: ['human_actor', 'operator'],
});

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function text(value, fallback = null) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function evidenceState(entry) {
  if (!entry || entry.state === 'not_reached') return 'unavailable';
  if (entry.state === 'satisfied') return 'current';
  if (entry.state === 'not_applicable') return 'not_applicable';
  return {
    missing: 'missing',
    malformed: 'invalid',
    negative: entry.code === 'activation.grant.revoked' ? 'revoked' : 'negative',
    changed: 'stale',
    stale: 'stale',
  }[entry.evidenceState] ?? 'unknown';
}

function candidateTarget(candidate) {
  const snapshot = candidate?.snapshot ?? candidate?.packet?.task ?? {};
  const repository = candidate?.repository ?? candidate?.packet?.repository ?? {};
  return {
    repositoryId: text(repository.worktree, 'repository:unavailable'),
    backend: ['files', 'github'].includes(snapshot.backend ?? candidate?.packet?.backend)
      ? snapshot.backend ?? candidate.packet.backend
      : 'files',
    taskId: text(snapshot.taskId ?? snapshot.id, 'task:unavailable'),
    workUnitId: null,
  };
}

function candidateBindings(candidate, decision) {
  const activation = decision?.bindings?.activation ?? candidate?.activationEvidence ?? candidate?.authorization ?? null;
  const contract = decision?.bindings?.contract ?? null;
  return {
    protectedContractId: text(contract?.digest ?? candidate?.packet?.task?.taskContractDigest),
    grantId: text(activation?.grant?.grantId ?? activation?.binding?.grantId),
    attemptId: null,
    checkInvocationId: null,
    candidateId: null,
    reviewRoundId: null,
    auditRunId: null,
    closeoutId: null,
    correctionOf: null,
  };
}

function hostEnforcement(candidate) {
  const declaration = candidate?.assignment?.hostRoleCapability ?? candidate?.packet?.assignment?.hostRoleCapability;
  const binding = declaration?.actionBindings?.find(action => action.action === 'role_dispatch');
  return ['enforced', 'advisory', 'unavailable', 'not_applicable'].includes(binding?.enforcement)
    ? binding.enforcement
    : 'unavailable';
}

export function normalizeDispatchSemanticInput(candidate, decision) {
  const target = candidateTarget(candidate);
  const scopeKey = `${target.repositoryId}:${target.taskId}:prepare_dispatch`;
  const facts = PREPARE_DISPATCH_DIMENSIONS.map(dimension => {
    const entry = decision?.dimensions?.[dimension] ?? null;
    const [ownerKind, ownerId] = FACT_OWNER[dimension];
    return {
      id: `dispatch.${dimension}`,
      state: evidenceState(entry),
      value: entry === null ? null : {
        dimensionState: entry.state,
        policyCode: entry.code ?? null,
      },
      owner: { kind: ownerKind, id: ownerId },
      scope: { kind: dimension === 'repository_identity' ? 'repository' : 'task_contract', key: scopeKey },
      source: {
        kind: 'dispatch_fact_shape',
        id: text(candidate?.factShape, 'unknown'),
        state: entry === null ? 'unavailable' : 'available',
      },
      observedAt: null,
      derivation: {
        methodId: 'agenticloop.dispatch-normalizer/v1',
        observationIds: [`${text(candidate?.factShape, 'unknown')}:${dimension}`],
      },
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  return deepFreeze({
    kind: SEMANTIC_INPUT_KIND,
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    methodId: SEMANTIC_METHOD_ID,
    request: {
      actionId: 'prepare_dispatch',
      actor: {
        roleId: 'orchestrator',
        actorId: 'orchestrator',
        authoritySource: 'workflow_role',
        hostEnforcement: hostEnforcement(candidate),
      },
      target,
      bindings: candidateBindings(candidate, decision),
      requestedAssurance: text(candidate?.policy?.minimumActivation ?? candidate?.packet?.assurance?.policy?.minimumActivation),
    },
    facts,
  });
}

export function evaluateNormalizedDispatchDecision(candidate, decision) {
  return evaluateSemanticInput(normalizeDispatchSemanticInput(candidate, decision));
}
