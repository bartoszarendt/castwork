import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bindProtectedTransitionEvaluation, protectedInputDigest } from '../src/protected-transition-inputs.js';
import { dispatchPreparationDigest, validateDispatchPreparation } from '../src/dispatch-envelope.js';
import { evaluateDispatchEligibility } from '../src/dispatch-eligibility.js';
import { recognizeHandoff, createPreparedDispatchValidation } from '../src/handoff-recognition.js';
import { createDispatchFixture } from './helpers/dispatch-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';
import { canonicalSha256 } from '../src/canonical-json.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'al-protected-inputs-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

// Deliberately independent of the C5 catalog: these are the controlling
// evaluator interfaces, recorded here so a catalog edit cannot make this proof
// self-fulfilling.
const EVALUATOR_CONTRACTS = Object.freeze({
  dispatch: Object.freeze([
    'snapshot', 'activationEvidence', 'readiness', 'repository', 'decomposition',
    'parallelScanInventory', 'assignment', 'policy', 'returnAdapter',
    'cleanStateObservation', 'inventoryRecheck', 'authority', 'factShape', 'now',
  ]),
  role_start: Object.freeze(['transition', 'expectation', 'preparedDispatch', 'consumedPacketIds', 'observations', 'now']),
  prepare_return: Object.freeze(['taskId', 'packet', 'capabilities', 'hostRoleCapabilities', 'assurancePolicy', 'now']),
});

// These contracts are deliberately stated in terms of canonical evaluator
// outputs, rather than the protected-input catalog or observer projection. A
// field either produces its named evaluator-owned refusal/dimension or has a
// concrete output invariant for this valid fixture.
const EVALUATOR_FIELD_CONTRACTS = Object.freeze({
  dispatch: Object.freeze({
    snapshot: outcome => assertDispatchDimension(outcome, 'lifecycle', 'refused'),
    activationEvidence: outcome => assertDispatchDimension(outcome, 'activation', 'refused'),
    readiness: outcome => assertDispatchDimension(outcome, 'readiness', 'refused'),
    repository: outcome => assertDispatchDimension(outcome, 'repository_identity', 'refused'),
    decomposition: outcome => assertDispatchDimension(outcome, 'decomposition', 'refused'),
    parallelScanInventory: outcome => assertDispatchDimension(outcome, 'work_unit_membership', 'refused'),
    assignment: outcome => assertDispatchDimension(outcome, 'assignment', 'refused'),
    policy: outcome => assertDispatchDimension(outcome, 'activation_assurance', 'refused'),
    cleanStateObservation: outcome => assertDispatchDimension(outcome, 'clean_state', 'refused'),
    authority: outcome => assertDispatchDimension(outcome, 'activation', 'refused'),
    factShape: outcome => assert.equal(outcome.factShape, '[C5 factShape mutation]'),
    returnAdapter: (outcome, baseline, mutation) => {
      assert.equal(outcome.ok, baseline.ok);
      assert.deepEqual(outcome.dimensions, baseline.dimensions);
      assert.deepEqual(outcome.bindings.returnAdapter, mutation);
    },
    inventoryRecheck: (outcome, baseline) => {
      assert.equal(outcome.ok, baseline.ok);
      assert.deepEqual(outcome.dimensions, baseline.dimensions);
    },
    now: outcome => assertDispatchDimension(outcome, 'decomposition', 'refused'),
  }),
  role_start: Object.freeze({
    transition: outcome => assertHandoffDiagnostic(outcome, 'handoff.transition.unsupported'),
    expectation: outcome => assertHandoffDiagnostic(outcome, 'handoff.expectation.malformed'),
    preparedDispatch: outcome => assertHandoffDiagnostic(outcome, 'handoff.evidence.malformed'),
    consumedPacketIds: outcome => assertHandoffDiagnostic(outcome, 'handoff.evidence.replayed'),
    observations: outcome => assert.deepEqual(outcome.observations, [{
      label: 'C5 independently observed evidence', grade: 'session_reported', claimedGrade: 'host_receipt', authoritative: false,
    }]),
    now: outcome => assertHandoffDiagnostic(outcome, 'handoff.evidence.freshness_expired'),
  }),
  prepare_return: Object.freeze({
    taskId: outcome => assert.match(outcome.errors.join('; '), /does not match the protected requested task/),
    packet: outcome => assert.match(outcome.errors.join('; '), /dispatch preparation is missing field\(s\): kind/),
    capabilities: outcome => assert.match(outcome.errors.join('; '), /not in the resolved capability inventory/),
    hostRoleCapabilities: outcome => assert.match(outcome.errors.join('; '), /no effective host-role capability declaration/),
    assurancePolicy: (outcome, baseline) => assert.deepEqual(outcome, baseline),
    now: outcome => assert.match(outcome.errors.join('; '), /activation capture has expired/),
  }),
});

