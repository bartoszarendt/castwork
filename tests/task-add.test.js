/**
 * `task add`: one entry appended to a frontmatter list, checked in memory,
 * written under the record's lock. It invents nothing: no actor, host, model or
 * time that was not given, and no reference that is not recorded.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { requirementEvaluation } from '../src/checks.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { setup } from '../src/setup.js';
import { entryFromPairs, taskAdd } from '../src/task-add.js';
import { findRecord, taskNew } from '../src/task-cli.js';

const BIN = fileURLToPath(new URL('../bin/castwork.js', import.meta.url));

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-add-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** @param {string} root @param {string} text */
function write(root, text) {
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

test('entries are typed as the record format types them, and only what is given is written', () => {
  const now = new Date('2026-10-10T12:34:56.789Z');
  assert.deepEqual({ ...entryFromPairs('candidate', ['ref=0123456', 'producers=worker@claude, worker@codex', 'at=now'], now) },
    { ref: '0123456', producers: ['worker@claude', 'worker@codex'], at: '2026-10-10T12:34:56Z' });
  assert.deepEqual({ ...entryFromPairs('evidence', ['result=fail', 'check=test', 'candidate=abc1234', 'exit_code=1', 'command=npm test -- --grep "a b"']) },
    { check: 'test', candidate: 'abc1234', result: 'fail', command: 'npm test -- --grep "a b"', exit_code: 1 });
  assert.throws(() => entryFromPairs('evidence', ['check=test', 'candidate=a']), /evidence needs result/);
  assert.throws(() => entryFromPairs('evidence', ['check=test', 'candidate=a', 'result=passed']), /result passed is not one of pass, fail/);
  assert.throws(() => entryFromPairs('assessment', ['candidate=a', 'role=reviewer', 'verdict=accept']), /role reviewer is not one of/);
  assert.throws(() => entryFromPairs('evidence', ['check=test', 'candidate=a', 'result=pass', 'exit_code=zero']), /not an integer/);
  assert.throws(() => entryFromPairs('evidence', ['check=test', 'candidate=a', 'result=pass', 'producers=x']), /evidence takes no field producers/);
  assert.throws(() => entryFromPairs('candidate', ['ref=a', 'ref=b']), /given twice/);
  assert.throws(() => entryFromPairs('candidate', ['ref=a', 'model=']), /model is empty/);
  assert.throws(() => entryFromPairs('candidate', ['ref']), /not key=value/);
});

test('entries append to the record\'s own lists, keeping its indentation and everything else', (t) => {
  const root = fixture(t);
  const file = write(root, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  checks: [test]\ncandidates:\n  - ref: abc1234\n    producers: [worker@claude]\n# about the evidence\nevidence: # history follows\n    - {check: test, candidate: abc1234, result: fail}\n---\n\n## Intent\nx\n');
  taskAdd(root, 'T-001', 'evidence', ['check=test', 'candidate=abc1234', 'result=pass', 'exit_code=0']);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('evidence: # history follows\n    - {check: test, candidate: abc1234, result: fail}\n    - check: test\n      candidate: abc1234\n      result: pass\n      exit_code: 0\n---\n'), text);
  assert.ok(text.startsWith('---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  checks: [test]\ncandidates:\n  - ref: abc1234\n    producers: [worker@claude]\n# about the evidence\n'));
  assert.equal(requirementEvaluation(findRecord(root, 'T-001').record)[0].status, 'satisfied');

  taskAdd(root, 'T-001', 'assessment', ['candidate=abc1234', 'role=verifier', 'actor=verifier@codex', 'verdict=accept']);
  taskAdd(root, 'T-001', 'candidate', ['ref=def5678', 'producers=worker@claude']);
  const record = findRecord(root, 'T-001').record;
  assert.equal(/** @type {unknown[]} */ (record.frontmatter.assessments).length, 1);
  assert.equal(/** @type {unknown[]} */ (record.frontmatter.candidates).length, 2);
  assert.deepEqual(record.errors, []);
});

test('a CRLF record gets CRLF entries', (t) => {
  const root = fixture(t);
  const file = write(root, '---\r\nschema: 1\r\nid: T-001\r\ntitle: t\r\nstatus: draft\r\n---\r\n\r\nbody\r\n');
  taskAdd(root, 'T-001', 'candidate', ['ref=abc1234']);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('status: draft\r\ncandidates:\r\n  - ref: abc1234\r\n---\r\n'), JSON.stringify(text));
  assert.doesNotMatch(text, /[^\r]\n/);
});

