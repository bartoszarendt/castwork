import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendAuditReport,
  createAuditRecordContent,
  evaluateAuditCloseoutGate,
} from '../src/audit-record.js';
import { evaluateCloseout } from '../src/closeout.js';
import { evaluateSemanticHandoff } from '../src/semantic-handoff-normalizer.js';
import { semanticEvaluationFor } from '../src/semantic-validation-normalizer.js';

let root;

before(() => { root = mkdtempSync(join(tmpdir(), 'al-semantic-serial-')); });
after(() => { rmSync(root, { recursive: true, force: true }); });

function target(name) {
  const value = mkdtempSync(join(root, `${name}-`));
  mkdirSync(join(value, '.agenticloop', 'audits'), { recursive: true });
  return value;
}

function baseRecord() {
  return createAuditRecordContent({
    auditId: 'AUD-001',
    workUnit: 'phase:37',
    coveredTasks: ['T-037'],
    candidateArtifact: 'commit:abc123',
    goal: 'Complete the bounded work unit.',
    completionOracle: 'The exact candidate passes its required checks.',
    evidence: 'Integrated evidence for commit:abc123.',
  });
}

function gate(repo, overrides = {}) {
  return evaluateAuditCloseoutGate(repo, {
    workUnit: 'phase:37',
    workUnitAudit: 'enabled',
    expectedCandidate: 'commit:abc123',
    expectedCoveredTasks: ['T-037'],
    taskStatus: () => 'accepted',
    ...overrides,
  });
}

describe('portable semantic consumption across the serial audit boundary', () => {
  it('maps missing, stale, legal, and opt-out feature states without collapsing them', () => {
    const repo = target('states');

    const missing = gate(repo);
    assert.equal(semanticEvaluationFor(missing)?.verdict, 'unknown');
    assert.equal(semanticEvaluationFor(missing)?.facts[0].state, 'missing');
    assert.deepEqual(semanticEvaluationFor(missing)?.reasons[0].owner, {
      kind: 'workflow_role', id: 'auditor',
    });

    const certified = appendAuditReport(baseRecord(), {
      verdict: 'certified',
      invocationMode: 'host_subagent',
      invocationReference: 'semantic-serial-auditor-1',
      auditedArtifact: 'commit:abc123',
      assessment: 'The exact bounded candidate satisfies the audit contract.',
      evidenceChecked: 'focused lifecycle checks passed',
      findings: [],
    });
    assert.equal(certified.ok, true, certified.errors?.join('; '));
    writeFileSync(join(repo, '.agenticloop', 'audits', 'AUD-001.md'), certified.content, 'utf8');

    const current = gate(repo);
    assert.equal(semanticEvaluationFor(current)?.verdict, 'legal');
    assert.equal(semanticEvaluationFor(current)?.facts[0].state, 'current');

    const stale = gate(repo, { expectedCandidate: 'commit:def456' });
    assert.equal(semanticEvaluationFor(stale)?.verdict, 'illegal');
    assert.equal(semanticEvaluationFor(stale)?.facts[0].state, 'stale');

    const disabled = gate(repo, { workUnitAudit: 'disabled' });
    assert.equal(semanticEvaluationFor(disabled)?.verdict, 'not_applicable');
    assert.equal(semanticEvaluationFor(disabled)?.facts[0].state, 'not_applicable');
  });

  it('reproduces the exact semantic result from the same normalized evidence', () => {
    const repo = target('deterministic');
    const first = semanticEvaluationFor(gate(repo));
    const second = semanticEvaluationFor(gate(repo));
    assert.deepEqual(second, first);
    assert.equal(second.evaluationId, first.evaluationId);
  });

  it('keeps verified-return recognition scoped below later feature decisions', () => {
    for (const transition of ['acceptance', 'integration', 'closeout']) {
      const result = evaluateSemanticHandoff({
        transition,
        requirement: 'verified_return',
        identity: {
          repositoryIdentity: 'repository:fixture',
          backend: 'files',
          taskId: 'T-037',
          returnId: 'return:T-037:1',
          candidateHead: 'abc123',
        },
      });
      assert.equal(result.request.actionId, 'verify_return');
      assert.equal(result.facts[0].id, 'return.verified');
      assert.equal(result.verdict, 'legal');
    }
  });

  it('associates incomplete closeout readiness with an unknown result', () => {
    const repo = target('closeout-missing');
    mkdirSync(join(repo, '.agenticloop', 'tasks'), { recursive: true });
    const result = evaluateCloseout(repo, {
      workUnit: 'phase:37',
      backend: 'files',
      artifact: '',
      coveredTasks: [],
      config: { task_backend: 'files', work_unit_audit: 'enabled' },
    });
    const semantic = semanticEvaluationFor(result);
    assert.equal(semantic?.request.actionId, 'closeout_prepare');
    assert.equal(semantic?.verdict, 'unknown');
    assert.equal(semantic?.facts[0].id, 'closeout.readiness');
  });
});
