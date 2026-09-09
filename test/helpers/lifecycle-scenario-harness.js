/**
 * Privacy-clean, disposable lifecycle baseline scenarios.
 *
 * This is a characterization harness, not a lifecycle shim: every command is
 * routed through `runCliInProcess`, the same CLI entry point used by command
 * tests. It records only stable command names, exit statuses, diagnostic codes,
 * and derived counts; it never retains command prose, packets, prompts, or a
 * target checkout after the caller removes its temporary root.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDispatchFixture, git } from './dispatch-fixture.js';
import { protectedHostBoundary } from './host-trust-fixture.js';
import { runCliInProcess } from './run-cli.js';
import { measureTaskWorkflow } from '../../src/workflow-measurement.js';
import { executionAttemptIdentity } from '../../src/execution-attempt-identity.js';
import { listDispatchConsumptions } from '../../src/handoff-consumption.js';
import { dispatchPreparationDigest } from '../../src/dispatch-envelope.js';
import {
  CLI_OPERATOR_PRODUCER_ID,
  OPERATOR_CONFIRMATION_PHRASE,
  activationGrantSignaturePayload,
  createActivationGrant,
  createTaskActivationBinding,
  taskActivationBindingSignaturePayload,
} from '../../src/activation-grant.js';
import { activationScopeSummaryDigest, writeActivationRecords } from '../../src/activation-store.js';
import {
  loadOperatorActivationKey,
  provisionOperatorActivationKey,
  signOperatorActivationPayload,
} from '../../src/activation-trust.js';
import { targetRepositoryIdentity } from '../../src/host-trust.js';
import { taskContractDigest } from '../../src/task-contract-baseline.js';

export const BASELINE_SCENARIOS = Object.freeze([
  'standard-serial', 'remediation', 'long-pause', 'update', 'operator-edit', 'eight-step-chain',
]);

function resultCode(result) {
  try {
    const value = JSON.parse(result.stdout);
    return value.code ?? value.error?.code ?? value.result?.code ?? value.diagnostics?.[0]?.code ?? 'none';
  } catch {
    return result.status === 0 ? 'none' : 'unstructured_cli_failure';
  }
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function fixtureHistory(root) {
  return git(root, ['rev-list', '--reverse', 'HEAD']).split(/\r?\n/).filter(Boolean);
}

function carrierDigest(root, taskId) {
  const body = readFileSync(join(root, '.agenticloop', 'tasks', `${taskId}.md`), 'utf8');
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/**
 * Create a real CLI fixture and provide bounded scenario operations.
 *
 * The fixture builder establishes activation, contract, dependency, and
 * decomposition evidence through the existing product helpers. A scoped
 * scaffold option permits a synthetic signed grant/binding scenario. No record
 * is hand-authored to imitate a lifecycle result.
 */
export async function createSyntheticScenarioHarness(temp, name, options = {}) {
  // The shared fixture's complete attribution chain is intentionally bound to
  // this opaque canonical ID. Keeping it avoids inventing a replacement
  // dependency record merely to make a measurement fixture look successful.
  const fixture = await createDispatchFixture(temp, `synthetic-baseline-${name}`, {
    taskIds: options.taskIds ?? ['T-001'], requiredChecksText: '- [RC-1] command: `node --version`',
    scaffold: options.scaffold === true,
  });
  const taskId = 'T-001';
  const commands = [];
  const operatorActivationRoot = join(temp, `synthetic-baseline-${name}-operator-activation`);
  const cli = args => runCliInProcess([...args, '--target', fixture.root], {
    operatorTrustRoot: fixture.operatorTrustRoot,
    operatorActivationRoot,
    hostAuthority: protectedHostBoundary(fixture.trust),
  });
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });

  const run = async (step, args) => {
    const result = await cli(args);
    commands.push(Object.freeze({ step, command: args.slice(0, 3).join(' '), status: result.status, code: resultCode(result) }));
    return result;
  };
  const packetPath = '.agenticloop/tmp/baseline-packet.json';

  const start = async () => {
    const prepared = await run('prepare-dispatch', [
      'task', 'prepare-dispatch', taskId, '--host', 'opencode', '--role', 'engineer', '--output', packetPath, '--json',
    ]);
    if (prepared.status !== 0) return prepared;
    const started = await run('role-start', ['task', 'role-start', taskId, '--packet', packetPath, '--json']);
    if (started.status === 0) commit(fixture.root, `record role start\n\nTask: ${taskId}\nAgent: engineer`);
    return started;
  };
  const productCommit = label => {
    writeFileSync(join(fixture.root, 'src', 'baseline-product.js'), `export const baselineProduct = '${label}';\n`, 'utf8');
    return commit(fixture.root, `${label} product change\n\nTask: ${taskId}\nAgent: engineer`);
  };
  const measurement = () => {
    const history = fixtureHistory(fixture.root);
    return measureTaskWorkflow(fixture.root, taskId, {
      commitRange: 'authorization',
      // `fixture` initializes the Git repository before the fixture's durable
      // authorization/task record commit. The task fixture is the authorization
      // anchor; the following baseline commit is the pre-existing contract
      // commit excluded by the frozen M1 rule.
      authorizationHead: history[1],
      taskContractCommit: history[2],
      now: '2040-01-01T00:00:00.000Z',
    });
  };
  return { fixture, taskId, commands, operatorActivationRoot, run, start, productCommit, measurement };
}

