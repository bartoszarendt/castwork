import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createMaintainerReviewOutcomeReceipt,
  maintainerReviewOutcomeBinding,
} from '../../src/maintainer-review-receipt.js';
import { executionAttemptIdentity } from '../../src/execution-attempt.js';
import { resolveCarrierLineage } from '../../src/handoff-consumption.js';

/** Record the completion/evidence sections through the Engineer's protected input. */
export async function recordCompletedTaskEvidence({ target, packet, productHead, carrierDigest, invoke }) {
  const lineage = resolveCarrierLineage(target, 'T-001', {
    backend: 'files',
    taskContractDigest: packet.task.taskContractDigest,
    currentCarrierDigest: carrierDigest(),
  });
  assert.equal(lineage.ok, true, lineage.errors?.join('; '));
  const inputPath = '.agenticloop/tmp/engineer-structured-evidence.json';
  writeFileSync(join(target, inputPath), `${JSON.stringify({
    kind: 'agenticloop.task-evidence-input',
    schemaVersion: 1,
    actorRole: 'engineer',
    provenance: {
      workflowRole: 'engineer',
      invocationId: packet.assignment.invocationId,
      taskContractDigest: packet.task.taskContractDigest,
      attemptId: executionAttemptIdentity(lineage.dispatchConsumption),
    },
    sections: {
      scopeCompleted: [{
        id: 'scope-1', summary: 'Delivered the closeout candidate.', status: 'completed',
        evidenceRefs: [`commit:${productHead}`],
      }],
      evidence: [{
        id: 'evidence-1', summary: 'Required verification passed.', status: 'passed',
        evidenceRefs: ['npm test'],
      }],
      deviations: [], knownGaps: [], verificationAttempts: [], revisionResolution: [],
      maintainerTriage: [], retryAuthorization: [],
    },
  }, null, 2)}\n`, 'utf8');
  const recorded = await invoke([
    'task', 'evidence', 'T-001', '--class', 'structured_task_evidence',
    '--expect-digest', carrierDigest(), '--input', inputPath, '--json', '--target', target,
  ]);
  assert.equal(recorded.status, 0, `${recorded.stdout}${recorded.stderr}`);
}

/** Drive an accepted files review exclusively through the protected commands. */
export async function attachAcceptedReview({ target, fixture, invoke, taskContractDigest, productHead }) {
  const verificationDir = join(target, '.agenticloop', 'returns', 'verifications');
  const verificationName = readdirSync(verificationDir).find(name => name.endsWith('.json'));
  assert.ok(verificationName, 'verified return must produce a durable verification record');
  const verification = JSON.parse(readFileSync(join(verificationDir, verificationName), 'utf8'));

  const prepared = await invoke(['task', 'review-prepare', 'T-001', '--json', '--target', target]);
  assert.equal(prepared.status, 0, `${prepared.stdout}${prepared.stderr}`);

  const outcome = {
    type: 'outcome', status: 'accepted', mode: 'host_subagent',
    artifact: `commit:${productHead}`, findingIds: [], classification: null,
    roleId: 'maintainer', actorAccount: 'maintainer-test', sourceReference: 'review:1',
  };
  const binding = maintainerReviewOutcomeBinding({
    taskId: 'T-001', taskContractDigest,
    returnVerification: verification, candidate: verification.finishCandidate,
    reviewOutcome: outcome,
  });
  const receipt = createMaintainerReviewOutcomeReceipt({
    receiptId: `maintainer-review-${Math.random().toString(36).slice(2)}`,
    adapterId: fixture.trust.adapterId,
    keyId: fixture.trust.keyId,
    targetRepository: fixture.trust.repositoryIdentity,
    invocationReference: 'maintainer-review-1',
    invocationMode: 'host_subagent',
    binding,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, fixture.trust.privateKey);
  const receiptPath = '.agenticloop/tmp/maintainer-review.json';
  writeFileSync(join(target, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  const attached = await invoke([
    'task', 'review-attach-outcome', 'T-001',
    '--maintainer-receipt', receiptPath,
    '--return-verification', verification.recordId,
    '--json', '--target', target,
  ]);
  assert.equal(attached.status, 0, `${attached.stdout}${attached.stderr}`);
  return verification;
}
