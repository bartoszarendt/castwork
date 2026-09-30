/**
 * An empty `tasks/` or `decisions/` is not kept by git, so a fresh clone of an
 * installed project lacks it until a record in it is committed. The record
 * commands must work there without running setup again.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { decisionNew } from '../src/decision-cli.js';
import { DECISIONS_DIRECTORY, STATE_DIRECTORY, TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { listRecordFiles, taskLint, taskList, taskNew, taskSet } from '../src/task-cli.js';

function tmp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-records-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** An installed project as a fresh clone has it: no empty record directories. */
function freshClone(t) {
  const root = tmp(t);
  setup(root, { hosts: ['codex'] });
  fs.rmdirSync(path.join(root, DECISIONS_DIRECTORY));
  fs.rmdirSync(path.join(root, TASKS_DIRECTORY));
  return root;
}

test('decision new recreates a missing decisions directory and numbers from one', (t) => {
  const root = freshClone(t);
  const file = decisionNew(root, 'Store money as integer minor units');
  assert.equal(file, path.join(root, DECISIONS_DIRECTORY, 'D-001.md'));
  assert.equal(parseRecord(fs.readFileSync(file, 'utf8')).frontmatter.id, 'D-001');
  assert.equal(path.basename(decisionNew(root, 'Second')), 'D-002.md');
});

test('task new recreates a missing tasks directory and numbers from one', (t) => {
  const root = freshClone(t);
  const file = taskNew(root, 'First task');
  assert.equal(file, path.join(root, TASKS_DIRECTORY, 'T-001.md'));
  assert.equal(parseRecord(fs.readFileSync(file, 'utf8')).frontmatter.id, 'T-001');
});

test('a missing tasks directory reads as no records and is not created', (t) => {
  const root = freshClone(t);
  assert.deepEqual(listRecordFiles(root), []);
  assert.equal(fs.existsSync(path.join(root, TASKS_DIRECTORY)), false);
});

test('without setup the record commands refuse and create nothing', (t) => {
  const root = tmp(t);
  assert.throws(() => decisionNew(root, 'A decision'), /does not exist/);
  assert.throws(() => taskNew(root, 'A task'), /does not exist/);
  assert.throws(() => listRecordFiles(root), /does not exist/);
  assert.equal(fs.existsSync(path.join(root, STATE_DIRECTORY)), false);
});

test('a state file is refused rather than reported as an empty record store', (t) => {
  const root = tmp(t);
  const state = path.join(root, STATE_DIRECTORY);
  fs.writeFileSync(state, 'not a directory\n');
  assert.throws(() => taskList(root, { json: true }), /not a directory/);
  assert.throws(() => taskLint(root, null, { json: true }), /not a directory/);
  assert.throws(() => taskNew(root, 'A task'), /not a directory/);
  assert.throws(() => decisionNew(root, 'A decision'), /not a directory/);
  assert.equal(fs.readFileSync(state, 'utf8'), 'not a directory\n');
  assert.deepEqual(fs.readdirSync(root), [STATE_DIRECTORY]);
});

for (const type of ['junction', 'dir']) {
  test(`a missing decisions directory is not created through a ${type} at .agenticloop`, (t) => {
    const root = tmp(t);
    const outside = tmp(t);
    try {
      fs.symlinkSync(outside, path.join(root, STATE_DIRECTORY), type);
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.code}`);
      return;
    }
    assert.throws(() => decisionNew(root, 'A decision'), /symbolic link/);
    assert.equal(fs.existsSync(path.join(outside, 'decisions')), false);
  });

  test(`existing records are not read or written through a ${type} at .agenticloop`, (t) => {
    const root = tmp(t);
    const outside = tmp(t);
    const tasks = path.join(outside, 'tasks');
    const decisions = path.join(outside, 'decisions');
    fs.mkdirSync(tasks);
    fs.mkdirSync(decisions);
    const record = '---\nschema: 1\nid: T-001\ntitle: Outside task\nstatus: draft\n---\n';
    fs.writeFileSync(path.join(tasks, 'T-001.md'), record);
    try {
      fs.symlinkSync(outside, path.join(root, STATE_DIRECTORY), type);
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.code}`);
      return;
    }
    assert.throws(() => listRecordFiles(root), /symbolic link/);
    assert.throws(() => decisionNew(root, 'A decision'), /symbolic link/);
    assert.throws(() => taskNew(root, 'A task'), /symbolic link/);
    assert.throws(() => taskSet(root, 'T-001', 'title', 'Changed'), /symbolic link/);
    assert.deepEqual(fs.readdirSync(decisions), []);
    assert.deepEqual(fs.readdirSync(tasks), ['T-001.md']);
    assert.equal(fs.readFileSync(path.join(tasks, 'T-001.md'), 'utf8'), record);
  });
}
