/**
 * Leaf readers shared by task commands and read-only diagnostic projections.
 *
 * These functions deliberately read canonical task/Git/evidence artifacts but
 * never import command dispatch or presentation modules.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { parseFrontmatter, replaceFrontmatterField } from './frontmatter.js';
import { PublicCommandError, VerificationContextMalformedError } from './public-error.js';
import { isGitObjectId } from './git-oid.js';
import { commitChangedPaths, createPathClassifier, deriveProductHead } from './product-lineage.js';
import { fileMatchesScopePattern } from './scope-matcher.js';
import { GIT_MAX_BUFFER } from './git-runner.js';
import { parseRequiredCheckCommand, validateExecutionEvidence, validateExecutionEvidenceStructure } from './execution-evidence.js';
import { isAbsoluteOrDriveQualifiedPath, isPathWithin, pathIdentity, samePathAuthority } from './path-identity.js';
import { taskContractDigest } from './task-contract-baseline.js';
import { taskRecordDigest } from './readiness-candidates.js';
import { resolveCarrierLineage } from './handoff-consumption.js';

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

export function implementationArtifactHead(content) {
  const [frontmatter] = parseFrontmatter(content);
  const value = text(frontmatter?.implementation_artifact);
  const commit = value.match(/^commit:([0-9a-f]{40}|[0-9a-f]{64})$/);
  if (commit) return commit[1];
  const range = value.match(/^range:[0-9a-f]{40,64}\.\.([0-9a-f]{40}|[0-9a-f]{64})$/);
  return range?.[1] ?? null;
}

/**
 * Read the durable post-dispatch facts a return producer consumes.  The exact
 * packet and check aggregate remain caller-supplied protected inputs, so this
 * reader never invents either one from a digest or a conventional scratch path.
 */
export function readPrepareReturnFacts(target, { taskId, projectConfig } = {}) {
  const template = projectConfig?.task_file_template ?? '.agenticloop/tasks/{taskId}.md';
  const carrier = template.replace(/\{taskId\}/g, String(taskId ?? ''));
  try {
    const body = readTargetText(target, carrier, 'current task record');
    const contract = taskContractDigest(body);
    const currentCarrierDigest = taskRecordDigest(body);
    const lineage = contract.ok
      ? resolveCarrierLineage(target, taskId, {
          backend: 'files', taskContractDigest: contract.digest, currentCarrierDigest,
        })
      : { ok: false, errors: ['current task contract is malformed'] };
    const productHead = implementationArtifactHead(body);
    return Object.freeze({
      carrier: Object.freeze({ state: contract.ok ? 'current' : 'malformed', carrier, contract, currentCarrierDigest }),
      attempt: Object.freeze({ state: lineage.ok ? 'current' : 'stale', lineage }),
      candidate: Object.freeze({ state: isGitObjectId(productHead) ? 'current' : 'malformed', productHead }),
      packet: Object.freeze({
        state: 'unavailable',
        detail: 'the exact retained dispatch packet is a protected caller input and cannot be reconstructed from dispatch consumption',
      }),
      checks: Object.freeze({
        state: 'unavailable',
        detail: 'the exact check-evidence path is a protected caller input and cannot be inferred from scratch state',
      }),
    });
  } catch (error) {
    return Object.freeze({
      carrier: Object.freeze({ state: 'unavailable', carrier, detail: error.message }),
      attempt: Object.freeze({ state: 'unavailable', detail: 'current task carrier is unavailable' }),
      candidate: Object.freeze({ state: 'unavailable', productHead: null }),
      packet: Object.freeze({ state: 'unavailable', detail: 'the exact retained dispatch packet is unavailable' }),
      checks: Object.freeze({ state: 'unavailable', detail: 'the exact check-evidence path is unavailable' }),
    });
  }
}

export function isExactImplementationArtifactReaffirmation(content, productHead) {
  const [frontmatter] = parseFrontmatter(content);
  const canonical = `commit:${String(productHead ?? '')}`;
  return text(frontmatter?.implementation_artifact) === canonical &&
    replaceFrontmatterField(content, 'implementation_artifact', canonical) === content;
}

export function targetGitRunner(target) {
  return args => spawnSync('git', args, { cwd: target, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
}

export function evaluateProductHeadEvidence(runGit, productHead, allowedPaths) {
  const patterns = (Array.isArray(allowedPaths) ? allowedPaths : [])
    .filter(pattern => typeof pattern === 'string' && pattern);
  const inTaskSurface = path => patterns.some(pattern => fileMatchesScopePattern(path, pattern));
  const refusal = (message, code = 'task.evidence.product_head') => new PublicCommandError(message, {
    code, evidenceState: 'changed', disposition: 'blocked',
    safeRepair: 'Pass the exact commit that introduced this task\'s product work; it must be reachable from HEAD and no path this task declares in allowed_paths may have changed after it.',
  });
  if (!isGitObjectId(productHead)) {
    return refusal('implementation artifact evidence requires --product-head as a full lowercase 40- or 64-character Git identity');
  }
  const observedHead = String(runGit(['rev-parse', '--verify', 'HEAD']).stdout ?? '').trim();
  if (!isGitObjectId(observedHead)) return refusal('implementation artifact evidence requires a readable current repository HEAD');
  if (productHead !== observedHead) {
    if (runGit(['merge-base', '--is-ancestor', productHead, observedHead]).status !== 0) {
      return refusal('implementation artifact evidence requires --product-head to be the current repository HEAD or an ancestor of it');
    }
    const taskPaths = String(runGit(['diff', '--name-only', '--no-renames', `${productHead}..${observedHead}`]).stdout ?? '')
      .split(/\r?\n/).filter(Boolean).filter(inTaskSurface);
    if (taskPaths.length > 0) {
      return refusal(`implementation artifact evidence requires --product-head to be the last commit carrying work on this task; path(s) inside allowed_paths changed after it: ${[...new Set(taskPaths)].sort().slice(0, 5).join(', ')}`);
    }
  }
  const changed = commitChangedPaths(runGit, productHead);
  if (!changed.ok) return refusal(`implementation artifact evidence could not read the product head: ${changed.reason}`);
  if (!changed.paths.some(inTaskSurface)) {
    return refusal('implementation artifact evidence requires a --product-head commit that changes at least one path this task declares in allowed_paths; a commit outside this task surface is not an implementation artifact');
  }
  return null;
}

export function publicTargetRelativePath(target, value, label) {
  if (typeof value !== 'string' || !value.trim() || isAbsoluteOrDriveQualifiedPath(value)) {
    throw new VerificationContextMalformedError(`${label} must be a non-empty target-relative path`);
  }
  const path = resolve(target, String(value));
  const relPath = relative(target, path).replace(/\\/g, '/');
  if (!relPath || relPath === '..' || relPath.startsWith('../')) {
    throw new VerificationContextMalformedError(`${label} must resolve inside the selected target`);
  }
  return { path, relPath };
}

export function readTargetText(target, relPath, label) {
  const { path } = publicTargetRelativePath(target, relPath, label);
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || !isPathWithin(path, target)) {
      throw new VerificationContextMalformedError(`${label} must be a target-confined regular file`);
    }
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof VerificationContextMalformedError) throw error;
    throw new VerificationContextMalformedError(`${label} is unreadable: ${error.message}`);
  }
}

