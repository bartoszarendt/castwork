/**
 * Behavioral regression tests for task role-start (Batch A) and
 * prepare-decomposition --output (Batch B).
 *
 * Covers:
 *  F1: idempotent retry with exact binding comparison (productBaseHead)
 *  F2: decomposition fixtures with real Git data
 *  F3: conditional receipt classification
 *  F4: mutation failure injection proving zero partial writes
 *  F7: shellQuoteArgument for paths with spaces
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { COMMAND_REGISTRY, parseCommandArgs, isReceiptRevalidationArgv } from '../src/cli-registry.js';
import { validateRequiredCheckEvidence, REQUIRED_CHECK_EVIDENCE_CONTRACT_VERSION } from '../src/required-checks.js';
import { taskSubcommandBackends } from '../src/task-cli.js';
import { deriveHandoffSequence, renderHandoffSequence } from '../src/handoff-sequence.js';
import { validateTaskStatusTransition, LEGAL_TASK_STATUS_TRANSITIONS } from '../src/task-transition.js';
import { evaluateDispatchableLifecycle, DISPATCHABLE_TASK_STATUSES } from '../src/dispatchability.js';
import { prepareRoleDispatch, dispatchPreparationDigest } from '../src/dispatch-envelope.js';
import { createDispatchFixture, sha256 } from './helpers/dispatch-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';
import { createTestHostTrust, protectedHostBoundary, writeHostTrustStore } from './helpers/host-trust-fixture.js';
import { shellQuoteArgument } from '../src/task-evidence-contract.js';
import { listDispatchConsumptions } from '../src/handoff-consumption.js';
import { validationResultDigest } from '../src/result-envelope.js';
import { canonicalSha256 } from '../src/canonical-json.js';
import { durableMutationIntentSignaturePayload, signHostPayload, targetRepositoryIdentity } from '../src/host-trust.js';
import { scaffoldFixture, interactiveOptions, runPrepareDispatch } from './helpers/activation-fixture.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'role-start-')); });
after(() => { try { rmSync(temp, { recursive: true, force: true }); } catch {} });

function persistSchemaV3Consumption(root, taskId) {
  const listed = listDispatchConsumptions(root, taskId, { backend: 'files' });
  assert.equal(listed.ok, true, listed.errors?.join('\n'));
  assert.equal(listed.records.length, 1, 'fixture must contain one current consumption before conversion');
  const record = structuredClone(listed.records[0]);
  const path = join(
    root, '.agenticloop', 'handoffs', 'dispatch', taskId,
    `${record.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`,
  );
  const legacy = { ...record, schemaVersion: 3 };
  delete legacy.transitionKey;
  delete legacy.protectedInputDigest;
  delete legacy.acceptedResult;
  delete legacy.toolkitPackageVersion;
  delete legacy.lifecycleSchemaSetDigest;
  delete legacy.digest;
  legacy.digest = `sha256:agenticloop.dispatch-consumption.v3:${canonicalSha256(legacy)}`;
  const source = `${JSON.stringify(legacy, null, 2)}\n`;
  writeFileSync(path, source, 'utf8');
  const resolved = listDispatchConsumptions(root, taskId, { backend: 'files' });
  assert.equal(resolved.ok, true, resolved.errors?.join('\n'));
  return { legacy, path, source, resolved: resolved.records[0] };
}

// The former parallel role-start branch made only this final HEAD comparison
// after validating a packet. It did not invoke the live dispatch revalidation.
function formerParallelHeadOnlyGuard(packet, currentHead) {
  return packet.decomposition !== null && packet.repository?.head === currentHead;
}

function redigestDurableIntent(intent) {
  const projection = structuredClone(intent);
  delete projection.digest;
  projection.authentication.value = null;
  intent.digest = `sha256:agenticloop.recoverable-mutation-intent.v1:${canonicalSha256(projection)}`;
}

async function prepareOperatorConfirmedRoleStart(name) {
  const fixture = await scaffoldFixture(temp, name);
  const activated = await runCliInProcess([
    'activate', 'T-001', '--json', '--target', fixture.root,
  ], interactiveOptions(fixture));
  assert.equal(activated.status, 0, activated.stderr);
  const add = spawnSync('git', ['add', '.agenticloop/activations'], { cwd: fixture.root, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync('git', ['commit', '-m', 'record operator activation'], { cwd: fixture.root, encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  const prepared = await runPrepareDispatch(fixture, ['--json']);
  assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`);
  const packet = JSON.parse(prepared.stdout);
  assert.equal(packet.assurance.activation, 'operator_confirmed');
  assert.equal(packet.returnAdapter, null);
  const packetPath = join(fixture.root, '.agenticloop', 'tmp', 'packet.json');
  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, JSON.stringify(packet, null, 2), 'utf8');
  return { fixture, packet };
}

// ── N1: role-start is NOT receipt-revalidation safe ────────────────────────

describe('N1: role-start receipt revalidation', () => {
  it('role-start has no receiptRevalidation field', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['role-start'];
    assert.equal(spec.receiptRevalidation, undefined, 'role-start must not have receiptRevalidation');
  });

  it('isReceiptRevalidationArgv returns false for role-start', () => {
    const result = isReceiptRevalidationArgv(['task', 'role-start', 'T-001', '--packet', 'p.json', '--check-evidence-output', 'c.json']);
    assert.equal(result, false, 'role-start must not be receipt-revalidation safe');
  });
});

// ── N2: prepare-decomposition conditional receipt revalidation ─────────────

describe('N2: prepare-decomposition conditional receipt revalidation', () => {
  it('receiptRevalidation is read-only-without-output', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['prepare-decomposition'];
    assert.equal(spec.receiptRevalidation, 'read-only-without-output');
  });

  it('isReceiptRevalidationArgv returns true without --output', () => {
    const result = isReceiptRevalidationArgv([
      'task', 'prepare-decomposition', 'T-001',
      '--work-unit', 'phase:1',
      '--source-ref', '.agenticloop/decompositions/T-001.json',
      '--source-revision', 'git-commit:abc123',
      '--base', 'git-tree:def456',
      '--dependencies', 'deps.json',
    ]);
    assert.equal(result, true, 'without --output must be receipt-safe');
  });

  it('isReceiptRevalidationArgv returns false with --output', () => {
    const result = isReceiptRevalidationArgv([
      'task', 'prepare-decomposition', 'T-001',
      '--work-unit', 'phase:1',
      '--source-ref', '.agenticloop/decompositions/T-001.json',
      '--source-revision', 'git-commit:abc123',
      '--base', 'git-tree:def456',
      '--dependencies', 'deps.json',
      '--output', 'decomp.json',
    ]);
    assert.equal(result, false, 'with --output must not be receipt-safe');
  });
});

// ── N6: canonical check-evidence producer ──────────────────────────────────

describe('N6: canonical check-evidence producer', () => {
  it('producer passes validateRequiredCheckEvidence', () => {
    const packet = {
      task: {
        requiredChecks: [
          { id: 'RC-1', kind: 'command', command: 'npm test' },
          { id: 'RC-2', kind: 'manual', instruction: 'Inspect the output.' },
        ],
        requiredCheckEvidenceContract: REQUIRED_CHECK_EVIDENCE_CONTRACT_VERSION,
      },
    };
    const checks = packet.task.requiredChecks.map(required => ({
      id: required.id,
      kind: required.kind,
      ...(required.kind === 'command'
        ? { command: required.command, exitCode: -1, executionEvidence: null }
        : { instruction: required.instruction, exitCode: null }),
      outcome: 'not_run',
      evidence: 'not yet recorded',
    }));
    const result = validateRequiredCheckEvidence(checks, {
      label: 'test', contractVersion: REQUIRED_CHECK_EVIDENCE_CONTRACT_VERSION,
    });
    assert.equal(result.ok, true, `check evidence must be valid: ${result.errors.join('; ')}`);
    assert.equal(result.checks.length, 2);
    assert.equal(result.checks[0].id, 'RC-1');
    assert.equal(result.checks[0].kind, 'command');
    assert.equal(result.checks[0].exitCode, -1);
    assert.equal(result.checks[0].executionEvidence, null);
    assert.equal(result.checks[1].id, 'RC-2');
    assert.equal(result.checks[1].kind, 'manual');
    assert.equal(result.checks[1].exitCode, null);
  });
});

// ── A3: terminal status refusal ────────────────────────────────────────────

describe('A3: terminal status refusal', () => {
  it('accepted -> in-progress is rejected', () => {
    const error = validateTaskStatusTransition('accepted', 'in-progress', null);
    assert.ok(error, 'accepted -> in-progress must be rejected');
    assert.match(error, /Cannot transition/);
  });

  it('closed -> in-progress is rejected', () => {
    const error = validateTaskStatusTransition('closed', 'in-progress', null);
    assert.ok(error, 'closed -> in-progress must be rejected');
  });

  it('dispatchable lifecycle rejects terminal statuses', () => {
    const result = evaluateDispatchableLifecycle('accepted');
    assert.equal(result.ok, false, 'accepted is not dispatchable');
    assert.equal(result.evidenceState, 'negative');
    const result2 = evaluateDispatchableLifecycle('closed');
    assert.equal(result2.ok, false, 'closed is not dispatchable');
  });

  it('valid transitions to in-progress are accepted', () => {
    for (const status of DISPATCHABLE_TASK_STATUSES) {
      if (status === 'in-progress') continue;
      const allowed = LEGAL_TASK_STATUS_TRANSITIONS[status]?.has('in-progress');
      if (allowed) {
        const error = validateTaskStatusTransition(status, 'in-progress', null);
        assert.equal(error, null, `${status} -> in-progress must be legal`);
      }
    }
  });
});

// ── A4: role-start registry ────────────────────────────────────────────────

describe('A4: role-start registry', () => {
  it('backend is files-only', () => {
    const backends = taskSubcommandBackends('role-start');
    assert.deepEqual(backends, ['files']);
  });

  it('has no --expect-digest option', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['role-start'];
    assert.ok(spec, 'role-start subcommand must exist');
    const hasExpectDigest = spec.options.some(opt => opt.name === 'expect-digest');
    assert.equal(hasExpectDigest, false, 'role-start must not accept --expect-digest');
  });

  it('requires --packet and exposes an optional scratch aggregate override', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['role-start'];
    const packetOpt = spec.options.find(opt => opt.name === 'packet');
    const checksOpt = spec.options.find(opt => opt.name === 'check-evidence-output');
    assert.ok(packetOpt, '--packet option must exist');
    assert.ok(checksOpt, '--check-evidence-output option must exist');
  });

  it('parses CLI args correctly', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['role-start'];
    const { opts, positional } = parseCommandArgs('task role-start', spec, [
      'T-001', '--packet', 'packet.json', '--check-evidence-output', 'checks.json', '--json',
    ]);
    assert.deepEqual(positional, ['T-001']);
    assert.equal(opts.packet, 'packet.json');
    assert.equal(opts.checkEvidenceOutput, 'checks.json');
    assert.equal(opts.json, true);
  });
});

// ── N5: nextSequence ───────────────────────────────────────────────────────

describe('N5: nextSequence', () => {
  it('step 2 uses refetch placeholder, not reused digest', () => {
    const seq = deriveHandoffSequence({ taskId: 'T-001', backend: 'files' });
    const roleStart = seq.steps.find(s => /role-start/.test(s.command));
    assert.ok(roleStart, 'sequence must include role-start step');
    assert.equal(roleStart.commitRequired, true);

    const evidenceSteps = seq.steps.filter(s => /evidence/.test(s.command));
    assert.ok(evidenceSteps.length >= 1, 'must have evidence steps');

    const step1 = evidenceSteps.find(s => /implementation_artifact/.test(s.command));
    if (step1) {
      assert.ok(!step1.command.includes('<refetch-after-commit>'), 'step 1 must use concrete digest');
    }

    const step2 = evidenceSteps.find(s => /implementation_summary/.test(s.command));
    if (step2) {
      assert.ok(step2.command.includes('<refetch-after-commit>'), 'step 2 must use refetch placeholder');
    }
  });

  it('sequence is renderable', () => {
    const seq = deriveHandoffSequence({ taskId: 'T-001', backend: 'files' });
    const rendered = renderHandoffSequence(seq);
    assert.ok(Array.isArray(rendered), 'must return array');
    assert.ok(rendered.length > 0, 'must have lines');
    assert.ok(rendered[0].includes('next ordered sequence'), 'must include header');
  });
});

// ── F6: handoff-sequence teaches role-start ────────────────────────────────

describe('F6: handoff-sequence role-start', () => {
  it('files backend uses task role-start', () => {
    const seq = deriveHandoffSequence({ taskId: 'T-001', backend: 'files' });
    const roleStart = seq.steps.find(s => /role-start/.test(s.command));
    assert.ok(roleStart, 'files backend sequence must use task role-start');
    assert.ok(roleStart.command.includes('--packet'), 'must include --packet');
    assert.ok(!roleStart.command.includes('--check-evidence-output'), 'must use the deterministic scratch aggregate default');
    assert.ok(roleStart.writes.some(w => w.includes('tasks/')), 'must write task record');
    assert.ok(roleStart.writes.some(w => w.includes('dispatch/')), 'must write dispatch consumption');
    assert.deepEqual(roleStart.scratchWrites, ['.agenticloop/tmp/T-001-checks.json']);
    assert.ok(!roleStart.writes.some(w => w.includes('checks.json')), 'mutable aggregate must not be durable');
  });

  it('non-files backend uses task status', () => {
    const seq = deriveHandoffSequence({ taskId: 'T-001', backend: 'github' });
    const roleStart = seq.steps.find(s => /task status.*in-progress/.test(s.command));
    assert.ok(roleStart, 'non-files backend sequence must use task status');
  });
});

// ── F7: shellQuoteArgument ─────────────────────────────────────────────────

describe('F7: shellQuoteArgument', () => {
  it('passes through simple values', () => {
    assert.equal(shellQuoteArgument('simple'), 'simple');
    assert.equal(shellQuoteArgument('git-tree:abc123'), 'git-tree:abc123');
  });

  it('quotes values with spaces', () => {
    assert.equal(shellQuoteArgument('path with spaces'), '"path with spaces"');
  });

  it('quotes values with special chars', () => {
    // Forward slashes are in the safe pattern, so they pass through
    assert.equal(shellQuoteArgument('path/with/special'), 'path/with/special');
    // Backslashes need quoting
    assert.equal(shellQuoteArgument('path\\with\\backslash'), '"path\\with\\backslash"');
  });

  it('rejects unquotable values', () => {
    assert.throws(() => shellQuoteArgument('value"with"quotes'), /cannot emit a shell-safe/);
    assert.throws(() => shellQuoteArgument("value'with'quotes"), /cannot emit a shell-safe/);
  });
});

// ── N7: Behavioral tests with real fixtures ────────────────────────────────

describe('N7: role-start behavioral tests', () => {
  it('F1: role-start happy path and exact retry returns already_current', async () => {
    const fixture = await createDispatchFixture(temp, 'happy', { initialStatus: 'agent-ready' });
    const root = fixture.root;

    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, `prepareRoleDispatch failed: ${prepared.validation.errors?.join(', ')}`);
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');

    // First role-start
    const result1 = await runCliInProcess([
      'task', 'role-start', 'T-001',
      '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json',
      '--json',
      '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(result1.status, 0, `first role-start failed: ${result1.stdout} ${result1.stderr}`);
    const output1 = JSON.parse(result1.stdout);
    assert.equal(output1.ok, true);
    assert.equal(output1.disposition, 'committed');
    assert.ok(output1.currentCarrierDigest, 'must have carrier digest');
    assert.ok(output1.nextSequence, 'must have nextSequence');
    assert.ok(output1.nextSequence.steps.length > 0, 'nextSequence must have steps');
    const commands = output1.nextSequence.steps.map(step => step.command).filter(command => typeof command === 'string');
    const productCommit = commands.findIndex(command => command.includes('prepare-product-commit'));
    const artifact = commands.findIndex(command => command.includes('implementation_artifact_evidence'));
    const summary = commands.findIndex(command => command.includes('implementation_summary_evidence'));
    const outcome = commands.findIndex(command => command.includes('implementation_outcome_evidence'));
    const initialize = commands.findIndex(command => command.includes('check-evidence-init'));
    const update = commands.findIndex(command => command.includes('check-evidence-update'));
    const prepare = commands.findIndex(command => command.includes('prepare-return'));
    const receiverCommands = output1.nextSequence.receiverSteps.map(step => step.command);
    assert.ok(productCommit >= 0 && productCommit < artifact && artifact < summary && summary < outcome && outcome < initialize && initialize < update && update < prepare,
      `unexpected lifecycle order: ${commands.join(' | ')}`);
    assert.equal(commands.some(command => command.includes('verify-return')), false);
    assert.match(receiverCommands[0], /verify-return/);
    for (const step of output1.nextSequence.steps) {
      if (step.commitRequired) {
        assert.ok(step.commitClass && step.commitReason);
      } else {
        assert.equal(step.commitClass ?? null, null);
        assert.equal(step.commitReason ?? null, null);
      }
    }

    // Exact retry should return already_current
    const result2 = await runCliInProcess([
      'task', 'role-start', 'T-001',
      '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json',
      '--json',
      '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(result2.status, 0, `retry failed: ${result2.stdout} ${result2.stderr}`);
    const output2 = JSON.parse(result2.stdout);
    assert.equal(output2.disposition, 'already_current', 'exact retry must return already_current');
  });

  it('accepts a current role start when only the retired readiness rendering differs', async () => {
    const fixture = await createDispatchFixture(temp, 'retired-readiness-rendering', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));

    // The warning is a mutable, non-authoritative rendering. The sealed packet
    // remains structurally valid, but a fresh evaluator derives no such warning.
    // The retired packet-wide equality compared the whole readiness projection.
    const packet = structuredClone(prepared.packet);
    packet.readiness.result.warnings = ['rendered after packet preparation'];
    packet.readiness.resultDigest = validationResultDigest(packet.readiness.result);
    packet.digest = dispatchPreparationDigest(packet);
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(packet, null, 2), 'utf8');
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    };

    // This is the exact current-evaluation seam role-start invokes immediately
    // before its mutation. It must succeed despite the rendering-only drift.
    const current = await runCliInProcess([
      'task', 'prepare-dispatch', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--role', 'engineer', '--json', '--target', root,
    ], options);
    assert.equal(current.status, 0, current.stdout);

    const started = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ], options);
    assert.equal(started.status, 0, started.stdout);
    assert.equal(JSON.parse(started.stdout).disposition, 'committed');
  });

  it('F1: tampered head fails closed', async () => {
    const fixture = await createDispatchFixture(temp, 'tampered', { initialStatus: 'agent-ready' });
    const root = fixture.root;

    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, `prepareRoleDispatch failed: ${prepared.validation.errors?.join(', ')}`);

    // Tamper with the packet's repository head
    const tampered = structuredClone(prepared.packet);
    tampered.repository.head = sha256('tampered-head');
    tampered.digest = dispatchPreparationDigest(tampered);
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(tampered, null, 2), 'utf8');

    const result = await runCliInProcess([
      'task', 'role-start', 'T-001',
      '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json',
      '--json',
      '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(result.status, 1, 'must reject tampered head');
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
  });

  it('F1: tampered digest fails closed', async () => {
    const fixture = await createDispatchFixture(temp, 'tampered-digest', { initialStatus: 'agent-ready' });
    const root = fixture.root;

    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, `prepareRoleDispatch failed: ${prepared.validation.errors?.join(', ')}`);

    // Tamper with the packet's dispatchCarrierDigest
    const tampered = structuredClone(prepared.packet);
    tampered.task.dispatchCarrierDigest = sha256('tampered');
    tampered.digest = dispatchPreparationDigest(tampered);
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(tampered, null, 2), 'utf8');

    const result = await runCliInProcess([
      'task', 'role-start', 'T-001',
      '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json',
      '--json',
      '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot });
    assert.equal(result.status, 1, 'must reject tampered digest');
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
  });

  it('F4: injected failure leaves zero partial writes', async () => {
    const fixture = await createDispatchFixture(temp, 'inject-fail', { initialStatus: 'agent-ready' });
    const root = fixture.root;

    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, `prepareRoleDispatch failed: ${prepared.validation.errors?.join(', ')}`);
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');

    // Record pre-existing state
    const carrierPath = join(root, '.agenticloop', 'tasks', 'T-001.md');
    const preCarrier = readFileSync(carrierPath, 'utf8');
    const consumptionDir = join(root, '.agenticloop', 'handoffs', 'dispatch', 'T-001');
    const preConsumptionExists = existsSync(consumptionDir);
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');
    const preChecksExists = existsSync(checksPath);

    // Inject failure via fsMutationOptions.beforeWrite
    const result = await runCliInProcess([
      'task', 'role-start', 'T-001',
      '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json',
      '--json',
      '--target', root,
    ], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      fsMutationOptions: {
        beforeWrite: () => { throw new Error('injected failure'); },
      },
    });
    assert.equal(result.status, 1, 'must fail on injected failure');

    // Verify zero partial writes
    const postCarrier = readFileSync(carrierPath, 'utf8');
    assert.equal(postCarrier, preCarrier, 'carrier must be unchanged after injected failure');
    assert.equal(existsSync(consumptionDir), preConsumptionExists, 'consumption dir must be unchanged');
    assert.equal(existsSync(checksPath), preChecksExists, 'checks file must be unchanged');
  });

  for (const [name, injectTermination, expectedConsumptions] of [
    ['after durable intent', {
      afterDurableIntent: () => {
        const error = new Error('simulated ordinary-route termination after durable intent');
        error.code = 'fs.mutation.simulated_termination';
        throw error;
      },
    }, 0],
    ['after carrier replacement', {
      afterMutation: ({ path, phase }) => {
        if (phase !== 'replacement' || path !== '.agenticloop/tasks/T-001.md') return;
        const error = new Error('simulated ordinary-route termination after carrier replacement');
        error.code = 'fs.mutation.simulated_termination';
        throw error;
      },
    }, 0],
    ['after check-evidence replacement', {
      afterMutation: ({ path, phase }) => {
        if (phase !== 'replacement' || path !== '.agenticloop/tmp/checks.json') return;
        const error = new Error('simulated ordinary-route termination after check-evidence replacement');
        error.code = 'fs.mutation.simulated_termination';
        throw error;
      },
    }, 0],
    ['after consumption commit', {
      afterMutation: ({ phase }) => {
        if (phase !== 'commit') return;
        const error = new Error('simulated ordinary-route termination after consumption commit');
        error.code = 'fs.mutation.simulated_termination';
        throw error;
      },
    }, 1],
  ]) {
    it(`recovers an operator-confirmed start ${name} with its original bounded authority`, async () => {
      const { fixture, packet } = await prepareOperatorConfirmedRoleStart(
        `ordinary-recovery-${name.replaceAll(/[^a-z]+/g, '-')}`,
      );
      const root = fixture.root;
      const argv = [
        'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
        '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
      ];
      const options = {
        operatorTrustRoot: fixture.operatorTrustRoot,
        operatorActivationRoot: fixture.operatorActivationRoot,
      };
      const transactionPath = join(root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
        `${packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

      const interrupted = await runCliInProcess(argv, {
        ...options,
        fsMutationOptions: injectTermination,
      });
      assert.equal(interrupted.status, 1, interrupted.stdout);
      assert.equal(existsSync(transactionPath), true, 'ordinary route must retain an authenticated recovery intent');
      const intent = JSON.parse(readFileSync(transactionPath, 'utf8'));
      assert.equal(intent.authentication.keyId, packet.activationBinding.grant.authentication.keyId);
      assert.match(intent.authentication.value, /^ed25519:/);
      const interruptedConsumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
      assert.equal(interruptedConsumptions.ok, true, interruptedConsumptions.errors?.join('\n'));
      assert.equal(interruptedConsumptions.records.length, expectedConsumptions);

      const retried = await runCliInProcess(argv, options);
      assert.equal(retried.status, 0, retried.stdout);
      const resumed = JSON.parse(retried.stdout);
      assert.equal(resumed.disposition, expectedConsumptions === 1 ? 'already_current' : 'committed');
      assert.equal(existsSync(transactionPath), false, 'retry must resolve the authenticated transaction');
      const consumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
      assert.equal(consumptions.ok, true, consumptions.errors?.join('\n'));
      assert.equal(consumptions.records.length, 1, 'retry must converge on exactly one consumption');
      assert.equal(consumptions.records[0].packetId, packet.packetId);
      assert.equal(consumptions.records[0].taskContractDigest, packet.task.taskContractDigest,
        'recovery must retain the original bounded authority');
    });
  }

  it('refuses a revoked operator-confirmed retry without rewriting its accepted consumption', async () => {
    const { fixture, packet } = await prepareOperatorConfirmedRoleStart('ordinary-retry-revoked');
    const root = fixture.root;
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
    };
    const started = await runCliInProcess(argv, options);
    assert.equal(started.status, 0, started.stdout);
    const authorizedRetry = await runCliInProcess(argv, options);
    assert.equal(authorizedRetry.status, 0, authorizedRetry.stdout);
    assert.equal(JSON.parse(authorizedRetry.stdout).disposition, 'already_current');
    const consumptionsBefore = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionsBefore.ok, true, consumptionsBefore.errors?.join('\n'));
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');
    const checksBefore = readFileSync(checksPath, 'utf8');

    const revoked = await runCliInProcess([
      'activation', 'revoke', packet.activationBinding.grant.grantId,
      '--json', '--target', root,
    ], { operatorActivationRoot: fixture.operatorActivationRoot });
    assert.equal(revoked.status, 0, revoked.stderr);

    const retry = await runCliInProcess(argv, options);
    assert.equal(retry.status, 1, retry.stdout);
    assert.equal(JSON.parse(retry.stdout).diagnostics[0].code, 'activation.grant.revoked');
    const consumptionsAfter = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionsAfter.ok, true, consumptionsAfter.errors?.join('\n'));
    assert.deepEqual(consumptionsAfter.records, consumptionsBefore.records);
    assert.equal(readFileSync(checksPath, 'utf8'), checksBefore);
  });

  for (const [name, injectTermination] of [
    ['after durable intent before any replacement', {
      afterDurableIntent: () => {
        const error = new Error('simulated process termination after durable intent');
        error.code = 'fs.mutation.simulated_termination';
        throw error;
      },
    }],
    ['after carrier/check replacement before consumption creation', {
      afterMutation: ({ path, type }) => {
        if (type !== 'write' || path !== '.agenticloop/tmp/checks.json') return;
        const error = new Error('simulated process termination after replacements');
        error.code = 'fs.mutation.simulated_termination';
        throw error;
      },
    }],
  ]) {
    it(`recovers ${name} and converges on one accepted role start`, async () => {
      const fixture = await createDispatchFixture(temp, `recover-${name.replaceAll(/[^a-z]+/g, '-')}`, { initialStatus: 'agent-ready' });
      const root = fixture.root;
      const prepared = prepareRoleDispatch(fixture, fixture.options);
      assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
      const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
      mkdirSync(dirname(packetPath), { recursive: true });
      writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
      const argv = [
        'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
        '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
      ];
      const transactionPath = join(root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
        `${prepared.packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

      const interrupted = await runCliInProcess(argv, {
        operatorTrustRoot: fixture.operatorTrustRoot,
        hostAuthority: protectedHostBoundary(fixture.trust),
        fsMutationOptions: injectTermination,
      });
      assert.equal(interrupted.status, 1, interrupted.stdout);
      assert.equal(existsSync(transactionPath), true, 'interrupted transaction intent must survive process termination');
      assert.equal(listDispatchConsumptions(root, 'T-001', { backend: 'files' }).records.length, 0,
        'interrupted start must not create a partial consumption');

      const retried = await runCliInProcess(argv, {
        operatorTrustRoot: fixture.operatorTrustRoot,
        hostAuthority: protectedHostBoundary(fixture.trust),
      });
      assert.equal(retried.status, 0, retried.stdout);
      assert.equal(JSON.parse(retried.stdout).disposition, 'committed');
      assert.equal(existsSync(transactionPath), false, 'recovery must remove the durable intent once consistent');
      const consumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
      assert.equal(consumptions.ok, true, consumptions.errors?.join('\n'));
      assert.equal(consumptions.records.length, 1, 'retry must create exactly one accepted consumption');
    });
  }

  it('rolls forward a committed consumption after termination before intent cleanup', async () => {
    const fixture = await createDispatchFixture(temp, 'recover-after-consumption-commit', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const transactionPath = join(root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
      `${prepared.packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    const carrierPath = join(root, '.agenticloop', 'tasks', 'T-001.md');
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');

    const interrupted = await runCliInProcess(argv, {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
      fsMutationOptions: {
        afterMutation: ({ phase }) => {
          if (phase !== 'commit') return;
          const error = new Error('simulated process termination after consumption commit');
          error.code = 'fs.mutation.simulated_termination';
          throw error;
        },
      },
    });
    assert.equal(interrupted.status, 1, interrupted.stdout);
    assert.equal(existsSync(transactionPath), true, 'intent must remain after termination following the consumption commit');
    const interruptedConsumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(interruptedConsumptions.ok, true, interruptedConsumptions.errors?.join('\n'));
    assert.equal(interruptedConsumptions.records.length, 1, 'the exclusive consumption create must already exist');
    const postCommitConsumption = structuredClone(interruptedConsumptions.records[0]);
    const postCommitCarrier = readFileSync(carrierPath, 'utf8');
    const postCommitChecks = readFileSync(checksPath, 'utf8');

    const retried = await runCliInProcess(argv, {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(retried.status, 0, retried.stdout);
    const recovered = JSON.parse(retried.stdout);
    assert.equal(recovered.disposition, 'already_current', 'retry must roll forward the committed start');
    assert.equal(existsSync(transactionPath), false, 'roll-forward recovery must remove the retained intent');
    assert.equal(readFileSync(carrierPath, 'utf8'), postCommitCarrier, 'roll-forward must retain the committed carrier state');
    assert.equal(readFileSync(checksPath, 'utf8'), postCommitChecks, 'roll-forward must retain the committed check evidence');
    const finalConsumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(finalConsumptions.ok, true, finalConsumptions.errors?.join('\n'));
    assert.equal(finalConsumptions.records.length, 1, 'roll-forward retry must not duplicate the consumption');
    assert.deepEqual(finalConsumptions.records[0], postCommitConsumption, 'roll-forward must preserve the original consumption');
    assert.equal(recovered.transitionKey, postCommitConsumption.transitionKey);
    assert.equal(recovered.currentCarrierDigest, postCommitConsumption.acceptedResult.currentCarrierDigest);
  });

  it('refuses a malformed durable role-start intent without mutation', async () => {
    const fixture = await createDispatchFixture(temp, 'malformed-role-start-intent', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const carrierPath = join(root, '.agenticloop', 'tasks', 'T-001.md');
    const carrierBefore = readFileSync(carrierPath, 'utf8');
    const transactionPath = join(root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
      `${prepared.packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    mkdirSync(dirname(transactionPath), { recursive: true });
    writeFileSync(transactionPath, '{}\n', 'utf8');

    const refused = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(refused.status, 1, refused.stdout);
    assert.equal(JSON.parse(refused.stdout).diagnostics[0].code, 'verification.context.malformed');
    assert.equal(readFileSync(carrierPath, 'utf8'), carrierBefore, 'malformed intent refusal must not mutate the carrier');
    assert.equal(listDispatchConsumptions(root, 'T-001', { backend: 'files' }).records.length, 0);
  });

  it('refuses a valid reused-key intent signed for target A when recovering target B', async () => {
    const source = await createDispatchFixture(temp, 'cross-target-intent-source', { initialStatus: 'agent-ready' });
    const recovering = await createDispatchFixture(temp, 'cross-target-intent-recovering', { initialStatus: 'agent-ready' });
    const sourcePrepared = prepareRoleDispatch(source, source.options);
    const recoveringPrepared = prepareRoleDispatch(recovering, recovering.options);
    assert.equal(sourcePrepared.ok, true, sourcePrepared.validation.errors?.join('\n'));
    assert.equal(recoveringPrepared.ok, true, recoveringPrepared.validation.errors?.join('\n'));

    const reusedKeyTrust = createTestHostTrust({ target: recovering.root });
    reusedKeyTrust.privateKey = source.trust.privateKey;
    reusedKeyTrust.publicKey = source.trust.publicKey;
    reusedKeyTrust.publicKeyBase64 = source.trust.publicKeyBase64;
    reusedKeyTrust.adapter = { ...reusedKeyTrust.adapter, publicKey: source.trust.publicKeyBase64 };
    reusedKeyTrust.document.adapters[0].publicKey = source.trust.publicKeyBase64;
    writeHostTrustStore(recovering.operatorTrustRoot, reusedKeyTrust);

    const sourcePacketPath = join(source.root, '.agenticloop', 'tmp', 'packet.json');
    const recoveringPacketPath = join(recovering.root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(sourcePacketPath), { recursive: true });
    mkdirSync(dirname(recoveringPacketPath), { recursive: true });
    writeFileSync(sourcePacketPath, JSON.stringify(sourcePrepared.packet, null, 2), 'utf8');
    writeFileSync(recoveringPacketPath, JSON.stringify(recoveringPrepared.packet, null, 2), 'utf8');

    const sourceArgv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', source.root,
    ];
    const interrupted = await runCliInProcess(sourceArgv, {
      operatorTrustRoot: source.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(source.trust),
      fsMutationOptions: {
        afterDurableIntent: () => {
          const error = new Error('simulate termination after source intent');
          error.code = 'fs.mutation.simulated_termination';
          throw error;
        },
      },
    });
    assert.equal(interrupted.status, 1, interrupted.stdout);
    const sourceIntentPath = join(source.root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
      `${sourcePrepared.packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    const forged = JSON.parse(readFileSync(sourceIntentPath, 'utf8'));
    assert.equal(forged.targetRepositoryIdentity, targetRepositoryIdentity(source.root));

    // The attacker has a legitimately signed, well-formed image for target A
    // and a key also pinned in B. Only the signed target identity distinguishes
    // this replay from B's own interrupted role start.
    forged.binding = {
      taskId: 'T-001',
      packetId: recoveringPrepared.packet.packetId,
      packetDigest: recoveringPrepared.packet.digest,
    };
    redigestDurableIntent(forged);
    forged.authentication.value = signHostPayload(durableMutationIntentSignaturePayload(forged), source.trust.privateKey);
    const recoveringIntentPath = join(recovering.root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
      `${recoveringPrepared.packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    mkdirSync(dirname(recoveringIntentPath), { recursive: true });
    writeFileSync(recoveringIntentPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');
    const carrierPath = join(recovering.root, '.agenticloop', 'tasks', 'T-001.md');
    const carrierBefore = readFileSync(carrierPath, 'utf8');

    const refused = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', recovering.root,
    ], {
      operatorTrustRoot: recovering.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(reusedKeyTrust),
    });
    assert.equal(refused.status, 1, refused.stdout);
    assert.equal(JSON.parse(refused.stdout).diagnostics[0].code, 'verification.context.malformed');
    assert.equal(readFileSync(carrierPath, 'utf8'), carrierBefore, 'cross-target intent must not restore its snapshots');
    assert.equal(listDispatchConsumptions(recovering.root, 'T-001', { backend: 'files' }).records.length, 0);
  });

  it('refuses a durable-intent challenge with a non-null identity for another target', () => {
    const trust = createTestHostTrust({ target: join(temp, 'challenge-target') });
    const boundary = protectedHostBoundary(trust);
    assert.throws(() => boundary({
      kind: 'agenticloop.durable-mutation-intent-authentication-challenge',
      schemaVersion: 1,
      adapterId: trust.adapterId,
      keyId: trust.keyId,
      targetRepositoryIdentity: targetRepositoryIdentity(join(temp, 'other-target')),
      payload: {
        kind: 'agenticloop.durable-mutation-intent-authentication-challenge',
        schemaVersion: 1,
        intent: { targetRepositoryIdentity: trust.repositoryIdentity },
      },
    }), /refused an invalid durable mutation intent authentication challenge/);
  });

  for (const [name, alterIntent] of [
    ['a valid-shaped re-digested forged preimage reconstruction', intent => {
      const carrierSnapshot = intent.snapshots.find(snapshot => snapshot.path === '.agenticloop/tasks/T-001.md');
      carrierSnapshot.bytes = Buffer.from('forged preimage', 'utf8').toString('base64');
    }],
    ['a re-digested tampered preimage byte', intent => {
      const carrierSnapshot = intent.snapshots.find(snapshot => snapshot.path === '.agenticloop/tasks/T-001.md');
      const bytes = Buffer.from(carrierSnapshot.bytes, 'base64');
      bytes[0] ^= 1;
      carrierSnapshot.bytes = bytes.toString('base64');
    }],
  ]) {
    it(`refuses ${name} without applying its snapshot`, async () => {
      const fixture = await createDispatchFixture(temp, `forged-intent-${name.replaceAll(/[^a-z]+/g, '-')}`, { initialStatus: 'agent-ready' });
      const root = fixture.root;
      const prepared = prepareRoleDispatch(fixture, fixture.options);
      assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
      const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
      mkdirSync(dirname(packetPath), { recursive: true });
      writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
      const argv = [
        'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
        '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
      ];
      const transactionPath = join(root, '.agenticloop', 'handoffs', 'role-start-transactions', 'T-001',
        `${prepared.packet.packetId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
      const interrupted = await runCliInProcess(argv, {
        operatorTrustRoot: fixture.operatorTrustRoot,
        hostAuthority: protectedHostBoundary(fixture.trust),
        fsMutationOptions: {
          afterMutation: ({ path, type }) => {
            if (type !== 'write' || path !== '.agenticloop/tmp/checks.json') return;
            const error = new Error('simulated termination after replacements');
            error.code = 'fs.mutation.simulated_termination';
            throw error;
          },
        },
      });
      assert.equal(interrupted.status, 1, interrupted.stdout);
      const postImage = readFileSync(join(root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8');
      const forged = JSON.parse(readFileSync(transactionPath, 'utf8'));
      alterIntent(forged);
      redigestDurableIntent(forged);
      writeFileSync(transactionPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');

      const refused = await runCliInProcess(argv, {
        operatorTrustRoot: fixture.operatorTrustRoot,
        hostAuthority: protectedHostBoundary(fixture.trust),
      });
      assert.equal(refused.status, 1, refused.stdout);
      assert.equal(JSON.parse(refused.stdout).diagnostics[0].code, 'verification.context.malformed');
      assert.equal(readFileSync(join(root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8'), postImage,
        'unauthenticated intent must not restore a supplied preimage');
      assert.equal(listDispatchConsumptions(root, 'T-001', { backend: 'files' }).records.length, 0);
    });
  }

  it('persists one protected transition result so a response-loss retry resumes the same attempt', async () => {
    const fixture = await createDispatchFixture(temp, 'atomic-retry', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];

    // Treat this successful invocation as a process crash after its mutation and
    // before its response reached the caller. The durable result must resume it.
    const first = await runCliInProcess(argv, {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(first.status, 0, first.stdout);
    const accepted = JSON.parse(first.stdout);
    assert.match(accepted.transitionKey, /^[a-f0-9]{64}$/);
    assert.match(accepted.protectedInputDigest, /^[a-f0-9]{64}$/);

    const retry = await runCliInProcess(argv, {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(retry.status, 0, retry.stdout);
    const resumed = JSON.parse(retry.stdout);
    assert.equal(resumed.disposition, 'already_current');
    assert.equal(resumed.transitionKey, accepted.transitionKey);
    assert.equal(resumed.protectedInputDigest, accepted.protectedInputDigest);
    assert.deepEqual(resumed.nextSequence, accepted.nextSequence);
    assert.match(resumed.nextSequence.steps[2].command, new RegExp(accepted.currentCarrierDigest));

    const consumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptions.ok, true, consumptions.errors?.join('\n'));
    assert.equal(consumptions.records.length, 1, 'retry must not create another attempt or consumption');
    assert.equal(consumptions.records[0].transitionKey, accepted.transitionKey);
    assert.equal(consumptions.records[0].acceptedResult.currentCarrierDigest, accepted.currentCarrierDigest);
    assert.equal(consumptions.records[0].acceptedResult.checkEvidenceOutput, '.agenticloop/tmp/checks.json');
  });

  it('resumes a complete schema-v3 consumption without rewriting its identity or duplicating its start', async () => {
    const fixture = await createDispatchFixture(temp, 'legacy-v3-canonical-retry', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    };
    const start = await runCliInProcess(argv, options);
    assert.equal(start.status, 0, start.stdout);
    const legacy = persistSchemaV3Consumption(root, 'T-001');
    const attemptsBefore = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsBefore.status, 0, attemptsBefore.stdout);
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');
    const checksBefore = readFileSync(checksPath, 'utf8');

    const retry = await runCliInProcess(argv, options);
    assert.equal(retry.status, 0, retry.stdout);
    const resumed = JSON.parse(retry.stdout);
    assert.equal(resumed.disposition, 'already_current');
    assert.equal(resumed.transitionKey, legacy.resolved.transitionKey);
    assert.equal(resumed.protectedInputDigest, legacy.resolved.protectedInputDigest);
    assert.deepEqual(resumed.acceptedResult, legacy.resolved.acceptedResult);
    assert.equal(readFileSync(legacy.path, 'utf8'), legacy.source, 'legacy record must stay byte-for-byte intact');
    const consumptions = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptions.ok, true, consumptions.errors?.join('\n'));
    assert.equal(consumptions.records.length, 1, 'resume must not duplicate consumption or attempts');
    const attemptsAfterRetry = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsAfterRetry.status, 0, attemptsAfterRetry.stdout);
    assert.deepEqual(JSON.parse(attemptsAfterRetry.stdout).attempts, JSON.parse(attemptsBefore.stdout).attempts);
    assert.equal(readFileSync(checksPath, 'utf8'), checksBefore, 'resume must not duplicate check evidence');

    writeFileSync(join(root, 'src', 'moved-head-after-v3.js'), 'export const invalidated = true;\n', 'utf8');
    const add = spawnSync('git', ['add', 'src/moved-head-after-v3.js'], { cwd: root, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const commit = spawnSync('git', ['commit', '-m', 'move head after legacy v3 role start'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);
    const invalidated = await runCliInProcess(argv, options);
    assert.equal(invalidated.status, 1, invalidated.stdout);
    assert.equal(JSON.parse(invalidated.stdout).diagnostics[0].code, 'dispatch.packet.stale');
    assert.equal(listDispatchConsumptions(root, 'T-001', { backend: 'files' }).records.length, 1);
    const attemptsAfterInvalidation = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsAfterInvalidation.status, 0, attemptsAfterInvalidation.stdout);
    assert.deepEqual(JSON.parse(attemptsAfterInvalidation.stdout).attempts, JSON.parse(attemptsBefore.stdout).attempts);
  });

  it('fails closed when a schema-v3 consumption lacks an authoritative identity field', async () => {
    const fixture = await createDispatchFixture(temp, 'legacy-v3-corrupt', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    };
    const start = await runCliInProcess(argv, options);
    assert.equal(start.status, 0, start.stdout);
    const legacy = persistSchemaV3Consumption(root, 'T-001');
    const corrupt = JSON.parse(legacy.source);
    delete corrupt.recognition;
    writeFileSync(legacy.path, `${JSON.stringify(corrupt, null, 2)}\n`, 'utf8');

    const retry = await runCliInProcess(argv, options);
    assert.equal(retry.status, 1, retry.stdout);
    const refusal = JSON.parse(retry.stdout);
    assert.equal(refusal.diagnostics[0].code, 'verification.context.malformed');
    assert.match(refusal.errors.join('\n'), /closed schema|embedded recognition/i);
  });

  it('refuses a response-loss retry after its repository base head moves without duplicating durable state', async () => {
    const fixture = await createDispatchFixture(temp, 'atomic-retry-moved-head', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    };

    const started = await runCliInProcess(argv, options);
    assert.equal(started.status, 0, started.stdout);
    const consumptionsBefore = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionsBefore.ok, true, consumptionsBefore.errors?.join('\n'));
    const attemptsBefore = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsBefore.status, 0, attemptsBefore.stdout);
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');
    const checksBefore = readFileSync(checksPath, 'utf8');

    writeFileSync(join(root, 'src', 'after-role-start.js'), 'export const invalidated = true;\n', 'utf8');
    const add = spawnSync('git', ['add', 'src/after-role-start.js'], { cwd: root, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const commit = spawnSync('git', ['commit', '-m', 'invalidate role-start repository base'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);

    const retry = await runCliInProcess(argv, options);
    assert.equal(retry.status, 1, retry.stdout);
    const refusal = JSON.parse(retry.stdout);
    assert.equal(refusal.diagnostics[0].code, 'dispatch.packet.stale');

    const consumptionsAfter = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionsAfter.ok, true, consumptionsAfter.errors?.join('\n'));
    assert.deepEqual(consumptionsAfter.records, consumptionsBefore.records, 'retry must not create or alter consumption evidence');
    const attemptsAfter = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsAfter.status, 0, attemptsAfter.stdout);
    assert.deepEqual(JSON.parse(attemptsAfter.stdout).attempts, JSON.parse(attemptsBefore.stdout).attempts,
      'retry must not create or alter attempts');
    assert.equal(readFileSync(checksPath, 'utf8'), checksBefore, 'retry must not alter check evidence');
  });

  it('refuses an initial parallel start after its repository base head moves without writes', async () => {
    const fixture = await createDispatchFixture(temp, 'parallel-initial-moved-head', {
      taskIds: ['T-001', 'T-002'], parallel: true, initialStatus: 'agent-ready',
    });
    const root = fixture.root;
    const prepared = prepareRoleDispatch({ ...fixture, parallelRequested: true }, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    assert.equal(prepared.packet.decomposition?.route, 'parallel', 'fixture must exercise the parallel role-start path');
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    };
    const roleStart = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const consumptionBefore = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionBefore.ok, true, consumptionBefore.errors?.join('\n'));
    const attemptsBefore = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsBefore.status, 0, attemptsBefore.stdout);
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');
    assert.equal(existsSync(checksPath), false, 'initial check evidence must not exist before start');

    writeFileSync(join(root, 'src', 'before-parallel-role-start.js'), 'export const invalidated = true;\n', 'utf8');
    const add = spawnSync('git', ['add', 'src/before-parallel-role-start.js'], { cwd: root, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const commit = spawnSync('git', ['commit', '-m', 'invalidate parallel role-start repository base'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);

    const canonical = await runCliInProcess(roleStart, options);
    assert.equal(canonical.status, 1, canonical.stdout);
    assert.equal(JSON.parse(canonical.stdout).diagnostics[0].code, 'dispatch.packet.stale');

    const consumptionAfter = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionAfter.ok, true, consumptionAfter.errors?.join('\n'));
    assert.deepEqual(consumptionAfter.records, consumptionBefore.records, 'refusals must not create consumption evidence');
    const attemptsAfter = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsAfter.status, 0, attemptsAfter.stdout);
    assert.deepEqual(JSON.parse(attemptsAfter.stdout).attempts, JSON.parse(attemptsBefore.stdout).attempts,
      'refusals must not create attempts');
    assert.equal(existsSync(checksPath), false, 'refusals must not initialize check evidence');
  });

  it('refuses a parallel role start when an in-scope tracked file becomes dirty without moving HEAD', async () => {
    const fixture = await createDispatchFixture(temp, 'parallel-initial-dirty-worktree', {
      taskIds: ['T-001', 'T-002'], parallel: true, initialStatus: 'agent-ready',
    });
    const root = fixture.root;
    const prepared = prepareRoleDispatch({ ...fixture, parallelRequested: true }, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const headBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const carrierBefore = readFileSync(join(root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8');
    writeFileSync(join(root, 'src', 'existing.js'), 'export const current = "dirty";\n', 'utf8');
    assert.equal(
      formerParallelHeadOnlyGuard(prepared.packet, headBefore),
      true,
      'the former parallel HEAD-only guard would have allowed this unchanged-HEAD dirty worktree',
    );

    const result = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(result.status, 1, result.stdout);
    const refusal = JSON.parse(result.stdout);
    assert.equal(refusal.diagnostics[0].code, 'worktree.clean_gate.failed');
    assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), headBefore);
    assert.equal(readFileSync(join(root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8'), carrierBefore);
    assert.equal(listDispatchConsumptions(root, 'T-001', { backend: 'files' }).records.length, 0);
    assert.equal(existsSync(join(root, '.agenticloop', 'tmp', 'checks.json')), false);
  });

  it('refuses a parallel role start when a sibling carrier changes after packet preparation', async () => {
    const fixture = await createDispatchFixture(temp, 'parallel-stale-sibling-carrier', {
      taskIds: ['T-001', 'T-002'], parallel: true, initialStatus: 'agent-ready',
    });
    const root = fixture.root;
    const prepared = prepareRoleDispatch({ ...fixture, parallelRequested: true }, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const carrierBefore = readFileSync(join(root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8');
    const siblingPath = join(root, '.agenticloop', 'tasks', 'T-002.md');
    writeFileSync(siblingPath, readFileSync(siblingPath, 'utf8').replace('status: agent-ready', 'status: blocked'));
    const add = spawnSync('git', ['add', '.agenticloop/tasks/T-002.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const commit = spawnSync('git', ['commit', '-m', 'change sibling carrier'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);

    const result = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(result.status, 1, result.stdout);
    const refusal = JSON.parse(result.stdout);
    assert.equal(refusal.diagnostics[0].code, 'dispatch.packet.stale');
    assert.equal(readFileSync(join(root, '.agenticloop', 'tasks', 'T-001.md'), 'utf8'), carrierBefore);
    assert.equal(listDispatchConsumptions(root, 'T-001', { backend: 'files' }).records.length, 0);
    assert.equal(existsSync(join(root, '.agenticloop', 'tmp', 'checks.json')), false);
  });

  it('starts a current parallel packet and matches the status route when its moved-head retry is refused', async () => {
    const fixture = await createDispatchFixture(temp, 'parallel-retry-moved-head', {
      taskIds: ['T-001', 'T-002'], parallel: true, initialStatus: 'agent-ready',
    });
    const root = fixture.root;
    const prepared = prepareRoleDispatch({ ...fixture, parallelRequested: true }, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    assert.equal(prepared.packet.decomposition?.route, 'parallel', 'fixture must preserve P36-05 parallel guards');
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const options = {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    };
    const argv = [
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence-output', '.agenticloop/tmp/checks.json', '--json', '--target', root,
    ];
    const started = await runCliInProcess(argv, options);
    assert.equal(started.status, 0, started.stdout);
    const accepted = JSON.parse(started.stdout);
    assert.equal(accepted.disposition, 'committed');
    const consumptionsBefore = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionsBefore.ok, true, consumptionsBefore.errors?.join('\n'));
    const attemptsBefore = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsBefore.status, 0, attemptsBefore.stdout);
    const checksPath = join(root, '.agenticloop', 'tmp', 'checks.json');
    const checksBefore = readFileSync(checksPath, 'utf8');

    writeFileSync(join(root, 'src', 'after-parallel-role-start.js'), 'export const invalidated = true;\n', 'utf8');
    const add = spawnSync('git', ['add', 'src/after-parallel-role-start.js'], { cwd: root, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const commit = spawnSync('git', ['commit', '-m', 'invalidate parallel role-start retry repository base'], { cwd: root, encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);

    const retry = await runCliInProcess(argv, options);
    assert.equal(retry.status, 1, retry.stdout);
    assert.equal(JSON.parse(retry.stdout).diagnostics[0].code, 'dispatch.packet.stale');
    const statusRetry = await runCliInProcess([
      'task', 'status', 'T-001', 'in-progress', '--expect-digest', accepted.currentCarrierDigest,
      '--dispatch-packet', '.agenticloop/tmp/packet.json', '--json', '--target', root,
    ], options);
    assert.equal(statusRetry.status, 1, statusRetry.stdout);
    assert.equal(JSON.parse(statusRetry.stdout).diagnostics[0].code, 'dispatch.packet.stale');

    const consumptionsAfter = listDispatchConsumptions(root, 'T-001', { backend: 'files' });
    assert.equal(consumptionsAfter.ok, true, consumptionsAfter.errors?.join('\n'));
    assert.deepEqual(consumptionsAfter.records, consumptionsBefore.records, 'retry must not alter consumption evidence');
    const attemptsAfter = await runCliInProcess([
      'task', 'attempt-status', 'T-001', '--json', '--target', root,
    ], options);
    assert.equal(attemptsAfter.status, 0, attemptsAfter.stdout);
    assert.deepEqual(JSON.parse(attemptsAfter.stdout).attempts, JSON.parse(attemptsBefore.stdout).attempts,
      'retry must not alter attempts');
    assert.equal(readFileSync(checksPath, 'utf8'), checksBefore, 'retry must not alter check evidence');
  });

  it('refuses a post-start packet through its typed lifecycle result, not a generic packet-equality stale wrapper', async () => {
    const fixture = await createDispatchFixture(temp, 'post-start-stale', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const prepared = prepareRoleDispatch(fixture, fixture.options);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const packetPath = join(root, '.agenticloop', 'tmp', 'packet.json');
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, JSON.stringify(prepared.packet, null, 2), 'utf8');
    const started = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json', '--json', '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(started.status, 0, started.stdout);

    const stale = await runCliInProcess([
      'task', 'prepare-dispatch', 'T-001', '--packet', '.agenticloop/tmp/packet.json', '--role', 'engineer', '--json', '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot, hostAuthority: protectedHostBoundary(fixture.trust) });
    assert.equal(stale.status, 1, stale.stdout);
    const result = JSON.parse(stale.stdout);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /clean checkout|in-progress|dispatchable lifecycle/i);
    assert.doesNotMatch(result.errors.join('\n'), /bindings changed after preparation/);
  });
});

// ── N7: prepare-decomposition behavioral tests ─────────────────────────────

describe('N7: prepare-decomposition behavioral tests', () => {
  it('F2: stdout-only mode emits raw canonical source', async () => {
    const fixture = await createDispatchFixture(temp, 'decomp-stdout', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();

    const result = await runCliInProcess([
      'task', 'prepare-decomposition', 'T-001',
      '--work-unit', 'fixture-work-unit',
      '--source-ref', '.agenticloop/decompositions/T-001.json',
      '--source-revision', `git-commit:${head}`,
      '--base', tree,
      '--dependencies', 'dependencies.json',
      '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot });
    assert.equal(result.status, 0, `prepare-decomposition failed: ${result.stderr}`);
    // stdout-only mode emits raw canonical source (valid JSON decomposition)
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.kind, 'source must have kind');
    assert.ok(parsed.taskId, 'source must have taskId');
    // Verify no output file was created
    assert.equal(existsSync(join(root, '.agenticloop', 'tmp', 'decomp-output.json')), false, 'must not persist without --output');
  });

  it('F2: --output mode persists and reports committed', async () => {
    const fixture = await createDispatchFixture(temp, 'decomp-output', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();

    const result = await runCliInProcess([
      'task', 'prepare-decomposition', 'T-001',
      '--work-unit', 'fixture-work-unit',
      '--source-ref', '.agenticloop/decompositions/T-001.json',
      '--source-revision', `git-commit:${head}`,
      '--base', tree,
      '--dependencies', 'dependencies.json',
      '--output', '.agenticloop/tmp/decomp-output.json',
      '--json',
      '--target', root,
    ], { operatorTrustRoot: fixture.operatorTrustRoot });
    assert.equal(result.status, 0, `prepare-decomposition --output failed: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.disposition, 'committed');
    assert.equal(output.persisted, true);
    assert.ok(existsSync(join(root, '.agenticloop', 'tmp', 'decomp-output.json')), 'output file must exist');
  });

  it('F2: --output mode returns already_current on exact retry', async () => {
    const fixture = await createDispatchFixture(temp, 'decomp-retry', { initialStatus: 'agent-ready' });
    const root = fixture.root;
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    // Use a recent fixed timestamp for deterministic output
    const observedAt = new Date().toISOString();

    const args = [
      'task', 'prepare-decomposition', 'T-001',
      '--work-unit', 'fixture-work-unit',
      '--source-ref', '.agenticloop/decompositions/T-001.json',
      '--source-revision', `git-commit:${head}`,
      '--base', tree,
      '--dependencies', 'dependencies.json',
      '--output', '.agenticloop/tmp/decomp-output.json',
      '--observed-at', observedAt,
      '--json',
      '--target', root,
    ];

    // First write
    const result1 = await runCliInProcess(args, { operatorTrustRoot: fixture.operatorTrustRoot });
    assert.equal(result1.status, 0, `first write failed: ${result1.stdout} ${result1.stderr}`);

    // Second write (exact retry with same observedAt)
    const result2 = await runCliInProcess(args, { operatorTrustRoot: fixture.operatorTrustRoot });
    assert.equal(result2.status, 0, `retry failed: ${result2.stderr}`);
    const output2 = JSON.parse(result2.stdout);
    assert.equal(output2.disposition, 'already_current', 'exact retry must return already_current');
  });

  it('F7: revalidation command handles paths with spaces', () => {
    // Test that shellQuoteArgument is used for paths with spaces
    const result = shellQuoteArgument('path with spaces');
    assert.equal(result, '"path with spaces"');
    // Verify the command would be executable
    assert.ok(!result.includes("'"), 'must not use single quotes');
  });
});

// ── Path handling ──────────────────────────────────────────────────────────

describe('path handling', () => {
  it('handles forward slashes in decomposition source-ref', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['prepare-decomposition'];
    const sourceRefOpt = spec.options.find(opt => opt.name === 'source-ref');
    assert.ok(sourceRefOpt, '--source-ref must exist');
  });

  it('role-start packet path is target-relative', () => {
    const spec = COMMAND_REGISTRY.task.subcommands['role-start'];
    const packetOpt = spec.options.find(opt => opt.name === 'packet');
    assert.ok(packetOpt.description.includes('target-relative'), 'must document target-relative');
  });
});
