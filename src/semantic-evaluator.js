import { canonicalJson, canonicalSha256 } from './canonical-json.js';

export const SEMANTIC_INPUT_KIND = 'agenticloop.semantic-input';
export const SEMANTIC_INPUT_SCHEMA_VERSION = 1;
export const SEMANTIC_METHOD_ID = 'agenticloop.lifecycle-semantics/v1';
export const SEMANTIC_RESULT_KIND = 'agenticloop.semantic-evaluation';
export const SEMANTIC_RESULT_SCHEMA_VERSION = 1;

export const SEMANTIC_ACTION_IDS = Object.freeze([
  'authorize',
  'revoke',
  'prepare_dispatch',
  'role_start',
  'check_evidence_init',
  'check_evidence_update',
  'prepare_return',
  'verify_return',
  'abandon_attempt',
  'adopt_product_work',
  'review_prepare',
  'review_record',
  'remediate',
  'audit_record',
  'integrate',
  'closeout_prepare',
  'closeout_record',
  'correct_derivation',
]);

export const SEMANTIC_EVIDENCE_STATES = Object.freeze([
  'current',
  'missing',
  'invalid',
  'negative',
  'stale',
  'revoked',
  'unsupported',
  'unavailable',
  'unknown',
  'not_applicable',
]);

export const SEMANTIC_VERDICTS = Object.freeze([
  'legal', 'illegal', 'unknown', 'not_applicable',
]);

export const PREPARE_DISPATCH_DIMENSIONS = Object.freeze([
  'task_identity',
  'lifecycle',
  'task_contract',
  'contract_baseline',
  'required_checks',
  'activation',
  'activation_assurance',
  'readiness',
  'dependency_evidence',
  'decomposition',
  'work_unit_membership',
  'maintainer_attribution',
  'task_eligibility',
  'repository_identity',
  'base_identity',
  'clean_state',
  'assignment',
  'host_role_capability',
  'return_capability',
]);

export const PREPARE_DISPATCH_FACT_IDS = Object.freeze(
  PREPARE_DISPATCH_DIMENSIONS.map(dimension => `dispatch.${dimension}`).sort(),
);

const SINGLE_HANDOFF_FACT = Object.freeze({
  authorize: 'authorization.grant',
  revoke: 'authorization.grant',
  role_start: 'handoff.prepared_dispatch',
  check_evidence_init: 'check.outcome',
  check_evidence_update: 'check.outcome',
  prepare_return: 'return.preparation',
  verify_return: 'return.verified',
  abandon_attempt: 'attempt.consumption',
  adopt_product_work: 'product.attribution',
  review_prepare: 'handoff.verified_return',
  review_record: 'review.outcome',
  remediate: 'remediation.authority',
  audit_record: 'audit.certificate',
  integrate: 'integration.readiness',
  closeout_prepare: 'closeout.readiness',
  closeout_record: 'closeout.readiness',
  correct_derivation: 'derivation.correctable',
});

export const SEMANTIC_ACTION_FACT_IDS = Object.freeze(Object.fromEntries(
  SEMANTIC_ACTION_IDS.map(actionId => [
    actionId,
    Object.freeze(actionId === 'prepare_dispatch'
      ? [...PREPARE_DISPATCH_FACT_IDS]
      : SINGLE_HANDOFF_FACT[actionId]
        ? [SINGLE_HANDOFF_FACT[actionId]]
        : []),
  ]),
));

export const IMPLEMENTED_SEMANTIC_ACTION_IDS = Object.freeze(
  SEMANTIC_ACTION_IDS.filter(actionId => SEMANTIC_ACTION_FACT_IDS[actionId].length > 0),
);

const CONDITIONAL_DISPATCH_FACTS = new Set([
  'dispatch.decomposition',
  'dispatch.work_unit_membership',
  'dispatch.maintainer_attribution',
  'dispatch.task_eligibility',
]);

const REQUEST_KEYS = Object.freeze([
  'actionId', 'actor', 'target', 'bindings', 'requestedAssurance',
]);
const ACTOR_KEYS = Object.freeze([
  'roleId', 'actorId', 'authoritySource', 'hostEnforcement',
]);
const TARGET_KEYS = Object.freeze([
  'repositoryId', 'backend', 'taskId', 'workUnitId',
]);
const BINDING_KEYS = Object.freeze([
  'protectedContractId', 'grantId', 'attemptId', 'checkInvocationId',
  'candidateId', 'reviewRoundId', 'auditRunId', 'closeoutId', 'correctionOf',
]);
const FACT_KEYS = Object.freeze([
  'id', 'state', 'value', 'owner', 'scope', 'source', 'observedAt', 'derivation',
]);

