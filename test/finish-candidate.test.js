import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveFinishCandidate, FinishCandidateIdentityError, finishCandidateIsCurrent } from '../src/finish-candidate.js';

const BASE = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const LATER_CANDIDATE = 'c'.repeat(40);

function finish(backend, overrides = {}) {
  return deriveFinishCandidate({
    backend,
    productRange: { base: BASE, head: CANDIDATE, commits: [CANDIDATE] },
    productChangedPaths: ['src/feature.js'],
    workflowChangedPaths: ['.agenticloop/tasks/T-001.md'],
    requiredChecks: [{ id: 'RC-1' }, { id: 'RC-2' }],
    returnIdentity: backend === 'files'
      ? {
          taskId: 'T-001',
          packetId: 'dispatch:00000000-0000-4000-8000-000000000001',
          returnId: 'return:00000000-0000-4000-8000-000000000002',
        }
      : { taskId: '7', pr: 42, head: CANDIDATE },
    candidateHead: CANDIDATE,
    ...overrides,
  });
}

describe('atomic finish candidate matrices', () => {
  for (const backend of ['files', 'github']) {
    it(`${backend}: derives all five finish outputs as one retry-stable result`, () => {
      const first = finish(backend);
      assert.deepEqual(finish(backend), first);
      assert.deepEqual(first.productRange, { base: BASE, head: CANDIDATE, commits: [CANDIDATE] });
      assert.deepEqual(first.changedPathVerdict, {
        state: 'current', productPaths: ['src/feature.js'], workflowPaths: ['.agenticloop/tasks/T-001.md'],
      });
      assert.deepEqual(first.requiredCheckSet, ['RC-1', 'RC-2']);
      assert.equal(first.certificationInvalidation.state, 'current');
      assert.equal(finishCandidateIsCurrent(first, CANDIDATE), true);
    });

    it(`${backend}: a later product candidate invalidates only prior candidate evidence`, () => {
      const invalidated = finish(backend, { observedCandidateHead: LATER_CANDIDATE });
      assert.equal(invalidated.certificationInvalidation.state, 'invalidated');
      assert.deepEqual(invalidated.certificationInvalidation.invalidatedEvidence,
        ['required_checks', 'return', 'review', 'audit', 'closeout']);
      assert.deepEqual(invalidated.certificationInvalidation.preservedEvidence, ['unrelated_workflow']);
      assert.equal(finishCandidateIsCurrent(invalidated, LATER_CANDIDATE), false);
    });
  }

  it('refuses a split changed-path verdict', () => {
    assert.throws(() => finish('files', { workflowChangedPaths: ['src/feature.js'] }), /both product and workflow/);
  });

  it('refuses an empty or degenerate return identity with a typed diagnostic', () => {
    let error = null;
    try {
      finish('files', { returnIdentity: {} });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof FinishCandidateIdentityError);
    assert.match(error.message, /finish return identity is missing, degenerate, or not exact/);
    assert.equal(error.code, 'role_return.invalid');
    assert.equal(error.evidenceState, 'malformed');
  });
});