test('an entry for a candidate that is not recorded, or a list in flow style, is refused without writing', (t) => {
  const root = fixture(t);
  const file = write(root, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\ncandidates: [{ref: abc1234}]\n---\n\nbody\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskAdd(root, 'T-001', 'evidence', ['check=test', 'candidate=ABC1234', 'result=pass']), /records no candidate ABC1234/);
  assert.throws(() => taskAdd(root, 'T-001', 'candidate', ['ref=def5678']), /not written as a block list/);
  assert.throws(() => taskAdd(root, 'T-001', 'verdict', ['candidate=abc1234']), /unknown entry kind verdict/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(root, TASKS_DIRECTORY)), ['T-001.md'], 'no lock or temporary file is left');
});

test('a task new record takes entries below its commented template', (t) => {
  const root = fixture(t);
  taskNew(root, 'Template');
  taskAdd(root, 'T-001', 'candidate', ['ref=abc1234', 'producers=worker@claude']);
  taskAdd(root, 'T-001', 'evidence', ['check=test', 'candidate=abc1234', 'result=pass']);
  const { record } = findRecord(root, 'T-001');
  assert.deepEqual(record.errors, []);
  assert.equal(/** @type {unknown[]} */ (record.frontmatter.evidence).length, 1);
});

test('simultaneous task add calls on one record all land', async (t) => {
  const root = fixture(t);
  write(root, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n  - ref: abc1234\n---\n\nbody\n');
  const run = promisify(execFile);
  const lenses = ['correctness', 'security', 'performance', 'tests', 'docs', 'api'];
  await Promise.all(lenses.map((lens) => run(process.execPath, [BIN, 'task', 'add', 'T-001', 'assessment', 'candidate=abc1234', 'role=verifier', `actor=${lens}@codex`, 'verdict=accept'], { cwd: root })));
  const actors = /** @type {Record<string, unknown>[]} */ (findRecord(root, 'T-001').record.frontmatter.assessments).map((entry) => entry.actor).sort();
  assert.deepEqual(actors, lenses.map((lens) => `${lens}@codex`).sort());
  assert.deepEqual(fs.readdirSync(path.join(root, TASKS_DIRECTORY)), ['T-001.md']);
});

test('a lock left behind is named, and nothing is written', (t) => {
  const root = fixture(t);
  const file = write(root, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n\nbody\n');
  fs.writeFileSync(`${file}.lock`, '');
  const before = fs.readFileSync(file, 'utf8');
  // A clock that moves a second each time it is read, so the real wait passes
  // without the test spending it.
  const started = Date.now();
  let reads = 0;
  t.mock.method(Date, 'now', () => started + 1000 * reads++);
  assert.throws(() => taskAdd(root, 'T-001', 'candidate', ['ref=abc1234']), (error) => /being written by another castwork command/.test(error.message) && /T-001\.md\.lock/.test(error.hint));
  const waited = 1000 * (reads - 1);
  t.mock.restoreAll();
  assert.ok(waited >= 10000 && waited <= 11000, `it waited about ten seconds before giving up, not ${waited} ms`);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('an earlier entry ending in a kept block scalar keeps its value, or nothing is written', (t) => {
  const root = fixture(t);
  const file = write(root, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n  - ref: abc1234\nassessments:\n  - candidate: abc1234\n    role: verifier\n    actor: v@codex\n    verdict: needs_revision\n    findings: |+\n      keep\n\n---\n\nbody\n');
  const before = fs.readFileSync(file, 'utf8');
  try {
    taskAdd(root, 'T-001', 'assessment', ['candidate=abc1234', 'role=verifier', 'actor=v2@codex', 'verdict=accept']);
  } catch (error) {
    assert.match(/** @type {Error} */ (error).message, /would change more than assessments/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    return;
  }
  const assessments = /** @type {Record<string, unknown>[]} */ (findRecord(root, 'T-001').record.frontmatter.assessments);
  assert.equal(assessments[0].findings, 'keep\n\n');
  assert.equal(assessments.length, 2);
});
