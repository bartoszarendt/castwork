/** Read-only rendering of canonical protected-action evaluator results. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lifecycleOrientationSnapshot } from './lifecycle-orientation.js';
import { loadProjectMap } from './project-map.js';
import { taskRecordRelativePath } from './terminal-scope.js';
import { taskContractDigest } from './task-contract-baseline.js';
import { evaluateReadOnlyDispatchProjection } from './handoff-preflight.js';
import {
  evaluateReadOnlyRoleStartProjection,
  evaluateReadOnlyReviewProjection,
} from './handoff-binding.js';
import { evaluateReadOnlyPrepareReturnProjection } from './dispatch-envelope.js';
import { evaluateReadOnlyAuditProjection } from './audit-record.js';
import { createReadOnlyLifecycleProjection } from './lifecycle-projection.js';

export const TASK_EXPLAIN_ACTION_IDS = Object.freeze([
  'prepare_dispatch', 'role_start', 'prepare_return', 'review', 'audit',
]);

// This is presentation coverage only.  Each named function owns its action's
// observation, applicability, prerequisites, reasons, and verdict; explain
// neither maps facts to codes nor reduces lifecycle state into legality.
export const TASK_EXPLAIN_ACTION_EVALUATORS = Object.freeze({
  prepare_dispatch: Object.freeze({ evaluator: 'evaluateReadOnlyDispatchProjection', evaluate: context =>
    evaluateReadOnlyDispatchProjection(context) }),
  role_start: Object.freeze({ evaluator: 'evaluateReadOnlyRoleStartProjection', evaluate: context =>
    evaluateReadOnlyRoleStartProjection(context) }),
  prepare_return: Object.freeze({ evaluator: 'evaluateReadOnlyPrepareReturnProjection', evaluate: context =>
    evaluateReadOnlyPrepareReturnProjection(context) }),
  review: Object.freeze({ evaluator: 'evaluateReadOnlyReviewProjection', evaluate: context =>
    evaluateReadOnlyReviewProjection(context) }),
  audit: Object.freeze({ evaluator: 'evaluateReadOnlyAuditProjection', evaluate: context =>
    evaluateReadOnlyAuditProjection(context.target, {
      taskId: context.taskId,
      projectConfig: context.projectConfig,
    }) }),
});

// A display/dependency index, not a source of evaluation. The protected
// evaluator envelopes carry the authoritative prerequisites.
export const TASK_EXPLAIN_ACTION_DEPENDENCIES = Object.freeze({
  prepare_dispatch: Object.freeze([]),
  role_start: Object.freeze([]),
  prepare_return: Object.freeze([]),
  review: Object.freeze([]),
  audit: Object.freeze([]),
});

function factsForTask(target, taskId, io) {
  const orientation = lifecycleOrientationSnapshot(target, { io });
  const lifecycle = orientation.tasks.find(task => task.taskId === taskId);
  if (!lifecycle) throw new Error(`Task record not found: ${taskId}`);
  const project = loadProjectMap(target).config;
  const carrier = join(target, ...taskRecordRelativePath(project, taskId).split('/'));
  const content = readFileSync(carrier, 'utf8');
  const contract = taskContractDigest(content);
  return {
    target,
    taskId,
    io: io ?? {},
    backend: orientation.backend,
    taskContractDigest: contract.ok ? contract.digest : null,
    dispatchCarrierDigest: lifecycle.carrierDigest ?? null,
    projectConfig: project,
    task: Object.freeze({
      id: taskId,
      carrier: lifecycle.carrier,
      backend: orientation.backend,
      lifecycle: Object.freeze({ status: lifecycle.status, state: lifecycle.state }),
      contract: Object.freeze({ state: lifecycle.baseline.state }),
      activation: Object.freeze({ state: lifecycle.operatorAuthorization.state }),
    }),
  };
}

function canonicalAction(id, context) {
  return TASK_EXPLAIN_ACTION_EVALUATORS[id].evaluate(context);
}

/** Build a bounded explanation by invoking the existing canonical owners only. */
export function explainTask(target, taskId, { action = null, io = null } = {}) {
  if (action !== null && !TASK_EXPLAIN_ACTION_IDS.includes(action)) {
    throw new Error(`Unknown task explain action '${action}'; expected one of: ${TASK_EXPLAIN_ACTION_IDS.join(', ')}`);
  }
  const context = factsForTask(target, taskId, io);
  return createReadOnlyLifecycleProjection({
    task: context.task,
    actions: (action ? [action] : TASK_EXPLAIN_ACTION_IDS).map(id => canonicalAction(id, context)),
  });
}

/** Human output is a direct rendering of canonical JSON, never a second model. */
export function renderTaskExplanation(explanation) {
  const { task } = explanation;
  const lines = [
    `facts: ${JSON.stringify(task)}`,
    `task: ${task.id}`,
    `carrier: ${task.carrier}`,
    `backend: ${task.backend}`,
    `lifecycle.status: ${task.lifecycle.status ?? 'unknown'}`,
    `lifecycle.state: ${task.lifecycle.state}`,
    `contract.state: ${task.contract.state}`,
    `activation.state: ${task.activation.state}`,
  ];
  for (const action of explanation.actions) {
    lines.push(`action: ${action.id}`);
    lines.push(`  verdict: ${action.verdict}`);
    lines.push(`  applicability: ${action.applicability}`);
    for (const fact of action.facts ?? []) {
      lines.push(`  fact: ${fact.fact}; observed_state=${fact.observedState}; fact_owner=${fact.factOwner}; policy_code=${fact.policyCode ?? 'none'}`);
    }
    for (const item of action.reasons) {
      lines.push(`  reason: ${item.fact}; state=${item.state}; observed_state=${item.observedState}; fact_owner=${item.factOwner}; policy_code=${item.policyCode ?? 'none'}${item.detail ? `; detail=${item.detail}` : ''}`);
    }
    for (const item of action.prerequisites) lines.push(`  prerequisite: ${item.fact}; condition=${item.condition}`);
  }
  lines.push('authority: none');
  lines.push('persisted: false');
  return lines.join('\n');
}
