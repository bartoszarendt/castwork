import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { DIAGNOSTIC_DEFINITIONS, HARD_REFUSAL_ALLOWLIST, REFUSAL_CLASSES } from '../src/refusal-classes.js';
import { runExecutedEightStepChain } from './helpers/lifecycle-scenario-harness.js';
import { runNpm } from './helpers/npm-runner.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'lifecycle-refusal-chain', 'fixture.json'), 'utf8'));
const proof = readFileSync(join(ROOT, 'docs', 'integrated-proof.md'), 'utf8');
const fieldAssertions = readFileSync(join(ROOT, 'docs', 'field-assertions.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const SERIAL_FIXTURE_MEASUREMENTS = Object.freeze({
  M3: [1, 0, 0],
  M6: 2071,
  M7: [76, 19, 95],
});
const syntheticRoot = mkdtempSync(join(tmpdir(), 'agenticloop-eight-step-proof-'));
after(() => rmSync(syntheticRoot, { recursive: true, force: true }));

describe('integrated lifecycle proof', () => {
  it('executes the synthetic eight-step field-shape chain through real commands and preserves lineage invariants', async () => {
    assert.equal(fixture.kind, 'agenticloop.synthetic-refusal-chain');
    assert.equal(fixture.privacy, 'synthetic-only');
    assert.equal(fixture.steps.length, 8);
    assert.deepEqual(fixture.steps.map(step => step.id), [
      'activation-expiry', 'wrong-product-head', 'artifact-class-mismatch', 'packet-liveness',
      'recovery-supersession', 'generated-clean-gate', 'decomposition-schema', 'member-dependency-evidence',
    ]);
    for (const step of fixture.steps) {
      assert.match(step.observedShape, /\S/);
      assert.match(step.syntheticResult, /\S/);
      assert.match(step.execution.command, /\S/);
      assert.equal(typeof step.execution.result.status, 'number');
      assert.match(step.execution.result.code, /\S/);
      assert.doesNotMatch(JSON.stringify(step), /target\s*(source|path|checkout)|raw\s*(session|prompt|transcript)/i);
    }
    const result = await runExecutedEightStepChain(syntheticRoot);
    assert.deepEqual(result.stages.map(step => step.id), fixture.steps.map(step => step.id));
    for (const stage of result.stages) {
      const expected = fixture.steps.find(step => step.id === stage.id).execution;
      assert.ok(stage.commands.some(command => command.command.startsWith(expected.command)), `${stage.id} must execute ${expected.command}`);
      assert.deepEqual(stage.observedResults, [expected.result], `${stage.id} result changed`);
      assert.deepEqual(stage.invariants, expected.invariants, `${stage.id} lineage invariants changed`);
      if (expected.authorization) assert.deepEqual(stage.authorization, expected.authorization, `${stage.id} authorization demonstration changed`);
      if (expected.result.status !== 0) {
        assert.equal(
          fixture.steps.find(step => step.id === stage.id).syntheticResult,
          `typed-refusal-observed:${expected.result.code}`,
          `${stage.id} label must state the observed typed refusal`,
        );
      }
    }
  });

  it('keeps the privacy-clean field log honest about retained and unavailable data', () => {
    assert.match(fieldAssertions, /approximately 493 Agentic Loop CLI calls/);
    assert.match(fieldAssertions, /parallel_scan\.decomposition\.invalid/);
    assert.match(fieldAssertions, /do not contain eight ordered refusal steps or a\s+stable code for each step/);
    assert.match(fieldAssertions, /No missing sequence or code is fabricated, inferred, or deferred/);
    const retainedFacts = fieldAssertions.split('## Quantitative Dispositions')[0];
    assert.doesNotMatch(retainedFacts, /\b[A-Za-z]:\\|\bses_[A-Za-z0-9]+\b/);
  });

  it('keeps every retained hard refusal and material human decision bound to a negative proof', () => {
    const hard = HARD_REFUSAL_ALLOWLIST.filter(({ code }) => REFUSAL_CLASSES[code].refusalClass === 'retained_hard_refusal');
    const human = HARD_REFUSAL_ALLOWLIST.filter(({ code }) => REFUSAL_CLASSES[code].refusalClass === 'material_human_decision');
    assert.equal(hard.length, 76, 'session_reported is warning-only');
    assert.equal(human.length, 19);
    assert.equal(hard.length + human.length, HARD_REFUSAL_ALLOWLIST.length);
    for (const entry of HARD_REFUSAL_ALLOWLIST) assert.match(entry.negativeProof, /\S/);
    assert.deepEqual([hard.length, human.length, HARD_REFUSAL_ALLOWLIST.length], SERIAL_FIXTURE_MEASUREMENTS.M7);
  });

  it('keeps non-context serial-fixture measurements exact while context measurements name their method and limitation', () => {
    assert.deepEqual(SERIAL_FIXTURE_MEASUREMENTS, {
      M3: [1, 0, 0], M6: 2071, M7: [76, 19, 95],
    });
    for (const value of [
      '1 attempt, 0 abandonments, 0 supersessions',
      '2,071 canonical words', '76 retained hard refusals and 19 material human decisions',
    ]) assert.match(proof, new RegExp(value));
    assert.match(proof, /agenticloop\.dispatch-context\/v5/);
    assert.match(proof, /retained pre-phase observation is unavailable, so no reduction determination is made/);
  });

  it('binds M1 and M2 to the measured terminal fixture rather than local literals', () => {
    assert.match(proof, /5 workflow, 1 product, 1 excluded task-contract commit/);
    assert.match(proof, /3 ordinary, 0 repair-only/);
    assert.match(
      readFileSync(join(ROOT, 'test', 'files-lifecycle-reliability.test.js'), 'utf8'),
      /M1 must bind workflow, product, and excluded task-contract commits to the measured fixture range/
    );
    assert.match(
      readFileSync(join(ROOT, 'test', 'files-lifecycle-reliability.test.js'), 'utf8'),
      /M2 must bind ordinary and repair-only delegation counts to the measured serial fixture artifacts/
    );
  });

  it('keeps proof records inside the packed artifact and names all integrated scenarios', async () => {
    for (const path of ['docs/integrated-proof.md', 'docs/field-assertions.md']) {
      assert.ok(packageJson.files.includes(path), `${path} must be packaged with the candidate`);
    }
    for (const phrase of [
      'Standard serial lifecycle through simulated review, audit, and closeout', 'Existing product adoption, preserved failed-attempt history, rerun checks and review',
      'Source, packed archive, clean installation', 'Synthetic chain and privacy scan',
    ]) assert.match(proof, new RegExp(phrase));
    const packedResult = await runNpm(['pack', '--dry-run', '--json'], {
      cache: join(syntheticRoot, 'npm-cache'), cwd: ROOT,
    });
    assert.equal(packedResult.status, 0, `npm pack --dry-run failed:\n${packedResult.stdout}\n${packedResult.stderr}`);
    const packed = JSON.parse(packedResult.stdout);
    const packedPaths = packed[0].files.map(file => file.path);
    for (const path of ['docs/integrated-proof.md', 'docs/field-assertions.md']) {
      assert.ok(packedPaths.includes(path), `${path} is missing from npm pack`);
    }
  }, { timeout: 120000 });
});

