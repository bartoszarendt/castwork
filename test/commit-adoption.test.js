import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMIT_ADOPTION_ASSURANCE,
  COMMIT_ADOPTION_CONSUMERS,
  createCommitAdoptionRecord,
  evaluateCommitAdoption,
  validateCommitAdoptionRecord,
} from '../src/commit-adoption.js';

const BASE = 'a'.repeat(40);
const HUMAN_FIX = 'b'.repeat(40);
const CURRENT = 'c'.repeat(40);
const WORKFLOW_RECEIPT = 'd'.repeat(40);

function gitFixture({
  reachable = true,
  merge = false,
  commits = [HUMAN_FIX],
  paths = ['src/fix.js'],
  pathsByCommit = {},
  messagesByCommit = {},
} = {}) {
  return args => {
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      return { status: reachable ? 0 : 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-list' && args[1] === '--reverse') {
      return { status: 0, stdout: `${commits.join('\n')}\n`, stderr: '' };
    }
    if (args[0] === 'rev-list' && args[1] === '--parents') {
      const commit = args.at(-1);
      const index = commits.indexOf(commit);
      const parent = index > 0 ? commits[index - 1] : BASE;
      return { status: 0, stdout: `${commit} ${parent}${merge ? ` ${'e'.repeat(40)}` : ''}\n`, stderr: '' };
    }
    if (args[0] === 'diff-tree') {
      const commit = args.at(-1);
      const changedPaths = pathsByCommit[commit] ?? paths;
      return { status: 0, stdout: `${changedPaths.join('\n')}\n`, stderr: '' };
    }
    if (args[0] === 'show' && args[1] === '-s' && args[2] === '--format=%B') {
      return { status: 0, stdout: messagesByCommit[args[3]] ?? 'Product implementation\n', stderr: '' };
    }
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
    actor: { class: 'operator', id: 'operator-1' },
    reason: 'An operator claimed the bounded correction before the supervisor resumed.',
    ...overrides,
  });
}

describe('commit adoption', () => {
  it('grades claimed origin as non-authenticated while preserving the bounded attempt', () => {
    const result = adoption();

    assert.equal(result.ok, true);
    assert.equal(result.assurance, COMMIT_ADOPTION_ASSURANCE);
    assert.deepEqual(result.adoption, {
      range: { base: BASE, head: HUMAN_FIX }, commits: [HUMAN_FIX],
      changedPaths: ['src/fix.js'],
      actor: { class: 'operator', id: 'operator-1' },
      reason: 'An operator claimed the bounded correction before the supervisor resumed.',
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

  it('excludes protected-command workflow receipts from adopted product paths', () => {
    const result = adoption({
      currentHead: WORKFLOW_RECEIPT,
      range: { base: BASE, head: WORKFLOW_RECEIPT },
      runGit: gitFixture({
        commits: [HUMAN_FIX, WORKFLOW_RECEIPT],
        pathsByCommit: {
          [HUMAN_FIX]: ['src/fix.js'],
          [WORKFLOW_RECEIPT]: ['.agenticloop/tasks/T-001.md'],
        },
        messagesByCommit: {
          [WORKFLOW_RECEIPT]: 'Record protected evidence\n\nWorkflow-Class: workflow_evidence\nTask: T-001\nAgent: maintainer\n',
        },
      }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.adoption.changedPaths, ['src/fix.js']);
  });

  it('refuses a collapsed workflow class that authors a product path', () => {
    const result = adoption({
      runGit: gitFixture({
        messagesByCommit: {
          [HUMAN_FIX]: 'Forged protected evidence\n\nWorkflow-Class: workflow_disposition\nTask: T-001\nAgent: maintainer\n',
        },
      }),
    });

    assert.equal(result.ok, false);
    assert.match(result.reasons.join('\n'), /authors a product path/);
  });

  it('uses a closed claimed-actor vocabulary', () => {
    const result = adoption({ actor: { class: 'human', id: 'operator-1' } });
    assert.equal(result.ok, false);
    assert.match(result.reasons.join('\n'), /operator, delegated-agent, unknown/);
  });

  it('rejects hand-authored, forged, stale, cross-target, cross-attempt, and future-dated records', () => {
    const evaluation = adoption();
    const record = createCommitAdoptionRecord({
      repositoryIdentity: 'file:/target-a', taskId: 'T-001', taskContractDigest: 'contract-1',
      riskClass: 'standard', evaluation, adoptedAt: '2026-08-08T12:00:00.000Z',
    });
    const cases = [
      ['hand-authored', (() => { const value = { ...record }; delete value.semanticDigest; return value; })(), {}],
      ['forged', { ...record, adoption: { ...record.adoption, actor: { class: 'unknown', id: 'forged' } } }, {}],
      ['stale', record, { taskContractDigest: 'contract-2' }],
      ['cross-target', record, { repositoryIdentity: 'file:/target-b' }],
      ['cross-attempt', record, { attemptId: 'attempt-2' }],
      ['future-dated', { ...record, adoptedAt: '2030-08-08T12:00:00.000Z' }, { now: Date.parse('2026-08-08T12:00:00.000Z') }],
    ];
    for (const [label, candidate, context] of cases) {
      const checked = validateCommitAdoptionRecord(candidate, {
        taskId: 'T-001', taskContractDigest: 'contract-1', baseHead: BASE, head: HUMAN_FIX,
        repositoryIdentity: 'file:/target-a', attemptId: 'attempt-1', now: Date.parse('2026-08-08T12:00:00.000Z'), ...context,
      });
      assert.equal(checked.ok, false, label);
    }
  });

  it('binds an unkeyed display digest while documenting that consumers derive provenance independently', () => {
    const record = createCommitAdoptionRecord({
      repositoryIdentity: 'file:/target-a', taskId: 'T-001', taskContractDigest: 'contract-1',
      riskClass: 'standard', evaluation: adoption(), adoptedAt: '2026-08-08T12:00:00.000Z',
    });
    assert.match(record.semanticDigest, /^sha256:agenticloop\.commit-adoption\.v2:[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(COMMIT_ADOPTION_CONSUMERS).sort(), [
      'commit-range.deriveCommitRange',
      'dispatch-envelope.adoptionAtWorkflowHead',
      'files-return-evidence.deriveReturnTopology',
    ]);
    assert.match(COMMIT_ADOPTION_CONSUMERS['commit-range.deriveCommitRange'], /does not consume/);
    assert.ok(Object.values(COMMIT_ADOPTION_CONSUMERS).every(value => /never range attribution|does not consume/.test(value)));
  });
});
