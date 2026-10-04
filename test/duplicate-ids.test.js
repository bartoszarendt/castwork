import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { duplicateIdErrors } from '../src/checks.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { findRecord, taskLint, taskSet } from '../src/task-cli.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-dup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** @param {string} root @param {string} name @param {string} id */
function write(root, name, id, extra = '') {
  const file = path.join(root, TASKS_DIRECTORY, `${name}.md`);
  fs.writeFileSync(file, `---\nschema: 1\nid: ${id}\ntitle: t\nstatus: draft\n${extra}---\n\n## Intent\nx\n`, 'utf8');
  return file;
}

/** @param {string[]} ids */
const parseAll = (ids) => ids.map((id, index) => parseRecord(`---\nschema: 1\nid: ${id}\ntitle: t\nstatus: draft\n---\n`, { path: `r${index}.md` }));

test('no duplicates means no errors', () => {
  assert.equal(duplicateIdErrors(parseAll(['T-001', 'T-002', 'T-003'])).size, 0);
});

test('every record sharing an id is reported, not just the later one', () => {
  const errors = duplicateIdErrors(parseAll(['T-001', 'T-002', 'T-001']));
  assert.deepEqual([...errors.keys()].sort(), ['r0.md', 'r2.md']);
  for (const error of errors.values()) assert.equal(error.code, 'id.duplicate');
});

test('the message names the other records holding the id', () => {
  const errors = duplicateIdErrors(parseAll(['T-001', 'T-001']));
  assert.match(errors.get('r0.md').message, /duplicate task id T-001, also declared by r1\.md/);
  assert.match(errors.get('r1.md').message, /duplicate task id T-001, also declared by r0\.md/);
});

test('three records sharing one id each name the other two', () => {
  const errors = duplicateIdErrors(parseAll(['T-001', 'T-001', 'T-001']));
  assert.equal(errors.size, 3);
  assert.match(errors.get('r1.md').message, /r0\.md, r2\.md/);
});

test('detection is deterministic across repeated runs', () => {
  const records = parseAll(['T-002', 'T-001', 'T-002', 'T-001']);
  const first = JSON.stringify([...duplicateIdErrors(records)].sort());
  for (let i = 0; i < 5; i += 1) {
    assert.equal(JSON.stringify([...duplicateIdErrors(records)].sort()), first);
  }
});

test('records with a missing or empty id are not treated as duplicates of each other', () => {
  const records = [
    parseRecord('---\nschema: 1\ntitle: t\nstatus: draft\n---\n', { path: 'a.md' }),
    parseRecord('---\nschema: 1\ntitle: t\nstatus: draft\n---\n', { path: 'b.md' }),
  ];
  assert.equal(duplicateIdErrors(records).size, 0);
});

test('lint fails and exits non-zero on duplicate ids', (t) => {
  const root = fixture(t);
  write(root, 'first', 'T-001');
  write(root, 'second', 'T-001');
  const result = taskLint(root, null, { json: true });
  assert.equal(result.ok, false);
  for (const report of result.reports) {
    assert.equal(report.structural.valid, false);
    assert.ok(report.structural.errors.some((error) => error.code === 'id.duplicate'));
  }
});

test('linting one record still sees a duplicate elsewhere in the corpus', (t) => {
  const root = fixture(t);
  write(root, 'first', 'T-001');
  write(root, 'second', 'T-001');
  const result = taskLint(root, 'T-001', { json: true });
  assert.equal(result.ok, false);
});

test('lint stays clean when the ids are unique', (t) => {
  const root = fixture(t);
  write(root, 'first', 'T-001');
  write(root, 'second', 'T-002');
  assert.equal(taskLint(root, null, { json: true }).ok, true);
});

test('an ambiguous id refuses rather than silently picking the first record', (t) => {
  const root = fixture(t);
  write(root, 'first', 'T-001');
  write(root, 'second', 'T-001');
  assert.throws(() => findRecord(root, 'T-001'), /declared by more than one record/);
});

test('task set refuses on an ambiguous id and writes nothing', (t) => {
  const root = fixture(t);
  const a = write(root, 'first', 'T-001');
  const b = write(root, 'second', 'T-001');
  const before = [fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8')];
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /more than one record/);
  assert.deepEqual([fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8')], before);
});
