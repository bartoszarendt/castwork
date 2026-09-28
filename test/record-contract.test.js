/**
 * Record-contract diagnostics: a requirement kind outside `requirements:` is a
 * structural error, and informational notes point at entries that are well
 * formed but unlikely to say what the writer meant: entries kept in the body,
 * evidence under an undeclared check name or recording `task lint`, a
 * credential in a command, a current candidate named by a moving name, and a
 * record grown large. `task list` marks records ready to close.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../src/cli-main.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { LARGE_RECORD_BYTES, parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { taskSet } from '../src/task-cli.js';

const HEAD = 'schema: 1\nid: T-001\ntitle: t\n';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-contract-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** @param {string} root @param {string} id @param {string} frontmatter @param {string} [body] */
function writeTask(root, id, frontmatter, body = '## Intent\nx\n') {
  const file = path.join(root, TASKS_DIRECTORY, `${id}.md`);
  fs.writeFileSync(file, `---\nschema: 1\nid: ${id}\ntitle: t\n${frontmatter}---\n\n${body}`, 'utf8');
  return file;
}

/** Run the CLI with stdout captured. */
function capture(argv, cwd) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    return { code: run(argv, { cwd }), out: chunks.join('') };
  } finally {
    process.stdout.write = original;
  }
}

/** @param {string} frontmatter @param {string} [body] */
function parse(frontmatter, body = '') {
  return parseRecord(`---\n${HEAD}${frontmatter}---\n\n${body}`);
}

/** @param {{info: {code: string}[]}} record @param {string} code */
function codes(record, code) {
  return record.info.filter((entry) => entry.code === code);
}

const ACCEPTED = 'candidates:\n  - ref: aaa\n    producers: [worker@opencode]\nassessments:\n  - { candidate: aaa, role: verifier, actor: verifier@opencode, verdict: accept }\n';

test('a requirement kind at the top level is a structural error naming the fix', () => {
  for (const kind of ['checks: [test]', 'independent_review: true', 'assessment_roles: [verifier]']) {
    const record = parse(`status: in_review\n${kind}\n`);
    const error = record.errors.find((entry) => entry.code === 'requirement.misplaced');
    assert.ok(error, kind);
    assert.match(error.message, /is at the top level; move it under requirements:/);
    assert.equal(codes(record, 'field.unrecognized').length, 0, 'not also reported as merely unrecognized');
  }
});

test('a done record with top-level assessment_roles fails lint, and task set done refuses it', (t) => {
  const root = fixture(t);
  const file = writeTask(root, 'T-001', `status: done\nassessment_roles: [verifier]\n${ACCEPTED}`);
  const lint = capture(['task', 'lint', 'T-001'], root);
  assert.equal(lint.code, 1);
  assert.match(lint.out, /requirement\.misplaced: assessment_roles is at the top level/);

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: done', 'status: in_review'), 'utf8');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /structural error[\s\S]*requirement\.misplaced/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written');

  // Moved under requirements, the same record is valid and may be closed.
  fs.writeFileSync(file, before.replace('assessment_roles: [verifier]\n', 'requirements:\n  assessment_roles: [verifier]\n'), 'utf8');
  taskSet(root, 'T-001', 'status', 'done');
});