function writeHistoricalSignedActivation(harness) {
  const { fixture, taskId, operatorActivationRoot } = harness;
  const provisioned = provisionOperatorActivationKey(fixture.root, { operatorActivationRoot });
  if (!provisioned.ok) throw new Error(`cannot provision synthetic activation signer: ${provisioned.errors.join('; ')}`);
  const operatorKey = loadOperatorActivationKey(fixture.root, { operatorActivationRoot }).key;
  if (!operatorKey) throw new Error('cannot load synthetic activation signer');

  const repositoryIdentity = targetRepositoryIdentity(fixture.root);
  const issuedAt = new Date(Date.now() - 120_000).toISOString();
  const expiresAt = new Date(Date.now() - 60_000).toISOString();
  const grantSkeleton = createActivationGrant({
    repositoryIdentity,
    backend: 'files',
    scope: { type: 'exact_tasks', taskIds: [taskId] },
    assurance: 'operator_confirmed',
    producer: { id: CLI_OPERATOR_PRODUCER_ID, channel: 'cli_interactive_confirmation' },
    issuedAt,
    expiresAt,
    evidence: {
      confirmedAt: issuedAt,
      confirmationPhrase: OPERATOR_CONFIRMATION_PHRASE,
      channel: 'cli_interactive_confirmation',
      operatorKeyId: operatorKey.keyId,
      scopeSummaryDigest: activationScopeSummaryDigest('synthetic historical activation expiry'),
    },
  });
  const grant = Object.freeze({
    ...grantSkeleton,
    authentication: signOperatorActivationPayload(activationGrantSignaturePayload(grantSkeleton), { key: operatorKey, repositoryIdentity }),
  });
  const bindingSkeleton = createTaskActivationBinding({
    grant,
    backend: 'files',
    taskId,
    carrier: `.agenticloop/tasks/${taskId}.md`,
    taskContractDigest: taskContractDigest(readFileSync(fixture.taskPath, 'utf8')).digest,
    derivation: 'direct_operator_confirmation',
    issuedAt,
    expiresAt,
  });
  const binding = Object.freeze({
    ...bindingSkeleton,
    authentication: signOperatorActivationPayload(taskActivationBindingSignaturePayload(bindingSkeleton), { key: operatorKey, repositoryIdentity }),
  });
  const written = writeActivationRecords(fixture.root, { grant, bindings: [binding] });
  if (!written.ok) throw new Error(`cannot write synthetic activation: ${written.receipt.errors.join('; ')}`);
}

/**
 * Execute the retained happy-path lifecycle stages in a disposable, activation-bound
 * repository. Each CLI result and each persisted attempt/lineage fact is
 * observed from the real evaluator; this is not a label-only refusal fixture.
 */
