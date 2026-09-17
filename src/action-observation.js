import { existsSync } from 'node:fs';

import {
  ACTION_OBSERVATION_KIND,
  ACTION_OBSERVATION_SCHEMA_VERSION,
  validateActionObservation,
} from './action-observation-contract.js';
import {
  appendEventLog,
  buildEvent,
  deriveTraceId,
  loadEvents,
  resolveEventLogPath,
} from './event-logging.js';
import { loadProjectMap } from './project-map.js';
import { SEMANTIC_METHOD_ID } from './semantic-evaluator.js';

function isoInstant(value) {
  if (typeof value === 'string') return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
}

export function buildActionObservation({
  operationAttemptId,
  semanticEvaluation,
  finalOutcome,
  occurredAt,
}) {
  const request = semanticEvaluation.request;
  const deduplicationKey = `action:${operationAttemptId}`;
  const observation = {
    kind: ACTION_OBSERVATION_KIND,
    schemaVersion: ACTION_OBSERVATION_SCHEMA_VERSION,
    observationId: `observation:${deriveTraceId(`${ACTION_OBSERVATION_KIND}:v1:${deduplicationKey}`)}`,
    operationAttemptId,
    actionId: request.actionId,
    actor: { roleId: request.actor.roleId, actorId: request.actor.actorId },
    evaluationId: semanticEvaluation.evaluationId,
    verdict: semanticEvaluation.verdict,
    reasonIds: [...new Set(semanticEvaluation.reasons.map(reason => reason.reasonId))].sort(),
    preEvaluationFailureCode: null,
    finalOutcome,
    repositoryId: request.target.repositoryId,
    taskId: request.target.taskId,
    protectedContractId: request.bindings.protectedContractId,
    attemptId: request.bindings.attemptId,
    candidateId: request.bindings.candidateId,
    deduplicationKey,
    methodId: SEMANTIC_METHOD_ID,
    occurredAt: isoInstant(occurredAt),
    coverage: { decision: 'available', finalOutcome: 'available' },
  };
  const errors = validateActionObservation(observation);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  return Object.freeze(observation);
}

/**
 * Best-effort adapter for the optional existing event log. Its result is
 * measurement coverage only and must never be consulted by a lifecycle gate.
 */
export function recordActionObservation({ target, backend, host, operationAttemptId, semanticEvaluation, finalOutcome, occurredAt }) {
  try {
    const config = loadProjectMap(target)?.config;
    if (config?.event_logging !== 'enabled') {
      return { recorded: false, coverage: 'unavailable', reason: 'event_logging_disabled' };
    }
    const observation = buildActionObservation({ operationAttemptId, semanticEvaluation, finalOutcome, occurredAt });
    const eventPath = resolveEventLogPath(target, undefined, observation.taskId).path;
    if (existsSync(eventPath)) {
      const duplicate = loadEvents(eventPath).some(event =>
        event?.data?.kind === ACTION_OBSERVATION_KIND &&
        event.data.deduplicationKey === observation.deduplicationKey
      );
      if (duplicate) return { recorded: true, coverage: 'available', duplicate: true, observation, path: eventPath };
    }
    const event = buildEvent({
      target,
      eventType: 'decision.recorded',
      task: observation.taskId,
      backend,
      host,
      role: observation.actor.roleId,
      summary: `Recorded ${observation.actionId} semantic decision`,
      outcome: finalOutcome === 'recorded' ? 'success' : 'unknown',
      refs: [observation.evaluationId],
      data: observation,
      occurredAt: observation.occurredAt,
      traceSeed: observation.deduplicationKey,
    }, observation.occurredAt);
    appendEventLog({ target, event, path: eventPath });
    return { recorded: true, coverage: 'available', duplicate: false, observation, path: eventPath };
  } catch (error) {
    return { recorded: false, coverage: 'unavailable', reason: 'observation_write_failed', error: error.message };
  }
}