test('entries kept as fenced YAML in the body are reported, and nothing is read from them', (t) => {
  const body = '## Evidence\n\n```yaml\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n```\n\n~~~yml\nassessments:\n  - { candidate: aaa, role: verifier, verdict: accept }\n~~~\n';
  const record = parse('status: in_review\n', body);
  const [note] = codes(record, 'entries.in_body');
  assert.ok(note);
  assert.match(note.message, /candidates, evidence, assessments/);
  assert.match(note.message, /not read by checks; move them into the frontmatter lists/);
  assert.deepEqual(record.errors, []);

  // A fence in another language, or the keys indented inside one, is not a body entry list.
  assert.equal(codes(parse('status: draft\n', '```json\n{"candidates": []}\n```\n'), 'entries.in_body').length, 0);
  assert.equal(codes(parse('status: draft\n', '```yaml\nfoo:\n  evidence: []\n```\n'), 'entries.in_body').length, 0);
  assert.equal(codes(parse('status: draft\n', 'candidates: prose outside a fence\n'), 'entries.in_body').length, 0);
  assert.equal(codes(parse('status: draft\n', '```sh\ncandidates: x\n```\n'), 'entries.in_body').length, 0, 'a shell block');
  assert.equal(codes(parse('status: draft\n', '```markdown\nevidence:\n  - x\n```\n'), 'entries.in_body').length, 0, 'a labelled block in another language');

  const root = fixture(t);
  writeTask(root, 'T-001', 'status: in_review\n', body);
  assert.match(capture(['task', 'lint', 'T-001'], root).out, /info   entries\.in_body/);
});

test('a fence inside a list item counts, and a fence closes only as CommonMark closes it', () => {
  const inBody = (body) => codes(parse('status: draft\n', body), 'entries.in_body').map((note) => note.message);
  // Indented inside a list item: the block's own margin is its top level.
  assert.match(inBody('- Evidence:\n\n  ```yaml\n  evidence:\n    - { check: test, candidate: aaa, result: pass }\n  ```\n')[0], /holds evidence;/);
  assert.equal(inBody('- Notes:\n\n  ```yaml\n  notes:\n    evidence: []\n  ```\n').length, 0, 'still nested there');
  // A shorter fence, the other character, or a fence with an info string does not close it.
  assert.equal(inBody('````\nnotes: |\n  ```\ncandidates: []\n````\n').length, 1, 'a shorter fence inside stays inside');
  assert.equal(inBody('~~~yaml\nnotes: x\n```\ncandidates: []\n~~~\n').length, 1, 'a backtick fence does not close a tilde one');
  assert.equal(inBody('```\nnotes: x\n```yaml\ncandidates: []\n```\n').length, 1, 'a fence with an info string does not close');
  // Once closed, what follows is prose again.
  assert.equal(inBody('```sh\nls\n```\ncandidates: prose\n').length, 0);
  // An unlabelled block is read as YAML.
  assert.match(inBody('```\nassessments:\n  - x\n```\n')[0], /holds assessments;/);
});

test('evidence for a check the record did not declare is noted once per check name, with a count', () => {
  const record = parse('status: in_review\nrequirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n  - { check: test_unit, candidate: aaa, result: pass }\n');
  const notes = codes(record, 'evidence.undeclared_check');
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /check test_unit \(evidence\[1\]\) is not among requirements\.checks \(test\)/);
  assert.match(notes[0].message, /a subset of a declared check goes under its own name/);

  const entries = Array.from({ length: 300 }, (_, index) => `  - { check: ${index % 2 === 0 ? 'unit' : 'e2e_smoke'}, candidate: aaa, result: pass }\n`).join('');
  const many = codes(parse(`status: in_review\nrequirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n${entries}`), 'evidence.undeclared_check');
  assert.equal(many.length, 2, 'one note per undeclared name, not one per entry');
  assert.match(many[0].message, /check unit \(150 evidence entries, from evidence\[0\]\)/);
  assert.match(many[1].message, /check e2e_smoke \(150 evidence entries, from evidence\[1\]\)/);

  const undeclared = parse('status: in_review\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: anything, candidate: aaa, result: pass }\n');
  assert.equal(codes(undeclared, 'evidence.undeclared_check').length, 0, 'nothing to compare against without declared checks');
});

