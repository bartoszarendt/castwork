/** Commit exactly the durable workflow paths written by one protected command. */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  evaluateCommitAttribution,
  evaluateWorkUnitCommitAttribution,
  renderCommitMessage,
  renderWorkUnitCommitMessage,
} from './commit-attribution.js';
import { assertSafeRelativePath, resolveTargetPath } from './fs-mutation-kernel.js';
import { GIT_MAX_BUFFER } from './git-runner.js';

export const WORKFLOW_COMMIT_CLASSES = Object.freeze([
  'workflow_evidence',
  'workflow_disposition',
]);

function git(target, args, encoding = 'utf8') {
  return spawnSync('git', args, { cwd: target, encoding, maxBuffer: GIT_MAX_BUFFER });
}

function output(result) {
  return [String(result?.stderr ?? '').trim(), String(result?.stdout ?? '').trim()]
    .filter(Boolean).join('\n') || `exit ${String(result?.status)}`;
}

function gitText(target, args) {
  const result = git(target, args);
  return result.status === 0 ? String(result.stdout ?? '').trim() : null;
}

function literal(path) {
  return `:(top,literal)${path}`;
}

function lines(value) {
  return String(value ?? '').split(/\r?\n/).filter(Boolean);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Create the one workflow commit owned by a successful protected invocation.
 * Other staged and unstaged paths are left untouched. Ordinary `git commit`
 * runs repository hooks and signing policy; `--only` confines the candidate to
 * this invocation's literal paths.
 */
export function commitWorkflowPaths({
  target,
  taskId,
  workUnitId = null,
  taskIds = null,
  paths,
  role,
  commitClass,
  subject,
} = {}) {
  const root = resolve(target ?? '.');
  const requested = [...new Set((paths ?? []).map(value => String(value).trim()).filter(Boolean))].sort();
  const errors = [];
  const workUnitCommit = typeof workUnitId === 'string' && workUnitId.trim() && Array.isArray(taskIds);
  if (!workUnitCommit && (!taskId || !String(taskId).trim())) errors.push('workflow commit requires a task id or exact work-unit task set');
  if (!WORKFLOW_COMMIT_CLASSES.includes(commitClass)) {
    errors.push(`workflow commit class must be one of: ${WORKFLOW_COMMIT_CLASSES.join(', ')}`);
  }
  if (requested.length === 0) errors.push('workflow commit requires at least one invocation-written path');
  for (const path of requested) {
    try {
      assertSafeRelativePath(path);
      const absolute = resolveTargetPath(root, path);
      const entry = lstatSync(absolute, { throwIfNoEntry: false });
      if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
        errors.push(`workflow commit path is not a regular file: ${path}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  const rendered = workUnitCommit
    ? renderWorkUnitCommitMessage({ workUnitId, taskIds, role, subject, commitClass })
    : renderCommitMessage({ taskId: String(taskId ?? ''), role, subject, commitClass });
  if (!rendered.ok) errors.push(...rendered.errors);
  if (errors.length > 0) return { ok: false, committed: false, errors };

  const head = gitText(root, ['rev-parse', '--verify', 'HEAD']);
  const ref = gitText(root, ['symbolic-ref', '--quiet', 'HEAD']);
  if (!head || !ref?.startsWith('refs/')) {
    return { ok: false, committed: false, errors: ['workflow evidence commits require HEAD on a named branch'] };
  }

  for (const path of requested) {
    const staged = git(root, ['add', '-f', '-A', '--', literal(path)]);
    if (staged.status !== 0) {
      return { ok: false, committed: false, errors: [`could not stage workflow path '${path}': ${output(staged)}`] };
    }
  }
  const candidateResult = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXBD', head, '--', ...requested.map(literal)]);
  if (candidateResult.status !== 0) {
    return { ok: false, committed: false, errors: [`could not inspect staged workflow paths: ${output(candidateResult)}`] };
  }
  const candidatePaths = lines(candidateResult.stdout).sort();
  if (candidatePaths.length === 0) {
    return {
      ok: true,
      committed: false,
      disposition: 'already_current',
      paths: [],
      commitClass,
      role,
      errors: [],
    };
  }
  if (candidatePaths.some(path => !requested.includes(path))) {
    return { ok: false, committed: false, errors: ['the staged workflow path set exceeds the invocation write set'] };
  }
  const expected = new Map(candidatePaths.map(path => {
    const absolute = resolveTargetPath(root, path);
    const entry = lstatSync(absolute, { throwIfNoEntry: false });
    return [path, entry ? sha256(readFileSync(absolute)) : null];
  }));

  const committed = git(root, ['commit', '--only', '-m', rendered.message, '--', ...candidatePaths.map(literal)]);
  if (committed.status !== 0) {
    return { ok: false, committed: false, errors: [`workflow evidence commit failed: ${output(committed)}`] };
  }
  const resultingHead = gitText(root, ['rev-parse', '--verify', ref]);
  const parent = resultingHead ? gitText(root, ['rev-parse', `${resultingHead}^`]) : null;
  const committedPathsResult = resultingHead
    ? git(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', resultingHead])
    : null;
  const committedPaths = committedPathsResult?.status === 0 ? lines(committedPathsResult.stdout).sort() : [];
  const message = resultingHead ? gitText(root, ['show', '-s', '--format=%B', resultingHead]) : null;
  const attribution = workUnitCommit
    ? evaluateWorkUnitCommitAttribution({ message, workUnitId, taskIds, role })
    : evaluateCommitAttribution({ message, taskId: String(taskId), role });
  const classLine = `Workflow-Class: ${commitClass}`;
  const byteErrors = [];
  for (const [path, digest] of expected) {
    const blob = git(root, ['show', `${resultingHead}:${path}`], null);
    if (digest === null ? blob.status === 0 : blob.status !== 0 || sha256(blob.stdout) !== digest) {
      byteErrors.push(`committed bytes differ from the protected invocation for '${path}'`);
    }
  }
  const valid = parent === head &&
    JSON.stringify(committedPaths) === JSON.stringify(candidatePaths) &&
    attribution.ok && String(message ?? '').split(/\r?\n/).includes(classLine) && byteErrors.length === 0;
  if (!valid) {
    return {
      ok: false,
      committed: true,
      commit: resultingHead,
      paths: committedPaths,
      errors: [
        ...(parent === head ? [] : ['workflow commit is not the direct child of the invocation entry HEAD']),
        ...(JSON.stringify(committedPaths) === JSON.stringify(candidatePaths) ? [] : ['workflow commit contains paths outside the invocation write set']),
        ...attribution.errors,
        ...(String(message ?? '').split(/\r?\n/).includes(classLine) ? [] : ['workflow commit lacks the canonical class trailer']),
        ...byteErrors,
      ],
    };
  }
  return {
    ok: true,
    committed: true,
    commit: resultingHead,
    parent: head,
    ref,
    paths: candidatePaths,
    commitClass,
    role,
  };
}
