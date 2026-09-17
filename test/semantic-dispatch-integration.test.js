import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  PREPARE_DISPATCH_FACT_IDS,
} from '../src/semantic-evaluator.js';
import {
  projectReadOnlyDispatchEligibility,
} from '../src/dispatch-eligibility.js';
import { prepareRoleDispatch } from '../src/dispatch-envelope.js';
import { createDispatchFixture } from './helpers/dispatch-fixture.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'semantic-dispatch-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function prepare(fixture, inputPatch = {}) {
  let decision = null;
  const result = prepareRoleDispatch({ ...fixture, ...inputPatch }, {
    ...fixture.options,
    onAfterEligibilityEvaluation(_candidate, evaluated) { decision = evaluated; },
  });
  return { result, decision };
}

describe('serial dispatch semantic integration', () => {
  it('makes orientation and packet preparation consume one legal result', async () => {
    const fixture = await createDispatchFixture(temp, 'legal');
    const { result, decision } = prepare(fixture);
    assert.equal(result.ok, true, result.validation?.errors?.join('\n'));
    assert.ok(decision?.semanticEvaluation);
    assert.equal(result.semanticEvaluation, decision.semanticEvaluation);
    assert.equal(result.semanticEvaluation.verdict, 'legal');
    assert.deepEqual(result.semanticEvaluation.facts.map(fact => fact.id), PREPARE_DISPATCH_FACT_IDS);
    assert.equal(projectReadOnlyDispatchEligibility(decision).verdict, result.semanticEvaluation.verdict);
    assert.equal(result.semanticEvaluation.requirements.length, 0);
  });

  it('maps missing material evidence to needs_context without relabeling evaluator unknown', async () => {
    const fixture = await createDispatchFixture(temp, 'missing');
    const { result } = prepare(fixture, { activation: null });
    assert.equal(result.ok, false);
    assert.equal(result.semanticEvaluation.verdict, 'unknown');
    assert.equal(result.validation.disposition, 'needs_context');
    assert.ok(result.semanticEvaluation.reasons.some(reason => reason.evidenceState === 'missing'));
    assert.ok(result.semanticEvaluation.requirements.every(requirement => requirement.owner.id));
  });

  it('keeps a known task-scoped cleanliness violation illegal', async () => {
    const fixture = await createDispatchFixture(temp, 'dirty');
    writeFileSync(join(fixture.root, 'src/dirty.js'), 'export const dirty = true;\n', 'utf8');
    const { result } = prepare(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.semanticEvaluation.verdict, 'illegal');
    assert.ok(result.semanticEvaluation.reasons.some(reason =>
      reason.factId === 'dispatch.clean_state' && reason.evidenceState === 'negative'
    ));
    assert.notEqual(result.validation.disposition, 'needs_context');
  });
});
