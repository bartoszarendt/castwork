import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkRecord, mayBeDone } from '../src/checks.js';
import { parseRecord } from '../src/record.js';

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples');

/** @param {string} name */
function load(name) {
  return parseRecord(fs.readFileSync(path.join(examples, `${name}.md`), 'utf8'), { path: name });
}

test('every documented example is structurally valid', () => {
  for (const name of ['solo', 'delegated', 'not-independent']) {
    assert.deepEqual(checkRecord(load(name)).structural.errors, [], `${name} has structural errors`);
  }
});

test('case A, solo: checks only, satisfied, no independence reported', () => {
  const record = load('solo');
  const results = checkRecord(record).requirements;
  assert.deepEqual(results.map((entry) => entry.requirement), ['checks:test']);
  assert.equal(results[0].status, 'satisfied');
  assert.ok(!results.some((entry) => entry.requirement === 'independent_review'));
  assert.equal(mayBeDone(record).allowed, true);
});

test('case B, delegated: independence and role assessment both satisfied', () => {
  const record = load('delegated');
  const results = checkRecord(record).requirements;
  assert.deepEqual(
    results.map((entry) => [entry.requirement, entry.status]),
    [['checks:test', 'satisfied'], ['checks:lint', 'satisfied'], ['independent_review', 'satisfied'], ['assessment_roles:maintainer', 'satisfied']],
  );
  assert.equal(mayBeDone(record).allowed, true);
});

test('case C, negative: the reviewer is a producer, so independence fails', () => {
  const record = load('not-independent');
  const results = checkRecord(record).requirements;
  const independence = results.find((entry) => entry.requirement === 'independent_review');
  assert.equal(independence.status, 'not_satisfied');
  assert.equal(independence.reason, 'actor.is_producer');

  // The role assessment still passes: the two requirements are independent.
  assert.equal(results.find((entry) => entry.requirement === 'assessment_roles:maintainer').status, 'satisfied');
  assert.equal(mayBeDone(record).allowed, false);
});

test('the canonical example in the docs parses and satisfies its requirements', () => {
  const doc = fs.readFileSync(path.join(examples, '..', 'record-format.md'), 'utf8');
  const blocks = [...doc.matchAll(/```markdown\n([\s\S]*?)```/g)].map((match) => match[1]);
  const canonical = blocks.find((block) => block.includes('id: T-001'));
  assert.ok(canonical, 'the canonical example is missing from record-format.md');
  const record = parseRecord(canonical);
  assert.deepEqual(record.errors, []);
  const results = checkRecord(record).requirements;
  assert.ok(results.every((entry) => entry.status === 'satisfied'), JSON.stringify(results));
});