test('task lint recorded as evidence is noted', () => {
  for (const command of ['npx --no agenticloop task lint T-001', 'node bin/agenticloop.js task lint', 'agenticloop task lint --json']) {
    const record = parse(`status: in_review\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: lint, candidate: aaa, result: pass, command: "${command}" }\n`);
    assert.equal(codes(record, 'evidence.lint_as_evidence').length, 1, command);
  }
  const lint = parse('status: in_review\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: lint, candidate: aaa, result: pass, command: "npm run lint" }\n');
  assert.equal(codes(lint, 'evidence.lint_as_evidence').length, 0, 'the project\'s own lint is ordinary evidence');
});

test('a command carrying a credential is noted, and a reference to one is not', () => {
  const cases = [
    // A URL with a password in it.
    ['psql postgres://app:hunter2@db.local:5432/app -c "select 1"', true],
    ['curl https://user:pa55@example.com/health', true],
    ['psql postgres://app:$DB_PASSWORD@db.local/app', false],
    ['psql postgres://app:${DB_PASSWORD}@db.local/app', false],
    ['psql postgres://app:%DB_PASSWORD%@db.local/app', false],
    ['git clone https://github.com/org/repo.git', false],
    ['psql postgres://localhost:5432/app', false],
    // A secret-named variable or option assigned a literal, quoted or not.
    ['DATABASE_PASSWORD=hunter2 npm test', true],
    ['API_KEY=sk-live-123 npm run e2e', true],
    ['PASSWORD="x" npm test', true],
    ["export API_KEY=\"sk-live-123\" && npm run e2e", true],
    ['$env:API_KEY="sk-live-123"; npm run e2e', true],
    ['$env:GITHUB_TOKEN = "ghp_abc"; npm test', true],
    ['npm test -- --password=hunter2', true],
    ['APIKEY=abc123 npm test', true],
    ['MY_SECRET=abc npm test', true],
    ['GH-TOKEN=abc npm test', true],
    // A reference, a number, a boolean, or a redacted value.
    ['DATABASE_URL=$DATABASE_URL npm test', false],
    ['API_KEY="$API_KEY" npm run e2e', false],
    ['API_KEY=${API_KEY} npm run e2e', false],
    ['$env:API_KEY=$env:API_KEY; npm test', false],
    ['echo %TOKEN%', false],
    ['TOKEN=*** npm test', false],
    ['API_KEY="***" npm test', false],
    ['PASSWORD_REQUIRED=true npm test', false],
    ['USE_TOKEN=off npm test', false],
    ['TOKEN_TTL=3600 npm test', false],
    // A secret word only as a whole segment of the name.
    ['MAX_TOKENS=4096 npm test', false],
    ['TOKENIZER=bpe npm test', false],
    ['npm test -- --tokenizer=bpe', false],
    ['npm test -- --tokenizer', false],
    ['KEYBOARD=us npm test', false],
    ['npm test', false],
  ];
  const noted = (command) => codes(
    parse(`status: in_review\ncandidates:\n  - ref: aaa\nevidence:\n  - check: test\n    candidate: aaa\n    result: pass\n    command: '${command.replace(/'/g, "''")}'\n`),
    'evidence.credential_like',
  ).length;
  for (const [command, flagged] of cases) assert.equal(noted(command), flagged ? 1 : 0, command);
});

test('the current candidate named by something that can move is noted; an object id is not', () => {
  const moving = (ref) => codes(parse(`status: in_review\ncandidates:\n  - ref: 0123abc\n  - ref: '${ref}'\n`), 'candidate.moving_ref');
  for (const ref of ['HEAD', 'main', 'feature/login', 'worktree-x', 'commit:abc', 'abc', 'tree:xyz', 'tree:abc']) {
    const [note] = moving(ref);
    assert.ok(note, ref);
    assert.match(note.message, /is a name, not an object id, and names can move; record the commit id or a snapshot/);
    assert.equal(note.index, 1);
  }
  for (const ref of ['0123abc', '0123ABC', 'a'.repeat(40), 'b'.repeat(64), 'tree:0123abc', `tree:${'C'.repeat(40)}`]) {
    assert.equal(moving(ref).length, 0, ref);
  }
  // Only the current candidate: an earlier moving name decides nothing.
  assert.equal(codes(parse('status: in_review\ncandidates:\n  - ref: HEAD\n  - ref: 0123abc\n'), 'candidate.moving_ref').length, 0);
  assert.equal(codes(parse('status: in_review\n'), 'candidate.moving_ref').length, 0);
});

