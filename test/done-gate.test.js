/**
 * Fourth review round, finding 4: `task set <id> status done` evaluated only
 * recognised requirement kinds, so a record that `task lint` rejects with
 * `requirement.unknown_kind` and exit 1 was still written to `done` with exit
 * 0. A declared requirement dropped to obtain `done` is what D38-2 forbids.
 *
 * The single write is now gated on the same structural validity lint reports,
 * from the same parse the command already performs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { TASKS_DIRECTORY } from '../src/layout.js';
import { setup } from '../src/setup.js';
import { taskLint, taskSet } from '../src/task-cli.js';

function fixture(t, frontmatter) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-donegate-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(file, `---\n${frontmatter}---\n\n## Intent\nx\n`, 'utf8');
  return { root, file };
}

/**
 * Lint's own verdict over every record, which is how the CLI decides its exit
 * code. It is asked for all records because an unparseable frontmatter has no
 * readable id to filter on.
 */
function lintFails(root) {
  return taskLint(root, null, { json: true }).ok === false;
}

const MISSPELT_KIND = 'schema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  check: [test]\ncandidates:\n  - ref: aaa\n';

test('r4-4: a misspelt requirement kind refuses status done', (t) => {
  const { root, file } = fixture(t, MISSPELT_KIND);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /structural/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written');
});

test('r4-4: the refusal names the error and repeats the "Nothing was written" hint', (t) => {
  const { root } = fixture(t, MISSPELT_KIND);
  assert.throws(
    () => taskSet(root, 'T-001', 'status', 'done'),
    (error) => {
      assert.match(error.message, /structural/);
      assert.match(error.message, /requirement\.unknown_kind/);
      assert.match(error.message, /unknown requirement kind check/);
      assert.match(String(error.hint), /Nothing was written\./);
      return true;
    },
  );
});

test('r4-4: lint still exits non-zero on the same record', (t) => {
  const { root } = fixture(t, MISSPELT_KIND);
  assert.equal(lintFails(root), true, 'lint must fail where the write refuses');
});

test('r4-4: every other task set value stays unrestricted on the same record', (t) => {
  const { root, file } = fixture(t, MISSPELT_KIND);
  taskSet(root, 'T-001', 'status', 'blocked');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: blocked$/m);
  taskSet(root, 'T-001', 'title', 'still editable');
  assert.match(fs.readFileSync(file, 'utf8'), /^title: still editable$/m);
});

test('r4-4: a structurally valid record with satisfied requirements still reaches done', (t) => {
  const { root, file } = fixture(
    t,
    'schema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass }\n',
  );
  taskSet(root, 'T-001', 'status', 'done');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: done$/m);
});

test('r4-4: a structural error unrelated to requirements also refuses done', (t) => {
  const { root, file } = fixture(
    t,
    'schema: 1\nid: T-001\ntitle: t\nstatus: in_review\ndepends_on: not-a-list\n',
  );
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /structural/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

/**
 * A duplicate flow key makes the whole frontmatter unparseable, so the record
 * has no readable id and the lookup refuses before the structural gate is
 * reached. That holds wherever the duplicate sits, including inside an evidence
 * entry, which is why the parseable-id variants above use a record whose YAML
 * is valid and whose structure is not.
 */
for (const [label, frontmatter] of [
  ['at top level', 'schema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements: {checks: [test], checks: []}\n'],
  ['inside an evidence entry', 'schema: 1\nid: T-001\ntitle: t\nstatus: in_review\nevidence:\n  - { check: test, check: lint, candidate: aaa, result: pass }\n'],
]) {
  test(`r4-4: a duplicate flow key ${label} is refused before the id can be read`, (t) => {
    const { root, file } = fixture(t, frontmatter);
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /no task record with id T-001/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written');
    assert.equal(lintFails(root), true, 'lint reports it as a structural error');
  });
}
