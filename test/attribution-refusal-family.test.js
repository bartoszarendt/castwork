import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateCommitAttribution,
  evaluateWorkUnitCommitAttribution,
} from '../src/commit-attribution.js';
import { evaluatePreflight } from '../src/github-preflight.js';
import { createReviewEntryReceipt } from '../src/review-entry-receipt.js';
import { taskContractDigest } from '../src/task-contract-baseline.js';
import { HARD_REFUSAL_ALLOWLIST, REFUSAL_CLASSES } from '../src/refusal-classes.js';

const HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

function preflightBody() {
  return [
    '## Scope Completed', 'Attribution proof.', '',
    '## Artifacts', `PR at ${HEAD}.`, '',
    '## Evidence', `Current PR head: ${HEAD}`, '',
    '- Required check: `npm test`', '  Verdict: passed', '  Evidence: tests passed', '',
    '## Deviations', 'None.', '', '## Known Gaps', 'None.', '', '## Follow-Ups', 'None.', '',
    '[[agent: engineer]]',
  ].join('\n');
}

function receiptFixture(commits) {
  const body = [
    '---', 'task_id: T-035', 'independent_review_required: false', '---',
    '# T-035', '', '## Scope', 'Receipt coverage.', '', '## Out of Scope', 'None.', '',
    '## Acceptance Criteria', 'Receipt is current.', '', '## Required Checks', '- [RC-1] `npm test`',
  ].join('\n');
  const contract = taskContractDigest(body);
  return {
    loaded: {
      input: {
        prData: { number: 35, baseRefOid: 'c'.repeat(40), headRefOid: HEAD, files: [{ path: 'src/receipt.js' }], commits },
        issueData: { number: 35, body },
        reviewHistory: { events: [], errors: [] },
      },
    },
    result: {
      ok: true, errors: [], warnings: [],
      requiredChecks: [{ id: 'RC-1', text: '[RC-1] `npm test`', matchKey: 'npm test' }],
      evidenceMatches: [{ id: 'RC-1', check: '[RC-1] `npm test`', verdict: 'passed', evidence: 'tests passed' }],
      contractBaseline: { digest: contract.digest, baseline: null },
    },
  };
}

describe('attribution/adoption hard-refusal proofs', () => {
  const expectedCodes = [
    'attribution.work_unit',
    'attribution.trailer',
    'attribution.role',
    'preflight.attribution',
  ];

  it('work-unit-mismatch-is-refused', () => {
    const workUnit = evaluateWorkUnitCommitAttribution({
      message: 'reviewed work\n\nWork-Unit: WU-other\nTasks: T-1, T-2\nAgent: maintainer',
      workUnitId: 'WU-current', taskIds: ['T-1', 'T-2'], role: 'maintainer',
    });
    assert.equal(workUnit.ok, false);
    assert.ok(workUnit.diagnostics.some(item => item.code === 'attribution.work_unit'));
  });

  it('task-trailer-mismatch-is-refused', () => {
    const trailer = evaluateCommitAttribution({
      message: 'implementation\n\nTask: T-other\nAgent: engineer', taskId: 'T-current', role: 'engineer',
    });
    assert.equal(trailer.ok, false);
    assert.ok(trailer.diagnostics.some(item => item.code === 'attribution.trailer'));
  });

  it('code-disjointness-separates-requested-role-validity-from-final-agent-trailer', () => {
    const wrongAgent = evaluateCommitAttribution({
      message: 'implementation\n\nTask: T-current\nAgent: maintainer', taskId: 'T-current', role: 'engineer',
    });
    assert.equal(wrongAgent.ok, false);
    assert.deepEqual(wrongAgent.diagnostics.map(item => item.code), ['attribution.trailer']);

    for (const role of ['reviewer', 'Engineer']) {
      const invalidRequestedRole = evaluateCommitAttribution({
        message: `implementation\n\nTask: T-current\nAgent: ${role.toLowerCase()}`, taskId: 'T-current', role,
      });
      assert.equal(invalidRequestedRole.ok, false, role);
      assert.deepEqual(invalidRequestedRole.diagnostics.map(item => item.code), ['attribution.role'], role);
    }
  });

  it('refuses review-entry receipt when an earlier PR commit fails canonical F5 attribution', () => {
    const earlier = 'b'.repeat(40);
    const { loaded, result } = receiptFixture([
      { oid: earlier, message: 'earlier implementation\n\nTask: T-other\nAgent: engineer' },
      { oid: HEAD, message: 'current implementation\n\nTask: T-035\nAgent: engineer' },
    ]);
    assert.throws(
      () => createReviewEntryReceipt(loaded, result),
      error => error instanceof TypeError &&
        error.message.includes(`review entry attribution for commit ${earlier} is invalid`) &&
        error.message.includes("stale Task trailer 'T-other'; expected 'T-035'"),
    );
  });

  it('github-role-conflict-is-refused', () => {
    const preflight = evaluatePreflight({
      prData: {
        number: 42, headRefOid: HEAD, body: preflightBody(), statusCheckRollup: [],
        commits: [{ oid: HEAD, message: 'implementation\n\nTask: #7\nAgent: maintainer' }],
      },
      issueData: {
        number: 7,
        body: '# T-001\n\n## Required Checks\n- `npm test`\n\n## Acceptance Criteria\n- done',
        comments: [],
      },
    });
    assert.equal(preflight.ok, false);
    assert.ok(preflight.diagnostics.some(item => item.code === 'preflight.attribution'));
  });

  it('binds every F5 hard refusal to a unique executable adversarial proof', () => {
    const proofs = HARD_REFUSAL_ALLOWLIST
      .filter(entry => expectedCodes.includes(entry.code))
      .map(entry => entry.negativeProof);
    assert.equal(proofs.length, expectedCodes.length);
    assert.equal(new Set(proofs).size, expectedCodes.length);
    for (const code of expectedCodes) {
      assert.equal(REFUSAL_CLASSES[code].family, 'F5');
      assert.equal(REFUSAL_CLASSES[code].refusalClass, 'retained_hard_refusal');
    }
  });

  it('records F5 role metadata only for requested-role validity', () => {
    const role = REFUSAL_CLASSES['attribution.role'];
    const allowlist = HARD_REFUSAL_ALLOWLIST.find(entry => entry.code === 'attribution.role');
    assert.equal(role.rationale, 'requested-workflow-role-validity');
    assert.equal(role.repairClass, 'repair requested role');
    assert.equal(role.semanticInvalidators, 'the requested role is lowercase and resolves in the canonical workflow-role registry');
    assert.match(role.proof, /code-disjointness-separates-requested-role-validity-from-final-agent-trailer/);
    assert.match(allowlist.negativeProof, /requested commit-attribution role is invalid or not lowercase/);
  });
});
