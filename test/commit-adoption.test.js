import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCommitAdoption } from '../src/commit-adoption.js';

const BASE = 'a'.repeat(40);
const HUMAN_FIX = 'b'.repeat(40);
const CURRENT = 'c'.repeat(40);

function gitFixture({ reachable = true, merge = false, paths = ['src/fix.js'] } = {}) {
  return args => {
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      return { status: reachable ? 0 : 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-list' && args[1] === '--reverse') {
      return { status: 0, stdout: `${HUMAN_FIX}\n`, stderr: '' };
    }
    if (args[0] === 'rev-list' && args[1] === '--parents') {
      return { status: 0, stdout: `${HUMAN_FIX} ${BASE}${merge ? ` ${'d'.repeat(40)}` : ''}\n`, stderr: '' };
    }
    if (args[0] === 'diff-tree') return { status: 0, stdout: `${paths.join('\n')}\n`, stderr: '' };
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

function adoption(overrides = {}) {
  return evaluateCommitAdoption({
    runGit: gitFixture(),
    currentHead: CURRENT,
    range: { base: BASE, head: HUMAN_FIX },
    originalBase: BASE,
    allowedPaths: ['src/**'],
    protectedContract: { authorized: 'contract-1', current: 'contract-1' },
    riskClass: { authorized: 'standard', current: 'standard' },
    attempt: { id: 'attempt-1', authorization: 'authorization-1' },
    executor: 'supervisor',
    actor: { class: 'human', id: 'human-1' },
    reason: 'A human applied the bounded correction before the supervisor resumed.',
    ...overrides,
  });
}

describe('commit adoption', () => {
  it('adopts a reachable human fix with recorded attribution and preserves the bounded attempt', () => {
    const result = adoption();

    assert.equal(result.ok, true);
    assert.deepEqual(result.adoption, {
      range: { base: BASE, head: HUMAN_FIX }, commits: [HUMAN_FIX],
      changedPaths: ['src/fix.js'],
      actor: { class: 'human', id: 'human-1' },
      reason: 'A human applied the bounded correction before the supervisor resumed.',
    });
    assert.deepEqual(result.preserved, { attempt: { id: 'attempt-1', authorization: 'authorization-1' }, originalBase: BASE });
    assert.deepEqual(result.certification.invalidated, ['required_checks', 'review', 'audit', 'closeout']);
    assert.deepEqual(result.certification.rerun, ['required_checks', 'review', 'audit']);
    assert.equal(result.nextOwner, null);
  });

  it('refuses an unrelated commit whose ancestry is unreachable from current repository state', () => {
    const result = adoption({ runGit: gitFixture({ reachable: false }) });
    assert.equal(result.ok, false);
    assert.equal(result.nextOwner, 'owner');
    assert.match(result.reasons.join('\n'), /not reachable/);
  });

  it('refuses a merge whose task-relevant range is ambiguous', () => {
    const result = adoption({ runGit: gitFixture({ merge: true }) });
    assert.equal(result.ok, false);
    assert.equal(result.nextOwner, 'owner');
    assert.match(result.reasons.join('\n'), /merge/);
  });

  it('refuses an out-of-scope changed path and returns it to the owner', () => {
    const result = adoption({ runGit: gitFixture({ paths: ['src/fix.js', 'docs/unrelated.md'] }) });
    assert.equal(result.ok, false);
    assert.equal(result.nextOwner, 'owner');
    assert.match(result.reasons.join('\n'), /not allowed/);
  });

  it('refuses protected-contract or risk changes under the existing authorization', () => {
    const result = adoption({ protectedContract: { authorized: 'contract-1', current: 'contract-2' } });
    assert.equal(result.ok, false);
    assert.equal(result.nextOwner, 'owner');
    assert.match(result.reasons.join('\n'), /protected contract/);
  });

  it('refuses missing protected-contract and risk-class identities with typed diagnostics', () => {
    const missingContract = adoption({ protectedContract: undefined });
    const missingRisk = adoption({ riskClass: undefined });

    for (const result of [missingContract, missingRisk]) {
      assert.equal(result.ok, false);
      assert.equal(result.nextOwner, 'owner');
    }
    assert.deepEqual(missingContract.diagnostics, [{ type: 'protected_contract_missing', evidenceState: 'malformed' }]);
    assert.deepEqual(missingRisk.diagnostics, [{ type: 'risk_class_missing', evidenceState: 'malformed' }]);
  });

  it('uses canonical directory and question-mark scope matching', () => {
    const directoryScope = adoption({ allowedPaths: ['src/'] });
    const questionGlobScope = adoption({
      allowedPaths: ['src/fix?.js'],
      runGit: gitFixture({ paths: ['src/fix1.js'] }),
    });

    assert.equal(directoryScope.ok, true);
    assert.equal(questionGlobScope.ok, true);
  });
});
