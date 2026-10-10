/**
 * Record integrity: writes that keep every byte they do not mean to change,
 * references that keep the text written, one rule for actor identity, and a
 * record that says it has an archive it was read without.
 *
 * Each case here reproduced a defect in 0.9.4: a field name read as a pattern,
 * a value read as a replacement template, a block scalar or list cut in half,
 * mixed line endings, an all-digit commit id read as a number, and a missing
 * archive that went unreported.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mayBeDone, requirementEvaluation, structuralValidity } from '../src/checks.js';
import { decisionNew } from '../src/decision-cli.js';
import { DECISIONS_DIRECTORY, TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { findRecord, taskLint, taskNew, taskSet, writeFrontmatterField } from '../src/task-cli.js';

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-integrity-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** @param {string} root @param {string} name @param {string} text */
function writeRaw(root, name, text) {
  const file = path.join(root, TASKS_DIRECTORY, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

const RECORD = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\nab: 1\n---\n\n## Intent\nx\n';

test('a field name is matched literally: a. never matches ab', () => {
  assert.throws(() => writeFrontmatterField(RECORD, 'a.', 'q'), /not a plain field name/);
  assert.throws(() => writeFrontmatterField(RECORD, 'a(b', 'q'), /not a plain field name/);
});

test('a structured field is refused, whether recognized or the project\'s own', (t) => {
  const root = fixture(t);
  const file = writeRaw(root, 'T-001.md', '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\ncandidates:\n  - ref: abc1234\nlabels:\n  - one\n  - two\n---\n\nbody\n');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'candidates', 'x'), /holds a list or a mapping/);
  assert.throws(() => taskSet(root, 'T-001', 'labels', 'x'), /holds a list or a mapping/);
  assert.throws(() => taskSet(root, 'T-001', 'depends_on', 'T-002'), /holds a list or a mapping/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a refusal writes nothing');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.id, 'T-001');
});

test('replacement tokens in a value stay literal in task set, task new, and decision new', (t) => {
  const root = fixture(t);
  writeRaw(root, 'T-001.md', RECORD);
  taskSet(root, 'T-001', 'title', 'Cash $& and $` and $\' tail');
  const record = findRecord(root, 'T-001').record;
  assert.equal(record.frontmatter.title, 'Cash $& and $` and $\' tail');
  assert.equal(record.frontmatter.status, 'draft');
  assert.deepEqual(structuralValidity(record).errors, []);

  taskNew(root, 'Pay $& now $` later');
  assert.equal(findRecord(root, 'T-002').record.frontmatter.title, 'Pay $& now $` later');

  const decision = decisionNew(root, 'Use $& here');
  assert.match(fs.readFileSync(decision, 'utf8'), /^title: "Use \$& here"$/m);
  assert.ok(fs.existsSync(path.join(root, DECISIONS_DIRECTORY)));
});

test('a block-scalar title is replaced whole, with no continuation lines left behind', () => {
  const text = '---\nschema: 1\nid: T-001\ntitle: >-\n  a long folded\n  title here\nstatus: draft\n---\n\nbody\n';
  const next = writeFrontmatterField(text, 'title', 'short');
  assert.equal(next, '---\nschema: 1\nid: T-001\ntitle: short\nstatus: draft\n---\n\nbody\n');
});

test('a one-line value takes only its own line, comments around it stay', () => {
  const text = '---\nschema: 1\nid: T-001\n# about the title\ntitle: t\n  # an indented note\nstatus: draft\n---\n\nbody\n';
  const next = writeFrontmatterField(text, 'title', 'u');
  assert.equal(next, text.replace('title: t\n', 'title: u\n'));
});

test('a field added to a CRLF record uses CRLF', () => {
  const text = '---\r\nschema: 1\r\nid: T-001\r\ntitle: t\r\nstatus: draft\r\n---\r\n## Intent\r\nx\r\n';
  const next = writeFrontmatterField(text, 'owner', 'me');
  assert.equal(next, text.replace('status: draft\r\n', 'status: draft\r\nowner: me\r\n'));
  assert.doesNotMatch(next, /[^\r]\n/);
});

test('a record with structural errors stays editable; its errors stay as they were', (t) => {
  const root = fixture(t);
  writeRaw(root, 'T-001.md', '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\nchecks: [test]\nassessments:\n  - {candidate: abc1234, role: maintainer, verdict: accept}\n---\n\nbody\n');
  const codes = () => structuralValidity(findRecord(root, 'T-001').record).errors.map((error) => error.code).sort();
  const before = codes();
  assert.ok(before.includes('requirement.misplaced'));
  taskSet(root, 'T-001', 'title', 'A corrected title');
  assert.equal(findRecord(root, 'T-001').record.frontmatter.title, 'A corrected title');
  assert.deepEqual(codes(), before);
});

test('frontmatter that cannot be read is not written to', () => {
  const text = '---\nschema: 1\nid: T-001\ntitle: [unterminated\nstatus: draft\n---\n\nbody\n';
  assert.throws(() => writeFrontmatterField(text, 'status', 'blocked'), /cannot be read/);
});

test('an all-digit commit id keeps the text written, quoted or not', () => {
  const record = parseRecord('---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  checks: [test]\ncandidates:\n  - ref: 0123456\n    producers: [worker@claude]\nevidence:\n  - check: test\n    candidate: "0123456"\n    result: pass\n  - {check: lint, candidate: 0123456, result: pass, exit_code: 0}\n---\n\nbody\n');
  const candidates = /** @type {Record<string, unknown>[]} */ (record.frontmatter.candidates);
  const evidence = /** @type {Record<string, unknown>[]} */ (record.frontmatter.evidence);
  assert.equal(candidates[0].ref, '0123456');
  assert.equal(evidence[1].candidate, '0123456');
  assert.equal(evidence[1].exit_code, 0, 'other integers are still numbers');
  assert.equal(record.frontmatter.schema, 1);
  assert.equal(requirementEvaluation(record)[0].status, 'satisfied');

  const long = parseRecord('---\nschema: 1\nid: T-002\ntitle: t\nstatus: draft\ncandidates:\n  - ref: 1234567890123456789012345678901234567890\n---\n');
  assert.equal(/** @type {Record<string, unknown>[]} */ (long.frontmatter.candidates)[0].ref, '1234567890123456789012345678901234567890');
});

test('actors are compared trimmed when choosing the effective assessment', () => {
  const record = parseRecord('---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  independent_review: true\ncandidates:\n  - ref: abc1234\n    producers: [worker@claude]\nassessments:\n  - {candidate: abc1234, role: verifier, actor: verifier@codex, verdict: reject}\n  - {candidate: abc1234, role: verifier, actor: "verifier@codex ", verdict: accept}\n---\n\nbody\n');
  const [result] = requirementEvaluation(record);
  assert.equal(result.status, 'satisfied', 'one actor changed its verdict');
  assert.ok(result.facts.some((fact) => /recorded reject earlier, then accept/.test(fact.fact)));
});

const POINTED = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\n---\nEarlier rounds: [T-001.archive.md](T-001.archive.md), moved by `task archive`.\n\n## Intent\nx\n';

test('a record that points to its archive, read without it, is structurally invalid', (t) => {
  const record = parseRecord(POINTED, { path: 'T-001.md' });
  assert.deepEqual(record.errors.map((error) => error.code), ['archive.missing']);
  assert.equal(mayBeDone(record).allowed, false);

  const root = fixture(t);
  writeRaw(root, 'T-001.md', POINTED);
  assert.equal(taskLint(root, 'T-001', { json: true }).ok, false);
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /structural error/);
});

