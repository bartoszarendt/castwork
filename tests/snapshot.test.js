/**
 * Uncommitted candidate snapshots: a `tree:<sha>` names exactly what is in the
 * working tree, under the repository's own ignore and line-ending rules,
 * without a commit. Taking one leaves the real index, HEAD, refs, and working
 * tree alone. Drift and lint are in snapshot-drift.test.js, the command in
 * snapshot-cli.test.js.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { snapshotDrift, takeSnapshot } from '../src/snapshot.js';
import { cli, git, references, repository, state, writeTask } from './snapshot-fixtures.js';

test('the same content gives the same snapshot, and a change gives another', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const first = takeSnapshot(root);
  const second = takeSnapshot(root);
  assert.match(first.ref, /^tree:[0-9a-f]{40,64}$/);
  assert.equal(first.ref, second.ref);
  assert.equal(first.base, git(root, 'rev-parse', 'HEAD').trim());
  assert.deepEqual(first.paths, ['app.txt']);

  fs.writeFileSync(path.join(root, 'app.txt'), 'three\n', 'utf8');
  assert.notEqual(takeSnapshot(root).ref, first.ref);
});

test('with nothing changed, the snapshot is the base commit\'s tree', (t) => {
  const root = repository(t);
  const snapshot = takeSnapshot(root);
  assert.equal(snapshot.tree, git(root, 'rev-parse', 'HEAD^{tree}').trim());
  assert.deepEqual(snapshot.paths, []);
});

test('task records and machine-local state do not change the snapshot', (t) => {
  const root = repository(t);
  const before = takeSnapshot(root).ref;
  writeTask(root, '  - ref: anything\n');
  fs.mkdirSync(path.join(root, '.castwork', 'local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.castwork', 'local', 'state.json'), '{}\n', 'utf8');
  assert.equal(takeSnapshot(root).ref, before);
});

test('untracked files are included and ignored ones are not', (t) => {
  const root = repository(t);
  const before = takeSnapshot(root).ref;
  fs.writeFileSync(path.join(root, 'ignored.log'), 'noise\n', 'utf8');
  assert.equal(takeSnapshot(root).ref, before, 'an ignored file stays out');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n', 'utf8');
  const withNew = takeSnapshot(root);
  assert.notEqual(withNew.ref, before);
  assert.deepEqual(withNew.paths, ['new.txt']);
  assert.equal(git(root, 'show', `${withNew.tree}:new.txt`), 'new\n', 'plain git reads the snapshot');
});

test('the repository\'s own line-ending rules apply, so CRLF on disk is not a different candidate', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt text eol=lf\n', 'utf8');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'a\nb\n', 'utf8');
  const lf = takeSnapshot(root).ref;
  fs.writeFileSync(path.join(root, 'notes.txt'), 'a\r\nb\r\n', 'utf8');
  assert.equal(takeSnapshot(root).ref, lf);
});

test('a snapshot leaves the real index, HEAD, refs, and working tree untouched', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'edited\n', 'utf8');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n', 'utf8');
  git(root, 'add', 'new.txt');
  const before = state(root);
  takeSnapshot(root);
  const after = state(root);
  assert.equal(after.index, before.index);
  assert.equal(after.head, before.head);
  assert.equal(after.refs, before.refs);
  assert.equal(after.status, before.status);
  assert.equal(after.app, before.app);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`castwork-index-${process.pid}-`)).length, 0, 'the temporary index is deleted');
});

test('a repository without a commit has no base, and every path differs', (t) => {
  const root = repository(t, { commit: false });
  const snapshot = takeSnapshot(root);
  assert.equal(snapshot.base, null);
  assert.ok(snapshot.paths.includes('app.txt'));
  assert.ok(!snapshot.paths.some((relative) => relative.startsWith('.castwork/tasks')));
});

test('a tasks directory that is tracked and then ignored does not stop a snapshot or change it', (t) => {
  const root = repository(t);
  writeTask(root, '  - ref: 0123abc\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'a tracked record');
  fs.appendFileSync(path.join(root, '.gitignore'), '.castwork/tasks/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '--quiet', '-m', 'ignore the records');
  const before = takeSnapshot(root);
  assert.equal(before.tree, git(root, 'rev-parse', 'HEAD^{tree}').trim());

  writeTask(root, '  - ref: 0123abc\n  - ref: 4567def\n');
  fs.writeFileSync(path.join(root, '.castwork', 'tasks', 'T-002.md'), '---\nschema: 1\n---\n', 'utf8');
  const printed = cli(root, 'snapshot');
  assert.equal(printed.code, 0, printed.err);
  assert.equal(printed.out.split('\n')[0], before.ref, 'records do not change the snapshot');
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  assert.deepEqual(takeSnapshot(root).paths, ['app.txt']);
});

test('machine-local state never changes the snapshot, ignored or not', (t) => {
  const root = repository(t);
  const before = takeSnapshot(root).ref;
  const local = path.join(root, '.castwork', 'local');
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, 'state.json'), '{}\n', 'utf8');
  assert.equal(takeSnapshot(root).ref, before, 'ignored, as setup leaves it');

  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.log\n', 'utf8');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '--quiet', '-m', 'local no longer ignored');
  const base = takeSnapshot(root).ref;
  fs.writeFileSync(path.join(local, 'other.json'), '{"a":1}\n', 'utf8');
  assert.equal(takeSnapshot(root).ref, base, 'not ignored, and still left out');
  assert.equal(references(root, `  - ref: ${base}\n`)[0].drift, 'matches', 'and not drift either');
});

test('a copy of the real index and an empty one give the same snapshot and the same drift', (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, 'dir'));
  fs.writeFileSync(path.join(root, 'dir', 'kept.txt'), 'kept\n', 'utf8');
  fs.writeFileSync(path.join(root, 'gone.txt'), 'gone\n', 'utf8');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'more files');
  // Edited, deleted, untracked, staged, and staged then edited again.
  fs.writeFileSync(path.join(root, 'app.txt'), 'edited\n', 'utf8');
  fs.rmSync(path.join(root, 'gone.txt'));
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n', 'utf8');
  fs.writeFileSync(path.join(root, 'dir', 'kept.txt'), 'staged\n', 'utf8');
  git(root, 'add', 'dir/kept.txt');
  fs.writeFileSync(path.join(root, 'dir', 'kept.txt'), 'staged, then edited\n', 'utf8');

  const copied = takeSnapshot(root);
  const fresh = takeSnapshot(root, { reuseIndex: false });
  assert.equal(copied.ref, fresh.ref);
  assert.deepEqual(copied.paths.sort(), ['app.txt', 'dir/kept.txt', 'gone.txt', 'new.txt']);
  assert.equal(git(root, 'show', `${copied.tree}:dir/kept.txt`), 'staged, then edited\n');

  fs.writeFileSync(path.join(root, 'app.txt'), 'drifted\n', 'utf8');
  assert.deepEqual(snapshotDrift(root, copied.tree), ['app.txt']);
  assert.deepEqual(snapshotDrift(root, copied.tree, { reuseIndex: false }), ['app.txt']);

  // A file marked assume-unchanged would hide its edit in a copied index, so
  // such an index is not copied.
  git(root, 'update-index', '--assume-unchanged', 'dir/kept.txt');
  fs.writeFileSync(path.join(root, 'dir', 'kept.txt'), 'hidden from a copy\n', 'utf8');
  assert.equal(takeSnapshot(root).ref, takeSnapshot(root, { reuseIndex: false }).ref);
  assert.equal(git(root, 'show', `${takeSnapshot(root).tree}:dir/kept.txt`), 'hidden from a copy\n');
});