export function readTargetJson(target, relPath, label) {
  try {
    return JSON.parse(readTargetText(target, relPath, label));
  } catch (error) {
    if (error instanceof VerificationContextMalformedError) throw error;
    throw new VerificationContextMalformedError(`${label} is unreadable or invalid JSON: ${error.message}`);
  }
}

/** Read-only structural validation. It intentionally does not establish currency. */
export function validateCommandCheckExecutionStructure(target, checks, inventory) {
  const targetAuthority = pathIdentity(target).authorityPath;
  const scratchAuthority = pathIdentity(join(target, '.agenticloop', 'tmp')).authorityPath;
  for (const required of inventory) {
    if (required.kind !== 'command') continue;
    const check = checks.find(candidate => candidate?.id === required.id);
    if (check?.outcome !== 'passed') continue;
    const reference = check.executionEvidence;
    if (!reference || typeof reference !== 'object' || Array.isArray(reference) ||
        Object.keys(reference).length !== 2 || typeof reference.path !== 'string' || !reference.path.trim() ||
        !/^sha256:agenticloop\.execution-evidence\.v4:[a-f0-9]{64}$/.test(String(reference.digest ?? ''))) {
      throw new VerificationContextMalformedError(`passed command check '${required.id}' requires a closed CLI execution artifact path and digest (executionEvidence)`);
    }
    const artifactPath = publicTargetRelativePath(target, reference.path, `passed command check '${required.id}' execution artifact`);
    const execution = readTargetJson(target, artifactPath.relPath, `passed command check '${required.id}' execution artifact`);
    const parsed = parseRequiredCheckCommand(required.command);
    const checked = validateExecutionEvidenceStructure(execution);
    if (!checked.ok) throw new VerificationContextMalformedError(`passed command check '${required.id}' execution artifact is invalid: ${checked.errors.join('; ')}`);
    if (reference.digest !== execution.digest || execution.check.id !== required.id ||
        execution.check.instruction !== required.command || execution.check.command !== parsed.command ||
        JSON.stringify(execution.check.args) !== JSON.stringify(parsed.args) ||
        execution.execution.outcome !== 'passed' || execution.execution.childExitCode !== 0 ||
        !['carrierRoot', 'artifactWorktreeRoot', 'workingDirectory'].every(field => samePathAuthority(execution.locations[field].authorityPath, targetAuthority)) ||
        !samePathAuthority(execution.locations.projectScratchRoot.authorityPath, scratchAuthority)) {
      throw new VerificationContextMalformedError(`passed command check '${required.id}' does not bind exact target CLI execution evidence`);
    }
  }
}

/** Protected validation: structural integrity plus the caller's complete binding. */
export function validatePreparedCommandCheckExecutions(target, checks, inventory, expectedBinding) {
  if (!expectedBinding || typeof expectedBinding !== 'object' || Array.isArray(expectedBinding)) {
    throw new VerificationContextMalformedError('protected command-check validation requires a complete execution-evidence binding');
  }
  validateCommandCheckExecutionStructure(target, checks, inventory);
  for (const required of inventory) {
    if (required.kind !== 'command') continue;
    const check = checks.find(candidate => candidate?.id === required.id);
    if (check?.outcome !== 'passed') continue;
    const execution = readTargetJson(target, check.executionEvidence.path, `passed command check '${required.id}' execution artifact`);
    const expectedArgv = parseRequiredCheckCommand(required.command);
    const checked = validateExecutionEvidence(execution, {
      expectedBinding: { ...expectedBinding, checkId: required.id, command: expectedArgv.command, args: [...expectedArgv.args] },
      repositoryHeadIsPermitted(observed, expected) {
        if (!isGitObjectId(observed) || !isGitObjectId(expected)) return false;
        const lineage = deriveProductHead({ runGit: targetGitRunner(target), baseHead: observed, head: expected, classifier: createPathClassifier(target) });
        return lineage.ok && lineage.productHead === observed;
      },
    });
    if (!checked.ok) throw new VerificationContextMalformedError(`passed command check '${required.id}' execution artifact is invalid: ${checked.errors.join('; ')}`);
  }
}