test('a record above 100 KB is noted as large', () => {
  const small = parse('status: draft\n', 'x\n');
  assert.equal(codes(small, 'record.large').length, 0);
  const large = parse('status: draft\n', `${'log line\n'.repeat(Math.ceil(LARGE_RECORD_BYTES / 9) + 10)}`);
  const [note] = codes(large, 'record.large');
  assert.ok(note);
  assert.match(note.message, /move run logs to linked files/);
  assert.deepEqual(large.errors, [], 'informational only');
});

test('task list marks a satisfied record that is not done as ready to close', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', `status: in_review\nrequirements:\n  assessment_roles: [verifier]\n${ACCEPTED}`);
  writeTask(root, 'T-002', 'status: in_review\nrequirements:\n  checks: [test]\n');
  writeTask(root, 'T-003', 'status: draft\n');
  writeTask(root, 'T-004', `status: done\nrequirements:\n  assessment_roles: [verifier]\n${ACCEPTED}`);

  const rows = JSON.parse(capture(['task', 'list', '--json'], root).out);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId['T-001'].requirements_satisfied, true);
  assert.equal(byId['T-002'].requirements_satisfied, false);
  assert.equal(byId['T-003'].requirements_satisfied, null, 'nothing declared says nothing about being finished');
  assert.equal(byId['T-004'].requirements_satisfied, true);

  const text = capture(['task', 'list'], root).out;
  assert.match(text, /T-001 +in_review \(ready to close\)/);
  assert.doesNotMatch(text, /T-002[^\n]*ready to close/);
  assert.doesNotMatch(text, /T-003[^\n]*ready to close/);
  assert.doesNotMatch(text, /T-004[^\n]*ready to close/, 'already done');
});

test('requirements_satisfied reports requirement evaluation alone; structural validity stays with lint', (t) => {
  const root = fixture(t);
  // Every declared requirement is met, but a misplaced key makes the record invalid.
  writeTask(root, 'T-001', `status: in_review\nchecks: [test]\nrequirements:\n  assessment_roles: [verifier]\n${ACCEPTED}`);
  const [row] = JSON.parse(capture(['task', 'list', '--json'], root).out);
  assert.equal(row.requirements_satisfied, true, 'the declared requirements are satisfied');
  assert.deepEqual(Object.keys(row), ['id', 'status', 'title', 'path', 'requirements_satisfied'], 'the row adds no other field');
  assert.equal(JSON.parse(capture(['task', 'lint', 'T-001', '--json'], root).out).records[0].structural.valid, false, 'lint reports the record invalid');
  assert.doesNotMatch(capture(['task', 'list'], root).out, /ready to close/, 'task set done would refuse it, so it is not ready');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /structural error/);
});

test('lint prints the current candidate in full and summarises earlier ones', (t) => {
  const root = fixture(t);
  writeTask(root, 'T-001', 'status: in_review\ncandidates:\n  - ref: old-one\n  - ref: old-two\n  - ref: current-one\n');
  const text = capture(['task', 'lint', 'T-001'], root).out;
  assert.match(text, /2 earlier candidates, 0 unavailable/, 'outside a git repository nothing was checked');
  assert.match(text, /not_checked +candidate +current-one +\(current\)/);
  assert.doesNotMatch(text, /candidate +old-one/);

  const report = JSON.parse(capture(['task', 'lint', 'T-001', '--json'], root).out);
  assert.deepEqual(report.records[0].references.map((reference) => reference.ref), ['old-one', 'old-two', 'current-one'], '--json keeps every candidate');
});
