import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { decisionNew } from '../src/decision-cli.js';
import { DECISIONS_DIRECTORY, TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { findRecord, taskNew, taskSet } from '../src/task-cli.js';
import { formatScalar, parseYaml } from '../src/yaml.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-scalar-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** Values that a bare YAML scalar would mangle, plus ordinary ones. */
const TRICKY = [
  'Fix #1 regression',
  'Handle # in the middle',
  '#leading hash',
  '[bracketed] start',
  '{braced} start',
  'Support a: b mapping',
  'Quote "this" properly',
  "It's an apostrophe",
  'trailing space ',
  ' leading space',
  'tab\there',
  '- leading dash',
  '? leading question',
  '*star',
  '&anchor',
  '!bang',
  '|pipe',
  '>gt',
  '100%',
  '@mention',
  '`backtick`',
  'comma, separated',
  'true',
  'false',
  'null',
  '123',
  '1.5',
  'back\\slash',
  'ordinary title',
];

for (const value of TRICKY) {
  test(`formatScalar round-trips ${JSON.stringify(value)}`, () => {
    const parsed = parseYaml(`title: ${formatScalar(value)}`);
    assert.equal(parsed.title, value);
    assert.equal(typeof parsed.title, 'string');
  });
}

test('an ordinary title is left unquoted', () => {
  assert.equal(formatScalar('ordinary title'), 'ordinary title');
});

test('a value that would parse as a non-string is quoted', () => {
  for (const value of ['true', 'false', 'null', '123', '1.5', 'yes', 'no']) {
    assert.ok(formatScalar(value).startsWith('"'), `${value} should be quoted`);
  }
});

test('the reported case survives task new end to end', (t) => {
  const root = fixture(t);
  taskNew(root, 'Fix #1 regression');
  const { record } = findRecord(root, 'T-001');
  assert.equal(record.frontmatter.title, 'Fix #1 regression');
  assert.deepEqual(record.errors, []);
});

for (const value of TRICKY) {
  test(`task new preserves ${JSON.stringify(value)}`, (t) => {
    const root = fixture(t);
    taskNew(root, value);
    const { record } = findRecord(root, 'T-001');
    assert.equal(record.frontmatter.title, value.trim());
    assert.deepEqual(record.errors, []);
  });
}

test('task set preserves a tricky value and keeps the record parseable', (t) => {
  const root = fixture(t);
  taskNew(root, 'ordinary');
  taskSet(root, 'T-001', 'title', 'Fix #1 regression');
  const { record } = findRecord(root, 'T-001');
  assert.equal(record.frontmatter.title, 'Fix #1 regression');
  assert.deepEqual(record.errors, []);
});

test('task set does not corrupt neighbouring frontmatter', (t) => {
  const root = fixture(t);
  taskNew(root, 'ordinary');
  taskSet(root, 'T-001', 'title', 'a: b # c');
  const { record } = findRecord(root, 'T-001');
  assert.equal(record.frontmatter.id, 'T-001');
  assert.equal(record.frontmatter.status, 'draft');
  assert.equal(record.frontmatter.title, 'a: b # c');
});

test('decision new preserves a tricky title', (t) => {
  const root = fixture(t);
  decisionNew(root, 'Store money as integer #minor units');
  const file = path.join(root, DECISIONS_DIRECTORY, 'D-001.md');
  const record = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(record.frontmatter.title, 'Store money as integer #minor units');
  assert.equal(record.frontmatter.id, 'D-001');
  // A decision record carries its own status vocabulary, so it is not asserted
  // against the task statuses here; decisionNew reads only the id.
  assert.ok(!record.errors.some((error) => error.code === 'frontmatter.unparseable'));
});

test('a hash inside an already-quoted value is not treated as a comment', () => {
  assert.equal(parseYaml('title: "a # b"').title, 'a # b');
});

test('an escaped backslash before n is not read as a newline', () => {
  assert.equal(parseYaml('a: "x\\\\n"').a, 'x\\n');
});

test('escape sequences decode in one pass', () => {
  assert.equal(parseYaml('a: "tab\\there"').a, 'tab\there');
  assert.equal(parseYaml('a: "line\\nbreak"').a, 'line\nbreak');
});

test('generated ids are written safely', (t) => {
  const root = fixture(t);
  taskNew(root, 'first');
  const raw = fs.readFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), 'utf8');
  assert.match(raw, /^id: T-001$/m);
});
