/**
 * Independent protected-action differential matrix.
 *
 * Expected states come from protected evaluator inputs and decisions, never
 * from task-explain, its routing map, or its dependency index.  The dispatch
 * row uses the exact live candidate that `prepareRoleDispatch` supplies to
 * `evaluateDispatchEligibility`, then changes one canonical input at a time.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  evaluateDispatchEligibility,
  projectReadOnlyDispatchEligibility,
} from '../src/dispatch-eligibility.js';
import {
  evaluateReadOnlyPrepareReturnProjection,
  prepareRoleDispatch,
  validateDispatchPreparation,
} from '../src/dispatch-envelope.js';
import { createDispatchFixture } from './helpers/dispatch-fixture.js';
import { REFUSAL_CLASSES } from '../src/refusal-classes.js';
import { runCliInProcess } from './helpers/run-cli.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'task-explain-matrix-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function captureProtectedDispatchCandidate(fixture) {
  let candidate = null;
  const result = prepareRoleDispatch({
    ...fixture,
    parallelRequested: fixture.decomposition?.route === 'parallel',
  }, {
    ...fixture.options,
    onBeforeEligibilityEvaluation(value) { candidate = value; },
  });
  assert.equal(result.ok, true, result.validation?.errors?.join('\n'));
  assert.ok(candidate, 'prepareRoleDispatch must expose its exact protected evaluator input before evaluation');
  return candidate;
}

function cloneCandidate(candidate) {
  return {
    ...candidate,
    snapshot: { ...candidate.snapshot },
    readiness: structuredClone(candidate.readiness),
    repository: { ...candidate.repository },
    decomposition: structuredClone(candidate.decomposition),
    parallelScanInventory: structuredClone(candidate.parallelScanInventory),
    assignment: structuredClone(candidate.assignment),
    policy: { ...candidate.policy },
    returnAdapter: candidate.returnAdapter === null ? null : structuredClone(candidate.returnAdapter),
    cleanStateObservation: structuredClone(candidate.cleanStateObservation),
    inventoryRecheck: candidate.inventoryRecheck === null ? null : { ...candidate.inventoryRecheck },
    authority: { ...candidate.authority },
  };
}

/** Assert owners on evaluator-produced coded reasons without calling a production lookup as an oracle. */
function assertActualCodedReasonOwners(action, observedCodes) {
  for (const reason of action.reasons ?? []) {
    if (reason.policyCode === null || reason.policyCode === undefined) continue;
    assert.equal(reason.factOwner, REFUSAL_CLASSES[reason.policyCode]?.factOwner,
      `${action.id} emits catalog-owned reason ${reason.policyCode}`);
    observedCodes.add(reason.policyCode);
  }
}