test('the same record read with its archive is valid, and a prose mention is not a pointer', () => {
  const archive = '---\nschema: 1\narchive_of: T-001\n---\n';
  const record = parseRecord(POINTED, { path: 'T-001.md', archive: { text: archive, path: 'T-001.archive.md' } });
  assert.deepEqual(record.errors, []);
  const mention = parseRecord(POINTED.replace('Earlier rounds:', 'See also\nEarlier rounds:'), { path: 'T-001.md' });
  assert.deepEqual(mention.errors, []);
});

test('a comment after a block scalar is not part of it, and a kept trailing line break survives an added field', () => {
  const comment = '---\nschema: 1\nid: T-001\ntitle: |\n    a\n  # keep me\nstatus: draft\n---\n\nbody\n';
  assert.equal(writeFrontmatterField(comment, 'title', 'x'), comment.replace('title: |\n    a\n', 'title: x\n'));

  const keep = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\nassessments:\n  - candidate: abc1234\n    role: verifier\n    actor: v@codex\n    verdict: needs_revision\n    findings: |+\n      keep\n\n---\n\nbody\n';
  const next = parseRecord(writeFrontmatterField(keep, 'owner', 'me'));
  assert.equal(/** @type {Record<string, unknown>[]} */ (next.frontmatter.assessments)[0].findings, 'keep\n\n');
  assert.equal(next.frontmatter.owner, 'me');
});
