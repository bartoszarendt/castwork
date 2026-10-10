/**
 * Interpretation corrections: a blocking verdict without an actor cannot be
 * shown not to be independent, an accepting actor that an earlier entry for the
 * same ref named as a producer is noted, and a whole-project lint leaves the
 * snapshots of closed tasks alone while `task lint <id>` still compares them.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { requirementEvaluation } from '../src/checks.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { takeSnapshot } from '../src/snapshot.js';
import { taskLint } from '../src/task-cli.js';

/** @param {string} lists */
const record = (lists) => parseRecord(`---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  independent_review: true\n${lists}---\n\nbody\n`);

const CANDIDATE = 'candidates:\n  - ref: abc1234\n    producers: [worker@claude]\n';

test('a blocking verdict without an actor leaves independent_review unknown', () => {
  const [result] = requirementEvaluation(record(`${CANDIDATE}assessments:\n  - {candidate: abc1234, role: verifier, verdict: reject}\n  - {candidate: abc1234, role: thinker, actor: thinker@codex, verdict: accept}\n`));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'assessment.blocking_without_actor');
  assert.ok(result.facts.some((fact) => /blocking verdicts without an actor: verifier \(no actor\)/.test(fact.fact)));
});

test('a later assessment by the same role replaces an actorless blocking verdict', () => {
  const [result] = requirementEvaluation(record(`${CANDIDATE}assessments:\n  - {candidate: abc1234, role: verifier, verdict: needs_revision}\n  - {candidate: abc1234, role: verifier, verdict: accept}\n  - {candidate: abc1234, role: thinker, actor: thinker@codex, verdict: accept}\n`));
  assert.equal(result.status, 'satisfied');
});

test('an assessment with an actor does not replace an actorless block, since it may be someone else', () => {
  const [result] = requirementEvaluation(record(`${CANDIDATE}assessments:\n  - {candidate: abc1234, role: verifier, verdict: reject}\n  - {candidate: abc1234, role: verifier, actor: verifier@codex, verdict: accept}\n`));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'assessment.blocking_without_actor');
});

test('an independent actor that blocks still makes the requirement not satisfied', () => {
  const [result] = requirementEvaluation(record(`${CANDIDATE}assessments:\n  - {candidate: abc1234, role: verifier, verdict: reject}\n  - {candidate: abc1234, role: verifier, actor: verifier@codex, verdict: reject}\n  - {candidate: abc1234, role: thinker, actor: thinker@codex, verdict: accept}\n`));
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'assessment.rejected');
});

test('an actorless block with only a producer accepting stays not satisfied', () => {
  const [result] = requirementEvaluation(record(`${CANDIDATE}assessments:\n  - {candidate: abc1234, role: verifier, verdict: reject}\n  - {candidate: abc1234, role: verifier, actor: worker@claude, verdict: accept}\n`));
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'actor.is_producer');
});

test('an accepting actor named as a producer of the same ref earlier is noted, and evaluation is unchanged', () => {
  const parsed = record('candidates:\n  - ref: abc1234\n    producers: [worker@claude]\n  - ref: abc1234\n    producers: [other@codex]\nassessments:\n  - {candidate: abc1234, role: verifier, actor: " worker@claude", verdict: accept}\n');
  const notes = parsed.info.filter((note) => note.code === 'candidate.producers_changed');
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /^worker@claude accepts abc1234, and an earlier entry for the same ref lists worker@claude/);
  assert.equal(requirementEvaluation(parsed)[0].status, 'satisfied');
});

test('reordered or repeated producers raise no note', () => {
  const parsed = record('candidates:\n  - ref: abc1234\n    producers: [a@claude, b@codex]\n  - ref: abc1234\n    producers: [b@codex, a@claude]\nassessments:\n  - {candidate: abc1234, role: verifier, actor: c@pi, verdict: accept}\n');
  assert.deepEqual(parsed.info.filter((note) => note.code === 'candidate.producers_changed'), []);
});

/** @param {string} root @param {...string} args */
function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('whole-project lint does not compare closed tasks\' snapshots; task lint <id> does', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-drift-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'app.txt'), 'one\n', 'utf8');
  setup(root, { hosts: ['codex'] });
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  const { ref } = takeSnapshot(root);
  for (const [id, status] of [['T-001', 'done'], ['T-002', 'in_progress'], ['T-003', 'cancelled']]) {
    fs.writeFileSync(path.join(root, TASKS_DIRECTORY, `${id}.md`), `---\nschema: 1\nid: ${id}\ntitle: t\nstatus: ${status}\ncandidates:\n  - ref: ${ref}\n---\n\nbody\n`, 'utf8');
  }
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');

  const drift = (/** @type {{reports: {id: string, references: {kind: string, drift?: string}[]}[]}} */ result, /** @type {string} */ id) =>
    result.reports.find((report) => report.id === id)?.references.find((reference) => reference.kind === 'candidate')?.drift;
  const all = taskLint(root, null, { json: true });
  assert.equal(drift(all, 'T-001'), 'not_checked');
  assert.equal(drift(all, 'T-003'), 'not_checked');
  assert.equal(drift(all, 'T-002'), 'differs');
  assert.ok(all.reports.every((report) => report.references.every((reference) => reference.available === 'available')), 'availability is still checked');
  assert.equal(drift(taskLint(root, 'T-001', { json: true }), 'T-001'), 'differs');
});
