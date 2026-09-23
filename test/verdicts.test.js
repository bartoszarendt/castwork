/**
 * Third review round, finding 4: a favorable outcome is not "somebody said
 * yes". An effective reject or needs_revision from a relevant actor or role
 * leaves the requirement not_satisfied, however many accepts stand beside it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mayBeDone, requirementEvaluation } from '../src/checks.js';
import { TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { taskSet } from '../src/task-cli.js';

/** @param {string} frontmatter */
function record(frontmatter) {
  return parseRecord(`---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\n${frontmatter}---\n\n## Intent\nx\n`);
}

function requirement(results, name) {
  const found = results.find((result) => result.requirement === name);
  assert.ok(found, `no result for ${name}`);
  return found;
}

const ROLE = 'requirements:\n  assessment_roles: [verifier]\ncandidates:\n  - ref: aaa\n    producers: [worker@codex]\n';
const INDEPENDENT = 'requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: [worker@codex]\n';

/** Finding 4a: `some(accept)` let one verifier overrule another. */
test('4: assessment_roles is not satisfied when one verifier rejects and another accepts', () => {
  const parsed = record(`${ROLE}assessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n`);
  const result = requirement(requirementEvaluation(parsed), 'assessment_roles:verifier');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'assessment.rejected');
});

test('4: the order of the two verifiers does not change the outcome', () => {
  const parsed = record(`${ROLE}assessments:\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n`);
  const result = requirement(requirementEvaluation(parsed), 'assessment_roles:verifier');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'assessment.rejected');
});

test('4: needs_revision blocks assessment_roles exactly as reject does', () => {
  const parsed = record(`${ROLE}assessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: needs_revision }\n`);
  const result = requirement(requirementEvaluation(parsed), 'assessment_roles:verifier');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'assessment.rejected');
});

test('4: the blocking actors are named in the facts', () => {
  const parsed = record(`${ROLE}assessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n`);
  const result = requirement(requirementEvaluation(parsed), 'assessment_roles:verifier');
  const facts = result.facts.map((fact) => fact.fact).join(' | ');
  assert.match(facts, /m2/);
  assert.ok(!/(^|\W)m1(\W|$)/.test(facts.split('blocking')[1] ?? ''), 'the accepting actor is not blocking');
});

/** Finding 4b: the same actor changing their mind is not two actors. */
test('4: a reject followed by an accept from the same actor is satisfied', () => {
  const parsed = record(`${ROLE}assessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: reject }\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n`);
  const result = requirement(requirementEvaluation(parsed), 'assessment_roles:verifier');
  assert.equal(result.status, 'satisfied');
  assert.equal(result.reason, 'assessment.accepted');
});

test('4: a single accepting verifier is still satisfied', () => {
  const parsed = record(`${ROLE}assessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n`);
  assert.equal(requirement(requirementEvaluation(parsed), 'assessment_roles:verifier').status, 'satisfied');
});

/** Finding 4c: independent_review inspected accepting assessments only. */
test('4: independent_review is not satisfied when one independent reviewer rejects', () => {
  const parsed = record(`${INDEPENDENT}assessments:\n  - { candidate: aaa, role: verifier, actor: a1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n`);
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'assessment.rejected');
  assert.match(result.facts.map((fact) => fact.fact).join(' | '), /m2/);
});

test('4: needs_revision from an independent actor blocks independent_review', () => {
  const parsed = record(`${INDEPENDENT}assessments:\n  - { candidate: aaa, role: verifier, actor: a1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: needs_revision }\n`);
  assert.equal(requirement(requirementEvaluation(parsed), 'independent_review').reason, 'assessment.rejected');
});

test('4: a producer rejecting their own candidate does not block independence', () => {
  const parsed = record(`${INDEPENDENT}assessments:\n  - { candidate: aaa, role: verifier, actor: a1, verdict: accept }\n  - { candidate: aaa, role: worker, actor: worker@codex, verdict: reject }\n`);
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'satisfied');
  assert.equal(result.reason, 'actor.independent');
});

test('4: an independent reject followed by that actor accepting is satisfied', () => {
  const parsed = record(`${INDEPENDENT}assessments:\n  - { candidate: aaa, role: verifier, actor: a1, verdict: reject }\n  - { candidate: aaa, role: verifier, actor: a1, verdict: accept }\n`);
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'satisfied');
  assert.equal(result.reason, 'actor.independent');
});

test('4: a blocking assessment on an earlier candidate is inapplicable', () => {
  const parsed = record('requirements:\n  independent_review: true\n  assessment_roles: [verifier]\ncandidates:\n  - ref: aaa\n    producers: [worker@codex]\n  - ref: bbb\n    producers: [worker@codex]\nassessments:\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n  - { candidate: bbb, role: verifier, actor: m1, verdict: accept }\n');
  const results = requirementEvaluation(parsed);
  assert.equal(requirement(results, 'assessment_roles:verifier').status, 'satisfied');
  assert.equal(requirement(results, 'independent_review').status, 'satisfied');
});

/** The unknown rules are unchanged by this fix. */
test('4: a candidate with no producers still leaves independence unknown', () => {
  const parsed = record('requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: verifier, actor: a1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n');
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'producers.missing');
});

test('4: an accepting assessment with no actor still leaves independence unknown', () => {
  const parsed = record(`${INDEPENDENT}assessments:\n  - { candidate: aaa, role: verifier, verdict: accept }\n`);
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'actor.missing');
});

/** The write validation follows the evaluation. */
test('4: mayBeDone refuses the mixed verdict for both requirement kinds', () => {
  const parsed = record('requirements:\n  independent_review: true\n  assessment_roles: [verifier]\ncandidates:\n  - ref: aaa\n    producers: [worker@codex]\nassessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n');
  const verdict = mayBeDone(parsed);
  assert.equal(verdict.allowed, false);
  assert.deepEqual(
    verdict.blocking.map((result) => result.reason).sort(),
    ['assessment.rejected', 'assessment.rejected'],
  );
});

test('4: task set status done refuses a record with a mixed verdict', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-verdict-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(
    file,
    '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  assessment_roles: [verifier]\ncandidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: verifier, actor: m1, verdict: accept }\n  - { candidate: aaa, role: verifier, actor: m2, verdict: reject }\n---\n\n## Intent\nx\n',
    'utf8',
  );
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /not satisfied/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
