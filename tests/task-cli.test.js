import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkRecord } from '../src/checks.js';
import { run } from '../src/cli-main.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { findRecord, taskLint, taskNew, taskSet } from '../src/task-cli.js';

/** Each fixture is its own temp tree, removed when the test ends. */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-task-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** @param {string} root @param {string} id @param {string} frontmatter */
function writeTask(root, id, frontmatter) {
  const file = path.join(root, TASKS_DIRECTORY, `${id}.md`);
  fs.writeFileSync(file, `---\nschema: 1\nid: ${id}\ntitle: t\nstatus: in_review\n${frontmatter}---\n\n## Intent\nx\n`, 'utf8');
  return file;
}

test('task new creates a record with the next id', (t) => {
  const root = fixture(t);
  taskNew(root, 'First task');
  taskNew(root, 'Second task');
  const ids = fs.readdirSync(path.join(root, TASKS_DIRECTORY)).sort();
  assert.deepEqual(ids, ['T-001.md', 'T-002.md']);
  const record = parseRecord(fs.readFileSync(path.join(root, TASKS_DIRECTORY, 'T-002.md'), 'utf8'));
  assert.equal(record.frontmatter.title, 'Second task');
  assert.equal(record.headings.filter(entry => entry.heading === 'Current state').length, 1);
  assert.deepEqual(record.errors, []);
});

test('task set writes an ordinary status without validating anything', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', 'requirements:\n  checks: [test]\n');
  taskSet(root, 'T-001', 'status', 'blocked');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.status, 'blocked');
});

test('task set status done refuses without writing when a requirement is unsatisfied', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /not satisfied/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('the record stays readable and editable after a refusal', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'));
  taskSet(root, 'T-001', 'status', 'needs_revision');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.status, 'needs_revision');
  fs.appendFileSync(file, '\n## Notes\nstill editable\n', 'utf8');
  assert.deepEqual(parseRecord(fs.readFileSync(file, 'utf8')).errors, []);
});

test('task set status done succeeds once every requirement is satisfied', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  taskSet(root, 'T-001', 'status', 'done');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.status, 'done');
});

test('task set rejects an unknown status value', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', '');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'shipped'), /unknown status value/);
});

test('task lint never writes', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\n');
  const before = fs.readFileSync(file, 'utf8');
  taskLint(root, 'T-001', { json: true });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('task lint fails a record claiming done with an unsatisfied requirement', (t) => {
  const root = fixture(t);
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(file, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: done\nrequirements:\n  checks: [test]\n---\n\n## Intent\nx\n', 'utf8');
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, false);
});

test('task lint passes an unsatisfied requirement that does not claim done', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', 'requirements:\n  checks: [test]\n');
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, true);
});

test('task lint fails a structurally invalid record', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), '---\nschema: 1\nid: T-001\ntitle: t\nstatus: nonsense\n---\n', 'utf8');
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, false);
});

test('an unavailable candidate reference alone does not fail lint', (t) => {
  const root = fixture(t);
  // A real repository, because a reference is only `unavailable` where it was
  // actually looked up. Outside one nothing is checked, which the next test
  // covers; this one is about an absent reference not failing lint.
  execFileSync('git', ['-C', root, 'init', '--quiet'], { stdio: ['ignore', 'ignore', 'ignore'] });
  writeTask(root, 'T-001', 'candidates:\n  - ref: 0000000\n');
  const result = taskLint(root, 'T-001', { json: true });
  assert.equal(result.ok, true);
  assert.equal(result.reports[0].references[0].available, 'unavailable');
});

test('an unchecked candidate reference alone does not fail lint either', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', 'candidates:\n  - ref: 0000000\n');
  const result = taskLint(root, 'T-001', { json: true });
  assert.equal(result.ok, true);
  assert.equal(result.reports[0].references[0].available, 'not_checked');
});

test('a hand-edited record and the parsed report agree', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  const direct = checkRecord(parseRecord(fs.readFileSync(file, 'utf8')), { refs: { aaa: false } });
  const viaCli = taskLint(root, 'T-001', { json: true }).reports[0];
  assert.deepEqual(viaCli.requirements, direct.requirements);
});

test('bookkeeping edits change no evaluation', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', 'requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  const before = taskLint(root, 'T-001', { json: true }).reports[0].requirements;
  fs.appendFileSync(file, '\n## Extra heading\nSome prose that changes nothing.\n', 'utf8');
  const after = taskLint(root, 'T-001', { json: true }).reports[0].requirements;
  assert.deepEqual(after, before);
});

test('findRecord reports a helpful error for an unknown id', (t) => {
  const root = fixture(t);
  assert.throws(() => findRecord(root, 'T-999'), /no task record with id T-999/);
});

