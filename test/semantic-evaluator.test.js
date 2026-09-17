import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PREPARE_DISPATCH_FACT_IDS,
  SEMANTIC_INPUT_KIND,
  SEMANTIC_INPUT_SCHEMA_VERSION,
  SEMANTIC_METHOD_ID,
  SemanticInputError,
  evaluateSemanticInput,
} from '../src/semantic-evaluator.js';

function input({ backend = 'files', state = {}, value = {}, derivationMethod = 'fixture/v1' } = {}) {
  return {
    kind: SEMANTIC_INPUT_KIND,
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    methodId: SEMANTIC_METHOD_ID,
    request: {
      actionId: 'prepare_dispatch',
      actor: {
        roleId: 'orchestrator', actorId: 'orchestrator',
        authoritySource: 'workflow_role', hostEnforcement: 'advisory',
      },
      target: { repositoryId: 'repository:fixture', backend, taskId: 'T-001', workUnitId: null },
      bindings: {
        protectedContractId: 'contract:one', grantId: 'grant:one', attemptId: null,
        checkInvocationId: null, candidateId: null, reviewRoundId: null,
        auditRunId: null, closeoutId: null, correctionOf: null,
      },
      requestedAssurance: 'host_signed',
    },
    facts: PREPARE_DISPATCH_FACT_IDS.map(id => ({
      id,
      state: state[id] ?? 'current',
      value: value[id] ?? { established: true },
      owner: { kind: 'workflow_role', id: 'maintainer' },
      scope: { kind: id === 'dispatch.repository_identity' ? 'repository' : 'task_contract', key: 'T-001:contract:one' },
      source: { kind: 'fixture', id: `source:${id}`, state: 'available' },
      observedAt: null,
      derivation: { methodId: derivationMethod, observationIds: [`observation:${id}`] },
    })),
  };
}

describe('portable semantic evaluator', () => {
  it('is deterministic, does not mutate input, and distinguishes unknown from illegal', () => {
    const complete = input();
    const before = structuredClone(complete);
    const first = evaluateSemanticInput(complete);
    const second = evaluateSemanticInput(structuredClone(complete));
    assert.deepEqual(complete, before);
    assert.deepEqual(first, second);
    assert.equal(first.verdict, 'legal');
    assert.equal(first.persisted, false);
    assert.equal(first.authority, 'none');

    const missing = evaluateSemanticInput(input({ state: { 'dispatch.activation': 'missing' } }));
    assert.equal(missing.verdict, 'unknown');
    assert.deepEqual(missing.reasons.map(reason => reason.reasonId), ['evidence.missing']);
    assert.equal(missing.requirements[0].owner.id, 'maintainer');

    const violated = evaluateSemanticInput(input({
      state: { 'dispatch.clean_state': 'negative', 'dispatch.return_capability': 'unavailable' },
    }));
    assert.equal(violated.verdict, 'illegal', 'known violation takes precedence over unavailable knowledge');
    assert.deepEqual(violated.reasons.map(reason => reason.evidenceState), ['negative', 'unavailable']);
  });

  it('keeps backend/rendering noise out of verdict and stable reason semantics', () => {
    const states = { 'dispatch.activation': 'revoked' };
    const files = evaluateSemanticInput(input({ backend: 'files', state: states }));
    const github = evaluateSemanticInput(input({ backend: 'github', state: states }));
    assert.equal(files.verdict, github.verdict);
    assert.deepEqual(files.reasons, github.reasons);
    assert.deepEqual(files.requirements, github.requirements);
    assert.notEqual(files.evaluationId, github.evaluationId, 'backend remains part of the complete input identity');

    const unrelatedProjectionData = {
      comments: ['not semantic evidence'],
      generatedHostFiles: ['.opencode/agents/engineer.md'],
      renderedText: 'anything',
      otherTask: { taskId: 'T-999', status: 'blocked' },
    };
    const before = evaluateSemanticInput(input({ state: states }));
    unrelatedProjectionData.comments.push('changed');
    unrelatedProjectionData.otherTask.status = 'accepted';
    const after = evaluateSemanticInput(input({ state: states }));
    assert.deepEqual(after, before);
  });

  it('fails explicitly for unsupported history and incomplete normalized inputs', () => {
    assert.throws(
      () => evaluateSemanticInput({ ...input(), schemaVersion: 0 }),
      error => error instanceof SemanticInputError && error.code === 'semantic_input.schema_unsupported',
    );
    assert.throws(
      () => evaluateSemanticInput({ ...input(), methodId: 'agenticloop.lifecycle-semantics/v0' }),
      error => error instanceof SemanticInputError && error.code === 'semantic_input.method_unsupported',
    );
    const incomplete = input();
    incomplete.facts.pop();
    assert.throws(
      () => evaluateSemanticInput(incomplete),
      error => error instanceof SemanticInputError && error.code === 'semantic_input.invalid',
    );
    assert.throws(
      () => evaluateSemanticInput({ ...input(), request: { ...input().request, actionId: 'invented' } }),
      error => error instanceof SemanticInputError && error.code === 'semantic_input.invalid',
    );
  });

  it('records a corrected derivation as a new evaluation without changing the original result', () => {
    const original = evaluateSemanticInput(input({
      state: { 'dispatch.readiness': 'invalid' },
      value: { 'dispatch.readiness': { derivationFault: true } },
      derivationMethod: 'fixture/incorrect-v1',
    }));
    const preserved = structuredClone(original);
    const corrected = evaluateSemanticInput(input({ derivationMethod: 'fixture/corrected-v2' }));
    assert.equal(original.verdict, 'illegal');
    assert.equal(original.reasons[0].reasonId, 'derivation.fault');
    assert.deepEqual(original.reasons[0].owner, { kind: 'human_actor', id: 'operator' });
    assert.deepEqual(
      original.facts.map(fact => fact.derivation.observationIds),
      corrected.facts.map(fact => fact.derivation.observationIds),
      'correction recomputes from the original observations',
    );
    assert.equal(corrected.verdict, 'legal');
    assert.notEqual(corrected.evaluationId, original.evaluationId);
    assert.deepEqual(original, preserved);
  });

  it('keeps missing evidence separate and explicitly refuses a requested exception', () => {
    const missing = evaluateSemanticInput(input({ state: { 'dispatch.readiness': 'missing' } }));
    assert.equal(missing.verdict, 'unknown');
    assert.equal(missing.reasons[0].reasonId, 'evidence.missing');
    assert.equal(missing.requirements[0].owner.id, 'maintainer');

    const exception = evaluateSemanticInput(input({
      state: { 'dispatch.readiness': 'invalid' },
      value: { 'dispatch.readiness': { exceptionRequested: true } },
    }));
    assert.equal(exception.verdict, 'illegal');
    assert.equal(exception.reasons[0].reasonId, 'exception.not_permitted');
  });
});