function valuesFor(actionId) {
  return Object.fromEntries(EVALUATOR_CONTRACTS[actionId].map((field, index) => [field, { field, index }]));
}

function assertExactBinding(event, actionId) {
  const expectedFields = [...EVALUATOR_CONTRACTS[actionId]].sort();
  assert.equal(event.actionId, actionId);
  assert.deepEqual(Object.keys(event.binding.protectedInputs).sort(), expectedFields);
  for (const field of EVALUATOR_CONTRACTS[actionId]) {
    const actual = event.evaluatorInput[field];
    assert.deepEqual(event.binding.protectedInputs[field], actual, `${actionId}.${field} must be the evaluator value`);
  }
  assert.equal(
    event.binding.digest,
    protectedInputDigest(actionId, event.binding.protectedInputs),
    `${actionId} digest must be produced from the observed pre-evaluation object`,
  );
}

function assertEveryAuthoritativeInputPerturbsDigest(event) {
  for (const field of Object.keys(event.binding.protectedInputs)) {
    assert.notEqual(
      event.binding.digest,
      protectedInputDigest(event.actionId, {
        ...event.binding.protectedInputs,
        [field]: { independentlyPerturbed: field },
      }),
      `${event.actionId}.${field} must alter the binding digest`,
    );
  }
}

function assertDispatchDimension(outcome, dimension, state) {
  assert.equal(outcome.ok, false);
  assert.equal(outcome.dimensions[dimension].state, state, `dispatch must decide ${dimension} from its mutated fact`);
}

function assertHandoffDiagnostic(outcome, code) {
  assert.equal(outcome.recognized, false);
  assert.ok(outcome.diagnostics.some(diagnostic => diagnostic.code === code), `recognition must emit ${code}`);
}

/**
 * The binding ratchet alone would prove only a hash changed. Re-run the actual
 * canonical evaluator on each one-field mutation of a real handler capture so
 * the test proves every declared C5 field reaches an evaluator boundary.
 */
function invokeCanonicalEvaluator(actionId, input) {
  const invoke = actionId === 'dispatch'
    ? input => evaluateDispatchEligibility(input)
    : actionId === 'role_start'
      ? input => recognizeHandoff({
        ...input,
        validatePreparedDispatch: packet => createPreparedDispatchValidation(packet, { ok: true, errors: [] }),
      })
      : input => validateDispatchPreparation(input.packet, {
        expectedTaskId: input.taskId,
        capabilities: input.capabilities,
        hostRoleCapabilities: input.hostRoleCapabilities,
        assurancePolicy: input.assurancePolicy,
        now: input.now,
        resolveActivationBinding: () => ({ ok: false, errors: ['probe resolver does not grant authority'] }),
      });
  return invoke(input);
}