export async function runExecutedHappyPath(temp) {
  const harness = await createSyntheticScenarioHarness(temp, 'eight-step-chain');
  const { fixture, taskId } = harness;
  const packetPath = '.agenticloop/tmp/baseline-packet.json';
  const checksPath = `.agenticloop/tmp/${taskId}-checks.json`;
  const returnPath = '.agenticloop/tmp/baseline-return.json';
  const stages = [];
  const record = (id, results) => {
    stages.push(Object.freeze({
      id,
      commands: Object.freeze(results.map(result => Object.freeze({ status: result.status, code: resultCode(result) }))),
    }));
  };

  const dispatched = await harness.run('dispatch', [
    'task', 'prepare-dispatch', taskId, '--host', 'opencode', '--role', 'engineer', '--output', packetPath, '--json',
  ]);
  record('dispatch', [dispatched]);
  if (dispatched.status !== 0) throw new Error(`synthetic dispatch failed: ${dispatched.stdout}`);

  const started = await harness.run('start', ['task', 'role-start', taskId, '--packet', packetPath, '--json']);
  record('start', [started]);
  if (started.status !== 0) throw new Error(`synthetic role start failed: ${started.stdout}`);
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', `record role start\n\nTask: ${taskId}\nAgent: engineer`]);

  writeFileSync(join(fixture.root, 'src', 'baseline-product.js'), "export const baselineProduct = 'eight-step-chain';\n", 'utf8');
  git(fixture.root, ['add', 'src/baseline-product.js']);
  git(fixture.root, ['commit', '-m', `eight-step-chain product change\n\nTask: ${taskId}\nAgent: engineer`]);
  const productHead = git(fixture.root, ['rev-parse', 'HEAD']);
  record('product-commit', [{ status: 0, stdout: JSON.stringify({ code: 'commit.attributed' }) }]);

  const artifactEvidence = await harness.run('artifact-evidence', [
    'task', 'evidence', taskId, '--class', 'implementation_artifact_evidence',
    '--expect-digest', carrierDigest(fixture.root, taskId), '--product-head', productHead, '--json',
  ]);
  record('artifact-evidence', [artifactEvidence]);
  if (artifactEvidence.status !== 0) throw new Error(`synthetic artifact evidence failed: ${artifactEvidence.stdout}`);
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', `record implementation artifact evidence\n\nTask: ${taskId}\nAgent: engineer`]);

  const initialized = await harness.run('check-evidence-init', [
    'task', 'check-evidence-init', taskId, '--packet', packetPath, '--output', checksPath, '--json',
  ]);
  if (initialized.status !== 0) throw new Error(`synthetic check initialization failed: ${initialized.stdout}`);
  const checkResults = [initialized];
  for (const check of JSON.parse(readFileSync(join(fixture.root, checksPath), 'utf8'))) {
    const updated = await harness.run('check-evidence-update', [
      'task', 'check-evidence-update', taskId, '--packet', packetPath, '--input', checksPath, '--output', checksPath,
      '--check', check.id, '--outcome', 'passed', '--evidence', `${check.id} passed in synthetic chain`,
      '--execution-output', `.agenticloop/checks/${taskId}/${check.id}.execution.json`, '--json',
    ]);
    checkResults.push(updated);
    if (updated.status !== 0) throw new Error(`synthetic check ${check.id} failed: ${updated.stdout}`);
  }
  record('required-check-evidence', checkResults);
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs', '.agenticloop/checks']);
  git(fixture.root, ['commit', '-m', `record required checks\n\nTask: ${taskId}\nAgent: engineer`]);

  const preparedReturn = await harness.run('prepare-return', [
    'task', 'prepare-return', taskId, '--packet', packetPath, '--check-evidence', checksPath,
    '--outcome', 'implementation_ready_for_review', '--output', returnPath, '--json',
  ]);
  record('prepare-return', [preparedReturn]);
  if (preparedReturn.status !== 0) throw new Error(`synthetic return preparation failed: ${preparedReturn.stdout}`);

  const verifiedReturn = await harness.run('verify-return', [
    'task', 'verify-return', taskId, '--packet', packetPath, '--return', returnPath, '--from-current-repository', '--json',
  ]);
  record('verify-return', [verifiedReturn]);
  if (verifiedReturn.status !== 0) throw new Error(`synthetic return verification failed: ${verifiedReturn.stdout}`);

  const consumption = listDispatchConsumptions(fixture.root, taskId, { backend: 'files' });
  if (!consumption.ok || consumption.records.length !== 1) throw new Error('synthetic chain did not preserve one dispatch consumption');
  const attemptId = executionAttemptIdentity(consumption.records[0]);
  const attemptStatus = await harness.run('attempt-status', ['task', 'attempt-status', taskId, '--json']);
  if (attemptStatus.status !== 0) throw new Error(`synthetic attempt status failed: ${attemptStatus.stdout}`);
  const attempts = JSON.parse(attemptStatus.stdout).attempts;
  const liveAttempt = attempts.find(attempt => attempt.attemptId === attemptId);
  if (!liveAttempt || attempts.length !== 1) throw new Error('synthetic chain did not retain one lineage-bound attempt');
  record('attempt-lineage', [attemptStatus]);

  return Object.freeze({
    scenario: 'executed-happy-path', availability: 'measured', unavailableReason: null,
    refusal: null, stages: Object.freeze(stages),
    commands: Object.freeze(harness.commands.map(command => Object.freeze({ ...command }))),
    delegations: delegationObservation(harness.commands),
    invariants: Object.freeze({
      dispatchConsumptions: consumption.records.length,
      attemptCount: attempts.length,
      attemptId,
      productHead,
      verifiedReturn: true,
    }),
    counters: Object.freeze({ ...harness.measurement().counters }),
  });
}

