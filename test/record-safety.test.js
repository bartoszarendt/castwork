import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { identityList, isRelativePath, requirementEvaluation } from '../src/checks.js';
import { observe } from '../src/observations.js';
import { parseRecord } from '../src/record.js';
import { formatScalar, parseYaml, YamlError } from '../src/yaml.js';

function tmp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-safety-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const requirement = (record, name) => requirementEvaluation(record).find((entry) => entry.requirement === name);

/** @param {string} producers */
function independence(producers, actor = 'm@x') {
  return parseRecord(`---\nschema: 1\nid: T-1\ntitle: t\nstatus: in_review\nrequirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: ${producers}\nassessments:\n  - { candidate: aaa, role: maintainer, actor: ${actor}, verdict: accept }\n---\n`);
}

// ---------------------------------------------------------------- finding 4
for (const producers of ['[""]', '["  "]', '["\\t"]', '[null]', '[1]', '[]']) {
  test(`4: producers ${producers} leaves independence unknown, not satisfied`, () => {
    const result = requirement(independence(producers), 'independent_review');
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'producers.missing');
  });
}

test('4: a blank producer entry is a structural error', () => {
  const record = independence('["", "engineer@a"]');
  assert.ok(record.errors.some((error) => error.code === 'identity.blank'));
});

test('4: a real producer still satisfies independence', () => {
  assert.equal(requirement(independence('["engineer@a"]'), 'independent_review').status, 'satisfied');
});

test('4: a blank producer mixed with a real one still compares against the real one', () => {
  const result = requirement(independence('["", "engineer@a"]'), 'independent_review');
  assert.equal(result.status, 'satisfied');
  assert.equal(requirement(independence('["", "m@x"]'), 'independent_review').status, 'not_satisfied');
});

test('4: a blank actor does not count as an accepting identity', () => {
  const record = parseRecord('---\nschema: 1\nid: T-1\ntitle: t\nstatus: in_review\nrequirements:\n  independent_review: true\ncandidates:\n  - ref: aaa\n    producers: ["engineer@a"]\nassessments:\n  - { candidate: aaa, role: maintainer, actor: "  ", verdict: accept }\n---\n');
  const result = requirement(record, 'independent_review');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'actor.missing');
  assert.ok(record.errors.some((error) => error.code === 'identity.blank'));
});

test('4: identityList keeps only usable identities', () => {
  assert.deepEqual(identityList(['a', '', '  ', null, 3, 'b ']), ['a', 'b']);
  assert.deepEqual(identityList('not a list'), []);
});

// ---------------------------------------------------------------- finding 5
test('5: an escaped quote does not end the string before a hash', () => {
  assert.equal(parseYaml('a: "x \\" # y"').a, 'x " # y');
  assert.equal(parseYaml('title: "Fix \\"#1\\" regression # not a comment"').title, 'Fix "#1" regression # not a comment');
});

test('5: a carriage return round-trips instead of being dropped', () => {
  for (const value of ['line\rreturn', 'crlf\r\nhere', '\rleading', 'trailing\r']) {
    assert.equal(parseYaml(`a: ${formatScalar(value)}`).a, value);
  }
});

test('5: a real comment is still stripped', () => {
  assert.equal(parseYaml('a: plain # comment').a, 'plain');
  assert.equal(parseYaml('a: "quoted" # comment').a, 'quoted');
});

test('5: every escape sequence round-trips through formatScalar', () => {
  for (const value of ['back\\slash', 'quote"inside', 'tab\there', 'nl\nhere', 'cr\rhere', 'all\\"\t\r\n#']) {
    assert.equal(parseYaml(`a: ${formatScalar(value)}`).a, value);
  }
});

// ---------------------------------------------------------------- finding 6
for (const key of ['__proto__', 'constructor', 'prototype']) {
  test(`6: a ${key} key is rejected rather than silently swallowed`, () => {
    assert.throws(() => parseYaml(`${key}: value\n`), YamlError);
    assert.throws(() => parseYaml(`a:\n  ${key}: value\n`), YamlError);
    assert.throws(() => parseYaml(`a: { ${key}: value }\n`), YamlError);
  });
}

test('6: parsed maps have a null prototype', () => {
  assert.equal(Object.getPrototypeOf(parseYaml('a: 1')), null);
  assert.equal(Object.getPrototypeOf(parseYaml('a:\n  b: 1').a), null);
  assert.equal(Object.getPrototypeOf(parseYaml('a: [{ b: 1 }]').a[0]), null);
});

test('6: inherited fields are not visible through a parsed record', () => {
  const record = parseRecord('---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\n---\n');
  assert.equal(record.frontmatter.constructor, undefined);
  assert.equal(record.frontmatter.toString, undefined);
  assert.equal(record.frontmatter.hasOwnProperty, undefined);
});

test('6: a record declaring __proto__ is a structural error, not a pollution', () => {
  const record = parseRecord('---\nschema: 1\nid: T-1\ntitle: t\nstatus: draft\n__proto__:\n  polluted: true\n---\n');
  assert.ok(record.errors.some((error) => error.code === 'frontmatter.unparseable'));
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

// ---------------------------------------------------------------- finding 8
for (const link of ['../secret.txt', '../../etc/passwd', 'a/../../b.txt', '/etc/passwd', 'C:\\secret.txt', '..\\secret.txt']) {
  test(`8: ${JSON.stringify(link)} is not treated as a link`, () => {
    assert.equal(isRelativePath(link), false);
  });
}

test('8: an ordinary root-relative link is still a link', () => {
  assert.equal(isRelativePath('logs/lint.txt'), true);
  assert.equal(isRelativePath('.agenticloop/logs/out.txt'), true);
});

test('8: a traversing link is never observed', (t) => {
  const root = tmp(t);
  const outside = tmp(t);
  fs.writeFileSync(path.join(outside, 'known.txt'), 'SECRET\n', 'utf8');
  fs.mkdirSync(path.join(root, '.agenticloop', 'tasks'), { recursive: true });
  const relative = path.relative(path.join(root, '.agenticloop', 'tasks'), path.join(outside, 'known.txt')).split(path.sep).join('/');
  const file = path.join(root, '.agenticloop', 'tasks', 'T-001.md');
  fs.writeFileSync(file, `---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass, output: "${relative}" }\n---\n`, 'utf8');
  const record = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
  // The observation maps carry a null prototype since the third round, so they
  // are compared by their own entries rather than by identity with a literal.
  assert.deepEqual({ ...observe(record, root).files }, {}, 'no external existence may be reported');
});

test('8: an in-checkout link is observed, resolved from the repository root', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.agenticloop', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'lint.txt'), 'out\n', 'utf8');
  const file = path.join(root, '.agenticloop', 'tasks', 'T-001.md');
  fs.writeFileSync(file, '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: lint, candidate: aaa, result: pass, output: "logs/lint.txt" }\n  - { check: test, candidate: aaa, result: pass, output: "logs/absent.txt" }\n---\n', 'utf8');
  const record = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
  assert.deepEqual({ ...observe(record, root).files }, { 'logs/lint.txt': true, 'logs/absent.txt': false });
});
