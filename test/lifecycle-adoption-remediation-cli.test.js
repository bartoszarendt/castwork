import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { canonicalJson, canonicalSha256 } from '../src/canonical-json.js';
import { appendAuditReport, createAuditRecordContent } from '../src/audit-record.js';
import { createAuditorReturnReceipt } from '../src/auditor-return-receipt.js';
import { loadAuditorReturnReceiptVerifier } from '../src/auditor-return-receipt.js';
import { parseAuditorWireReport, prepareAuditorReturnReportForSigning, wireReportToAuditRun } from '../src/audit-report-schema.js';
import { createDispatchConsumption, dispatchConsumptionRelativePath } from '../src/handoff-consumption.js';
import { recognizeHandoff } from '../src/handoff-recognition.js';
import { createReturnVerification, listReturnVerifications, writeReturnVerification } from '../src/return-verification.js';
import { refetchFilesReturnEvidence } from '../src/files-return-evidence.js';
import { executionAttemptAbandonmentRelativePath, executionAttemptIdentity } from '../src/execution-attempt.js';
import { maintainerReviewOutcomeBinding, createMaintainerReviewOutcomeReceipt } from '../src/maintainer-review-receipt.js';
import { parseFilesReviewHistory } from '../src/review-history.js';
import { taskContractDigest } from '../src/task-contract-baseline.js';
import { createDispatchFixture, git, prepare, readyReturn, repositoryEvidence } from './helpers/dispatch-fixture.js';
import { fixtureDispatchValidator } from './helpers/handoff-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'al-lifecycle-adoption-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function consumeAttempt(fixture) {
  const prepared = prepare(fixture);
  assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
  const packet = prepared.packet;
  const recognition = recognizeHandoff({
    transition: 'role_start',
    expectation: {
      backend: 'files', taskId: 'T-001', roleId: 'engineer', taskContractDigest: packet.task.contractDigest,
      carrierDigest: packet.task.digest, packetId: packet.packetId, packetDigest: packet.digest,
      workUnitIdentity: packet.decomposition?.workUnitId ?? null, artifactHead: packet.repository.head,
      worktreeRoot: packet.repository.worktree, minimumActivationAssurance: 'operator_confirmed',
    },
    preparedDispatch: packet,
    validatePreparedDispatch: fixtureDispatchValidator(fixture),
  });
  assert.equal(recognition.recognized, true, JSON.stringify(recognition.diagnostics));
  const consumption = createDispatchConsumption({ backend: 'files', taskId: 'T-001', recognition });
  const path = join(fixture.root, dispatchConsumptionRelativePath(consumption));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(consumption, null, 2)}\n`);
  return { consumption, packet, attemptId: executionAttemptIdentity(consumption) };
}

function commit(fixture, path, content = 'export const adopted = true;\n', { attributed = false } = {}) {
  writeFileSync(join(fixture.root, path), content);
  git(fixture.root, ['add', path]);
  git(fixture.root, ['commit', '-m', attributed
    ? `implement ${path}\n\nTask: T-001\nAgent: engineer`
    : `adopt ${path}`]);
  return git(fixture.root, ['rev-parse', 'HEAD']);
}

function remove(fixture, path) {
  git(fixture.root, ['rm', path]);
  git(fixture.root, ['commit', '-m', `restore ${path}`]);
  return git(fixture.root, ['rev-parse', 'HEAD']);
}

function carrierDigest(fixture) {
  return `sha256:${createHash('sha256').update(readFileSync(join(fixture.root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8'), 'utf8').digest('hex')}`;
}

function commitWorkflow(fixture, subject) {
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs', '.agenticloop/adoptions']);
  git(fixture.root, ['commit', '-m', `${subject}\n\nTask: T-001\nAgent: maintainer`]);
}

function adoptionArgs(fixture, attempt, head) {
  return [
    'task', 'adopt-commit', 'T-001', '--attempt', attempt.attemptId,
    '--base', attempt.consumption.productBaseHead, '--head', head,
    '--actor-class', 'human', '--actor-id', 'operator-1',
    '--reason', 'A human applied the bounded correction before the supervisor resumed.',
    '--json', '--target', fixture.root,
  ];
}

function protectedOptions(fixture) {
  const loaded = loadAuditorReturnReceiptVerifier({
    target: fixture.root,
    operatorTrustRoot: fixture.operatorTrustRoot,
    adapterId: fixture.trust.adapterId,
    protectedBoundary: protectedHostBoundary(fixture.trust),
  });
  assert.equal(loaded.ok, true, loaded.errors?.join('\n'));
  return {
    operatorTrustRoot: fixture.operatorTrustRoot,
    hostAuthority: protectedHostBoundary(fixture.trust),
    auditProvenanceVerifier: loaded.verifier,
  };
}

async function remediation(fixture, attempt, candidate, finding) {
  const candidatePath = '.agenticloop/tmp/candidate.json';
  const findingPath = '.agenticloop/tmp/finding.json';
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  writeFileSync(join(fixture.root, candidatePath), `${JSON.stringify(candidate)}\n`);
  writeFileSync(join(fixture.root, findingPath), `${JSON.stringify(finding)}\n`);
  return runCliInProcess([
    'task', 'remediation-authority', 'T-001', '--attempt', attempt.attemptId,
    '--candidate', candidatePath, '--finding', findingPath,
    '--json', '--target', fixture.root,
  ], protectedOptions(fixture));
}

function reviewHistory(head, actor = 'maintainer-1', mode = 'host_subagent') {
  return `\n## Review History\n\n### Review remediation\n\n- Status: needs_revision\n- Mode: ${mode}\n- Artifact: ${head}\n- Findings: F-1\n- Review role carrier: agenticloop.review-role-carrier/v1\n- Role ID: maintainer\n- Actor account: ${actor}\n`;
}

async function persistAuthenticatedAudit(fixture, head) {
  const raw = {
    report_schema: 'auditor_report_v1', producer: { roleId: 'auditor' }, artifact: `commit:${head}`,
    covered_tasks: ['T-001'], invocation: { mode: 'host_subagent', reference: 'audit-remediation-1', provenance: 'verified', receipt: null },
    perspectives: Object.fromEntries(['outcome', 'completeness', 'integration_coherence', 'engineering_quality', 'verification', 'risk'].map(key => [key, `${key} evidence`])),
    assessment: 'Independent Auditor found an in-contract correction.', evidence_checked: 'node --test', verdict: 'needs_remediation', findings: [],
  };
  const prepared = prepareAuditorReturnReportForSigning(raw);
  assert.equal(prepared.ok, true, prepared.errors?.join('\n'));
  prepared.report.invocation.receipt = canonicalJson(createAuditorReturnReceipt({
    receiptId: 'auditor-remediation-1', adapterId: fixture.trust.adapterId, keyId: fixture.trust.keyId,
    targetRepository: fixture.trust.repositoryIdentity, invocationReference: 'audit-remediation-1', invocationMode: 'host_subagent',
    workUnit: 'work-unit:remediation', candidateArtifact: `commit:${head}`, coveredTasks: ['T-001'], reportDigest: prepared.digest,
    issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, fixture.trust.privateKey));
  const parsed = parseAuditorWireReport(prepared.report);
  assert.equal(parsed.ok, true, parsed.errors?.join('\n'));
  const reportPath = '.agenticloop/tmp/auditor-report.json';
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  writeFileSync(join(fixture.root, reportPath), `${JSON.stringify(parsed.report)}\n`);
  const options = protectedOptions(fixture);
  const created = await runCliInProcess([
    'audit', 'new', '--work-unit', 'work-unit:remediation', '--covered-tasks', 'T-001',
    '--artifact', `commit:${head}`, '--goal', 'Resolve the bounded finding.',
    '--completion-oracle', 'The exact candidate is audited.', '--evidence', 'node --test passed.', '--target', fixture.root,
  ], options);
  assert.equal(created.status, 0, `${created.stderr}\n${created.stdout}`);
  const reported = await runCliInProcess([
    'audit', 'report', 'AUD-001', '--file', reportPath, '--target', fixture.root,
  ], options);
  assert.equal(reported.status, 0, `${reported.stderr}\n${reported.stdout}`);
}

function signedMaintainerReviewOutcome(fixture, verification, body, reviewOutcome, receiptId = 'maintainer-remediation-1') {
  const binding = maintainerReviewOutcomeBinding({
    taskId: 'T-001', taskContractDigest: taskContractDigest(body).digest,
    returnVerification: verification, candidate: verification.finishCandidate, reviewOutcome,
  });
  return createMaintainerReviewOutcomeReceipt({
    receiptId, adapterId: fixture.trust.adapterId, keyId: fixture.trust.keyId,
    targetRepository: fixture.trust.repositoryIdentity, invocationReference: receiptId,
    invocationMode: reviewOutcome.mode, binding,
    issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, fixture.trust.privateKey);
}

function persistAuthenticatedMaintainerReview(fixture, verification, head, reviewer, mode = 'host_subagent') {
  const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
  const body = readFileSync(taskPath, 'utf8');
  const history = parseFilesReviewHistory(`${body}${reviewHistory(head, reviewer, mode)}`);
  const reviewOutcome = history.events.filter(event => event.type === 'outcome').at(-1);
  assert.ok(reviewOutcome, 'fixture must contain a Maintainer outcome before signing it');
  const receipt = signedMaintainerReviewOutcome(fixture, verification, body, reviewOutcome);
  const receiptPath = '.agenticloop/tmp/maintainer-review.json';
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  writeFileSync(join(fixture.root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  return receiptPath;
}

function directClaimedAudit(head) {
  const raw = {
    report_schema: 'auditor_report_v1', producer: { roleId: 'auditor' }, artifact: `commit:${head}`,
    covered_tasks: ['T-001'], invocation: { mode: 'host_subagent', reference: 'claimed-audit-1', provenance: 'verified', receipt: 'claimed-host-receipt' },
    perspectives: Object.fromEntries(['outcome', 'completeness', 'integration_coherence', 'engineering_quality', 'verification', 'risk'].map(key => [key, `${key} evidence`])),
    assessment: 'Claimed independent audit.', evidence_checked: 'node --test', verdict: 'needs_remediation', findings: [],
  };
  const parsed = parseAuditorWireReport(raw);
  assert.equal(parsed.ok, true, parsed.errors?.join('\n'));
  const base = createAuditRecordContent({
    auditId: 'AUD-001', workUnit: 'work-unit:remediation', coveredTasks: ['T-001'], candidateArtifact: `commit:${head}`,
    goal: 'Resolve the bounded finding.', completionOracle: 'The exact candidate is audited.', evidence: 'node --test passed.',
  });
  const appended = appendAuditReport(base, {
    ...wireReportToAuditRun(parsed.report), auditorReturnAssurance: 'host_receipt', producerAuthenticated: true,
  });
  assert.equal(appended.ok, true, appended.errors?.join('\n'));
  return appended.content;
}

async function persistDurableCertifications(fixture, attempt, head, {
  reviewer = 'maintainer-1', audit = true, reviewMode = 'host_subagent', expectedReviewStatus = 0,
} = {}) {
  git(fixture.root, ['add', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', 'record consumed dispatch\n\nTask: T-001\nAgent: maintainer']);
  const evidence = refetchFilesReturnEvidence(fixture.root, attempt.packet, {
    productHead: head,
    checks: [
      { id: 'RC-1', kind: 'command', command: 'npm test', outcome: 'passed', exitCode: 0, evidence: '1 passing' },
      { id: 'RC-2', kind: 'command', command: 'npm run typecheck', outcome: 'passed', exitCode: 0, evidence: 'no errors' },
    ],
    task: { currentCarrierDigest: carrierDigest(fixture) },
  });
  const roleReturn = readyReturn(attempt.packet, evidence);
  const verification = createReturnVerification({
    target: fixture.root, packet: attempt.packet, roleReturn, repositoryEvidence: evidence,
    received: { ok: true, returnAssurance: 'session_reported' },
  });
  const written = writeReturnVerification(fixture.root, verification);
  assert.equal(written.ok, true, written.errors?.join('\n'));
  const maintainerReceipt = persistAuthenticatedMaintainerReview(fixture, verification, head, reviewer, reviewMode);
  const review = await runCliInProcess([
    'task', 'review-prepare', 'T-001', '--maintainer-receipt', maintainerReceipt, '--json', '--target', fixture.root,
  ], protectedOptions(fixture));
  assert.equal(review.status, expectedReviewStatus, `${review.stderr}\n${review.stdout}`);
  if (review.status !== 0) return { verification, review };
  const task = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
  writeFileSync(task, `${readFileSync(task, 'utf8')}${reviewHistory(head, reviewer, reviewMode)}`);
  if (audit) await persistAuthenticatedAudit(fixture, head);
  return verification.finishCandidate;
}

describe('production lifecycle adoption and remediation commands', () => {
  it('records deliberate human-fix adoption and invalidates the exact certifications for rerun without consuming the attempt', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-success');
    const failedAttempt = consumeAttempt(fixture);
    const failedRecord = {
      kind: 'agenticloop.execution-attempt-abandonment', schemaVersion: 2,
      backend: 'files', taskId: 'T-001', attemptId: failedAttempt.attemptId,
      packetId: failedAttempt.packet.packetId,
      reason: 'The prior attempt failed before product work could begin.',
      disposition: 'tooling_failed', authority: 'maintainer:adoption-history-test',
      productMutationOccurred: false, carrierMutationOccurred: true,
      abandonedAt: new Date().toISOString(),
    };
    const failedRecordPath = join(fixture.root, executionAttemptAbandonmentRelativePath(failedRecord));
    mkdirSync(join(failedRecordPath, '..'), { recursive: true });
    writeFileSync(failedRecordPath, `${JSON.stringify(failedRecord, null, 2)}\n`);
    git(fixture.root, ['add', '.agenticloop/handoffs']);
    git(fixture.root, ['commit', '-m', 'preserve failed attempt before adoption\n\nTask: T-001\nAgent: maintainer']);
    const priorRepository = fixture.repository;
    const currentHead = git(fixture.root, ['rev-parse', 'HEAD']);
    fixture.repository = () => ({ ...priorRepository(), head: currentHead, baseHead: currentHead });
    fixture.refetchRepository = fixture.repository;
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.adoption.actor, { class: 'human', id: 'operator-1' });
    assert.match(payload.adoption.reason, /human applied/);
    assert.equal(payload.preserved.attempt.id, attempt.attemptId);
    assert.deepEqual(payload.certification.invalidated, ['required_checks', 'review', 'audit', 'closeout']);
    assert.deepEqual(payload.certification.rerun, ['required_checks', 'review', 'audit']);
    const attempts = JSON.parse((await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture))).stdout).attempts;
    assert.equal(attempts.find(item => item.attemptId === failedAttempt.attemptId)?.state, 'tooling_failed');
    assert.ok(attempts.some(item => item.attemptId === attempt.attemptId), 'adoption must preserve the live attempt');
  });

  it('consumes a durable adoption record in the real prepare-return lineage while refusing an unadopted human commit', async () => {
    const fixture = await createDispatchFixture(temp, 'adoption-return-lineage', {
      requiredChecksText: '- [RC-1] command: `node --version`\n- [RC-2] command: `node --version`',
      independentReviewRequired: true,
    });
    const failedAttempt = consumeAttempt(fixture);
    const failedRecord = {
      kind: 'agenticloop.execution-attempt-abandonment', schemaVersion: 2,
      backend: 'files', taskId: 'T-001', attemptId: failedAttempt.attemptId,
      packetId: failedAttempt.packet.packetId,
      reason: 'The prior attempt failed before product work could begin.',
      disposition: 'tooling_failed', authority: 'maintainer:adoption-lineage-test',
      productMutationOccurred: false, carrierMutationOccurred: true,
      abandonedAt: new Date().toISOString(),
    };
    const failedRecordPath = join(fixture.root, executionAttemptAbandonmentRelativePath(failedRecord));
    mkdirSync(join(failedRecordPath, '..'), { recursive: true });
    writeFileSync(failedRecordPath, `${JSON.stringify(failedRecord, null, 2)}\n`);
    git(fixture.root, ['add', '.agenticloop/handoffs']);
    git(fixture.root, ['commit', '-m', 'preserve failed attempt before adoption\n\nTask: T-001\nAgent: maintainer']);
    const priorRepository = fixture.repository;
    const currentHead = git(fixture.root, ['rev-parse', 'HEAD']);
    fixture.repository = () => ({ ...priorRepository(), head: currentHead, baseHead: currentHead });
    fixture.refetchRepository = fixture.repository;
    const packetPath = '.agenticloop/tmp/packet.json';
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    const packet = prepare(fixture).packet;
    writeFileSync(join(fixture.root, packetPath), `${JSON.stringify(packet)}\n`);
    const cli = args => runCliInProcess([...args, '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust),
    });
    const started = await cli(['task', 'status', 'T-001', 'in-progress', '--expect-digest', carrierDigest(fixture), '--dispatch-packet', packetPath, '--json']);
    assert.equal(started.status, 0, started.stderr);
    const attempt = JSON.parse((await cli(['task', 'attempt-status', 'T-001', '--json'])).stdout).attempts.at(-1).attemptId;
    const humanHead = commit(fixture, 'src/adopted.js');
    const unadopted = await cli(['task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence', '--expect-digest', carrierDigest(fixture), '--product-head', humanHead, '--json']);
    assert.equal(unadopted.status, 0, unadopted.stderr);
    const checksPath = '.agenticloop/tmp/checks.json';
    assert.equal((await cli(['task', 'check-evidence-init', 'T-001', '--packet', packetPath, '--output', checksPath, '--json'])).status, 0);
    for (const check of JSON.parse(readFileSync(join(fixture.root, checksPath), 'utf8'))) {
      const updated = await cli(['task', 'check-evidence-update', 'T-001', '--packet', packetPath, '--input', checksPath, '--output', checksPath, '--check', check.id, '--outcome', 'passed', '--evidence', `${check.id} passed`, '--execution-output', `.agenticloop/checks/T-001/${check.id}.execution.json`, '--json']);
      assert.equal(updated.status, 0, `${updated.stderr}\n${updated.stdout}`);
    }
    git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs', '.agenticloop/checks']);
    git(fixture.root, ['commit', '-m', 'record required checks\n\nTask: T-001\nAgent: engineer']);
    const returnPath = '.agenticloop/tmp/return.json';
    const refused = await cli(['task', 'prepare-return', 'T-001', '--packet', packetPath, '--check-evidence', checksPath, '--outcome', 'implementation_ready_for_review', '--output', returnPath, '--json']);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /durable commit-adoption attribution|canonical Task/);

    const adopted = await cli([
      'task', 'adopt-commit', 'T-001', '--attempt', attempt, '--base', packet.repository.head, '--head', humanHead,
      '--actor-class', 'human', '--actor-id', 'operator-1', '--reason', 'Human bounded correction.', '--json',
    ]);
    assert.equal(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    commitWorkflow(fixture, 'record deliberate human adoption');
    const currentChecksPath = '.agenticloop/tmp/checks-after-adoption.json';
    const initializedAfterAdoption = await cli([
      'task', 'check-evidence-init', 'T-001', '--packet', packetPath,
      '--output', currentChecksPath, '--json',
    ]);
    assert.equal(initializedAfterAdoption.status, 0, `${initializedAfterAdoption.stderr}\n${initializedAfterAdoption.stdout}`);
    const checksAfterAdoption = JSON.parse(readFileSync(join(fixture.root, currentChecksPath), 'utf8'));
    for (const check of checksAfterAdoption) {
      const rerun = await cli([
        'task', 'check-evidence-update', 'T-001', '--packet', packetPath,
        '--input', currentChecksPath, '--output', currentChecksPath, '--check', check.id,
        '--outcome', 'passed', '--evidence', `${check.id} rerun after adoption`,
        '--execution-output', `.agenticloop/checks/T-001/${check.id}.execution.json`, '--json',
      ]);
      assert.equal(rerun.status, 0, `${rerun.stderr}\n${rerun.stdout}`);
    }
    git(fixture.root, ['add', '.agenticloop/checks']);
    git(fixture.root, ['commit', '-m', 'rerun required checks after adoption\n\nTask: T-001\nAgent: engineer']);
    const returned = await cli(['task', 'prepare-return', 'T-001', '--packet', packetPath, '--check-evidence', currentChecksPath, '--outcome', 'implementation_ready_for_review', '--output', returnPath, '--json']);
    assert.equal(returned.status, 0, `${returned.stderr}\n${returned.stdout}`);
    const roleReturn = JSON.parse(readFileSync(join(fixture.root, returnPath), 'utf8'));
    assert.equal(roleReturn.productBaseHead, packet.repository.head);
    assert.equal(roleReturn.productHead, humanHead);
    assert.deepEqual(roleReturn.productAttribution.commits, [humanHead]);
    const verified = await cli(['task', 'verify-return', 'T-001', '--packet', packetPath, '--return', returnPath, '--from-current-repository', '--json']);
    assert.equal(verified.status, 0, `${verified.stderr}\n${verified.stdout}`);

    // The adopted product commit keeps the live attempt and preserves its failed
    // predecessor. It does not create an empty protocol-only attempt merely to
    // get back to review; current checks and a fresh independent Maintainer
    // review are both rerun after adoption.
    const verification = listReturnVerifications(fixture.root, 'T-001').records[0];
    const maintainerReceipt = persistAuthenticatedMaintainerReview(fixture, verification, humanHead, 'maintainer-2');
    const reviewed = await cli([
      'task', 'review-prepare', 'T-001', '--maintainer-receipt', maintainerReceipt, '--json',
    ]);
    assert.equal(reviewed.status, 0, `${reviewed.stderr}\n${reviewed.stdout}`);
    const attempts = JSON.parse((await cli(['task', 'attempt-status', 'T-001', '--json'])).stdout).attempts;
    assert.equal(attempts.find(item => item.attemptId === failedAttempt.attemptId)?.state, 'tooling_failed',
      'the adopted fixture must retain the failed predecessor as durable history');
    assert.equal(attempts.filter(item => item.attemptId === attempt).length, 1,
      'adoption must retain exactly the live attempt that adopted the product commit');
    assert.equal(attempts.length, 2, 'adoption must not mint a protocol-only attempt after the current checks and independent review rerun');

    const adoptionPath = join(fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${humanHead}.json`);
    writeFileSync(adoptionPath, '{not json}\n');
    commitWorkflow(fixture, 'corrupt adoption record for refusal probe');
    const corrupt = await cli(['task', 'prepare-return', 'T-001', '--packet', packetPath, '--check-evidence', currentChecksPath, '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/corrupt-return.json', '--json']);
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stdout, /commit adoption/);
  });

  it('refuses an out-of-scope changed path through the adoption command and routes it to the owner', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-out-of-scope');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'outside.js');
    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).evaluation.reasons.join('\n'), /not allowed/);
    assert.equal(JSON.parse(result.stdout).evaluation.nextOwner, 'owner');
  });

  it('refuses a changed-and-reverted out-of-scope path across a real linear adoption range without persisting a record', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-reverted-out-of-scope');
    const attempt = consumeAttempt(fixture);
    commit(fixture, 'outside.js');
    const head = remove(fixture, 'outside.js');

    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.evaluation.nextOwner, 'owner');
    assert.match(payload.evaluation.reasons.join('\n'), /not allowed/);
    assert.equal(existsSync(join(fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${head}.json`)), false);
  });

  it('adopts a real linear range whose every touched path is in scope even when its endpoint tree is unchanged', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-reverted-in-scope');
    const attempt = consumeAttempt(fixture);
    commit(fixture, 'src/reverted.js');
    const head = remove(fixture, 'src/reverted.js');

    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.adoption.changedPaths, ['src/reverted.js']);
    assert.equal(existsSync(join(fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${head}.json`)), true);
  });

  it('refuses a multi-commit adoption range with in-scope and out-of-scope paths in separate commits', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-mixed-multi-commit');
    const attempt = consumeAttempt(fixture);
    commit(fixture, 'src/adopted.js');
    const head = commit(fixture, 'outside.js');

    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.evaluation.nextOwner, 'owner');
    assert.match(payload.evaluation.reasons.join('\n'), /not allowed/);
    assert.equal(existsSync(join(fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${head}.json`)), false);
  });

  it('refuses a changed protected contract through the adoption command', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-contract');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const task = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(task, readFileSync(task, 'utf8').replace('## Scope', '## Scope\nChanged contract.'));
    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).evaluation.reasons.join('\n'), /protected contract/);
  });

  it('refuses an ambiguous merge range through the adoption command', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-merge');
    const attempt = consumeAttempt(fixture);
    git(fixture.root, ['checkout', '-b', 'side']);
    commit(fixture, 'src/side.js');
    git(fixture.root, ['checkout', 'task/T-001']);
    commit(fixture, 'src/main.js');
    git(fixture.root, ['merge', '--no-ff', 'side', '-m', 'merge side']);
    const head = git(fixture.root, ['rev-parse', 'HEAD']);
    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).evaluation.reasons.join('\n'), /merge or ambiguous/);
  });

  it('opens an in-contract remediation cycle under the preserved authority', async () => {
    const fixture = await createDispatchFixture(temp, 'remediation-success');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(JSON.parse(result.stdout).authority.attempt, attempt.attemptId);
  });

  it('refuses a signed single-agent fallback at files review preparation when independent review is required', async () => {
    const fixture = await createDispatchFixture(temp, 'independent-review-fallback-refusal', {
      independentReviewRequired: true,
    });
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const { review } = await persistDurableCertifications(fixture, attempt, head, {
      audit: false, reviewMode: 'single_agent_fallback', expectedReviewStatus: 1,
    });

    const payload = JSON.parse(review.stdout);
    assert.equal(payload.diagnostics[0].code, 'review_prepare.independent_review_policy');
    assert.match(payload.diagnostics[0].message, /independent review.*single_agent_fallback/i);
  });

  it('permits a signed single-agent fallback when the task does not require independent review', async () => {
    const fixture = await createDispatchFixture(temp, 'fallback-review-not-required');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head, {
      audit: false, reviewMode: 'single_agent_fallback',
    });

    assert.equal(candidate.productRange.head, head);
  });

  it('refuses a valid signed single-agent fallback during durable remediation when independent review is required', async () => {
    const fixture = await createDispatchFixture(temp, 'independent-remediation-fallback-refusal', {
      independentReviewRequired: true,
    });
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(taskPath, readFileSync(taskPath, 'utf8').replace('Mode: host_subagent', 'Mode: single_agent_fallback'));
    const verification = listReturnVerifications(fixture.root, 'T-001').records[0];
    const taskBody = readFileSync(taskPath, 'utf8');
    const reviewOutcome = parseFilesReviewHistory(taskBody).events.filter(event => event.type === 'outcome').at(-1);
    const entryDir = join(fixture.root, '.agenticloop', 'reviews', 'entries', 'T-001');
    const entryPath = join(entryDir, readdirSync(entryDir).find(name => name.endsWith('.json')));
    const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
    entry.maintainerOutcome = signedMaintainerReviewOutcome(
      fixture, verification, taskBody, reviewOutcome, 'maintainer-remediation-fallback-1'
    );
    const { digest, ...projection } = entry;
    entry.digest = `sha256:agenticloop.files-review-entry-receipt.v3:${canonicalSha256(projection)}`;
    writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);

    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(result.status, 1);
    const diagnostics = JSON.parse(result.stdout).freshness.diagnostics.map(item => item.type);
    assert.ok(diagnostics.includes('maintainer_review_independence_required'));
  });

  it('permits a genuinely independent signed review through durable remediation', async () => {
    const fixture = await createDispatchFixture(temp, 'independent-remediation-success', {
      independentReviewRequired: true,
    });
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  });

  it('refuses a forged files reviewer identity despite a genuine signed Auditor record', async () => {
    const fixture = await createDispatchFixture(temp, 'remediation-forged-maintainer');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const task = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(task, readFileSync(task, 'utf8').replace('Actor account: maintainer-1', 'Actor account: engineer-1'));

    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(result.status, 1);
    const diagnostics = JSON.parse(result.stdout).freshness.diagnostics.map(item => item.type);
    assert.ok(diagnostics.includes('maintainer_review_authentication_failed'));
  });

  it('refuses a review entry missing its protected Maintainer authentication', async () => {
    const fixture = await createDispatchFixture(temp, 'remediation-missing-maintainer-auth');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const entryDir = join(fixture.root, '.agenticloop', 'reviews', 'entries', 'T-001');
    const entryPath = join(entryDir, readdirSync(entryDir).find(name => name.endsWith('.json')));
    const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
    entry.maintainerOutcome = null;
    const { digest, ...projection } = entry;
    entry.digest = `sha256:agenticloop.files-review-entry-receipt.v3:${canonicalSha256(projection)}`;
    writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);

    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(result.status, 1);
    const diagnostics = JSON.parse(result.stdout).freshness.diagnostics.map(item => item.type);
    assert.ok(diagnostics.includes('maintainer_review_authentication_failed'));
  });

  it('refuses hand-written review and claimed-audit records without protected bindings', async () => {
    const fixture = await createDispatchFixture(temp, 'remediation-direct-write');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const reviewDir = join(fixture.root, '.agenticloop', 'reviews', 'entries', 'T-001');
    for (const name of readdirSync(reviewDir)) writeFileSync(join(reviewDir, name), `${JSON.stringify({
      kind: 'agenticloop.files-review-entry-receipt', schemaVersion: 2, taskId: 'T-001',
      productHead: head, candidateHead: head, verifiedReturn: { digest: 'claimed' },
    })}\n`);
    writeFileSync(join(fixture.root, '.agenticloop', 'audits', 'AUD-001.md'), directClaimedAudit(head));
    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(result.status, 1);
    const diagnostics = JSON.parse(result.stdout).freshness.diagnostics.map(item => item.type);
    assert.ok(diagnostics.includes('review_entry_unverified'));
    assert.ok(diagnostics.includes('auditor_record_authentication_failed'));
  });

  it('returns scope-expanding remediation findings to the owner', async () => {
    const fixture = await createDispatchFixture(temp, 'remediation-expansion');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const candidate = await persistDurableCertifications(fixture, attempt, head);
    const result = await remediation(fixture, attempt, candidate, {
      contract: attempt.consumption.taskContractDigest, risk: 'standard', widensIntent: true,
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).authority.nextOwner, 'owner');
  });

  it('refuses stale candidates and producer self-certification through remediation authority', async () => {
    const staleFixture = await createDispatchFixture(temp, 'remediation-stale');
    const staleAttempt = consumeAttempt(staleFixture);
    const staleHead = commit(staleFixture, 'src/adopted.js', undefined, { attributed: true });
    const staleCandidate = await persistDurableCertifications(staleFixture, staleAttempt, staleHead);
    commit(staleFixture, 'src/mutated.js');
    const stale = await remediation(staleFixture, staleAttempt, staleCandidate, {
      contract: staleAttempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(stale.status, 1);
    assert.match(JSON.parse(stale.stdout).freshness.reasons.join('\n'), /candidate/);

    const missingFixture = await createDispatchFixture(temp, 'remediation-missing');
    const missingAttempt = consumeAttempt(missingFixture);
    const missingHead = commit(missingFixture, 'src/adopted.js', undefined, { attributed: true });
    const missingCandidate = await persistDurableCertifications(missingFixture, missingAttempt, missingHead, { audit: false });
    const missing = await remediation(missingFixture, missingAttempt, missingCandidate, {
      contract: missingAttempt.consumption.taskContractDigest, risk: 'standard', widensIntent: false,
    });
    assert.equal(missing.status, 1);
    assert.match(JSON.parse(missing.stdout).freshness.reasons.join('\n'), /Auditor record/);
  });
});