describe('protected dispatch differential matrix', () => {
  it('perturbs every declared dispatch dimension through the protected evaluator and never projects it legal', async () => {
    const fixture = await createDispatchFixture(temp, 'all-dispatch-dimensions', {
      parallel: true,
      taskIds: ['T-001', 'T-002'],
    });
    const base = captureProtectedDispatchCandidate(fixture);
    const observedCodes = new Set();

    // These are deliberately literal contract dimensions, not explain metadata.
    // Every mutation changes evaluator input only; no decision ledger is forged.
    const mutations = {
      task_identity: value => { value.snapshot.taskId = 'T-002'; },
      lifecycle: value => { value.snapshot.body = value.snapshot.body.replace(/^status: .*$/m, 'status: closed'); },
      task_contract: value => { value.snapshot.body = 'not a task record'; },
      contract_baseline: value => { value.snapshot.trustedRecordErrors = ['broken contract history']; },
      required_checks: value => { value.snapshot.body = value.snapshot.body.replace('- [RC-1] command: `npm test`', '- malformed required check'); },
      activation: value => { value.activationEvidence = null; },
      activation_assurance: value => { value.policy = { mode: 'hardened', minimumActivation: 'host_signed' }; value.activationEvidence = { source: 'legacy_task_capture', capture: null }; },
      readiness: value => { value.readiness = null; },
      dependency_evidence: value => { value.readiness = { ...value.readiness, evidence: { ...value.readiness.evidence, dependencies: null } }; },
      decomposition: value => { value.decomposition = null; },
      work_unit_membership: value => { value.parallelScanInventory = { ...value.parallelScanInventory, members: value.parallelScanInventory.members.map(member => ({ ...member, digest: 'sha256:bad' })) }; },
      maintainer_attribution: value => { value.decomposition = { ...value.decomposition, authority: 'engineer' }; },
      task_eligibility: value => { value.decomposition = { ...value.decomposition, scan: { ...value.decomposition.scan, inventory: { ...value.decomposition.scan.inventory, members: [] } } }; },
      repository_identity: value => { value.repository = { ...value.repository, head: 'not-a-git-commit' }; },
      base_identity: value => { value.repository = { ...value.repository, baseTree: 'not-a-git-tree' }; },
      clean_state: value => { value.cleanStateObservation = null; },
      assignment: value => { value.assignment = null; },
      host_role_capability: value => { value.assignment = { ...value.assignment, hostRoleCapability: null }; },
      return_capability: value => { value.returnAdapter = null; value.policy = { mode: 'hardened', minimumActivation: 'host_signed', minimumReturn: 'host_receipt' }; },
    };

    const expectedDimensions = [
      'task_identity', 'lifecycle', 'task_contract', 'contract_baseline', 'required_checks',
      'activation', 'activation_assurance', 'readiness', 'dependency_evidence', 'decomposition',
      'work_unit_membership', 'maintainer_attribution', 'task_eligibility', 'repository_identity',
      'base_identity', 'clean_state', 'assignment', 'host_role_capability', 'return_capability',
    ];
    assert.deepEqual(Object.keys(mutations), expectedDimensions);

    for (const dimension of expectedDimensions) {
      const candidate = cloneCandidate(base);
      mutations[dimension](candidate);
      const protectedDecision = evaluateDispatchEligibility(candidate);
      const observed = protectedDecision.dimensions[dimension];
      assert.notEqual(observed?.state, 'satisfied', `${dimension} mutation did not reach its protected dimension`);
      const explainOwnerOutcome = projectReadOnlyDispatchEligibility(protectedDecision);
      assert.notEqual(explainOwnerOutcome.verdict, 'legal', `${dimension} failure/unavailability projected legal`);
      assert.ok(explainOwnerOutcome.reasons.some(reason => reason.fact === `dispatch.${dimension}`),
        `${dimension} must remain visible in the owner projection`);
      assertActualCodedReasonOwners(explainOwnerOutcome, observedCodes);
    }
    assert.ok(observedCodes.size > 0, 'the differential matrix must exercise actual coded evaluator reasons');
  });
});

