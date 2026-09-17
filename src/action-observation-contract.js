import {
  SEMANTIC_ACTION_IDS,
  SEMANTIC_METHOD_ID,
  SEMANTIC_VERDICTS,
} from './semantic-evaluator.js';

export const ACTION_OBSERVATION_KIND = 'agenticloop.action-observation';
export const ACTION_OBSERVATION_SCHEMA_VERSION = 1;

export const ACTION_OBSERVATION_OUTCOMES = Object.freeze([
  'recorded',
  'refused_before_evaluation',
  'refused_by_evaluation',
  'failed_after_evaluation',
]);

const OBSERVATION_KEYS = Object.freeze([
  'kind', 'schemaVersion', 'observationId', 'operationAttemptId', 'actionId',
  'actor', 'evaluationId', 'verdict', 'reasonIds', 'preEvaluationFailureCode',
  'finalOutcome', 'repositoryId', 'taskId', 'protectedContractId', 'attemptId',
  'candidateId', 'deduplicationKey', 'methodId', 'occurredAt', 'coverage',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmpty(value);
}

export function validateActionObservation(value) {
  const errors = [];
  if (!exactKeys(value, OBSERVATION_KEYS)) {
    return ['action observation fields are incomplete or contain unknown properties'];
  }
  if (value.kind !== ACTION_OBSERVATION_KIND) errors.push(`action observation kind must be '${ACTION_OBSERVATION_KIND}'`);
  if (value.schemaVersion !== ACTION_OBSERVATION_SCHEMA_VERSION) errors.push(`action observation schemaVersion must be ${ACTION_OBSERVATION_SCHEMA_VERSION}`);
  for (const key of ['observationId', 'operationAttemptId', 'deduplicationKey']) {
    if (!nonEmpty(value[key])) errors.push(`action observation ${key} must be a non-empty string`);
  }
  if (!SEMANTIC_ACTION_IDS.includes(value.actionId)) errors.push('action observation actionId is invalid');
  if (!exactKeys(value.actor, ['roleId', 'actorId']) || !nonEmpty(value.actor.roleId) || !nonEmpty(value.actor.actorId)) {
    errors.push('action observation actor is invalid');
  }
  if (!ACTION_OBSERVATION_OUTCOMES.includes(value.finalOutcome)) errors.push('action observation finalOutcome is invalid');
  if (value.methodId !== SEMANTIC_METHOD_ID) errors.push(`action observation methodId must be '${SEMANTIC_METHOD_ID}'`);
  if (!nonEmpty(value.repositoryId) || !nonEmpty(value.taskId)) errors.push('action observation repositoryId and taskId are required');
  for (const key of ['protectedContractId', 'attemptId', 'candidateId']) {
    if (!nullableString(value[key])) errors.push(`action observation ${key} must be a string or null`);
  }
  if (!nonEmpty(value.occurredAt) || Number.isNaN(new Date(value.occurredAt).valueOf())) {
    errors.push('action observation occurredAt must be an ISO timestamp');
  }
  if (!exactKeys(value.coverage, ['decision', 'finalOutcome']) ||
      !['available', 'unavailable'].includes(value.coverage.decision) ||
      !['available', 'unavailable'].includes(value.coverage.finalOutcome)) {
    errors.push('action observation coverage is invalid');
  }

  const evaluated = value.evaluationId !== null;
  if (evaluated) {
    if (!nonEmpty(value.evaluationId) || !SEMANTIC_VERDICTS.includes(value.verdict)) {
      errors.push('evaluated action observation requires an evaluationId and verdict');
    }
    if (!Array.isArray(value.reasonIds) || value.reasonIds.some(reason => !nonEmpty(reason))) {
      errors.push('evaluated action observation reasonIds must be strings');
    }
    if (value.preEvaluationFailureCode !== null) errors.push('evaluated action observation cannot carry a pre-evaluation failure code');
    if (value.coverage.decision !== 'available') errors.push('evaluated action observation decision coverage must be available');
  } else {
    if (value.verdict !== null || !Array.isArray(value.reasonIds) || value.reasonIds.length !== 0 || !nonEmpty(value.preEvaluationFailureCode)) {
      errors.push('pre-evaluation action observation must carry only a typed failure code');
    }
    if (value.coverage.decision !== 'unavailable') errors.push('pre-evaluation action observation decision coverage must be unavailable');
  }
  return errors;
}
