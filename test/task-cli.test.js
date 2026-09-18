import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkRecord } from '../src/checks.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { findRecord, taskLint, taskNew, taskSet } from '../src/task-cli.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-task-'));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** @param {string} root @param {string} id @param {string} frontmatter */
function writeTask(root, id, frontmatter) {
  const file = path.join(root, TASKS_DIRECTORY, `${id}.md`);
  fs.writeFileSync(file, `---\nschema: 1\nid: ${id}\ntitle: t\nstatus: in_review\n${frontmatter}---\n\n## Intent\nx\n`, 'utf8');
  return file;
}

test('task new creates a record with the next id', () => {
  const root = fixture();
  taskNew(root, 'First task');
  taskNew(root, 'Second task');
  const ids = fs.readdirSync(path.join(root, TASKS_DIRECTORY)).sort();
  assert.deepEqual(ids, ['T-001.md', 'T-002.md']);
  const record = parseRecord(fs.readFileSync(path.join(root, TASKS_DIRECTORY, 'T-002.md'), 'utf8'));
  assert.equal(record.frontmatter.title, 'Second task');
  assert.deepEqual(record.errors, []);
});

test('task set writes an ordinary status without validating anything', () => {
  const root = fixture();
  writeTask(root, 'T-001', 'requirements:\n  checks: [test]\n');
  taskSet(root, 'T-001', 'status', 'blocked');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.status, 'blocked');
});

test('task set status done refuses without writing when a requirement is unsatisfied', () => {
  const root = fixture();
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /not satisfied/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('the record stays readable and editable after a refusal', () => {
  const root = fixture();
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'));
  taskSet(root, 'T-001', 'status', 'needs_revision');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.status, 'needs_revision');
  fs.appendFileSync(file, '\n## Notes\nstill editable\n', 'utf8');
  assert.deepEqual(parseRecord(fs.readFileSync(file, 'utf8')).errors, []);
});

test('task set status done succeeds once every requirement is satisfied', () => {
  const root = fixture();
  writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  taskSet(root, 'T-001', 'status', 'done');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.status, 'done');
});

test('task set rejects an unknown status value', () => {
  const root = fixture();
  writeTask(root, 'T-001', '');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'shipped'), /unknown status value/);
});

test('task lint never writes', () => {
  const root = fixture();
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\n');
  const before = fs.readFileSync(file, 'utf8');
  taskLint(root, 'T-001', { json: true });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('task lint fails a record claiming done with an unsatisfied requirement', () => {
  const root = fixture();
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(file, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: done\nrequirements:\n  checks: [test]\n---\n\n## Intent\nx\n', 'utf8');
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, false);
});

test('task lint passes an unsatisfied requirement that does not claim done', () => {
  const root = fixture();
  writeTask(root, 'T-001', 'requirements:\n  checks: [test]\n');
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, true);
});

test('task lint fails a structurally invalid record', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), '---\nschema: 1\nid: T-001\ntitle: t\nstatus: nonsense\n---\n', 'utf8');
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, false);
});

test('an unavailable candidate reference alone does not fail lint', () => {
  const root = fixture();
  writeTask(root, 'T-001', 'candidates:\n  - ref: 0000000\n');
  const result = taskLint(root, 'T-001', { json: true });
  assert.equal(result.ok, true);
  assert.equal(result.reports[0].references[0].available, 'unavailable');
});

test('a hand-edited record and the parsed report agree', () => {
  const root = fixture();
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  const direct = checkRecord(parseRecord(fs.readFileSync(file, 'utf8')), { refs: { aaa: false } });
  const viaCli = taskLint(root, 'T-001', { json: true }).reports[0];
  assert.deepEqual(viaCli.requirements, direct.requirements);
});

test('bookkeeping edits change no evaluation', () => {
  const root = fixture();
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  const before = taskLint(root, 'T-001', { json: true }).reports[0].requirements;
  fs.appendFileSync(file, '\n## Extra heading\nSome prose that changes nothing.\n', 'utf8');
  const after = taskLint(root, 'T-001', { json: true }).reports[0].requirements;
  assert.deepEqual(after, before);
});

test('findRecord reports a helpful error for an unknown id', () => {
  const root = fixture();
  assert.throws(() => findRecord(root, 'T-999'), /no task record with id T-999/);
});