const KNOWN_VIOLATION_STATES = new Set(['invalid', 'negative', 'stale', 'revoked']);
const UNKNOWN_STATES = new Set(['missing', 'unsupported', 'unavailable', 'unknown']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmpty(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export class SemanticInputError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'SemanticInputError';
    this.code = code;
  }
}

function invalid(message) {
  throw new SemanticInputError('semantic_input.invalid', message);
}

function validateRequest(request) {
  if (!exactKeys(request, REQUEST_KEYS)) invalid('semantic request fields are incomplete or contain unknown properties');
  if (!SEMANTIC_ACTION_IDS.includes(request.actionId)) invalid(`unknown semantic action '${String(request.actionId)}'`);
  if (!IMPLEMENTED_SEMANTIC_ACTION_IDS.includes(request.actionId)) {
    throw new SemanticInputError(
      'semantic_action.unsupported',
      `semantic action '${request.actionId}' is declared but is not implemented by ${SEMANTIC_METHOD_ID}`,
    );
  }
  if (!exactKeys(request.actor, ACTOR_KEYS) ||
      !nonEmpty(request.actor.roleId) ||
      !nonEmpty(request.actor.actorId) ||
      !nonEmpty(request.actor.authoritySource) ||
      !['enforced', 'advisory', 'unavailable', 'not_applicable'].includes(request.actor.hostEnforcement)) {
    invalid('semantic request actor is invalid');
  }
  if (!exactKeys(request.target, TARGET_KEYS) ||
      !nonEmpty(request.target.repositoryId) ||
      !['files', 'github'].includes(request.target.backend) ||
      !nonEmpty(request.target.taskId) ||
      !nullableString(request.target.workUnitId)) {
    invalid('semantic request target is invalid');
  }
  if (!exactKeys(request.bindings, BINDING_KEYS) ||
      Object.values(request.bindings).some(value => !nullableString(value))) {
    invalid('semantic request bindings are invalid');
  }
  if (!nullableString(request.requestedAssurance)) invalid('semantic request requestedAssurance must be a string or null');
}

function validateFact(fact) {
  if (!exactKeys(fact, FACT_KEYS)) invalid('semantic fact fields are incomplete or contain unknown properties');
  if (!nonEmpty(fact.id) || !SEMANTIC_EVIDENCE_STATES.includes(fact.state)) invalid('semantic fact identity or state is invalid');
  if (!exactKeys(fact.owner, ['kind', 'id']) || !nonEmpty(fact.owner.kind) || !nonEmpty(fact.owner.id)) {
    invalid(`semantic fact '${fact.id}' owner is invalid`);
  }
  if (!exactKeys(fact.scope, ['kind', 'key']) || !nonEmpty(fact.scope.kind) || !nonEmpty(fact.scope.key)) {
    invalid(`semantic fact '${fact.id}' scope is invalid`);
  }
  if (!exactKeys(fact.source, ['kind', 'id', 'state']) ||
      !nonEmpty(fact.source.kind) || !nonEmpty(fact.source.id) ||
      !['available', 'unavailable'].includes(fact.source.state)) {
    invalid(`semantic fact '${fact.id}' source is invalid`);
  }
  if (!nullableString(fact.observedAt)) invalid(`semantic fact '${fact.id}' observedAt must be a string or null`);
  if (fact.observedAt !== null && (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fact.observedAt) ||
    Number.isNaN(Date.parse(fact.observedAt))
  )) invalid(`semantic fact '${fact.id}' observedAt must be an ISO-8601 UTC instant or null`);
  if (fact.derivation !== null && (
    !exactKeys(fact.derivation, ['methodId', 'observationIds']) ||
    !nonEmpty(fact.derivation.methodId) ||
    !Array.isArray(fact.derivation.observationIds) ||
    fact.derivation.observationIds.length === 0 ||
    fact.derivation.observationIds.some(value => !nonEmpty(value))
  )) invalid(`semantic fact '${fact.id}' derivation is invalid`);
  try {
    canonicalJson(fact.value);
  } catch (error) {
    invalid(`semantic fact '${fact.id}' value is not canonical JSON data: ${error.message}`);
  }
}

function validateInput(input) {
  if (!exactKeys(input, ['kind', 'schemaVersion', 'methodId', 'request', 'facts'])) {
    invalid('semantic input fields are incomplete or contain unknown properties');
  }
  if (input.kind !== SEMANTIC_INPUT_KIND) invalid(`semantic input kind must be '${SEMANTIC_INPUT_KIND}'`);
  if (input.schemaVersion !== SEMANTIC_INPUT_SCHEMA_VERSION) {
    throw new SemanticInputError(
      'semantic_input.schema_unsupported',
      `semantic input schemaVersion '${String(input.schemaVersion)}' is unsupported`,
    );
  }
  if (input.methodId !== SEMANTIC_METHOD_ID) {
    throw new SemanticInputError(
      'semantic_input.method_unsupported',
      `semantic input methodId '${String(input.methodId)}' is unsupported`,
    );
  }
  validateRequest(input.request);
  if (!Array.isArray(input.facts)) invalid('semantic input facts must be an array');
  for (const fact of input.facts) validateFact(fact);
  const ids = input.facts.map(fact => fact.id);
  if (new Set(ids).size !== ids.length) invalid('semantic input facts contain duplicate IDs');
  if (ids.some((id, index) => index > 0 && ids[index - 1].localeCompare(id) >= 0)) {
    invalid('semantic input facts must be sorted by stable ID');
  }
  const expected = SEMANTIC_ACTION_FACT_IDS[input.request.actionId];
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) {
    invalid(`${input.request.actionId} facts must exactly equal: ${expected.join(', ')}`);
  }
}

