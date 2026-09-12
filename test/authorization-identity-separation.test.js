import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  createActivationRevocation,
  resolveTaskActivationBinding,
} from '../src/activation-grant.js';
import { resolveCurrentTaskAuthorization } from '../src/activation-resolution.js';
import { externalRevocationDirectoryForIdentity } from '../src/activation-trust.js';
import { evaluateDispatchableLifecycle } from '../src/dispatchability.js';
import { targetRepositoryIdentity } from '../src/host-trust.js';
import { taskContractDigest } from '../src/task-contract-baseline.js';
import {
  createReviewEntryReceipt,
  validateReviewEntryReceipt,
  validateReviewEntryReceiptShape,
} from '../src/review-entry-receipt.js';
import {
  CONTRACT_DIGEST,
  REPOSITORY,
  bindingFor,
  grantFor,
  interactiveOptions,
  scaffoldFixture,
} from './helpers/activation-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const TASK_BODY = [
  '---', 'task_id: T-036', 'task_contract_schema: 2', 'independent_review_required: false',
  'allowed_paths:', '  - src/**', '---', '# T-036', '',
  '## Scope', 'Keep this protected scope.', '',
  '## Out of Scope', 'None.', '',
  '## Acceptance Criteria', '- Preserve identity boundaries.', '',
  '## Required Checks', '- [RC-1] `npm test`',
].join('\n');

function resolution(overrides = {}) {
  const grant = overrides.grant ?? grantFor({ ttlSeconds: 60 });
  const binding = overrides.binding ?? bindingFor(grant);
  return resolveTaskActivationBinding({
    grant: { ...grant, authentication: { algorithm: 'ed25519', keyId: 'operator-0123456789abcdef', value: 'ed25519:AA==' } },
    binding: { ...binding, authentication: { algorithm: 'ed25519', keyId: 'operator-0123456789abcdef', value: 'ed25519:AA==' } },
    repositoryIdentity: REPOSITORY,
    backend: 'files',
    taskId: 'T-016',
    carrier: '.agenticloop/tasks/T-016.md',
    taskContractDigest: CONTRACT_DIGEST,
    verifySignature: () => true,
    now: Date.parse(grant.expiresAt) + FIVE_DAYS_MS,
    ...overrides.input,
  });
}

function reviewMaterial(head = HEAD, body = TASK_BODY, history = { events: [], errors: [] }) {
  const contract = taskContractDigest(body);
  const loaded = {
    input: {
      prData: {
        number: 36,
        baseRefOid: 'c'.repeat(40),
        headRefOid: head,
        files: [{ path: 'src/identity.js' }],
        commits: [{ oid: head, message: 'Implement identity\n\nTask: T-036\nAgent: engineer' }],
      },
      issueData: { number: 36, body },
      reviewHistory: history,
    },
  };
  return {
    loaded,
    result: {
      ok: true, errors: [], warnings: [],
      requiredChecks: [{ id: 'RC-1', text: '[RC-1] `npm test`', matchKey: 'npm test' }],
      evidenceMatches: [{ id: 'RC-1', check: '[RC-1] `npm test`', verdict: 'passed', evidence: 'passed' }],
      contractBaseline: { digest: contract.digest, baseline: null },
    },
  };
}

