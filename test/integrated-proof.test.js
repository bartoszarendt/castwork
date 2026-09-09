import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { HARD_REFUSAL_ALLOWLIST, REFUSAL_CLASSES } from '../src/refusal-classes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', `phase${36}-eight-step-chain`, 'fixture.json'), 'utf8'));
const proof = readFileSync(join(ROOT, 'docs', 'integrated-proof.md'), 'utf8');
const fieldAssertions = readFileSync(join(ROOT, 'docs', 'field-assertions.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const SERIAL_FIXTURE_MEASUREMENTS = Object.freeze({
  M3: [1, 0, 0],
  M4: 6193,
  M5: [4632, 4097, 2362],
  M6: 2071,
  M7: [77, 18, 95],
});

describe('integrated lifecycle proof', () => {
  it('keeps the synthetic eight-step refusal chain complete, ordered, and target-free', () => {
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
      assert.doesNotMatch(JSON.stringify(step), /target\s*(source|path|checkout)|raw\s*(session|prompt|transcript)/i);
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
    assert.equal(hard.length, 77);
    assert.equal(human.length, 18);
    assert.equal(hard.length + human.length, HARD_REFUSAL_ALLOWLIST.length);
    for (const entry of HARD_REFUSAL_ALLOWLIST) assert.match(entry.negativeProof, /\S/);
    assert.deepEqual([hard.length, human.length, HARD_REFUSAL_ALLOWLIST.length], SERIAL_FIXTURE_MEASUREMENTS.M7);
  });

  it('pins reported non-Git serial-fixture measurements to their exact value', () => {
    assert.deepEqual(SERIAL_FIXTURE_MEASUREMENTS, {
      M3: [1, 0, 0], M4: 6193,
      M5: [4632, 4097, 2362], M6: 2071, M7: [77, 18, 95],
    });
    for (const value of [
      '1 attempt, 0 abandonments, 0 supersessions',
      '6,193 canonical words', 'Maintainer 4,632; Engineer 4,097; Auditor 2,362 canonical words',
      '2,071 canonical words', '77 retained hard refusals and 18 material human decisions',
    ]) assert.match(proof, new RegExp(value));
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

  it('keeps proof records inside the packed artifact and names all integrated scenarios', () => {
    for (const path of ['docs/integrated-proof.md', 'docs/field-assertions.md']) {
      assert.ok(packageJson.files.includes(path), `${path} must be packaged with the candidate`);
    }
    for (const phrase of [
      'Standard serial lifecycle through simulated review, audit, and closeout', 'Existing product adoption, preserved failed-attempt history, rerun checks and review',
      'Source, packed archive, clean installation', 'Synthetic chain and privacy scan',
    ]) assert.match(proof, new RegExp(phrase));
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' }));
    const packedPaths = packed[0].files.map(file => file.path);
    for (const path of ['docs/integrated-proof.md', 'docs/field-assertions.md']) {
      assert.ok(packedPaths.includes(path), `${path} is missing from npm pack`);
    }
  }, { timeout: 120000 });
});
