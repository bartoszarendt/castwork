import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCertificationFreshness, evaluateRemediationAuthority } from '../src/certification-remediation.js';
import { deriveFinishCandidate } from '../src/finish-candidate.js';

const BASE = 'a'.repeat(40);
const CANDIDATE_HEAD = 'b'.repeat(40);
const MUTATED_HEAD = 'c'.repeat(40);

function candidate(head = CANDIDATE_HEAD) {
  return deriveFinishCandidate({
    backend: 'files',
    productRange: { base: BASE, head, commits: [head] },
    productChangedPaths: ['src/fix.js'],
    workflowChangedPaths: [],
    requiredChecks: [{ id: 'RC-1' }],
    returnIdentity: {
      taskId: 'T-001',
      packetId: 'dispatch:00000000-0000-4000-8000-000000000001',
      returnId: 'return:00000000-0000-4000-8000-000000000002',
    },
    candidateHead: head,
  });
}

const CANDIDATE = candidate();
const MUTATED = candidate(MUTATED_HEAD);

function certification(overrides = {}) {
  return evaluateCertificationFreshness({
    candidate: CANDIDATE,
    persistedCandidate: CANDIDATE,
    producer: { role: 'engineer', id: 'engineer-1' },
    review: { candidate: CANDIDATE, role: 'maintainer', id: 'maintainer-1' },
    audit: { candidate: CANDIDATE, role: 'auditor', id: 'auditor-1' },
    ...overrides,
  });
}

function remediation(overrides = {}) {
  return evaluateRemediationAuthority({
    authorization: { contract: 'contract-1', risk: 'standard', attempt: 'attempt-1' },
    finding: { contract: 'contract-1', risk: 'standard', widensIntent: false },
    ...overrides,
  });
}

describe('review, audit, and remediation', () => {
  it('refuses a producing role that attempts to certify its own output', () => {
    const result = certification({ review: { candidate: CANDIDATE, role: 'engineer', id: 'engineer-1' } });
    assert.equal(result.ok, false);
    assert.match(result.reasons.join('\n'), /producing/);
  });

  it('refuses stale review or audit verdicts after candidate mutation', () => {
    const result = certification({ candidate: MUTATED });
    assert.equal(result.ok, false);
    assert.match(result.reasons.join('\n'), /candidate/);
  });

  it('refuses a candidate that is not the canonical persisted finish candidate', () => {
    const result = certification({ candidate: { head: CANDIDATE_HEAD } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics, [{ type: 'candidate_not_canonical', evidenceState: 'malformed' }]);
  });

  it('refuses blank Maintainer or Auditor identities with typed diagnostics', () => {
    const blankMaintainer = certification({ review: { candidate: CANDIDATE, role: 'maintainer', id: ' ' } });
    const blankAuditor = certification({ audit: { candidate: CANDIDATE, role: 'auditor', id: '\t' } });

    assert.equal(blankMaintainer.ok, false);
    assert.equal(blankAuditor.ok, false);
    assert.deepEqual(blankMaintainer.diagnostics, [{ type: 'maintainer_identity_missing', evidenceState: 'malformed' }]);
    assert.deepEqual(blankAuditor.diagnostics, [{ type: 'auditor_identity_missing', evidenceState: 'malformed' }]);
  });

  it('opens an in-contract remediation cycle under the existing authorization', () => {
    const result = remediation();
    assert.deepEqual(result, {
      authorized: true,
      nextOwner: null,
      cycle: { attempt: 'attempt-1', preservesAuthorization: true, invalidates: ['review', 'audit', 'closeout'] },
      reasons: [],
    });
  });

  it('requires owner action when a finding would expand task intent', () => {
    const result = remediation({ finding: { contract: 'contract-1', risk: 'standard', widensIntent: true } });
    assert.equal(result.authorized, false);
    assert.equal(result.nextOwner, 'owner');
    assert.match(result.reasons.join('\n'), /widens task intent/);
  });

  it('requires an explicit non-widening determination before authorizing remediation', () => {
    const result = remediation({ finding: { contract: 'contract-1', risk: 'standard' } });
    assert.equal(result.authorized, false);
    assert.equal(result.nextOwner, 'owner');
    assert.deepEqual(result.diagnostics, [{ type: 'finding_widens_intent_unconfirmed', evidenceState: 'malformed' }]);
  });
});
