/**
 * Shared boundary for caller-selected public output paths.
 *
 * Public artifacts are ordinary target-relative files, but they must never be
 * used to replace lifecycle authority. Lifecycle commands own those namespaces
 * through their task locks and in-lock validation; an output option has neither.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PublicCommandError } from './public-error.js';
import { publicTargetRelativePath } from './task-fact-readers.js';
import { isValidTaskId, TASK_ID_MAX_LENGTH } from './task-id.js';
import { listTaskRecords, taskRecordRelativePath } from './terminal-scope.js';

// This is a factual negative guard, not an unavailable-context condition. Keep
// the existing policy-backed diagnostic code so every public command presents
// the same typed refusal rather than degrading it to cli.operational.
export const PUBLIC_OUTPUT_PROTECTED_CODE = 'evidence.negative';

const LIFECYCLE_AUTHORITY_PREFIXES = Object.freeze([
  '.agenticloop/activation',
  '.agenticloop/activations',
  '.agenticloop/adoptions',
  '.agenticloop/audits',
  '.agenticloop/closeout-waivers',
  '.agenticloop/decisions',
  '.agenticloop/decompositions',
  '.agenticloop/handoffs',
  '.agenticloop/improvements',
  '.agenticloop/lifecycle-receipt.json',
  '.agenticloop/locks/lifecycle-authority',
  '.agenticloop/project.md',
  '.agenticloop/remediations',
  '.agenticloop/returns',
  '.agenticloop/reviews',
  '.agenticloop/task-contract-history',
  '.agenticloop/tasks',
  '.agenticloop/worktrees',
]);

function canonicalPath(path) {
  return resolve(String(path).replace(/\\/g, '/')).replace(/\\/g, '/').toLowerCase();
}

function isPathAtOrBelow(path, prefix) {
  const canonicalCandidate = String(path).replace(/\\/g, '/').toLowerCase();
  const canonicalPrefix = String(prefix).replace(/\\/g, '/').toLowerCase();
  return canonicalCandidate === canonicalPrefix || canonicalCandidate.startsWith(`${canonicalPrefix}/`);
}

function resolvedCarrierPath(target, projectConfig, taskId) {
  const relPath = taskRecordRelativePath(projectConfig, taskId);
  return publicTargetRelativePath(target, relPath, 'configured task carrier template').path;
}

/**
 * Resolve the same carrier inventory used by the files task system.  The active
 * carrier is named directly because it remains protected even when its record
 * has not been created yet; every other record comes from the durable inventory.
 */
function resolvedCarrierPaths(target, projectConfig, activeTaskId) {
  const paths = [];
  if (typeof activeTaskId === 'string' && activeTaskId) {
    paths.push(resolvedCarrierPath(target, projectConfig, activeTaskId));
  }
  for (const record of listTaskRecords(target, projectConfig).entries) {
    if (isValidTaskId(record.taskId, projectConfig?.task_id_regex ?? '^T-\\d{3,}$')) {
      paths.push(resolve(target, record.relPath));
    }
  }
  return new Set(paths.map(canonicalPath));
}

/**
 * Test a prospective task id by expanding it through the task system's carrier
 * resolver and comparing the resulting path.  This is deliberately structural:
 * no carrier regex, sentinel, or token backreference is constructed.
 */
function isCarrierShapedPath(target, destination, projectConfig) {
  const template = publicTargetRelativePath(
    target, taskRecordRelativePath(projectConfig, '{taskId}'), 'configured task carrier template'
  ).relPath;
  const prefix = template.slice(0, template.indexOf('{taskId}'));
  const candidate = destination.relPath;
  if (!candidate.toLowerCase().startsWith(prefix.toLowerCase())) return false;

  // Derive candidates only from the first token's bounded task-ID position,
  // then resolve the complete configured template for each one. This keeps the
  // prospective check on the task system's actual expansion path (rather than
  // reconstructing a carrier matcher) and covers adjacent/repeated tokens:
  // `{taskId}{taskId}.md` is tested as `T-001` in both positions.
  const start = prefix.length;
  const maxTaskIdLength = Math.min(TASK_ID_MAX_LENGTH, candidate.length - start);
  for (let length = 1; length <= maxTaskIdLength; length += 1) {
    const taskId = candidate.slice(start, start + length);
    if (!isValidTaskId(taskId, projectConfig?.task_id_regex ?? '^T-\\d{3,}$')) continue;
    if (canonicalPath(resolvedCarrierPath(target, projectConfig, taskId)) === canonicalPath(destination.path)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a caller-selected output path only when it is outside every
 * lifecycle-authority namespace. This does not constrain scratch or ordinary
 * product-relative outputs.
 */
export function publicOutputTargetRelativePath(target, value, label, {
  projectConfig,
  activeTaskId = null,
  authorizedAuthorityPrefixes = [],
} = {}) {
  // The task system accepts Windows separators in carrier templates. Normalize
  // the caller's spelling before resolving too, then compare canonical paths.
  const destination = publicTargetRelativePath(
    target, typeof value === 'string' ? value.replace(/\\/g, '/') : value, label
  );
  const authorized = authorizedAuthorityPrefixes.some(prefix =>
    typeof prefix === 'string' && isPathAtOrBelow(destination.relPath, prefix));
  const carrierShaped = isCarrierShapedPath(target, destination, projectConfig);
  const protectedCarrier = resolvedCarrierPaths(target, projectConfig, activeTaskId)
    .has(canonicalPath(destination.path)) || (carrierShaped && existsSync(destination.path));
  // A carrier is lifecycle authority even when a command is otherwise allowed
  // to write in its containing namespace. Namespace authorization can never
  // authorize replacing an active or existing task carrier.
  if (protectedCarrier || (!authorized && LIFECYCLE_AUTHORITY_PREFIXES.some(prefix => isPathAtOrBelow(destination.relPath, prefix)))) {
    throw new PublicCommandError(
      `${label} must not target lifecycle-authority path: ${destination.relPath}`,
      {
        code: PUBLIC_OUTPUT_PROTECTED_CODE,
        evidenceState: 'negative',
        disposition: 'blocked',
        safeRepair: 'Write public output to .agenticloop/tmp/, .agenticloop/checks/, or another non-authority target-relative path.',
      }
    );
  }
  // An absent carrier-shaped path is not yet lifecycle authority, but it must
  // be created exclusively: another process may create it after this
  // observation and before the mutation kernel writes it.
  return {
    ...destination,
    requiresExclusiveCreate: !protectedCarrier && carrierShaped,
  };
}

/** Build the mutation that preserves the public-output carrier boundary. */
export function publicOutputMutation(destination, content) {
  return {
    type: destination.requiresExclusiveCreate ? 'create' : 'write',
    path: destination.relPath,
    content,
  };
}

/**
 * Translate a raced exclusive public-output creation to the same typed refusal
 * as an already-observed carrier. Other filesystem failures retain their
 * caller-specific operational classification.
 */
export function publicOutputMutationFailure(destination, label, applied) {
  if (!destination.requiresExclusiveCreate || !applied?.errors?.some(error => /^EEXIST:/.test(String(error)))) {
    return null;
  }
  return new PublicCommandError(
    `${label} must not target lifecycle-authority path: ${destination.relPath}`,
    {
      code: PUBLIC_OUTPUT_PROTECTED_CODE,
      evidenceState: 'negative',
      disposition: 'blocked',
      safeRepair: 'Write public output to .agenticloop/tmp/, .agenticloop/checks/, or another non-authority target-relative path.',
    }
  );
}
