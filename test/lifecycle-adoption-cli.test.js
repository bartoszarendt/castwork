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
import { createDispatchConsumption, dispatchConsumptionRelativePath, listDispatchConsumptions } from '../src/handoff-consumption.js';
import { recognizeHandoff } from '../src/handoff-recognition.js';
import { createActivationRevocation } from '../src/activation-grant.js';
import { writeActivationRevocation } from '../src/activation-store.js';
import { createReturnVerification, listReturnVerifications, writeReturnVerification } from '../src/return-verification.js';
import { refetchFilesReturnEvidence } from '../src/files-return-evidence.js';
import { executionAttemptAbandonmentRelativePath, executionAttemptIdentity } from '../src/execution-attempt.js';
import { executeMutationBatch } from '../src/fs-mutation-kernel.js';
import {
  maintainerReviewOutcomeBinding,
  authenticateFreshMaintainerReviewOutcomeReceipt,
  createMaintainerReviewOutcomeReceipt,
  verifyMaintainerReviewOutcomeReceipt,
} from '../src/maintainer-review-receipt.js';
import { parseFilesReviewHistory } from '../src/review-history.js';
import { taskContractDigest } from '../src/task-contract-baseline.js';
import { createDispatchFixture, git, prepare, readyReturn, repositoryEvidence } from './helpers/dispatch-fixture.js';
import { fixtureDispatchValidator } from './helpers/handoff-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { interactiveOptions, prepareThroughCli, scaffoldFixture } from './helpers/activation-fixture.js';
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

function taskPath(fixture) {
  return join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
}

function terminalCarrierMutation(fixture, carrier, status = 'closed') {
  return executeMutationBatch(fixture.root, [{
    type: 'write', path: '.agenticloop/tasks/T-001.md',
    content: carrier.replace(/^status: .*$/m, `status: ${status}`),
    expectedKind: 'file', expectedDigest: createHash('sha256').update(carrier, 'utf8').digest('hex'),
  }], { lifecycleAuthorityTaskIds: ['T-001'] });
}

function commitWorkflow(fixture, subject) {
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs', '.agenticloop/adoptions']);
  git(fixture.root, ['commit', '-m', `${subject}\n\nTask: T-001\nAgent: maintainer`]);
}

function adoptionArgs(fixture, attempt, head) {
  return [
    'task', 'adopt-commit', 'T-001', '--attempt', attempt.attemptId,
    '--base', attempt.consumption.productBaseHead, '--head', head,
    '--actor-class', 'operator', '--actor-id', 'operator-1',
    '--reason', 'An operator claimed the bounded correction before the supervisor resumed.',
    '--json', '--target', fixture.root,
  ];
}

async function startedGrantAttempt(name) {
  const fixture = await scaffoldFixture(temp, name);
  const activated = await runCliInProcess(['activate', 'T-001', '--target', fixture.root], interactiveOptions(fixture));
  assert.equal(activated.status, 0, `${activated.stdout}\n${activated.stderr}`);
  const packet = await prepareThroughCli(fixture);
  const packetPath = '.agenticloop/tmp/adoption-packet.json';
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  writeFileSync(join(fixture.root, packetPath), `${JSON.stringify(packet, null, 2)}\n`);
  const options = {
    operatorTrustRoot: fixture.operatorTrustRoot,
    operatorActivationRoot: fixture.operatorActivationRoot,
  };
  const started = await runCliInProcess([
    'task', 'role-start', 'T-001', '--packet', packetPath, '--json', '--target', fixture.root,
  ], options);
  assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
  const consumption = listDispatchConsumptions(fixture.root, 'T-001', { backend: 'files' }).records[0];
  const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
  return { fixture, packet, consumption, attemptId: executionAttemptIdentity(consumption), head, options };
}

