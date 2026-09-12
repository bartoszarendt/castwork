import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { COMMAND_REGISTRY, isReceiptRevalidationArgv } from '../src/cli-registry.js';
import { createDispatchFixture } from './helpers/dispatch-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { loadProjectMap } from '../src/project-map.js';
import {
  TASK_EXPLAIN_ACTION_IDS,
  TASK_EXPLAIN_ACTION_EVALUATORS,
} from '../src/task-explain.js';
import { DISPATCH_ELIGIBILITY_DIMENSIONS } from '../src/dispatch-eligibility.js';
import { evaluateReadOnlyDispatchProjection } from '../src/handoff-preflight.js';
import {
  evaluateReadOnlyRoleStartProjection,
  evaluateReadOnlyReviewProjection,
} from '../src/handoff-binding.js';
import { evaluateReadOnlyPrepareReturnProjection } from '../src/dispatch-envelope.js';
import { evaluateReadOnlyAuditProjection } from '../src/audit-record.js';
import { REFUSAL_CLASSES } from '../src/refusal-classes.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'task-explain-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function snapshot(root, relative = '') {
  const path = join(root, relative);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (child === '.git') return [];
    if (entry.isDirectory()) return snapshot(root, child);
    const state = statSync(join(root, child));
    return [{ path: child, mtimeMs: state.mtimeMs, digest: createHash('sha256').update(readFileSync(join(root, child))).digest('hex') }];
  });
}

function runExplain(fixture, action) {
  return runCliInProcess(['task', 'explain', 'T-001', '--action', action, '--json', '--target', fixture.root], {
    operatorTrustRoot: fixture.operatorTrustRoot,
    operatorActivationRoot: fixture.operatorActivationRoot,
    hostAuthority: protectedHostBoundary(fixture.trust),
  });
}

function dispatchContext(fixture) {
  return {
    target: fixture.root,
    taskId: 'T-001',
    backend: 'files',
    projectConfig: loadProjectMap(fixture.root).config,
    io: {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    },
  };
}

function canonicalAction(fixture, action) {
  const context = dispatchContext(fixture);
  if (action === 'prepare_dispatch') return evaluateReadOnlyDispatchProjection(context);
  if (action === 'role_start') return evaluateReadOnlyRoleStartProjection({
    ...context, taskContractDigest: null, dispatchCarrierDigest: null,
  });
  if (action === 'prepare_return') return evaluateReadOnlyPrepareReturnProjection(context);
  if (action === 'review') return evaluateReadOnlyReviewProjection({
    ...context, taskContractDigest: null,
  });
  return evaluateReadOnlyAuditProjection(fixture.root, {
    taskId: 'T-001', projectConfig: context.projectConfig,
  });
}

function assertHumanExplanationParity(human, json) {
  const taskFacts = human.split('\n').find(line => line.startsWith('facts: '));
  assert.ok(taskFacts, 'human output must render task facts');
  assert.deepEqual(JSON.parse(taskFacts.slice('facts: '.length)), json.task);
  for (const action of json.actions) {
    assert.ok(human.includes(`action: ${action.id}`));
    assert.ok(human.includes(`  verdict: ${action.verdict}`));
    assert.ok(human.includes(`  applicability: ${action.applicability}`));
    for (const fact of action.facts ?? []) {
      assert.ok(human.includes(`  fact: ${fact.fact}; observed_state=${fact.observedState}; fact_owner=${fact.factOwner}; policy_code=${fact.policyCode ?? 'none'}`));
    }
    for (const reason of action.reasons ?? []) {
      assert.ok(human.includes(`  reason: ${reason.fact}; state=${reason.state}; observed_state=${reason.observedState}; fact_owner=${reason.factOwner}; policy_code=${reason.policyCode ?? 'none'}${reason.detail ? `; detail=${reason.detail}` : ''}`));
    }
    for (const prerequisite of action.prerequisites ?? []) {
      assert.ok(human.includes(`  prerequisite: ${prerequisite.fact}; condition=${prerequisite.condition}`));
    }
  }
}

/** Check the owner carried by an actual evaluator result, not a presentation helper. */
function assertActualCodedReasonOwners(action) {
  for (const reason of action.reasons ?? []) {
    if (reason.policyCode === null || reason.policyCode === undefined) continue;
    assert.equal(
      reason.factOwner,
      REFUSAL_CLASSES[reason.policyCode]?.factOwner,
      `${action.id} emits catalog-owned reason ${reason.policyCode}`,
    );
  }
}

