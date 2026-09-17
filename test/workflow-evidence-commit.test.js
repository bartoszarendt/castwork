import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { commitWorkflowPaths } from '../src/workflow-evidence-commit.js';

let root;

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return String(result.stdout ?? '').trim();
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'al-workflow-commit-'));
  git(['init', '-q']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  writeFileSync(join(root, 'product.js'), 'export const value = 1;\n');
  writeFileSync(join(root, 'evidence.json'), '{}\n');
  writeFileSync(join(root, 'unrelated.txt'), 'before\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
});

after(() => rmSync(root, { recursive: true, force: true }));

describe('CLI-authored workflow evidence commit', () => {
  it('commits only invocation-written paths and preserves unrelated staged work', () => {
    writeFileSync(join(root, 'unrelated.txt'), 'staged elsewhere\n');
    git(['add', 'unrelated.txt']);
    writeFileSync(join(root, 'evidence.json'), '{"ok":true}\n');

    const result = commitWorkflowPaths({
      target: root,
      taskId: 'T-001',
      paths: ['evidence.json'],
      role: 'maintainer',
      commitClass: 'workflow_evidence',
      subject: 'Record verified evidence',
    });
    assert.equal(result.ok, true, result.errors?.join('; '));
    assert.deepEqual(result.paths, ['evidence.json']);
    assert.equal(git(['show', '--format=', '--name-only', 'HEAD']), 'evidence.json');
    assert.match(git(['show', '-s', '--format=%B', 'HEAD']), /Workflow-Class: workflow_evidence\nTask: T-001\nAgent: maintainer/);
    assert.equal(git(['diff', '--cached', '--name-only']), 'unrelated.txt');
  });

  it('renders exact work-unit attribution for a disposition commit', () => {
    writeFileSync(join(root, 'audit.json'), '{"state":"resolved"}\n');
    const result = commitWorkflowPaths({
      target: root,
      workUnitId: 'milestone:M00',
      taskIds: ['T-001', 'T-002'],
      paths: ['audit.json'],
      role: 'maintainer',
      commitClass: 'workflow_disposition',
      subject: 'Record audit disposition',
    });
    assert.equal(result.ok, true, result.errors?.join('; '));
    assert.match(git(['show', '-s', '--format=%B', 'HEAD']), /Workflow-Class: workflow_disposition\nWork-Unit: milestone:M00\nTasks: T-001, T-002\nAgent: maintainer/);
    assert.equal(git(['diff', '--cached', '--name-only']), 'unrelated.txt');
  });

  it('treats an exact retry with no path diff as already current', () => {
    const head = git(['rev-parse', 'HEAD']);
    const result = commitWorkflowPaths({
      target: root,
      workUnitId: 'milestone:M00',
      taskIds: ['T-001', 'T-002'],
      paths: ['audit.json'],
      role: 'maintainer',
      commitClass: 'workflow_disposition',
      subject: 'Record audit disposition',
    });
    assert.equal(result.ok, true, result.errors?.join('; '));
    assert.equal(result.committed, false);
    assert.equal(result.disposition, 'already_current');
    assert.equal(git(['rev-parse', 'HEAD']), head);
    assert.equal(git(['diff', '--cached', '--name-only']), 'unrelated.txt');
  });
});