function mutationFor(actionId, field, input) {
  if (actionId === 'dispatch' && field === 'factShape') return '[C5 factShape mutation]';
  if (actionId === 'dispatch' && field === 'now') return input.now + 7 * 24 * 60 * 60 * 1000;
  if (actionId === 'role_start' && field === 'consumedPacketIds') return [input.preparedDispatch.packetId];
  if (actionId === 'role_start' && field === 'observations') {
    return [{ label: 'C5 independently observed evidence', grade: 'host_receipt' }];
  }
  if (actionId === 'role_start' && field === 'now') return input.now + 7 * 24 * 60 * 60 * 1000;
  if (actionId === 'prepare_return' && field === 'taskId') return 'C5-mutated-task-id';
  if (actionId === 'prepare_return' && field === 'assurancePolicy') return { mode: 'C5-invalid-policy' };
  if (actionId === 'prepare_return' && field === 'now') return input.now + 7 * 24 * 60 * 60 * 1000;
  return { c5IndependentMutation: `${actionId}.${field}` };
}

function tracedEvaluatorInput(input) {
  const reads = new Set();
  return {
    reads,
    value: new Proxy(input, {
      get(target, property, receiver) {
        if (typeof property === 'string') reads.add(property);
        return Reflect.get(target, property, receiver);
      },
    }),
  };
}

function assertEveryRealHandlerInputPerturbsEvaluator(event, actionId) {
  const observedInputDigest = canonicalSha256({ actionId, evaluatorInput: event.evaluatorInput });
  assert.ok(event.evaluatorOutcome && typeof event.evaluatorOutcome === 'object', `${actionId} must expose the actual evaluator outcome`);
  for (const field of EVALUATOR_CONTRACTS[actionId]) {
    const mutation = mutationFor(actionId, field, event.evaluatorInput);
    const mutated = {
      ...event.evaluatorInput,
      [field]: mutation,
    };
    const mutatedInputDigest = canonicalSha256({ actionId, evaluatorInput: mutated });
    assert.notEqual(mutatedInputDigest, observedInputDigest,
      `${actionId}.${field} must change the canonical evaluator input observation`);
    const traced = tracedEvaluatorInput(mutated);
    let outcome;
    assert.doesNotThrow(() => { outcome = invokeCanonicalEvaluator(actionId, traced.value); },
      `${actionId}.${field} must reach its exact canonical evaluator`);
    assert.equal(typeof outcome, 'object', `${actionId}.${field} must produce a concrete evaluator outcome`);
    assert.ok(traced.reads.has(field), `${actionId}.${field} must be read by its canonical evaluator`);
    EVALUATOR_FIELD_CONTRACTS[actionId][field](outcome, event.evaluatorOutcome, mutation);
  }
}