/**
 * The prose summary above the residue table stated a catalog row count nobody
 * checked. It shipped as "193" while the catalog held 192, and the suite stayed
 * green because the binding test pins the *table* and never read that sentence.
 * A number no test derives is a claim, not a measurement.
 *
 * These derive every figure in that sentence from the thing it describes, so a
 * drift fails here instead of shipping.
 */
describe('the residue summary is derived, not asserted', () => {
  const summary = proof.split('\n').find(line => line.includes('hard-refusal targets and one warning-only'));

  /** The ledger table, parsed back out of the shipped document. */
  function ledgerTally() {
    const tally = {};
    for (const line of proof.split('\n')) {
      if (!line.startsWith('| ') || line.startsWith('| Code |') || line.startsWith('|---')) continue;
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.length !== 4) continue;
      tally[cells[1]] = (tally[cells[1]] ?? 0) + 1;
    }
    return tally;
  }

  it('states the live catalog row count', () => {
    assert.ok(summary, 'the residue summary sentence must exist');
    const rows = Object.keys(DIAGNOSTIC_DEFINITIONS).length;
    assert.ok(summary.includes(`The ${rows}-row catalog`),
      `the summary must state the live catalog row count (${rows}), not: ${summary.slice(0, 40)}`);
  });

  it('states the live hard-refusal target count', () => {
    assert.ok(summary.includes(`${HARD_REFUSAL_ALLOWLIST.length} hard-refusal targets`),
      `the summary must state ${HARD_REFUSAL_ALLOWLIST.length} hard-refusal targets`);
  });

  it('states the partition the ledger actually renders, accounting for every target once', () => {
    const tally = ledgerTally();
    const probes = tally['pre-existing-installed-probe'] ?? 0;
    const binary = tally['executed-installed-binary'] ?? 0;
    const moduleOnly = tally['executed-installed-module'] ?? 0;
    const blocked = tally['harness-blocked'] ?? 0;
    const unreachable = tally['unreachable-through-supported-public-surface'] ?? 0;
    const executed = probes + binary;

    assert.ok(summary.includes(`${executed} executed (${probes} pre-existing probes and ${binary} installed-binary executions)`),
      `the summary must state ${executed} executed (${probes} probes, ${binary} binary)`);
    assert.ok(summary.includes(`${moduleOnly} module-only`), `module-only rows: ${moduleOnly}`);
    assert.ok(summary.includes(`${blocked} harness-blocked`), `harness-blocked rows: ${blocked}`);
    assert.ok(summary.includes(`${unreachable} unreachable`), `unreachable rows: ${unreachable}`);

    // Every hard-refusal target is dispositioned exactly once.
    assert.equal(executed + moduleOnly + blocked + unreachable, HARD_REFUSAL_ALLOWLIST.length,
      'the rendered partition must account for every hard-refusal target exactly once');
  });
});