describe('authorization freshness', () => {
  it('allows a multi-day resume while each real invalidator still refuses', () => {
    const grant = grantFor({ ttlSeconds: 60 });
    assert.equal(resolution({ grant }).ok, true, 'elapsed grant metadata alone cannot refuse');

    const revoked = resolution({ grant, input: { revocations: [createActivationRevocation({ grant, reason: 'test' })] } });
    assert.equal(revoked.ok, false);
    assert.ok(revoked.errors.some(error => error.code === 'activation.grant.revoked'));

    const changedContract = resolution({ grant, input: { taskContractDigest: `sha256:v1:${'c'.repeat(64)}` } });
    assert.equal(changedContract.ok, false);
    assert.ok(changedContract.errors.some(error => error.code === 'activation.binding.stale_contract'));

    const wrongTarget = resolution({ grant, input: { repositoryIdentity: 'file:/tmp/other-target' } });
    assert.equal(wrongTarget.ok, false);
    assert.ok(wrongTarget.errors.some(error => error.code === 'activation.grant.repository_mismatch'));

    assert.equal(evaluateDispatchableLifecycle('accepted').ok, false, 'terminality remains a current lifecycle gate');
  });

  it('returns unavailable rather than silently trusting an unreadable external deny registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agenticloop-external-revocation-'));
    try {
      const fixture = await scaffoldFixture(root, 'external-unavailable');
      const activated = await runCliInProcess(['activate', 'T-001', '--target', fixture.root], interactiveOptions(fixture));
      assert.equal(activated.status, 0, activated.stderr);
      const registry = externalRevocationDirectoryForIdentity(
        targetRepositoryIdentity(fixture.root),
        fixture.operatorActivationRoot
      );
      mkdirSync(dirname(registry), { recursive: true });
      symlinkSync(fixture.root, registry);
      const authorization = resolveCurrentTaskAuthorization(fixture.root, {
        operatorTrustRoot: fixture.operatorTrustRoot,
        operatorActivationRoot: fixture.operatorActivationRoot,
      }, {
        backend: 'files', taskId: 'T-001', carrier: '.agenticloop/tasks/T-001.md',
        taskContractDigest: taskContractDigest(readFileSync(fixture.taskPath, 'utf8')).digest,
      });
      assert.equal(authorization.state, 'unavailable');
      assert.match(authorization.errors.join('\n'), /revocation inventory unavailable/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('identity separation mutation matrix', () => {
  it('separates protected intent, product, certification, receipts, schema, and mutable projection', () => {
    const contract = taskContractDigest(TASK_BODY);
    const comment = `${TASK_BODY}\n\n## Comments\n\n- Mutable comment.`;
    const receipt = `${TASK_BODY}\n\n<!-- AGENTIC_LOOP_TASK_CONTRACT_BASELINE\nversion: 1\ndigest: ${contract.digest}\n-->`;
    const generatedState = `${TASK_BODY}\n\n## Generated State\n\n- Host-local rendering.`;
    const schemaOnly = TASK_BODY.replace('task_contract_schema: 2', 'task_contract_schema: 3');
    for (const body of [comment, receipt, generatedState, schemaOnly]) {
      assert.equal(taskContractDigest(body).digest, contract.digest);
    }
    assert.notEqual(taskContractDigest(TASK_BODY.replace('Keep this protected scope.', 'Changed scope.')).digest, contract.digest);
    assert.notEqual(taskContractDigest(TASK_BODY.replace('  - src/**', '  - lib/**')).digest, contract.digest);

    const current = reviewMaterial();
    const certificate = createReviewEntryReceipt(current.loaded, current.result, { observedAt: '2026-09-06T00:00:00.000Z' });
    assert.equal(validateReviewEntryReceipt(certificate, reviewMaterial(HEAD, comment).loaded, reviewMaterial(HEAD, comment).result).ok, true);
    assert.equal(validateReviewEntryReceipt(certificate, reviewMaterial(NEXT).loaded, reviewMaterial(NEXT).result).ok, false, 'certification binds the exact product candidate');
    const changedScope = reviewMaterial(HEAD, TASK_BODY.replace('Keep this protected scope.', 'Changed scope.'));
    assert.equal(validateReviewEntryReceipt(certificate, changedScope.loaded, changedScope.result).ok, false, 'protected intent invalidates certification');
    const changedAllowedPaths = reviewMaterial(HEAD, TASK_BODY.replace('  - src/**', '  - lib/**'));
    assert.equal(validateReviewEntryReceipt(certificate, changedAllowedPaths.loaded, changedAllowedPaths.result).ok, false, 'allowed-scope change invalidates certification');
    const changedReceipt = reviewMaterial(HEAD, TASK_BODY, { events: [{ artifact: HEAD, type: 'outcome', status: 'accepted' }], errors: [] });
    assert.equal(validateReviewEntryReceipt(certificate, changedReceipt.loaded, changedReceipt.result).ok, false, 'review receipt evidence has its own identity');

    const staleSchema = structuredClone(certificate);
    staleSchema.schemaVersion = 3;
    assert.equal(validateReviewEntryReceiptShape(staleSchema).ok, false, 'schema identity is distinct from protected intent');
  });
});
