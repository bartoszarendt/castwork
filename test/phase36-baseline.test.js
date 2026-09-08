/**
 * P36-00A characterization only. These fixtures define a proposed transition
 * identity and exercise the existing derived measurement; they do not alter
 * production lifecycle behavior.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { canonicalJson, canonicalSha256 } from '../src/canonical-json.js';
import { assertPrivacyClean } from '../src/workflow-measurement.js';
import { countCanonicalWords } from '../src/canonical-word-count.js';
import {
  PACKAGED_SURFACE_MEASUREMENT_SCHEMA,
  PACKAGED_SURFACE_MEASUREMENT_SOURCES,
  packagedSurfaceMeasurementIdentity,
} from '../src/measurement-implementation-identity.js';
import { executionAttemptIdentity } from '../src/execution-attempt-identity.js';
import { listDispatchConsumptions } from '../src/handoff-consumption.js';
import { protectedTransitionKey } from '../src/protected-transition-key.js';
import { measureAdapterWords } from '../scripts/measure-adapter-words.mjs';
import { BASELINE_SCENARIOS, createSyntheticScenarioHarness, runSyntheticScenario } from './helpers/lifecycle-scenario-harness.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED_SURFACE_SNAPSHOT = JSON.parse(readFileSync(join(REPO_ROOT, 'src', 'packaged-surface-baseline.json'), 'utf8'));
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.jsonc', '.md', '.toml', '.txt', '.yaml', '.yml']);
// Keep this exact-file exemption synchronized with the tracked-file guard in
// test/internal-planning-boundary.test.js. This candidate-set check includes
// untracked non-ignored files so a commit cannot introduce a latent violation.
const PHASE_NUMBER_IN_FILENAME = /(?:phase[ _-]?\d+|p\d{2}-(?:d)?\d+)/i;
const INTERNAL_PHASE_REFERENCE = /\b(?:phase[ _-]?\d{2}|p\d{2}-d\d+)\b/i;
const SYNTHETIC_BASELINE_TEST = 'test/phase36-baseline.test.js';
const FROZEN_ADAPTER_WORD_COUNTS = Object.freeze({
  opencode: { generatedPayload: 16128, agentDefinitions: 15120, activationSurface: 1008, referenceLibrary: 0 },
  codex: { generatedPayload: 76822, agentDefinitions: 15458, activationSurface: 1291, referenceLibrary: 60073 },
  'claude-code': { generatedPayload: 57465, agentDefinitions: 13941, activationSurface: 2219, referenceLibrary: 41305 },
  copilot: { generatedPayload: 74857, agentDefinitions: 15187, activationSurface: 1345, referenceLibrary: 58325 },
  cursor: { generatedPayload: 74609, agentDefinitions: 15185, activationSurface: 1099, referenceLibrary: 58325 },
});

function candidateRepositoryFiles() {
  const listFiles = args => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  return [...new Set([
    ...listFiles(['ls-files', '-z']),
    ...listFiles(['ls-files', '--others', '--exclude-standard', '-z']),
  ])];
}

function candidatePhaseViolations() {
  const violations = [];
  for (const relativePath of candidateRepositoryFiles()) {
    if (relativePath === SYNTHETIC_BASELINE_TEST) continue;
    const file = join(REPO_ROOT, relativePath);
    if (PHASE_NUMBER_IN_FILENAME.test(basename(file))) {
      violations.push(`${relativePath}: numbered phase in filename`);
    }
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      if (INTERNAL_PHASE_REFERENCE.test(line)) {
        violations.push(`${relativePath}:${index + 1}: numbered internal phase reference`);
      }
    }
  }
  return violations;
}

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'synthetic-baseline-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

export const NO_ATTEMPT_ID = 'none';

export const transitionKey = protectedTransitionKey;

describe('P36-00A frozen baseline', () => {
  it('keeps the tracked and untracked candidate set within the internal planning boundary', () => {
    assert.deepEqual(candidatePhaseViolations(), []);
  });

  it('pins generated adapter word counts to the pre-change baseline', () => {
    assert.deepEqual(
      measureAdapterWords(),
      FROZEN_ADAPTER_WORD_COUNTS,
      'the pre-change baseline requires deliberate re-measurement with evidence'
    );
  });

  it('re-measures the named clean detached subject when its Git object is available', () => {
    const { commit, tree } = PACKAGED_SURFACE_SNAPSHOT.subject;
    assert.equal(execFileSync('git', ['cat-file', '-e', `${commit}^{tree}`], { cwd: REPO_ROOT, encoding: 'utf8' }), '');
    assert.equal(execFileSync('git', ['rev-parse', `${commit}^{tree}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(), tree);
    assert.equal(
      execFileSync('git', ['rev-parse', `${PACKAGED_SURFACE_SNAPSHOT.observedArtifact.baseCommit}^{tree}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
      PACKAGED_SURFACE_SNAPSHOT.observedArtifact.baseTree
    );

    const subject = mkdtempSync(join(tmpdir(), 'packaged-surface-subject-'));
    try {
      execFileSync('git', ['clone', '--no-local', '--no-checkout', REPO_ROOT, subject], { encoding: 'utf8' });
      execFileSync('git', ['checkout', '--detach', commit], { cwd: subject, encoding: 'utf8' });
      assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: subject, encoding: 'utf8' }), '');
      assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: subject, encoding: 'utf8' }).trim(), commit);
      const implementation = packagedSurfaceMeasurementIdentity(REPO_ROOT);
      assert.deepEqual(implementation, PACKAGED_SURFACE_SNAPSHOT.measurementImplementation);
      assert.equal(implementation.schema, PACKAGED_SURFACE_MEASUREMENT_SCHEMA);
      for (const path of PACKAGED_SURFACE_MEASUREMENT_SOURCES) {
        copyFileSync(join(REPO_ROOT, path), join(subject, path));
      }
      assert.deepEqual(packagedSurfaceMeasurementIdentity(subject), implementation);
      const result = execFileSync(process.execPath, [join(subject, 'scripts', 'measure-adapter-words.mjs')], {
        cwd: subject,
        encoding: 'utf8',
      });
      assert.deepEqual(JSON.parse(result), PACKAGED_SURFACE_SNAPSHOT.adapters);
    } finally {
      rmSync(subject, { recursive: true, force: true });
    }
  });

  it('keeps canonical methodology within the deferred P36-M6 ceiling', () => {
    assert.ok(countCanonicalWords(readFileSync(join(REPO_ROOT, 'AGENTIC_LOOP.md'), 'utf8')) <= 15000);
  });

  it('pins the stable transition key to real immutable dispatch consumption and the outside-attempt sentinel', async () => {
    const harness = await createSyntheticScenarioHarness(temp, 'transition-key');
    const started = await harness.start();
    assert.equal(started.status, 0, JSON.stringify(harness.commands));
    const consumptions = listDispatchConsumptions(harness.fixture.root, harness.taskId, { backend: 'files' });
    assert.equal(consumptions.ok, true, consumptions.errors?.join('\n'));
    assert.equal(consumptions.records.length, 1);
    const consumption = consumptions.records[0];
    const actualAttemptId = executionAttemptIdentity(consumption);
    assert.match(actualAttemptId, /^attempt:[a-f0-9]{32}$/);
    assert.equal(actualAttemptId, executionAttemptIdentity({
      packetId: consumption.packetId,
      packetDigest: consumption.packetDigest,
      invocationId: consumption.invocationId,
      productBaseHead: consumption.productBaseHead,
      taskId: consumption.taskId,
    }));
    assert.equal(consumption.transitionKey, transitionKey({
      kind: 'agenticloop.transition.start',
      schemaVersion: 1,
      repositoryIdentity: consumption.repositoryIdentity,
      taskId: consumption.taskId,
      attemptId: actualAttemptId,
      actionId: 'role_start',
      protectedInputDigest: consumption.protectedInputDigest,
    }));
    const identity = {
      kind: 'agenticloop.transition.start',
      schemaVersion: 1,
      repositoryIdentity: 'git:synthetic-repository-identity',
      taskId: consumption.taskId,
      attemptId: actualAttemptId,
      actionId: 'role_start',
      protectedInputDigest: 'sha256:synthetic-protected-input',
    };
    const reordered = {
      protectedInputDigest: identity.protectedInputDigest,
      actionId: identity.actionId,
      taskId: identity.taskId,
      repositoryIdentity: identity.repositoryIdentity,
      schemaVersion: identity.schemaVersion,
      kind: identity.kind,
      attemptId: identity.attemptId,
      observedAt: '2040-01-01T00:00:00.000Z',
      renderedCarrierDigest: 'sha256:mutable-rendering',
    };

    const expected = transitionKey({ ...identity, taskId: consumption.taskId });
    assert.equal(identity.taskId, consumption.taskId);
    assert.equal(transitionKey(identity), expected);
    assert.equal(transitionKey(reordered), expected);
    assert.equal(canonicalJson(identity), canonicalJson({ ...identity, actionId: 'role_start' }));
    assert.notEqual(transitionKey({ ...identity, protectedInputDigest: 'sha256:changed-input' }), expected);
    assert.notEqual(transitionKey({ ...identity, taskId: 'T-002' }), expected);
    assert.equal(
      transitionKey({ ...identity, attemptId: NO_ATTEMPT_ID, actionId: 'authorize' }),
      transitionKey({ ...reordered, attemptId: NO_ATTEMPT_ID, actionId: 'authorize' })
    );
    assert.notEqual(transitionKey({ ...identity, attemptId: NO_ATTEMPT_ID }), expected);
  });

  it('runs all six current lifecycle scenarios through the actual CLI and retains measured blocks', async () => {
    const results = await Promise.all(BASELINE_SCENARIOS.map(scenario => runSyntheticScenario(temp, scenario)));
    assert.deepEqual(results.map(result => result.scenario), BASELINE_SCENARIOS);
    const standard = results.find(result => result.scenario === 'standard-serial');
    assert.equal(standard.availability, 'measured');
    assert.equal(standard.counters.executionAttempts, 1);
    assert.equal(standard.counters.dispatchConsumptions, 1);
    assert.equal(standard.counters.supersessions, 0);
    assert.equal(standard.refusal?.step, 'prepare-return');
    assert.ok(standard.refusal?.code && standard.refusal.code !== 'none');
    const pinnedScenarios = {
      'standard-serial': { counts: [2, 2, 5], step: 'prepare-return' },
      remediation: { counts: [2, 2, 5], step: 'prepare-return' },
      'long-pause': { counts: [2, 1, 4] },
      update: { counts: [2, 1, 4], step: 'prepare-return-after-generated-update' },
      'operator-edit': { counts: [2, 2, 5] },
      'eight-step-chain': { counts: [2, 1, 4] },
    };
    for (const result of results) {
      assert.equal(assertPrivacyClean({ counters: result.counters, scenario: result.scenario }).ok, true);
      assert.deepEqual(result.delegations, {
        status: 'partial',
        ordinaryPrefixCount: 1,
        completeReference: 'unavailable',
        repairOnly: 'unavailable',
        limitation: 'the current route stops before candidate, independent review, and audit; it cannot measure the complete three-role reference or repair-only delegations',
      });
      const pinned = pinnedScenarios[result.scenario];
      assert.deepEqual(
        [result.counters.workflowCommits, result.counters.productCommits, result.counters.totalCommits],
        pinned.counts,
        `the frozen pre-change baseline for ${result.scenario} requires deliberate re-measurement with evidence`
      );
      if (pinned.step) {
        assert.deepEqual(result.refusal, { step: pinned.step, code: 'verification.context.malformed' });
      } else {
        assert.equal(result.availability, 'unavailable');
        assert.match(result.unavailableReason, /missing command:/);
        assert.equal(result.refusal, null);
      }
    }
  });
});
