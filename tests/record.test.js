import assert from 'node:assert/strict';
import test from 'node:test';

import { declaredRequirements, parseRecord, splitFrontmatter, STATUS_VALUES } from '../src/record.js';

const canonical = `---
schema: 1
id: T-001
title: Greet by name
status: in_review
requirements:
  checks: [test, lint]
  independent_review: true
candidates:
  - ref: 007c7f8
    producers: [worker@claude]
evidence:
  - { check: test, candidate: 007c7f8, result: pass, command: "npm test", exit_code: 0 }
  - { check: lint, candidate: 007c7f8, result: pass }
assessments:
  - { candidate: 007c7f8, role: verifier, actor: verifier@codex, verdict: accept, findings: "none" }
---

## Intent
Greet the user.
## Design notes
Any extra heading is fine.
`;

test('parses the canonical example with no structural errors', () => {
  const record = parseRecord(canonical);
  assert.deepEqual(record.errors, []);
  assert.equal(record.frontmatter.id, 'T-001');
  assert.deepEqual(declaredRequirements(record), { checks: ['test', 'lint'], independent_review: true });
});

test('Current state is recognized once; closing hashes normalize duplicates at any level', () => {
  const single = parseRecord(`${canonical}\n## Current state ##\n<!-- authoring instruction -->\n## Decision#\nx\n`);
  assert.deepEqual(single.errors, []);
  assert.ok(single.headings.some(entry => entry.heading === 'Current state'));
  assert.ok(single.headings.some(entry => entry.heading === 'Decision#'));
  const duplicate = parseRecord(`${canonical}\n## Current state ##\nx\n### Current state\ny\n`);
  assert.deepEqual(duplicate.errors.map(error => error.code), ['heading.duplicate']);
});

test('an extra prose heading raises no diagnostic', () => {
  const record = parseRecord(canonical);
  assert.ok(record.headings.some((entry) => entry.heading === 'Design notes'));
  assert.deepEqual(record.errors, []);
});

test('a duplicate recognized heading is a structural error', () => {
  const record = parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\n---\n\n## Intent\na\n## Intent\nb\n`);
  assert.ok(record.errors.some((error) => error.code === 'heading.duplicate'));
});

test('an unrecognized frontmatter field is informational, not an error', () => {
  const record = parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\nteam: platform\n---\n`);
  assert.deepEqual(record.errors, []);
  assert.ok(record.info.some((note) => note.code === 'field.unrecognized'));
});

test('an unknown status value is a structural error', () => {
  const record = parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: shipped\n---\n`);
  assert.ok(record.errors.some((error) => error.code === 'status.unknown'));
});

test('missing required fields are reported individually', () => {
  const record = parseRecord(`---\nschema: 1\n---\n`);
  const missing = record.errors.filter((error) => error.code === 'field.missing').map((error) => error.field);
  assert.deepEqual(missing.sort(), ['id', 'status', 'title']);
});

test('an unknown requirement kind is a structural error', () => {
  const record = parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\nrequirements:\n  vibes: true\n---\n`);
  assert.ok(record.errors.some((error) => error.code === 'requirement.unknown_kind'));
});

test('a recognized structured list that is not a list is a structural error', () => {
  const record = parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\ncandidates: nope\n---\n`);
  assert.ok(record.errors.some((error) => error.code === 'field.not_a_list'));
});

test('an evidence entry missing a required field is reported', () => {
  const record = parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\nevidence:\n  - { check: test, result: pass }\n---\n`);
  assert.ok(record.errors.some((error) => error.code === 'entry.missing_field'));
});

test('unparseable frontmatter is reported as such', () => {
  const record = parseRecord(`---\nschema: 1\nid: "oops\n---\n`);
  assert.ok(record.errors.some((error) => error.code === 'frontmatter.unparseable'));
});

test('a record with no frontmatter is reported, not thrown', () => {
  const record = parseRecord('# just prose\n');
  assert.ok(record.errors.some((error) => error.code === 'frontmatter.missing'));
});

test('the status vocabulary is the nine documented values', () => {
  assert.equal(STATUS_VALUES.length, 9);
  assert.ok(STATUS_VALUES.includes('needs_context'));
});

test('splitFrontmatter returns the body unchanged when there is none', () => {
  assert.deepEqual(splitFrontmatter('hello\n'), { yaml: null, body: 'hello\n' });
});