function reasonId(fact) {
  const policyCodes = new Set([
    fact.value?.policyCode,
    ...(Array.isArray(fact.value?.policyCodes) ? fact.value.policyCodes : []),
  ].filter(Boolean));
  if (fact.state === 'invalid' && fact.derivation !== null && fact.value?.derivationFault === true) return 'derivation.fault';
  if (fact.state === 'invalid' && fact.value?.exceptionRequested === true) return 'exception.not_permitted';
  if (fact.state === 'revoked' || policyCodes.has('activation.grant.revoked')) return 'authorization.revoked';
  if (policyCodes.has('worktree.clean_gate.failed')) return 'evidence.negative';
  if (policyCodes.has('capability.declaration.invalid')) return 'evidence.invalid';
  return {
    missing: 'evidence.missing',
    invalid: 'evidence.invalid',
    negative: 'evidence.negative',
    stale: 'evidence.stale',
    unsupported: 'evidence.unsupported',
    unavailable: 'evidence.unavailable',
    unknown: 'evidence.unknown',
    not_applicable: 'evidence.unknown',
  }[fact.state] ?? 'evidence.unknown';
}

function reasonOwner(fact, id) {
  return id === 'derivation.fault'
    ? { kind: 'human_actor', id: 'operator' }
    : fact.owner;
}

function availabilityFor(fact) {
  return ['unsupported', 'unavailable', 'unknown', 'not_applicable'].includes(fact.state)
    ? 'unavailable'
    : 'available';
}

function evaluateAction(input) {
  const reasons = [];
  const requirements = [];
  let knownViolation = false;
  let unknownMaterial = false;

  for (const fact of input.facts) {
    if (fact.state === 'current') continue;
    if (input.request.actionId === 'prepare_dispatch' &&
        fact.state === 'not_applicable' && CONDITIONAL_DISPATCH_FACTS.has(fact.id)) continue;
    const normalizedState = fact.state === 'not_applicable' ? 'unknown' : fact.state;
    if (KNOWN_VIOLATION_STATES.has(normalizedState)) knownViolation = true;
    if (UNKNOWN_STATES.has(normalizedState)) unknownMaterial = true;
    const id = reasonId({ ...fact, state: normalizedState });
    const owner = reasonOwner(fact, id);
    reasons.push({
      reasonId: id,
      factId: fact.id,
      evidenceState: fact.state,
      owner,
      scope: fact.scope,
      materiality: 'material',
      conflictingFactIds: [],
    });
    requirements.push({
      requirementId: `requirement.${fact.id}`,
      factId: fact.id,
      condition: `${fact.id} must be current for ${fact.scope.key}`,
      owner,
      availability: availabilityFor(fact),
      requiredAuthority: owner,
      actionHint: null,
    });
  }

  const verdict = input.facts.length > 0 && input.facts.every(fact => fact.state === 'not_applicable')
    ? 'not_applicable'
    : knownViolation ? 'illegal' : unknownMaterial ? 'unknown' : 'legal';
  return { verdict, reasons, requirements };
}

export function evaluateSemanticInput(input) {
  validateInput(input);
  const normalized = deepFreeze(structuredClone(input));
  const decision = evaluateAction(normalized);
  return deepFreeze({
    kind: SEMANTIC_RESULT_KIND,
    schemaVersion: SEMANTIC_RESULT_SCHEMA_VERSION,
    methodId: SEMANTIC_METHOD_ID,
    evaluationId: `sha256:agenticloop.semantic-evaluation.v1:${canonicalSha256(normalized)}`,
    request: normalized.request,
    facts: normalized.facts,
    verdict: decision.verdict,
    reasons: decision.reasons,
    requirements: decision.requirements,
    assurance: {
      roleAuthority: normalized.facts.find(fact => fact.id === 'dispatch.assignment')?.state === 'current'
        ? 'established'
        : 'unknown',
      hostEnforcement: normalized.request.actor.hostEnforcement,
      requested: normalized.request.requestedAssurance,
    },
    diagnostics: [],
    derived: true,
    persisted: false,
    authority: 'none',
  });
}
