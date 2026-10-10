/**
 * Comparing the working tree with a snapshot: a `tree:` reference resolves,
 * drift is observed for the current candidate only, under the repository's own
 * rules, and is not checked where it cannot be.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { snapshotTree, takeSnapshot } from '../src/snapshot.js';
import { cli, git, references, repository, writeTask } from './snapshot-fixtures.js';

test('lint resolves a tree: reference and reports a missing or malformed one as unavailable', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const { ref } = takeSnapshot(root);
  const results = references(root, `  - ref: tree:${'0'.repeat(40)}\n  - ref: tree:--output=x\n  - ref: ${ref}\n`);
  assert.deepEqual(results.map((result) => result.available), ['unavailable', 'unavailable', 'available']);
  assert.equal(snapshotTree('tree:--output=x'), null, 'a reference can never become a git option');

  // A blob or a commit named as a tree is not a snapshot.
  const blob = git(root, 'rev-parse', 'HEAD:app.txt').trim();
  assert.equal(references(root, `  - ref: tree:${blob}\n`)[0].available, 'unavailable');
});

test('drift is observed for the current snapshot, cleared when the edit is reverted', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const { ref } = takeSnapshot(root);
  const current = () => references(root, `  - ref: ${ref}\n`)[0];
  assert.equal(current().drift, 'matches');

  fs.writeFileSync(path.join(root, 'app.txt'), 'edited after the evidence\n', 'utf8');
  fs.writeFileSync(path.join(root, 'stray.txt'), 'x\n', 'utf8');
  const drifted = current();
  assert.equal(drifted.drift, 'differs');
  assert.deepEqual(drifted.drift_paths.sort(), ['app.txt', 'stray.txt']);

  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  fs.rmSync(path.join(root, 'stray.txt'));
  assert.equal(current().drift, 'matches');

  // Records and ignored files are not drift.
  writeTask(root, `  - ref: ${ref}\n`);
  fs.writeFileSync(path.join(root, 'ignored.log'), 'noise\n', 'utf8');
  assert.equal(current().drift, 'matches');

  // Only the current candidate is compared.
  const earlier = references(root, `  - ref: ${ref}\n  - ref: HEAD\n`)[0];
  assert.equal(earlier.drift, undefined);
});

test('with core.autocrlf on, CRLF on disk is the same candidate and no drift', (t) => {
  const root = repository(t);
  git(root, 'config', 'core.autocrlf', 'true');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'a\nb\n', 'utf8');
  const lf = takeSnapshot(root);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'a\r\nb\r\n', 'utf8');
  const crlf = takeSnapshot(root);
  assert.equal(crlf.ref, lf.ref);
  assert.equal(takeSnapshot(root, { reuseIndex: false }).ref, lf.ref);
  assert.equal(git(root, 'cat-file', 'blob', `${lf.tree}:notes.txt`), 'a\nb\n', 'stored as git would commit it');
  assert.equal(references(root, `  - ref: ${lf.ref}\n`)[0].drift, 'matches');
});

test('a dirty submodule is not drift', (t) => {
  const root = repository(t);
  const module = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-module-')));
  t.after(() => fs.rmSync(module, { recursive: true, force: true }));
  git(module, 'init', '--quiet');
  fs.writeFileSync(path.join(module, 'lib.txt'), 'lib\n', 'utf8');
  git(module, 'add', '-A');
  git(module, 'commit', '--quiet', '-m', 'lib');
  git(root, '-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', module, 'lib');
  git(root, 'commit', '--quiet', '-m', 'with a submodule');
  const { ref } = takeSnapshot(root);
  fs.writeFileSync(path.join(root, 'lib', 'lib.txt'), 'edited inside the submodule\n', 'utf8');
  fs.writeFileSync(path.join(root, 'lib', 'scratch.txt'), 'untracked inside it\n', 'utf8');
  assert.equal(references(root, `  - ref: ${ref}\n`)[0].drift, 'matches');
});

test('in a sparse checkout drift is not checked rather than counted', (t) => {
  const root = repository(t);
  for (const directory of ['kept', 'elsewhere']) {
    fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, directory, 'file.txt'), `${directory}\n`, 'utf8');
  }
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'two directories');
  const { ref } = takeSnapshot(root);
  git(root, 'sparse-checkout', 'set', 'kept');
  assert.equal(fs.existsSync(path.join(root, 'elsewhere', 'file.txt')), false, 'the checkout is sparse');
  const [current] = references(root, `  - ref: ${ref}\n`);
  assert.equal(current.available, 'available');
  assert.equal(current.drift, 'not_checked');
});

test('an uppercase tree: reference resolves, and a moving current candidate is noted', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const { tree } = takeSnapshot(root);
  const [upper] = references(root, `  - ref: tree:${tree.toUpperCase()}\n`);
  assert.equal(upper.available, 'available');
  assert.equal(upper.drift, 'matches');
  assert.equal(snapshotTree(`tree:${tree.toUpperCase()}`), tree);

  writeTask(root, '  - ref: HEAD\n');
  const lint = cli(root, 'task', 'lint', 'T-001');
  assert.match(lint.out, /available +candidate +HEAD +\(current\)/, 'it resolves');
  assert.match(lint.out, /info {3}candidate\.moving_ref: the current candidate HEAD is a name, not an object id/);
});
