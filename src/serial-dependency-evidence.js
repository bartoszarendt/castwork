/*
 * Direct dependency facts for the files-backed serial route.
 *
 * Serial dispatch deliberately has no decomposition or dependency-snapshot
 * artifact. Its dependency proof is instead a fresh, canonical observation of
 * every declared dependency carrier and that carrier's trusted contract
 * history. Both preflight and packet preparation consume this module so they
 * cannot disagree over the same current repository facts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { canonicalJson, canonicalSha256 } from './canonical-json.js';
import { loadFilesTaskContractRecords } from './files-task-contract.js';
import { displayPath, isPathWithin } from './path-identity.js';
import { taskContractDigest, validateTaskContractBaseline } from './task-contract-baseline.js';
import { taskStatusFromBody } from './dispatchability.js';
import { defaultDependencyFreshnessSeconds } from './task-evidence-contract.js';
import { parseTaskReadinessDeclaration } from './task-readiness.js';

function taskCarrierPath(target, template, taskId) {
  const relativePath = template.replace(/\{taskId\}/g, taskId).replace(/\\/g, '/');
  const path = displayPath(relativePath, { base: target });
  return isPathWithin(path, target) ? { path, relativePath } : null;
}

function currentRevisionTimestamp(target, fallbackNow) {
  const result = spawnSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: target, encoding: 'utf8' });
  const instant = new Date(String(result.stdout ?? '').trim());
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : new Date(fallbackNow).toISOString();
}

/**
 * Resolve current direct dependency carriers into the existing readiness
 * dependency-evidence contract. A terminal-looking carrier is not trusted
 * until its material contract and committed append-only baseline validate.
 * Invalid or unavailable carriers deliberately become `unresolved`, allowing
 * the existing readiness evaluator to own the stable public refusal code.
 */
export function resolveSerialDependencyEvidence({
  target,
  taskBody,
  projectConfig = {},
  now = Date.now(),
} = {}) {
  const declaration = parseTaskReadinessDeclaration(taskBody).declaration;
  const template = projectConfig.task_file_template ?? '.agenticloop/tasks/{taskId}.md';
  // The committed revision is the serial observation boundary: a different
  // current carrier or trusted history necessarily changes the digest below.
  // Reusing its timestamp keeps packet preparation and immediate live
  // revalidation byte-stable over unchanged facts, unlike a wall-clock
  // snapshot which would self-invalidate a freshly minted packet.
  const evaluatedAt = currentRevisionTimestamp(target, now);
  const records = (declaration?.dependsOn ?? []).map(taskId => {
    const carrier = taskCarrierPath(target, template, taskId);
    if (!carrier || !existsSync(carrier.path)) {
      return { taskId, carrier: carrier?.relativePath ?? null, state: 'missing', status: 'unresolved' };
    }
    try {
      const body = readFileSync(carrier.path, 'utf8');
      const contract = taskContractDigest(body);
      const history = contract.ok
        ? loadFilesTaskContractRecords(target, taskId)
        : { trustedRecords: [], errors: ['dependency task contract is malformed'] };
      const baseline = contract.ok && contract.projection.task_id === taskId
        ? validateTaskContractBaseline(body, {
            lifecycle: 'transition',
            trustedRecords: history.trustedRecords,
            trustedRecordErrors: history.errors,
          })
        : { ok: false };
      const status = baseline.ok ? taskStatusFromBody(body) ?? 'unresolved' : 'unresolved';
      const state = !contract.ok || contract.projection.task_id !== taskId
        ? 'malformed'
        : !baseline.ok
          ? 'untrusted'
          : ['resolved', 'accepted', 'closed'].includes(status)
            ? 'satisfied'
            : 'non_terminal';
      return {
        taskId,
        carrier: carrier.relativePath,
        state,
        carrierDigest: `sha256:${canonicalSha256(body)}`,
        contractDigest: contract.ok ? contract.digest : null,
        trustedRecordCount: history.trustedRecords.length,
        trustedRecordErrors: [...history.errors],
        status,
      };
    } catch {
      return { taskId, carrier: carrier.relativePath, state: 'unreadable', status: 'unresolved' };
    }
  }).sort((left, right) => left.taskId.localeCompare(right.taskId));

  // This digest is a current carrier-and-contract observation, not a parallel
  // snapshot digest. It binds each declared dependency only; unrelated task
  // changes do not over-invalidate serial dispatch.
  const source = `files:${template.replace(/\\/g, '/')}`;
  const digest = `sha256:${canonicalSha256(canonicalJson({ source, records }))}`;
  const statuses = records.map(({ taskId, status }) => ({ id: taskId, status }));
  return {
    evidence: {
      source,
      digest,
      observedAt: evaluatedAt,
      evaluatedAt,
      freshnessPolicy: { maxAgeSeconds: defaultDependencyFreshnessSeconds('files') },
      freshnessState: 'current',
      evaluatedState: statuses.every(({ status }) => ['resolved', 'accepted', 'closed'].includes(status))
        ? 'satisfied'
        : 'unsatisfied',
      statuses,
      revalidationArgs: ['--serial-dependencies', template.replace(/\\/g, '/')],
    },
    records,
    statuses: Object.fromEntries(statuses.map(({ id, status }) => [id, status])),
  };
}