function assertAdoptionRefusalWithoutMutation(fixture, head, beforeCarrier, result, code) {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.evaluation.diagnostics[0].code, code);
  assert.equal(readFileSync(join(fixture.root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8'), beforeCarrier);
  assert.equal(existsSync(join(fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${head}.json`)), false);
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


function reviewHistory(head, actor = 'maintainer-1', mode = 'host_subagent') {
  return `\n## Review History\n\n### Review correction\n\n- Status: needs_revision\n- Mode: ${mode}\n- Artifact: ${head}\n- Findings: F-1\n- Review role carrier: agenticloop.review-role-carrier/v1\n- Role ID: maintainer\n- Actor account: ${actor}\n`;
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

function signedMaintainerReviewOutcome(fixture, verification, body, reviewOutcome, receiptId = 'maintainer-remediation-1', now = Date.now()) {
  const binding = maintainerReviewOutcomeBinding({
    taskId: 'T-001', taskContractDigest: taskContractDigest(body).digest,
    returnVerification: verification, candidate: verification.finishCandidate, reviewOutcome,
  });
  return createMaintainerReviewOutcomeReceipt({
    receiptId, adapterId: fixture.trust.adapterId, keyId: fixture.trust.keyId,
    targetRepository: fixture.trust.repositoryIdentity, invocationReference: receiptId,
    invocationMode: reviewOutcome.mode, binding,
    issuedAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
  }, fixture.trust.privateKey);
}

function initialAuthentication(fixture, verification, body, reviewOutcome, receipt, now = Date.now()) {
  const authenticated = authenticateFreshMaintainerReviewOutcomeReceipt(receipt, {
    taskId: 'T-001', taskContractDigest: taskContractDigest(body).digest,
    returnVerification: verification, candidate: verification.finishCandidate, reviewOutcome,
    trustedAdapter: fixture.trust.adapter, target: fixture.root, role: 'maintainer',
    invocationReference: receipt.invocation.reference, invocationMode: reviewOutcome.mode, now,
    hostAuthority: protectedHostBoundary(fixture.trust),
  });
  assert.equal(authenticated.verified, true, authenticated.error);
  return authenticated.initialAuthentication;
}

function persistAuthenticatedMaintainerReview(fixture, verification, head, reviewer, mode = 'host_subagent', receiptId = 'maintainer-remediation-1', now = Date.now()) {
  const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
  const body = readFileSync(taskPath, 'utf8');
  const history = parseFilesReviewHistory(`${body}${reviewHistory(head, reviewer, mode)}`);
  const reviewOutcome = history.events.filter(event => event.type === 'outcome').at(-1);
  assert.ok(reviewOutcome, 'fixture must contain a Maintainer outcome before signing it');
  const receipt = signedMaintainerReviewOutcome(fixture, verification, body, reviewOutcome, receiptId, now);
  const receiptPath = '.agenticloop/tmp/maintainer-review.json';
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  writeFileSync(join(fixture.root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  return receiptPath;
}

function persistSessionReportedMaintainerReview(fixture, head, {
  reviewerSession = 'session:maintainer-review-1',
  status = 'accepted',
  mode = 'host_subagent',
} = {}) {
  const reportPath = '.agenticloop/tmp/maintainer-review-session.json';
  const outcome = {
    status,
    mode,
    artifact: `commit:${head}`,
    findingIds: status === 'needs_revision' ? ['F-1'] : [],
    classification: status === 'needs_revision' ? 'implementation_changing' : null,
    roleId: 'maintainer',
    actorAccount: reviewerSession,
    sourceReference: 'review:1',
  };
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  writeFileSync(join(fixture.root, reportPath), `${JSON.stringify({ reviewerSession, outcome }, null, 2)}\n`);
  return reportPath;
}

async function prepareLegacyV3ReviewEntry(fixture, verification) {
  const prepared = await runCliInProcess([
    'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
  ], protectedOptions(fixture));
  assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
  const entryPath = join(fixture.root, JSON.parse(prepared.stdout).reviewEntryPath);
  const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
  assert.equal(entry.schemaVersion, 5);
  assert.equal(entry.maintainerOutcome, null);
  assert.equal(entry.initialAuthentication, null);
  delete entry.initialAuthentication;
  entry.schemaVersion = 3;
  const { digest, ...projection } = entry;
  entry.digest = `sha256:agenticloop.files-review-entry-receipt.v3:${canonicalSha256(projection)}`;
  writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
  return entryPath;
}

function setLegacyV3ReviewOutcome(entryPath, maintainerOutcome) {
  const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
  entry.maintainerOutcome = maintainerOutcome;
  const { digest, ...projection } = entry;
  entry.digest = `sha256:agenticloop.files-review-entry-receipt.v3:${canonicalSha256(projection)}`;
  writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
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

function persistVerifiedReturn(fixture, attempt, head) {
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
  return verification;
}

async function persistDurableCertifications(fixture, attempt, head, {
  reviewer = 'maintainer-1', audit = true, reviewMode = 'host_subagent', expectedReviewStatus = 0,
} = {}) {
  const verification = persistVerifiedReturn(fixture, attempt, head);
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

describe('production lifecycle adoption and review-attachment commands', () => {
  it('refuses commit adoption when the consumed grant is revoked without creating an adoption record', async () => {
    const attempt = await startedGrantAttempt('adopt-revoked-grant');
    const revoked = writeActivationRevocation(attempt.fixture.root, createActivationRevocation({
      grant: attempt.packet.activationBinding.grant,
      reason: 'operator withdrew adoption authority',
    }));
    assert.equal(revoked.ok, true, revoked.receipt.errors?.join('\n'));
    const beforeCarrier = readFileSync(join(attempt.fixture.root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8');
    const result = await runCliInProcess(adoptionArgs(attempt.fixture, {
      attemptId: attempt.attemptId, consumption: attempt.consumption,
    }, attempt.head), attempt.options);
    assertAdoptionRefusalWithoutMutation(
      attempt.fixture, attempt.head, beforeCarrier, result, 'activation.grant.revoked'
    );
  });

  it('refuses commit adoption for a terminal task without creating an adoption record', async () => {
    const attempt = await startedGrantAttempt('adopt-terminal-task');
    const taskPath = join(attempt.fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(taskPath, readFileSync(taskPath, 'utf8').replace('status: in-progress', 'status: closed'));
    const beforeCarrier = readFileSync(taskPath, 'utf8');
    const result = await runCliInProcess(adoptionArgs(attempt.fixture, {
      attemptId: attempt.attemptId, consumption: attempt.consumption,
    }, attempt.head), attempt.options);
    assertAdoptionRefusalWithoutMutation(
      attempt.fixture, attempt.head, beforeCarrier, result, 'task.lifecycle.not_dispatchable'
    );
  });

  it('refuses a terminal interleave during commit adoption without creating an authority record', async () => {
    const attempt = await startedGrantAttempt('adopt-terminal-interleave');
    const before = readFileSync(taskPath(attempt.fixture), 'utf8');
    let terminal;
    const result = await runCliInProcess(adoptionArgs(attempt.fixture, {
      attemptId: attempt.attemptId, consumption: attempt.consumption,
    }, attempt.head), {
      ...attempt.options,
      fsMutationOptions: {
        afterFinalValidation: () => {
          terminal = readFileSync(taskPath(attempt.fixture), 'utf8').replace(/^status: .*$/m, 'status: closed');
          writeFileSync(taskPath(attempt.fixture), terminal, 'utf8');
        },
      },
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const refusal = JSON.parse(result.stdout);
    assert.equal(refusal.evaluation.ok, false);
    assert.match(refusal.evaluation.reasons.join('\n'), /terminal|not dispatchable|closed/i);
    assert.notEqual(before, terminal);
    assert.equal(readFileSync(taskPath(attempt.fixture), 'utf8'), terminal);
    assert.equal(existsSync(join(attempt.fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${attempt.head}.json`)), false);
  });

  it('refuses a terminal interleave during carrier evidence persistence and preserves closed state', async () => {
    const attempt = await startedGrantAttempt('evidence-terminal-interleave');
    let terminal;
    const result = await runCliInProcess([
      'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
      '--expect-digest', carrierDigest(attempt.fixture), '--product-head', attempt.head,
      '--json', '--target', attempt.fixture.root,
    ], {
      ...attempt.options,
      fsMutationOptions: {
        afterFinalValidation: () => {
          terminal = readFileSync(taskPath(attempt.fixture), 'utf8').replace(/^status: .*$/m, 'status: closed');
          writeFileSync(taskPath(attempt.fixture), terminal, 'utf8');
        },
      },
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'task.lifecycle.not_dispatchable');
    assert.equal(readFileSync(taskPath(attempt.fixture), 'utf8'), terminal);
    assert.equal(existsSync(join(attempt.fixture.root, '.agenticloop', 'handoffs', 'carrier-mutations', 'T-001')), false);
  });

  it('refuses commit adoption for a retired attempt without creating an adoption record', async () => {
    const fixture = await createDispatchFixture(temp, 'adopt-retired-attempt');
    const attempt = consumeAttempt(fixture);
    const retired = {
      kind: 'agenticloop.execution-attempt-abandonment', schemaVersion: 2,
      backend: 'files', taskId: 'T-001', attemptId: attempt.attemptId,
      packetId: attempt.packet.packetId, reason: 'The attempt was explicitly retired.',
      disposition: 'tooling_failed', authority: 'maintainer:retire-adoption-attempt',
      productMutationOccurred: false, carrierMutationOccurred: true, abandonedAt: new Date().toISOString(),
    };
    const retiredPath = join(fixture.root, executionAttemptAbandonmentRelativePath(retired));
    mkdirSync(join(retiredPath, '..'), { recursive: true });
    writeFileSync(retiredPath, `${JSON.stringify(retired, null, 2)}\n`);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const beforeCarrier = readFileSync(join(fixture.root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8');
    const result = await runCliInProcess(adoptionArgs(fixture, attempt, head));
    assertAdoptionRefusalWithoutMutation(
      fixture, head, beforeCarrier, result, 'dispatch.packet.conserved'
    );
  });

  it('records non-authenticated claimed adoption and invalidates the exact certifications for rerun without consuming the attempt', async () => {
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
    assert.equal(payload.assurance, 'non_authenticated_claim');
    assert.deepEqual(payload.adoption.actor, { class: 'operator', id: 'operator-1' });
    assert.match(payload.adoption.reason, /operator claimed/);
    assert.equal(payload.preserved.attempt.id, attempt.attemptId);
    assert.deepEqual(payload.certification.invalidated, ['required_checks', 'review', 'audit', 'closeout']);
    assert.deepEqual(payload.certification.rerun, ['required_checks', 'review', 'audit']);
    const attempts = JSON.parse((await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture))).stdout).attempts;
    assert.equal(attempts.find(item => item.attemptId === failedAttempt.attemptId)?.state, 'tooling_failed');
    assert.ok(attempts.some(item => item.attemptId === attempt.attemptId), 'adoption must preserve the live attempt');
  });

  it('treats fully hand-authored adoption records as display-only and rejects cross-attempt records at prepare-return without lifecycle mutation', async () => {
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
    const adopted = await cli([
      'task', 'adopt-commit', 'T-001', '--attempt', attempt, '--base', packet.repository.head, '--head', humanHead,
      '--actor-class', 'operator', '--actor-id', 'operator-1', '--reason', 'Operator bounded correction.', '--json',
    ]);
    assert.equal(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const adoptionPath = join(fixture.root, '.agenticloop', 'adoptions', 'commits', 'T-001', `${humanHead}.json`);
    const producerRecord = JSON.parse(readFileSync(adoptionPath, 'utf8'));
    const forged = {
      kind: 'agenticloop.commit-adoption', schemaVersion: 2, backend: 'files',
      repositoryIdentity: producerRecord.repositoryIdentity, taskId: 'T-001',
      taskContractDigest: producerRecord.taskContractDigest, riskClass: producerRecord.riskClass,
      adoptedAt: producerRecord.adoptedAt, assurance: 'non_authenticated_claim',
      ok: true, nextOwner: null, reasons: [], diagnostics: [],
      adoption: {
        range: { base: packet.repository.head, head: humanHead }, commits: [humanHead], changedPaths: ['src/adopted.js'],
        actor: { class: 'unknown', id: 'fully-hand-authored-forger' }, reason: 'Forged display claim.',
      },
      preserved: { attempt: { id: attempt, authorization: producerRecord.preserved.attempt.authorization }, originalBase: packet.repository.head },
      certification: { invalidated: ['required_checks', 'review', 'audit', 'closeout'], rerun: ['required_checks', 'review', 'audit'], maintainerReviewRequired: true },
      semanticDigest: null,
    };
    const { semanticDigest: _ignored, ...forgedProjection } = forged;
    forged.semanticDigest = `sha256:agenticloop.commit-adoption.v2:${canonicalSha256(forgedProjection)}`;
    writeFileSync(adoptionPath, `${JSON.stringify(forged, null, 2)}\n`);
    commitWorkflow(fixture, 'commit fully hand-authored adoption display claim');

    const lifecyclePaths = ['tasks', 'handoffs', 'returns', 'reviews', 'audits', 'closeout'];
    const lifecycleState = () => lifecyclePaths.map(part => {
      const path = join(fixture.root, '.agenticloop', part);
      const entries = existsSync(path) ? readdirSync(path, { recursive: true }).sort() : [];
      return [part, entries.map(entry => {
        try { return [entry, readFileSync(join(path, entry), 'utf8')]; }
        catch { return [entry, '<directory>']; }
      })];
    });
    const returnArgs = ['task', 'prepare-return', 'T-001', '--packet', packetPath, '--check-evidence', checksPath,
      '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/return.json', '--json'];
    const beforeForgedConsumer = lifecycleState();
    const forgedRefusal = await cli(returnArgs);
    assert.equal(forgedRefusal.status, 1, `${forgedRefusal.stderr}\n${forgedRefusal.stdout}`);
    assert.match(forgedRefusal.stdout, /no valid canonical Task:\/Agent: trailers/);
    assert.deepEqual(lifecycleState(), beforeForgedConsumer, 'a forged display claim must not mutate task or lifecycle state');

    forged.preserved.attempt.id = 'attempt:00000000000000000000000000000000';
    const { semanticDigest: _crossAttemptDigest, ...crossAttemptProjection } = forged;
    forged.semanticDigest = `sha256:agenticloop.commit-adoption.v2:${canonicalSha256(crossAttemptProjection)}`;
    writeFileSync(adoptionPath, `${JSON.stringify(forged, null, 2)}\n`);
    commitWorkflow(fixture, 'commit cross-attempt adoption display claim');
    const beforeCrossAttemptConsumer = lifecycleState();
    const crossAttemptRefusal = await cli(returnArgs);
    assert.equal(crossAttemptRefusal.status, 1, `${crossAttemptRefusal.stderr}\n${crossAttemptRefusal.stdout}`);
    assert.match(crossAttemptRefusal.stdout, /does not preserve the original bounded attempt/);
    assert.deepEqual(lifecycleState(), beforeCrossAttemptConsumer, 'a cross-attempt display claim must not mutate task or lifecycle state');
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


  it('prepares before review, then atomically attaches the later authenticated outcome', async () => {
    const fixture = await createDispatchFixture(temp, 'review-prepare-then-attach');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const verification = persistVerifiedReturn(fixture, attempt, head);
    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
    const preparedEntry = JSON.parse(readFileSync(join(
      fixture.root, JSON.parse(prepared.stdout).reviewEntryPath
    ), 'utf8'));
    assert.equal(preparedEntry.maintainerOutcome, null);
    assert.equal(preparedEntry.initialAuthentication, null);

    const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf8')}${reviewHistory(head)}`);
    const receiptPath = persistAuthenticatedMaintainerReview(fixture, verification, head, 'maintainer-attach');
    const attached = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--maintainer-receipt', receiptPath, '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(attached.status, 0, `${attached.stderr}\n${attached.stdout}`);
    assert.equal(JSON.parse(attached.stdout).mutationDisposition, 'attached');
    const attempts = JSON.parse((await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture))).stdout).attempts;
    assert.equal(attempts.find(item => item.attemptId === attempt.attemptId)?.state, 'reviewed_needs_revision',
      'the authenticated needs_revision outcome keeps the bounded attempt eligible for an in-contract correction');
  });

  it('records an exact session-reported outcome only for a standard task without independent review', async () => {
    const fixture = await createDispatchFixture(temp, 'review-attach-session-reported');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const verification = persistVerifiedReturn(fixture, attempt, head);
    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
    const sessionReport = persistSessionReportedMaintainerReview(fixture, head);

    const attached = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--session-report', sessionReport, '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(attached.status, 0, `${attached.stderr}\n${attached.stdout}`);
    const result = JSON.parse(attached.stdout);
    assert.equal(result.assurance, 'session_reported');
    assert.equal(result.producerAuthenticated, false);
    const entry = JSON.parse(readFileSync(join(fixture.root, result.reviewEntryPath), 'utf8'));
    assert.equal(entry.schemaVersion, 6);
    assert.equal(entry.initialAuthentication, null);
    assert.equal(entry.maintainerOutcome.assurance, 'session_reported');
    assert.equal(entry.maintainerOutcome.producerAuthenticated, false);
    assert.equal(entry.maintainerOutcome.reviewerSession, 'session:maintainer-review-1');
    assert.equal(entry.maintainerOutcome.binding.taskContractDigest, taskContractDigest(readFileSync(taskPath(fixture), 'utf8')).digest);
    assert.equal(entry.maintainerOutcome.binding.candidate.head, head);
    assert.equal(entry.maintainerOutcome.binding.returnVerification.recordId, verification.recordId);
    assert.equal(entry.maintainerOutcome.history.digest, entry.reviewHistory.digest);
    assert.deepEqual(entry.maintainerOutcome.policy, { mode: 'standard', independentReviewRequired: false });
  });

  it('keeps session-reported review outcomes blocked for independent-review and hardened tasks', async () => {
    for (const scenario of [
      { name: 'independent', fixtureOptions: { independentReviewRequired: true }, expectedCode: 'review_prepare.independent_review_policy' },
      { name: 'hardened', fixtureOptions: {}, hardened: true, expectedCode: 'handoff.evidence.unauthenticated' },
    ]) {
      const fixture = await createDispatchFixture(temp, `review-attach-session-${scenario.name}`, scenario.fixtureOptions);
      const attempt = consumeAttempt(fixture);
      const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
      const verification = persistVerifiedReturn(fixture, attempt, head);
      const prepared = await runCliInProcess([
        'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
      ], protectedOptions(fixture));
      assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
      const sessionReport = persistSessionReportedMaintainerReview(fixture, head);
      if (scenario.hardened) {
        writeFileSync(join(fixture.root, 'agenticloop.json'), `${JSON.stringify({ activation: { mode: 'hardened' } })}\n`);
      }
      const taskBefore = readFileSync(taskPath(fixture), 'utf8');
      const entryPath = join(fixture.root, JSON.parse(prepared.stdout).reviewEntryPath);
      const entryBefore = readFileSync(entryPath, 'utf8');

      const attached = await runCliInProcess([
        'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
        '--session-report', sessionReport, '--json', '--target', fixture.root,
      ], protectedOptions(fixture));
      assert.equal(attached.status, 1, `${scenario.name}: ${attached.stderr}\n${attached.stdout}`);
      assert.equal(JSON.parse(attached.stdout).diagnostics[0].code, scenario.expectedCode);
      assert.equal(readFileSync(taskPath(fixture), 'utf8'), taskBefore);
      assert.equal(readFileSync(entryPath, 'utf8'), entryBefore);
    }
  });

  it('serializes a terminal contender during review preparation and preserves the terminal retry', async () => {
    const fixture = await createDispatchFixture(temp, 'review-prepare-terminal-interleave');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    persistVerifiedReturn(fixture, attempt, head);
    let contender;

    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], {
      ...protectedOptions(fixture),
      fsMutationOptions: {
        afterFinalVerification: () => {
          contender = terminalCarrierMutation(fixture, readFileSync(taskPath(fixture), 'utf8'), 'accepted');
        },
      },
    });

    assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
    assert.equal(contender.ok, false);
    assert.match(contender.errors[0], /lifecycle authority 'T-001' is currently locked/);
    const afterReview = readFileSync(taskPath(fixture), 'utf8');
    assert.equal(terminalCarrierMutation(fixture, afterReview, 'accepted').ok, true);
    assert.match(readFileSync(taskPath(fixture), 'utf8'), /^status: accepted$/m);
    assert.equal(existsSync(join(fixture.root, JSON.parse(prepared.stdout).reviewEntryPath)), true);
  });

  it('refuses review preparation when its in-lock lifecycle reader observes a terminal carrier', async () => {
    const fixture = await createDispatchFixture(temp, 'review-prepare-terminal-refusal');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    persistVerifiedReturn(fixture, attempt, head);
    let closed;

    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], {
      ...protectedOptions(fixture),
      fsMutationOptions: {
        afterFinalValidation: () => {
          closed = readFileSync(taskPath(fixture), 'utf8').replace(/^status: .*$/m, 'status: closed');
          writeFileSync(taskPath(fixture), closed, 'utf8');
        },
      },
    });

    assert.equal(prepared.status, 1, `${prepared.stderr}\n${prepared.stdout}`);
    assert.equal(JSON.parse(prepared.stdout).diagnostics[0].code, 'task.lifecycle.not_dispatchable');
    assert.equal(readFileSync(taskPath(fixture), 'utf8'), closed, 'review preparation must not revert terminal state');
  });

  it('serializes a terminal contender during outcome attachment and preserves the terminal retry', async () => {
    const fixture = await createDispatchFixture(temp, 'review-attach-terminal-interleave');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const verification = persistVerifiedReturn(fixture, attempt, head);
    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
    writeFileSync(taskPath(fixture), `${readFileSync(taskPath(fixture), 'utf8')}${reviewHistory(head)}`);
    const receiptPath = persistAuthenticatedMaintainerReview(fixture, verification, head, 'maintainer-attach-interleave');
    let contender;

    const attached = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--maintainer-receipt', receiptPath, '--json', '--target', fixture.root,
    ], {
      ...protectedOptions(fixture),
      fsMutationOptions: {
        afterFinalVerification: () => {
          contender = terminalCarrierMutation(fixture, readFileSync(taskPath(fixture), 'utf8'));
        },
      },
    });

    assert.equal(attached.status, 0, `${attached.stderr}\n${attached.stdout}`);
    assert.equal(contender.ok, false);
    assert.match(contender.errors[0], /lifecycle authority 'T-001' is currently locked/);
    const afterAttachment = readFileSync(taskPath(fixture), 'utf8');
    assert.equal(terminalCarrierMutation(fixture, afterAttachment).ok, true);
    assert.match(readFileSync(taskPath(fixture), 'utf8'), /^status: closed$/m);
    const entry = JSON.parse(readFileSync(join(fixture.root, JSON.parse(attached.stdout).reviewEntryPath), 'utf8'));
    assert.deepEqual(entry.maintainerOutcome, JSON.parse(readFileSync(join(fixture.root, receiptPath), 'utf8')));
  });

  it('records a terminal-task attachment as historical without reopening the carrier', async () => {
    const fixture = await createDispatchFixture(temp, 'review-attach-terminal-history');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const verification = persistVerifiedReturn(fixture, attempt, head);
    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
    const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf8')}${reviewHistory(head)}`.replace(/^status: .*$/m, 'status: closed'));
    const receiptPath = persistAuthenticatedMaintainerReview(fixture, verification, head, 'maintainer-terminal');

    const attached = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--maintainer-receipt', receiptPath, '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(attached.status, 0, `${attached.stderr}\n${attached.stdout}`);
    assert.equal(JSON.parse(attached.stdout).mutationDisposition, 'attached_historical');
    assert.equal(JSON.parse(attached.stdout).authorization, 'historical_recording');
  });

  it('atomically migrates a populated valid v3 review entry with a matching fresh receipt', async () => {
    const fixture = await createDispatchFixture(temp, 'review-attach-v3-migration');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const verification = persistVerifiedReturn(fixture, attempt, head);
    const entryPath = await prepareLegacyV3ReviewEntry(fixture, verification);
    const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf8')}${reviewHistory(head)}`);
    const recordedReceiptPath = persistAuthenticatedMaintainerReview(
      fixture, verification, head, 'maintainer-v3', 'host_subagent', 'legacy-v3-recorded'
    );
    const legacy = setLegacyV3ReviewOutcome(
      entryPath, JSON.parse(readFileSync(join(fixture.root, recordedReceiptPath), 'utf8'))
    );
    const receiptPath = persistAuthenticatedMaintainerReview(
      fixture, verification, head, 'maintainer-v3', 'host_subagent', 'legacy-v3-fresh'
    );

    const attached = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--maintainer-receipt', receiptPath, '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(attached.status, 0, `${attached.stderr}\n${attached.stdout}`);
    assert.equal(JSON.parse(attached.stdout).mutationDisposition, 'migrated_and_attached');
    const migrated = JSON.parse(readFileSync(entryPath, 'utf8'));
    assert.equal(migrated.schemaVersion, 5);
    assert.equal(migrated.taskId, legacy.taskId);
    assert.deepEqual(migrated.verifiedReturn, legacy.verifiedReturn);
    assert.equal(migrated.reviewHistory.eventCount, legacy.reviewHistory.eventCount + 1);
    assert.notEqual(migrated.reviewHistory.digest, legacy.reviewHistory.digest);
    assert.deepEqual(migrated.maintainerOutcome.binding, legacy.maintainerOutcome.binding);
    assert.notEqual(migrated.maintainerOutcome.receiptId, legacy.maintainerOutcome.receiptId);
    assert.ok(migrated.initialAuthentication);
  });

  it('preserves populated v3 entry bytes when fresh migration input is non-matching, stale, forged, or incomplete', async () => {
    const scenarios = [
      { name: 'non-matching', mutateEntry: entry => { entry.maintainerOutcome.binding.outcome.actorAccount = 'other-maintainer'; } },
      { name: 'stale', mutateReceipt: receipt => receipt, now: Date.now() - 900_001 },
      { name: 'forged', mutateReceipt: receipt => ({ ...receipt, authentication: { ...receipt.authentication, value: 'forged' } }) },
      { name: 'incomplete', mutateEntry: entry => { delete entry.candidateHead; } },
    ];
    for (const scenario of scenarios) {
      const fixture = await createDispatchFixture(temp, `review-attach-v3-${scenario.name}`);
      const attempt = consumeAttempt(fixture);
      const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
      const verification = persistVerifiedReturn(fixture, attempt, head);
      const entryPath = await prepareLegacyV3ReviewEntry(fixture, verification);
      const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
      writeFileSync(taskPath, `${readFileSync(taskPath, 'utf8')}${reviewHistory(head)}`);
      const recordedReceiptPath = persistAuthenticatedMaintainerReview(
        fixture, verification, head, `maintainer-v3-${scenario.name}`, 'host_subagent', `legacy-${scenario.name}-recorded`
      );
      setLegacyV3ReviewOutcome(entryPath, JSON.parse(readFileSync(join(fixture.root, recordedReceiptPath), 'utf8')));
      if (scenario.mutateEntry) {
        const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
        scenario.mutateEntry(entry);
        const { digest, ...projection } = entry;
        entry.digest = `sha256:agenticloop.files-review-entry-receipt.v3:${canonicalSha256(projection)}`;
        writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
      }
      const receiptPath = persistAuthenticatedMaintainerReview(
        fixture, verification, head, `maintainer-v3-${scenario.name}`, 'host_subagent',
        `maintainer-v3-${scenario.name}`, scenario.now ?? Date.now()
      );
      if (scenario.mutateReceipt) {
        const receipt = scenario.mutateReceipt(JSON.parse(readFileSync(join(fixture.root, receiptPath), 'utf8')));
        writeFileSync(join(fixture.root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
      }
      const before = readFileSync(entryPath, 'utf8');
      const result = await runCliInProcess([
        'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
        '--maintainer-receipt', receiptPath, '--json', '--target', fixture.root,
      ], protectedOptions(fixture));

      assert.equal(result.status, 1, `${scenario.name}: ${result.stderr}\n${result.stdout}`);
      const code = JSON.parse(result.stdout).diagnostics[0].code;
      assert.equal(code, ['non-matching', 'incomplete'].includes(scenario.name)
        ? 'review.entry.persistence_conflict' : 'handoff.evidence.unauthenticated');
      assert.equal(readFileSync(entryPath, 'utf8'), before, `${scenario.name} migration must preserve original entry bytes`);
    }
  });

  it('accepts an aged recorded outcome but refuses a stale new receipt submission', async () => {
    const fixture = await createDispatchFixture(temp, 'aged-recorded-maintainer-outcome');
    const attempt = consumeAttempt(fixture);
    const head = commit(fixture, 'src/adopted.js', undefined, { attributed: true });
    const verification = persistVerifiedReturn(fixture, attempt, head);
    const prepared = await runCliInProcess([
      'task', 'review-prepare', 'T-001', '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(prepared.status, 0, `${prepared.stderr}\n${prepared.stdout}`);
    const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    writeFileSync(taskPath, `${readFileSync(taskPath, 'utf8')}${reviewHistory(head)}`);

    const recordedNow = Date.now() - 900_001;
    const staleReceiptPath = persistAuthenticatedMaintainerReview(
      fixture, verification, head, 'maintainer-aged', 'host_subagent', 'maintainer-stale-new', recordedNow
    );
    const stale = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--maintainer-receipt', staleReceiptPath, '--json', '--target', fixture.root,
    ], protectedOptions(fixture));
    assert.equal(stale.status, 1, `${stale.stderr}\n${stale.stdout}`);
    assert.equal(JSON.parse(stale.stdout).diagnostics[0].code, 'handoff.evidence.unauthenticated');

    const staleReceipt = JSON.parse(readFileSync(join(fixture.root, staleReceiptPath), 'utf8'));
    const staleOutcome = parseFilesReviewHistory(readFileSync(taskPath, 'utf8')).events
      .filter(event => event.type === 'outcome').at(-1);
    const legacyBypass = verifyMaintainerReviewOutcomeReceipt(staleReceipt, {
      trustedAdapter: fixture.trust.adapter, target: fixture.root, role: 'maintainer',
      invocationReference: staleReceipt.invocation.reference, invocationMode: staleOutcome.mode,
      taskId: 'T-001', taskContractDigest: taskContractDigest(readFileSync(taskPath, 'utf8')).digest,
      returnVerification: verification, candidate: verification.finishCandidate,
      history: parseFilesReviewHistory(readFileSync(taskPath, 'utf8')), reviewOutcome: staleOutcome,
      receiptUse: 'durable_recorded', now: Date.now(),
    });
    assert.equal(legacyBypass.verified, false);
    assert.equal(legacyBypass.state, 'stale');

    const currentAtRecordTime = persistAuthenticatedMaintainerReview(
      fixture, verification, head, 'maintainer-aged', 'host_subagent', 'maintainer-recorded-aged', recordedNow
    );
    const attached = await runCliInProcess([
      'task', 'review-attach-outcome', 'T-001', '--return-verification', verification.recordId,
      '--maintainer-receipt', currentAtRecordTime, '--json', '--target', fixture.root,
    ], { ...protectedOptions(fixture), maintainerReviewNow: recordedNow });
    assert.equal(attached.status, 0, `${attached.stderr}\n${attached.stdout}`);
    const entryPath = join(fixture.root, JSON.parse(attached.stdout).reviewEntryPath);
    const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
    const recordedReceipt = JSON.parse(readFileSync(join(fixture.root, currentAtRecordTime), 'utf8'));
    assert.deepEqual(entry.maintainerOutcome, recordedReceipt);
    assert.deepEqual(entry.initialAuthentication, initialAuthentication(
      fixture, verification, readFileSync(taskPath, 'utf8'), staleOutcome, recordedReceipt, recordedNow
    ));
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

});