describe('post-dispatch protected-command differential matrix', () => {
  it('uses protected command outcomes for role start, return, review, and audit without promoting unavailable or failed facts', async () => {
    const fixture = await createDispatchFixture(temp, 'post-dispatch-actions');
    const observedCodes = new Set();
    const run = args => runCliInProcess([...args, '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    const explain = async action => {
      const result = await run(['task', 'explain', 'T-001', '--action', action, '--json']);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).actions[0];
    };

    // Exact historical mismatch: a genuine packet succeeds only with the
    // protected caller's authenticated inventories/resolver; permissive
    // read-only defaults cannot authenticate its capability inventory.
    const fixturePrepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(fixturePrepared.ok, true, fixturePrepared.validation?.errors?.join('\n'));
    assert.equal(validateDispatchPreparation(fixturePrepared.packet, fixture.options).ok, true);
    assert.equal(validateDispatchPreparation(fixturePrepared.packet).ok, false,
      'read-only defaults must not impersonate the protected caller capability inventory');

    // role_start / current authenticated dispatch packet: unavailable and pass.
    const missingStart = await run(['task', 'role-start', 'T-001', '--json']);
    assert.notEqual(missingStart.status, 0, 'the protected role-start command must reject an absent packet');
    assert.equal((await explain('role_start')).verdict, 'unknown');
    const prepared = await run([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', '.agenticloop/tmp/matrix-packet.json', '--json',
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const started = await run(['task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/matrix-packet.json', '--json']);
    assert.equal(started.status, 0, started.stderr);

    // A supplied packet without the protected caller's trusted validation
    // options, selected check aggregate, and exact candidate context is never a
    // read-only legality proof. The protected command rejects the same supplied
    // packet here because its required checks are absent; the projection remains
    // honestly unknown rather than validating with permissive defaults.
    const suppliedPacket = JSON.parse(readFileSync(join(fixture.root, '.agenticloop/tmp/matrix-packet.json'), 'utf8'));
    const suppliedProjection = evaluateReadOnlyPrepareReturnProjection({
      target: fixture.root, taskId: 'T-001', projectConfig: { task_file_template: '.agenticloop/tasks/{taskId}.md' },
      packet: suppliedPacket,
    });
    assert.equal(suppliedProjection.verdict, 'unknown');
    assert.notEqual(suppliedProjection.verdict, 'legal');
    assertActualCodedReasonOwners(suppliedProjection, observedCodes);

    // prepare_return: packet/check are explicit protected inputs, while the
    // consumed attempt, carrier, and candidate are independently read facts.
    const missingReturn = await run([
      'task', 'prepare-return', 'T-001', '--packet', '.agenticloop/tmp/matrix-packet.json',
      '--check-evidence', '.agenticloop/tmp/matrix-checks.json', '--outcome', 'implementation_ready_for_review',
      '--output', '.agenticloop/tmp/matrix-return.json', '--json',
    ]);
    assert.notEqual(missingReturn.status, 0, 'the protected return command must reject missing check evidence');
    const returnProjection = await explain('prepare_return');
    assert.equal(returnProjection.verdict, 'unknown');
    assert.notEqual(returnProjection.verdict, 'legal');
    assert.ok(returnProjection.facts.some(fact => fact.fact === 'return.dispatch_attempt' && fact.observedState === 'current'));
    assert.ok(returnProjection.reasons.some(reason => reason.fact === 'dispatch_packet.current' && reason.state === 'unknown'));
    assert.ok(returnProjection.reasons.some(reason => reason.fact === 'required_check_evidence.current' && reason.state === 'unknown'));
    assertActualCodedReasonOwners(returnProjection, observedCodes);

    const mismatchedProjection = evaluateReadOnlyPrepareReturnProjection({
      target: fixture.root, taskId: 'T-001', projectConfig: { task_file_template: '.agenticloop/tasks/{taskId}.md' },
      packet: { ...suppliedPacket, digest: 'sha256:agenticloop.role-preparation.v8:forged' },
    });
    assert.equal(mismatchedProjection.verdict, 'unknown');
    assert.notEqual(mismatchedProjection.verdict, 'legal');
    assertActualCodedReasonOwners(mismatchedProjection, observedCodes);

    // review: missing verified return is unavailable; a malformed durable return
    // record is an observed protected failure at both command and explain paths.
    const missingReview = await run(['task', 'review-prepare', 'T-001', '--json']);
    assert.notEqual(missingReview.status, 0, 'the protected review command must reject a missing verified return');
    assert.equal((await explain('review')).verdict, 'unknown');
    const returnDirectory = join(fixture.root, '.agenticloop', 'returns', 'verifications');
    mkdirSync(returnDirectory, { recursive: true });
    writeFileSync(join(returnDirectory, 'malformed.json'), '{not-json\n');
    const malformedReview = await run(['task', 'review-prepare', 'T-001', '--json']);
    assert.notEqual(malformedReview.status, 0, 'the protected review command must reject malformed stored return evidence');
    const malformedProjection = await explain('review');
    assert.equal(malformedProjection.verdict, 'illegal');
    assert.ok(malformedProjection.reasons.some(reason => reason.policyCode === 'handoff.evidence.malformed'));
    assertActualCodedReasonOwners(malformedProjection, observedCodes);

    // audit: enabled mode has unavailable candidate/coverage; the configured
    // opt-out is the only applicable not_applicable outcome and matches the
    // protected audit gate rather than a task-id stand-in.
    const enabledAudit = await run(['audit', 'gate', 'work-unit:matrix', '--json']);
    assert.notEqual(enabledAudit.status, 0, 'enabled audit gate must require candidate and covered tasks');
    assert.equal((await explain('audit')).verdict, 'unknown');
    const projectPath = join(fixture.root, '.agenticloop', 'project.md');
    writeFileSync(projectPath, readFileSync(projectPath, 'utf8').replace('work_unit_audit: enabled', 'work_unit_audit: disabled'));
    const disabledAudit = await run(['audit', 'gate', 'work-unit:matrix', '--json']);
    assert.equal(disabledAudit.status, 0, disabledAudit.stderr);
    const disabledProjection = await explain('audit');
    assert.equal(disabledProjection.verdict, 'legal');
    assert.equal(disabledProjection.applicability, 'not_applicable');
    assertActualCodedReasonOwners(disabledProjection, observedCodes);
    assert.ok(observedCodes.has('handoff.evidence.malformed'), 'the matrix must check its actual coded review reason owner');
  });
});