async function attemptInvariants(harness) {
  const { fixture, taskId } = harness;
  const consumption = listDispatchConsumptions(fixture.root, taskId, { backend: 'files' });
  if (!consumption.ok) throw new Error(`cannot inspect synthetic dispatch consumption: ${consumption.errors.join('; ')}`);
  const status = await harness.run('attempt-status', ['task', 'attempt-status', taskId, '--json']);
  if (status.status !== 0) throw new Error(`cannot inspect synthetic attempt state: ${status.stdout}`);
  const report = JSON.parse(status.stdout);
  const attempt = report.liveAttempt ?? report.attempts[0] ?? null;
  return Object.freeze({
    dispatchConsumptions: consumption.records.length,
    attempts: report.attempts.length,
    liveAttempt: report.liveAttempt ? 'present' : 'absent',
    state: attempt?.state ?? 'none',
  });
}

function observedResult(result) {
  return Object.freeze({ status: result.status, code: resultCode(result) });
}

async function observeFieldStepShape(temp, id, action, options = {}) {
  const harness = await createSyntheticScenarioHarness(temp, `eight-step-${id}`, options);
  const actionResult = await action(harness);
  const results = Array.isArray(actionResult) ? actionResult : actionResult.results;
  return Object.freeze({
    id,
    observedResults: Object.freeze(results.map(observedResult)),
    commands: Object.freeze(harness.commands.map(command => Object.freeze({ ...command }))),
    invariants: await attemptInvariants(harness),
    authorization: Array.isArray(actionResult) ? null : actionResult.authorization,
  });
}

/**
 * Executes the eight privacy-clean field-step shapes as independently
 * reproducible current-policy observations. The retained field data does not
 * supply a real-target sequence or per-step code, so no synthetic setup claims
 * to reconstruct either; every mapped result below comes from a real CLI call.
 */
