import assert from 'node:assert/strict';
import test from 'node:test';

import { checkRecord, currentCandidate, effectiveAssessments, effectiveEvidence, mayBeDone, referenceAvailability, requirementEvaluation } from '../src/checks.js';
import { parseRecord } from '../src/record.js';

/** @param {string} frontmatter */
const record = (frontmatter) => parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: in_review\n${frontmatter}---\n\n## Intent\nx\n`);

const requirement = (results, name) => results.find((entry) => entry.requirement === name);

test('the current candidate is the last in document order', () => {
  const parsed = record('candidates:\n  - ref: aaa\n  - ref: bbb\n');
  assert.equal(currentCandidate(parsed).ref, 'bbb');
});

test('checks requirement is satisfied by a passing evidence entry', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  assert.equal(requirement(requirementEvaluation(parsed), 'checks:test').status, 'satisfied');
});

test('absent evidence is not_satisfied with reason evidence.missing, never unknown', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  const result = requirement(requirementEvaluation(parsed), 'checks:test');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'evidence.missing');
});

test('a later fail overrides an earlier pass for the same check and candidate', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n  - { check: test, candidate: aaa, result: fail }\n');
  const result = requirement(requirementEvaluation(parsed), 'checks:test');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'evidence.fail');
  assert.equal(effectiveEvidence(parsed, 'test', 'aaa').result, 'fail');
});

test('a later pass after a fail restores satisfaction', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: fail }\n  - { check: test, candidate: aaa, result: pass }\n');
  assert.equal(requirement(requirementEvaluation(parsed), 'checks:test').status, 'satisfied');
});

test('independent_review is satisfied when the accepting actor is not a producer', () => {
  const parsed = record('requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: [engineer@a]\nassessments:\n  - { candidate: aaa, role: maintainer, actor: maintainer@b, verdict: accept }\n');
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'satisfied');
  assert.equal(result.reason, 'actor.independent');
});

test('independent_review fails when the accepting actor is a producer, whatever role it claims', () => {
  const parsed = record('requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: [engineer@a]\nassessments:\n  - { candidate: aaa, role: auditor, actor: engineer@a, verdict: accept }\n');
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'actor.is_producer');
});

test('independent_review is unknown when the candidate records no producers', () => {
  const parsed = record('requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: maintainer, actor: m@b, verdict: accept }\n');
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'producers.missing');
});

test('independent_review is unknown when every accepting assessment lacks an actor', () => {
  const parsed = record('requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: [engineer@a]\nassessments:\n  - { candidate: aaa, role: maintainer, verdict: accept }\n');
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'actor.missing');
});

test('comparing two actor strings is checked while the identities stay asserted', () => {
  const parsed = record('requirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: [engineer@a]\nassessments:\n  - { candidate: aaa, role: maintainer, actor: maintainer@b, verdict: accept }\n');
  const result = requirement(requirementEvaluation(parsed), 'independent_review');
  const trusts = Object.fromEntries(result.facts.map((fact) => [fact.fact.slice(0, 16), fact.trust]));
  assert.equal(result.facts.filter((fact) => fact.trust === 'checked').length, 1);
  assert.equal(result.facts.filter((fact) => fact.trust === 'asserted').length, 2);
  assert.ok(Object.values(trusts).includes('asserted'));
});

test('assessment_roles is satisfied only by an accept from that role', () => {
  const accepted = record('requirements:\n  assessment_roles: [maintainer]\ncandidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: maintainer, actor: m, verdict: accept }\n');
  assert.equal(requirement(requirementEvaluation(accepted), 'assessment_roles:maintainer').status, 'satisfied');

  const rejected = record('requirements:\n  assessment_roles: [maintainer]\ncandidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: maintainer, actor: m, verdict: reject }\n');
  const result = requirement(requirementEvaluation(rejected), 'assessment_roles:maintainer');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'assessment.not_accepted');
});

test('a rejecting assessment stays effective until the same actor records a later one', () => {
  const parsed = record('requirements:\n  assessment_roles: [maintainer]\ncandidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: maintainer, actor: m, verdict: accept }\n  - { candidate: aaa, role: maintainer, actor: m, verdict: reject }\n');
  assert.equal(requirement(requirementEvaluation(parsed), 'assessment_roles:maintainer').status, 'not_satisfied');
  assert.equal(effectiveAssessments(parsed, 'aaa').length, 1);
});

test('two actors each keep their own effective assessment', () => {
  const parsed = record('candidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: maintainer, actor: m, verdict: reject }\n  - { candidate: aaa, role: auditor, actor: a, verdict: accept }\n');
  assert.equal(effectiveAssessments(parsed, 'aaa').length, 2);
});

test('adding a candidate makes prior evidence inapplicable without any diagnostic', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n  - ref: bbb\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  assert.deepEqual(parsed.errors, []);
  const result = requirement(requirementEvaluation(parsed), 'checks:test');
  assert.equal(result.status, 'not_satisfied');
  assert.equal(result.reason, 'evidence.missing');
});

test('an undeclared requirement is never introduced', () => {
  const parsed = record('candidates:\n  - ref: aaa\n    producers: [e]\nassessments:\n  - { candidate: aaa, role: maintainer, actor: e, verdict: accept }\n');
  assert.deepEqual(requirementEvaluation(parsed), []);
  assert.equal(mayBeDone(parsed).allowed, true);
});

test('references are not_checked without observations and unavailable with them', () => {
  const parsed = record('candidates:\n  - ref: aaa\n');
  assert.equal(referenceAvailability(parsed)[0].available, 'not_checked');
  assert.equal(referenceAvailability(parsed, { refs: { aaa: false } })[0].available, 'unavailable');
  assert.equal(referenceAvailability(parsed, { refs: { aaa: true } })[0].available, 'available');
});

test('an unavailable reference is not a structural error', () => {
  const parsed = record('candidates:\n  - ref: deadbee\n');
  const report = checkRecord(parsed, { refs: { deadbee: false } });
  assert.equal(report.structural.valid, true);
  assert.equal(report.references[0].available, 'unavailable');
});

test('the three outputs are reported separately', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  const report = checkRecord(parsed, { refs: { aaa: true } });
  assert.deepEqual(Object.keys(report), ['structural', 'references', 'requirements']);
  assert.equal(report.structural.valid, true);
  assert.equal(report.references.length, 1);
  assert.equal(report.requirements.length, 1);
});

test('mayBeDone blocks only on unsatisfied requirements', () => {
  const blocked = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n');
  assert.equal(mayBeDone(blocked).allowed, false);
  assert.equal(mayBeDone(blocked).blocking.length, 1);

  const clear = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  assert.equal(mayBeDone(clear).allowed, true);
});

test('checks are pure: the same input gives the same result and nothing is mutated', () => {
  const parsed = record('requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n');
  const before = JSON.stringify(parsed.frontmatter);
  const first = JSON.stringify(requirementEvaluation(parsed));
  const second = JSON.stringify(requirementEvaluation(parsed));
  assert.equal(first, second);
  assert.equal(JSON.stringify(parsed.frontmatter), before);
});