describe('P36 C5 protected evaluator bindings', () => {
  it('rejects missing and extra fields against independently declared evaluator contracts', () => {
    for (const actionId of Object.keys(EVALUATOR_CONTRACTS)) {
      const values = valuesFor(actionId);
      const binding = bindProtectedTransitionEvaluation(actionId, values);
      assert.deepEqual(Object.keys(binding.protectedInputs).sort(), [...EVALUATOR_CONTRACTS[actionId]].sort());
      for (const field of EVALUATOR_CONTRACTS[actionId]) {
        assert.notEqual(
          binding.digest,
          bindProtectedTransitionEvaluation(actionId, { ...values, [field]: { changed: field } }).digest,
          `${actionId}.${field} must affect its action-specific digest`,
        );
      }

      const missing = { ...values };
      delete missing[EVALUATOR_CONTRACTS[actionId][0]];
      assert.throws(() => bindProtectedTransitionEvaluation(actionId, missing), /must exactly match its evaluator contract/);
      assert.throws(
        () => bindProtectedTransitionEvaluation(actionId, { ...values, unexpected: true }),
        /must exactly match its evaluator contract/,
      );
    }
  });

  it('observes each real task handler binding before its authoritative evaluator', async () => {
    const fixture = await createDispatchFixture(temp, 'protected-handler-binding');
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    const observed = [];
    const run = args => runCliInProcess([...args, '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
      protectedTransitionObserver: event => observed.push(event),
    });
    const packetPath = '.agenticloop/tmp/packet.json';

    const dispatch = await run([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', packetPath, '--json',
    ]);
    assert.equal(dispatch.status, 0, dispatch.stdout);
    const dispatchEvent = observed.find(event => event.actionId === 'dispatch');
    assert.ok(dispatchEvent, 'prepare-dispatch must bind before evaluateDispatchEligibility');
    assertExactBinding(dispatchEvent, 'dispatch');
    assert.ok(dispatchEvent.evaluatorOutcome, 'prepare-dispatch must report its real evaluator outcome');
    assertEveryAuthoritativeInputPerturbsDigest(dispatchEvent);
    assertEveryRealHandlerInputPerturbsEvaluator(dispatchEvent, 'dispatch');

    const roleStart = await run(['task', 'role-start', 'T-001', '--packet', packetPath, '--json']);
    assert.equal(roleStart.status, 0, roleStart.stdout);
    const roleStartEvent = observed.find(event => event.actionId === 'role_start');
    assert.ok(roleStartEvent, 'role-start must bind before recognizeHandoff');
    assertExactBinding(roleStartEvent, 'role_start');
    assert.ok(roleStartEvent.evaluatorOutcome, 'role-start must report its real evaluator outcome');
    assertEveryAuthoritativeInputPerturbsDigest(roleStartEvent);
    assertEveryRealHandlerInputPerturbsEvaluator(roleStartEvent, 'role_start');

    // This fixture has no implementation or check evidence, so return production
    // correctly refuses later. The binding is nevertheless made immediately
    // before its real dispatch-authenticity evaluator, not after return refetch.
    const returned = await run([
      'task', 'prepare-return', 'T-001', '--packet', packetPath,
      '--check-evidence', '.agenticloop/tmp/checks.json',
      '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/return.json', '--json',
    ]);
    assert.notEqual(returned.status, 0);
    const returnEvent = observed.find(event => event.actionId === 'prepare_return');
    assert.ok(returnEvent, 'prepare-return must bind before validateDispatchPreparation');
    assertExactBinding(returnEvent, 'prepare_return');
    assert.ok(returnEvent.evaluatorOutcome, 'prepare-return must report its real evaluator outcome');
    assertEveryAuthoritativeInputPerturbsDigest(returnEvent);
    assertEveryRealHandlerInputPerturbsEvaluator(returnEvent, 'prepare_return');
  });

  it('keeps malformed prepare-return assurance policy behavior differential to the baseline evaluator input', async () => {
    const fixture = await createDispatchFixture(temp, 'prepare-return-assurance-baseline-differential');
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    const observed = [];
    const run = args => runCliInProcess([...args, '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
      protectedTransitionObserver: event => observed.push(event),
    });
    const packetPath = '.agenticloop/tmp/packet.json';
    assert.equal((await run([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', packetPath, '--json',
    ])).status, 0);
    assert.equal((await run(['task', 'role-start', 'T-001', '--packet', packetPath, '--json'])).status, 0);
    const returned = await run([
      'task', 'prepare-return', 'T-001', '--packet', packetPath,
      '--check-evidence', '.agenticloop/tmp/checks.json',
      '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/return.json', '--json',
    ]);
    assert.notEqual(returned.status, 0);

    const event = observed.find(item => item.actionId === 'prepare_return');
    assert.ok(event);
    const baseline = invokeCanonicalEvaluator('prepare_return', event.evaluatorInput);
    const mutatedInput = { ...event.evaluatorInput, assurancePolicy: { mode: 'C5-invalid-policy' } };
    const traced = tracedEvaluatorInput(mutatedInput);
    let mutated;
    assert.doesNotThrow(() => { mutated = invokeCanonicalEvaluator('prepare_return', traced.value); });
    assert.ok(traced.reads.has('assurancePolicy'));
    assert.notEqual(
      protectedInputDigest('prepare_return', event.binding.protectedInputs),
      protectedInputDigest('prepare_return', mutatedInput),
    );
    assert.deepEqual(mutated, baseline);
  });

  it('uses the role-start recognition instant for the normal CLI custom validator and nested activation resolver', async () => {
    const fixture = await createDispatchFixture(temp, 'role-start-single-clock');
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    const packetPath = '.agenticloop/tmp/packet.json';
    const run = args => runCliInProcess([...args, '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    const prepared = await run([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', packetPath, '--json',
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const packetFile = join(fixture.root, packetPath);
    const packet = JSON.parse(readFileSync(packetFile, 'utf8'));
    const recognitionNow = Date.now();
    packet.assignment.liveness.expiry = new Date(recognitionNow + 1_000).toISOString();
    packet.digest = dispatchPreparationDigest(packet);
    writeFileSync(packetFile, JSON.stringify(packet, null, 2));

    const realNow = Date.now;
    let clockReads = 0;
    try {
      // The first read is recognizeRoleStart's one resolved instant. A custom
      // validator that falls back to Date.now() sees the second, expired value.
      Date.now = () => (clockReads++ === 0 ? recognitionNow : recognitionNow + 2_000);
      const started = await run(['task', 'role-start', 'T-001', '--packet', packetPath, '--json']);
      assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
    } finally {
      Date.now = realNow;
    }
    assert.ok(clockReads >= 1, 'role start must resolve a clock before validation');
  });

  it('isolates hostile observers from evaluator inputs, command results, output, and persisted state', async () => {
    const fixture = await createDispatchFixture(temp, 'protected-hostile-observer');
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    const observed = [];
    const run = args => runCliInProcess([...args, '--target', fixture.root], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
      protectedTransitionObserver: event => {
        observed.push(event);
        const mutableChild = event.actionId === 'dispatch'
          ? event.evaluatorInput.assignment
          : event.actionId === 'role_start'
            ? event.evaluatorInput.preparedDispatch
            : event.evaluatorInput.packet;
        assert.throws(() => { mutableChild.hostileObserverMutation = true; }, TypeError);
        assert.throws(() => { event.binding.protectedInputs.hostileObserverMutation = true; }, TypeError);
        throw new Error('hostile observer exception');
      },
    });
    const packetPath = '.agenticloop/tmp/packet.json';

    const dispatch = await run([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', packetPath, '--json',
    ]);
    assert.equal(dispatch.status, 0, dispatch.stdout);
    const packetBeforeStart = readFileSync(join(fixture.root, packetPath), 'utf8');
    assert.doesNotThrow(() => JSON.parse(packetBeforeStart));

    const roleStart = await run(['task', 'role-start', 'T-001', '--packet', packetPath, '--json']);
    assert.equal(roleStart.status, 0, roleStart.stdout);
    assert.equal(readFileSync(join(fixture.root, packetPath), 'utf8'), packetBeforeStart);

    const taskPath = join(fixture.root, '.agenticloop', 'tasks', 'T-001.md');
    const taskBeforeReturn = readFileSync(taskPath, 'utf8');
    const returnPath = '.agenticloop/tmp/return.json';
    const returned = await run([
      'task', 'prepare-return', 'T-001', '--packet', packetPath,
      '--check-evidence', '.agenticloop/tmp/checks.json',
      '--outcome', 'implementation_ready_for_review', '--output', returnPath, '--json',
    ]);
    assert.notEqual(returned.status, 0);
    assert.match(`${returned.stdout}\n${returned.stderr}`, /verification\.context\.malformed/);
    assert.equal(readFileSync(taskPath, 'utf8'), taskBeforeReturn);
    assert.equal(existsSync(join(fixture.root, returnPath)), false);

    assert.deepEqual(observed.map(event => event.actionId), ['dispatch', 'role_start', 'prepare_return']);
    for (const event of observed) {
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Object.isFrozen(event.evaluatorInput), true);
      assert.equal(Object.isFrozen(event.binding), true);
    }
  });
});