describe('task explain canonical action projections', () => {
  it('is an explicitly read-only registered task command', () => {
    const spec = COMMAND_REGISTRY.task.subcommands.explain;
    assert.equal(spec.receiptRevalidation, 'read-only');
    assert.deepEqual(spec.positionals, [{ name: 'id', required: true }]);
    assert.equal(isReceiptRevalidationArgv(['task', 'explain', 'T-001']), true);
  });

  it('has a named canonical owner for every rendered action', () => {
    assert.deepEqual(Object.keys(TASK_EXPLAIN_ACTION_EVALUATORS), TASK_EXPLAIN_ACTION_IDS);
    assert.deepEqual(Object.values(TASK_EXPLAIN_ACTION_EVALUATORS).map(item => item.evaluator), [
      'evaluateReadOnlyDispatchProjection', 'evaluateReadOnlyRoleStartProjection',
      'evaluateReadOnlyPrepareReturnProjection', 'evaluateReadOnlyReviewProjection',
      'evaluateReadOnlyAuditProjection',
    ]);
  });

  it('renders the direct canonical result for every action without changing target state', async () => {
    const fixture = await createDispatchFixture(temp, 'all-actions');
    const beforeState = snapshot(fixture.root);
    for (const action of TASK_EXPLAIN_ACTION_IDS) {
      const direct = canonicalAction(fixture, action);
      const result = await runExplain(fixture, action);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).actions[0], direct, action);
    }
    assert.deepEqual(snapshot(fixture.root), beforeState);
  });

  it('faithfully renders every JSON action fact, verdict, reason, and prerequisite for humans', async () => {
    const fixture = await createDispatchFixture(temp, 'human-json-parity');
    const jsonRun = await runCliInProcess(['task', 'explain', 'T-001', '--json', '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    const humanRun = await runCliInProcess(['task', 'explain', 'T-001', '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(jsonRun.status, 0, jsonRun.stderr);
    assert.equal(humanRun.status, 0, humanRun.stderr);
    assertHumanExplanationParity(humanRun.stdout, JSON.parse(jsonRun.stdout));
  });

  it('keeps every read-only incomplete action unknown and names its protected prerequisite', async () => {
    const fixture = await createDispatchFixture(temp, 'incomplete-actions');
    for (const action of ['role_start', 'prepare_return', 'review', 'audit']) {
      const result = await runExplain(fixture, action);
      assert.equal(result.status, 0, result.stderr);
      const projection = JSON.parse(result.stdout).actions[0];
      assert.equal(projection.verdict, 'unknown', action);
      assert.ok(projection.prerequisites.length > 0, action);
      assert.ok(projection.reasons.some(reason => reason.state === 'unknown'), action);
    }
  });

  it('keeps the canonical unbound assignment unavailable rather than interpreting it as applicable or legal', async () => {
    const fixture = await createDispatchFixture(temp, 'unbound-assignment');
    const direct = canonicalAction(fixture, 'prepare_dispatch');
    assert.equal(direct.verdict, 'unknown');
    const assignment = direct.reasons.find(reason => reason.fact === 'dispatch.assignment');
    assert.deepEqual(assignment && { state: assignment.state, observedState: assignment.observedState }, {
      state: 'unknown', observedState: 'not_applicable',
    });
    const result = await runExplain(fixture, 'prepare_dispatch');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).actions[0], direct);
  });

  it('differentially preserves a protected dispatch failure and never promotes it to legal', async () => {
    const fixture = await createDispatchFixture(temp, 'dirty-dispatch');
    writeFileSync(join(fixture.root, 'src', 'dirty.js'), 'export const dirty = true;\n');
    const direct = canonicalAction(fixture, 'prepare_dispatch');
    assert.equal(direct.verdict, 'illegal');
    assert.ok(direct.reasons.some(reason => reason.fact === 'dispatch.clean_state' && reason.state === 'failed'));
    const result = await runExplain(fixture, 'prepare_dispatch');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).actions[0], direct);
  });

  it('uses the configured audit opt-out and canonical scope instead of treating a task id as a work unit', async () => {
    const fixture = await createDispatchFixture(temp, 'disabled-audit');
    const projectPath = join(fixture.root, '.agenticloop', 'project.md');
    writeFileSync(projectPath, readFileSync(projectPath, 'utf8').replace(
      'work_unit_audit: enabled', 'work_unit_audit: disabled'
    ));
    const direct = canonicalAction(fixture, 'audit');
    assert.equal(direct.verdict, 'legal');
    assert.equal(direct.applicability, 'not_applicable');
    const result = await runExplain(fixture, 'audit');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).actions[0], direct);
  });

  it('uses the protected review return-store path so malformed stored evidence stays observable', async () => {
    const fixture = await createDispatchFixture(temp, 'malformed-review-store');
    const prepared = await runCliInProcess([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', '.agenticloop/tmp/packet.json', '--json', '--target', fixture.root,
    ], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(prepared.status, 0, prepared.stderr);
    const started = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json', '--json', '--target', fixture.root,
    ], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(started.status, 0, started.stderr);
    const returnDir = join(fixture.root, '.agenticloop', 'returns', 'verifications');
    mkdirSync(returnDir, { recursive: true });
    writeFileSync(join(returnDir, 'malformed.json'), '{not-json\n');

    const result = await runExplain(fixture, 'review');
    assert.equal(result.status, 0, result.stderr);
    const projection = JSON.parse(result.stdout).actions[0];
    assert.equal(projection.verdict, 'illegal');
    const coded = projection.reasons.find(reason => reason.policyCode === 'handoff.evidence.malformed');
    assert.equal(coded?.factOwner, REFUSAL_CLASSES['handoff.evidence.malformed'].factOwner);
    assertActualCodedReasonOwners(projection);
  });

  it('enumerates every material dispatch fact from the canonical decision ledger, not explain metadata', async () => {
    const fixture = await createDispatchFixture(temp, 'material-facts');
    const direct = canonicalAction(fixture, 'prepare_dispatch');
    const observedFacts = new Set(direct.facts.map(fact => fact.fact.slice('dispatch.'.length)));
    const expectedFacts = [
      'task_identity', 'lifecycle', 'task_contract', 'contract_baseline', 'required_checks',
      'activation', 'activation_assurance', 'readiness', 'dependency_evidence', 'decomposition',
      'work_unit_membership', 'maintainer_attribution', 'task_eligibility', 'repository_identity',
      'base_identity', 'clean_state', 'assignment', 'host_role_capability', 'return_capability',
    ];
    assert.deepEqual(expectedFacts, DISPATCH_ELIGIBILITY_DIMENSIONS);
    assert.deepEqual([...observedFacts].sort(), expectedFacts.sort());
  });
});