export async function runExecutedEightStepChain(temp) {
  const stages = [];

  stages.push(await observeFieldStepShape(temp, 'activation-expiry', async harness => {
    writeHistoricalSignedActivation(harness);
    const packetPath = '.agenticloop/tmp/historical-activation-packet.json';
    const prepared = await harness.run('prepare-dispatch', [
      'task', 'prepare-dispatch', harness.taskId, '--host', 'opencode', '--role', 'engineer', '--output', packetPath, '--json',
    ]);
    if (prepared.status !== 0) throw new Error(`cannot prepare historical activation expiry shape: ${prepared.stdout}`);
    const packetFile = join(harness.fixture.root, packetPath);
    const packet = JSON.parse(readFileSync(packetFile, 'utf8'));
    if (packet.activation !== null || !packet.activationBinding?.grant?.authentication || !packet.activationBinding?.binding?.authentication) {
      throw new Error('historical activation expiry shape did not carry the signed synthetic grant and binding');
    }
    if (Date.parse(packet.activationBinding.grant.expiresAt) >= Date.now() ||
        Date.parse(packet.activationBinding.binding.expiresAt) >= Date.now()) {
      throw new Error('historical activation expiry shape did not retain elapsed grant and binding expiry');
    }
    if (Date.parse(packet.assignment.liveness.expiry) <= Date.now()) {
      throw new Error('historical activation expiry shape did not retain current packet liveness');
    }
    const started = await harness.run('activation-expiry', ['task', 'role-start', harness.taskId, '--packet', packetPath, '--json']);
    if (started.status !== 0) throw new Error(`historical activation expiry incorrectly blocked authorization: ${started.stdout}`);
    return {
      results: [started],
      authorization: Object.freeze({
        grant: 'signed_historical_expiry',
        binding: 'signed_historical_expiry',
        packetLiveness: 'current',
        outcome: 'continued',
      }),
    };
  }, { scaffold: true }));

  stages.push(await observeFieldStepShape(temp, 'wrong-product-head', async harness => {
    const started = await harness.start();
    if (started.status !== 0) throw new Error(`cannot start wrong-product-head shape: ${started.stdout}`);
    harness.productCommit('wrong-product-head');
    return [await harness.run('wrong-product-head', [
      'task', 'evidence', harness.taskId, '--class', 'implementation_artifact_evidence',
      '--expect-digest', carrierDigest(harness.fixture.root, harness.taskId), '--product-head', '0'.repeat(40), '--json',
    ])];
  }));

  stages.push(await observeFieldStepShape(temp, 'artifact-class-mismatch', async harness => {
    const started = await harness.start();
    if (started.status !== 0) throw new Error(`cannot start artifact-class-mismatch shape: ${started.stdout}`);
    return [await harness.run('artifact-class-mismatch', [
      'task', 'evidence', harness.taskId, '--class', 'implementation_summary_evidence',
      '--expect-digest', carrierDigest(harness.fixture.root, harness.taskId), '--summary', 'synthetic summary',
      '--check-evidence', 'synthetic check evidence', '--json',
    ])];
  }));

  stages.push(await observeFieldStepShape(temp, 'packet-liveness', async harness => {
    const packetPath = '.agenticloop/tmp/liveness-packet.json';
    const prepared = await harness.run('prepare-dispatch', [
      'task', 'prepare-dispatch', harness.taskId, '--host', 'opencode', '--role', 'engineer', '--output', packetPath, '--json',
    ]);
    if (prepared.status !== 0) throw new Error(`cannot prepare packet-liveness shape: ${prepared.stdout}`);
    const preflight = await harness.run('handoff-preflight', ['task', 'handoff-preflight', harness.taskId, '--host', 'opencode', '--json']);
    if (preflight.status !== 0) throw new Error(`cannot preflight packet-liveness shape: ${preflight.stdout}`);
    const packetFile = join(harness.fixture.root, packetPath);
    const packet = JSON.parse(readFileSync(packetFile, 'utf8'));
    packet.assignment.liveness.expiry = new Date(Date.now() - 1_000).toISOString();
    packet.digest = dispatchPreparationDigest(packet);
    writeFileSync(packetFile, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
    return [await harness.run('packet-liveness', ['task', 'role-start', harness.taskId, '--packet', packetPath, '--json'])];
  }));

  stages.push(await observeFieldStepShape(temp, 'recovery-supersession', async harness => {
    const started = await harness.start();
    if (started.status !== 0) throw new Error(`cannot start recovery-supersession shape: ${started.stdout}`);
    const consumption = listDispatchConsumptions(harness.fixture.root, harness.taskId, { backend: 'files' });
    const attemptId = executionAttemptIdentity(consumption.records[0]);
    return [await harness.run('recovery-supersession', [
      'task', 'abandon-attempt', harness.taskId, '--attempt', attemptId,
      '--reason', 'the synthetic retained packet cannot prove the original product base', '--authority', 'operator:synthetic', '--json',
    ])];
  }));

  stages.push(await observeFieldStepShape(temp, 'generated-clean-gate', async harness => {
    const hostLocal = join(harness.fixture.root, '.opencode', 'agent');
    mkdirSync(hostLocal, { recursive: true });
    writeFileSync(join(hostLocal, 'engineer.md'), 'generated synthetic fixture\n', 'utf8');
    return [await harness.run('generated-clean-gate', [
      'task', 'prepare-dispatch', harness.taskId, '--host', 'opencode', '--role', 'engineer', '--output', '.agenticloop/tmp/generated-packet.json', '--json',
    ])];
  }));

  stages.push(await observeFieldStepShape(temp, 'decomposition-schema', async harness => {
    const path = join(harness.fixture.root, '.agenticloop', 'decompositions', `${harness.taskId}.json`);
    const decomposition = JSON.parse(readFileSync(path, 'utf8'));
    decomposition.schemaVersion = 1;
    writeFileSync(path, `${JSON.stringify(decomposition, null, 2)}\n`, 'utf8');
    git(harness.fixture.root, ['add', '.agenticloop/decompositions']);
    git(harness.fixture.root, ['commit', '-m', `synthetic decomposition schema compatibility\n\nTask: ${harness.taskId}\nAgent: maintainer`]);
    return [await harness.run('decomposition-schema', [
      'task', 'prepare-dispatch', harness.taskId, '--host', 'opencode', '--role', 'engineer', '--output', '.agenticloop/tmp/schema-packet.json', '--json',
    ])];
  }));

  stages.push(await observeFieldStepShape(temp, 'member-dependency-evidence', async harness => [
    await harness.run('member-dependency-evidence', [
      'task', 'prepare-dispatch', harness.taskId, '--host', 'opencode', '--role', 'engineer', '--output', '.agenticloop/tmp/member-packet.json', '--json',
    ]),
  ], { taskIds: ['T-001', 'T-002'] }));

  return Object.freeze({
    scenario: 'eight-step-chain', availability: 'measured', unavailableReason: null,
    refusal: null, stages: Object.freeze(stages),
  });
}

function firstFailure(commands) {
  return commands.find(command => command.status !== 0) ?? null;
}

function delegationObservation(commands) {
  return Object.freeze({
    status: 'partial',
    ordinaryPrefixCount: commands.filter(command => (command.step === 'role-start' || command.step === 'start') && command.status === 0).length,
    completeReference: 'unavailable',
    repairOnly: 'unavailable',
    limitation: 'the current route stops before candidate, independent review, and audit; it cannot measure the complete three-role reference or repair-only delegations',
  });
}

/** Run one frozen scenario and return only its privacy-clean observation. */
export async function runSyntheticScenario(temp, scenario) {
  if (!BASELINE_SCENARIOS.includes(scenario)) throw new TypeError(`unknown baseline scenario '${scenario}'`);
  if (scenario === 'eight-step-chain') return runExecutedEightStepChain(temp);
  const harness = await createSyntheticScenarioHarness(temp, scenario);
  let availability = 'measured';
  let unavailableReason = null;

  if (scenario === 'standard-serial' || scenario === 'remediation') {
    const started = await harness.start();
    if (started.status === 0) {
      harness.productCommit(scenario);
      await harness.run('prepare-return', [
        'task', 'prepare-return', harness.taskId, '--packet', '.agenticloop/tmp/baseline-packet.json',
        '--check-evidence', `.agenticloop/tmp/${harness.taskId}-checks.json`,
        '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/baseline-return.json', '--json',
      ]);
    }
  } else if (scenario === 'long-pause') {
    await harness.start();
    await harness.run('handoff-preflight-after-pause', ['task', 'handoff-preflight', harness.taskId, '--host', 'opencode', '--json']);
    availability = 'unavailable';
    unavailableReason = 'missing command: current CLI exposes no injectable --now/clock input for a multi-day protected-transition resume';
  } else if (scenario === 'update') {
    const started = await harness.start();
    if (started.status === 0) {
      mkdirSync(join(harness.fixture.root, '.opencode', 'agents'), { recursive: true });
      writeFileSync(join(harness.fixture.root, '.opencode', 'agents', 'generated-baseline.md'), 'generated synthetic fixture\n', 'utf8');
      await harness.run('handoff-preflight-after-generated-update', ['task', 'handoff-preflight', harness.taskId, '--host', 'opencode', '--json']);
      await harness.run('prepare-return-after-generated-update', [
        'task', 'prepare-return', harness.taskId, '--packet', '.agenticloop/tmp/baseline-packet.json',
        '--check-evidence', `.agenticloop/tmp/${harness.taskId}-checks.json`,
        '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/baseline-return.json', '--json',
      ]);
    }
  } else if (scenario === 'operator-edit') {
    const started = await harness.start();
    if (started.status === 0) {
      writeFileSync(join(harness.fixture.root, 'src', 'operator-edit.js'), 'export const operatorEdit = true;\n', 'utf8');
      commit(harness.fixture.root, 'operator product correction');
      await harness.run('handoff-preflight-after-operator-edit', ['task', 'handoff-preflight', harness.taskId, '--host', 'opencode', '--json']);
      availability = 'unavailable';
      unavailableReason = 'missing command: current CLI exposes no explicit product-adoption command for an out-of-band reachable commit';
    }
  }

  const failure = firstFailure(harness.commands);
  return Object.freeze({
    scenario,
    availability,
    unavailableReason,
    refusal: failure ? Object.freeze({ step: failure.step, code: failure.code }) : null,
    commands: Object.freeze(harness.commands.map(command => Object.freeze({ ...command }))),
    delegations: delegationObservation(harness.commands),
    counters: Object.freeze({ ...harness.measurement().counters }),
  });
}