test('lint folds only earlier evidence, regrouping mixed names and retaining every credential note', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', `requirements:
  checks: [test]
candidates:
  - ref: 1111111
  - ref: 2222222
evidence:
  - {check: mixed, candidate: 1111111, result: pass, command: 'castwork task lint T-001 PASSWORD=secret'}
  - {check: old, candidate: 1111111, result: pass}
  - {check: mixed, candidate: 2222222, result: pass, command: 'castwork task lint T-001 TOKEN=secret'}
  - {check: mixed, candidate: 2222222, result: pass}
`);
  const before = capture(['task', 'lint', 'T-001', '--json'], root);
  const notes = parseRecord(fs.readFileSync(file, 'utf8')).info;
  const text = capture(['task', 'lint', 'T-001'], root).out;
  assert.match(text, /check mixed \(2 evidence entries, from evidence\[2\]\)/);
  assert.doesNotMatch(text, /check old \(/);
  assert.match(text, /1 undeclared check names, 1 entries on earlier candidates; --json lists them/);
  assert.match(text, /evidence\.lint_as_evidence: evidence\[2\]/);
  assert.doesNotMatch(text, /evidence\.lint_as_evidence: evidence\[0\]/);
  assert.match(text, /1 entries on earlier candidates record task lint/);
  assert.equal((text.match(/evidence\.credential_like:/g) ?? []).length, 2);
  const after = capture(['task', 'lint', 'T-001', '--json'], root);
  assert.deepEqual(JSON.parse(after.out), JSON.parse(before.out));
  assert.deepEqual(JSON.parse(after.out).records[0].structural.info, notes);
});

/* ------------------------------------------------------------------ */
/* Field round, F1: a record whose findings are a folded scalar        */
/* ------------------------------------------------------------------ */

/** Run the CLI with stdout captured, so the JSON body can be asserted too. */
function capture(argv, cwd) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    const code = run(argv, { cwd });
    return { code, out: chunks.join('') };
  } finally {
    process.stdout.write = original;
  }
}

/**
 * The shape an OpenCode agent assessing a task actually wrote in the field,
 * with the role ids of today. Before this round the folded header came back as
 * the string `>-`, the next line failed with `expected key: value`, the whole
 * frontmatter was unparseable, and `task list` reported the task's status as
 * `unknown`.
 */
const FOLDED_FINDINGS =
  'requirements:\n' +
  '  checks: [test]\n' +
  '  independent_review: true\n' +
  'candidates:\n' +
  '  - ref: worktree-T005\n' +
  '    producers: [worker@opencode]\n' +
  'evidence:\n' +
  '  - check: test\n' +
  '    candidate: worktree-T005\n' +
  '    result: pass\n' +
  '    command: "npm test"\n' +
  '    exit_code: 0\n' +
  '    host: opencode\n' +
  '    model: "zai-coding-plan/glm-5.3"\n' +
  '    at: "2026-09-18T12:34:56Z"\n' +
  'assessments:\n' +
  '  - candidate: worktree-T005\n' +
  '    role: verifier\n' +
  '    actor: verifier@opencode\n' +
  '    verdict: accept\n' +
  '    findings: >-\n' +
  '      fallback assessment (verifier provider unavailable): accept.\n' +
  '      Canonical spec is keyboard-only.\n';

const FOLDED_TEXT = 'fallback assessment (verifier provider unavailable): accept. Canonical spec is keyboard-only.';

test('F1: a folded findings scalar leaves the record structurally valid', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-005', FOLDED_FINDINGS);
  const { record } = findRecord(root, 'T-005');
  assert.deepEqual(record.errors, [], 'the record has structural errors');
  assert.equal(record.frontmatter.assessments[0].findings, FOLDED_TEXT);
});

test('F1: task lint exits 0 on a record with a folded findings scalar', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-005', FOLDED_FINDINGS);
  const { code, out } = capture(['task', 'lint', '--json'], root);
  assert.equal(code, 0, out);
  assert.equal(JSON.parse(out).ok, true);
});

test('F1: task list prints the real status of a record with a folded scalar', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-005', FOLDED_FINDINGS);
  const { code, out } = capture(['task', 'list'], root);
  assert.equal(code, 0);
  assert.match(out, /T-005\s+in_review/);
  assert.doesNotMatch(out, /unknown/);
});

test('F1: task show --json returns the folded text with the folding applied', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-005', FOLDED_FINDINGS);
  const { code, out } = capture(['task', 'show', 'T-005', '--json'], root);
  assert.equal(code, 0);
  const shown = JSON.parse(out);
  assert.equal(shown.frontmatter.assessments[0].findings, FOLDED_TEXT);
  assert.equal(shown.structural.valid, true);
  assert.deepEqual(shown.structural.errors, []);
});

test('F1: task set status done preserves a folded findings scalar', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-005', FOLDED_FINDINGS);
  taskSet(root, 'T-005', 'status', 'done');
  const raw = fs.readFileSync(file, 'utf8');
  assert.match(raw, /findings: >-\r?\n\s+fallback assessment/);
  const { record } = findRecord(root, 'T-005');
  assert.equal(record.frontmatter.status, 'done');
  assert.equal(record.frontmatter.assessments[0].findings, FOLDED_TEXT);
});
