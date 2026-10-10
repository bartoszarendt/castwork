/**
 * The snapshot command and lint over snapshots: what they print, where they
 * run, and that they write nothing into `.git` but the snapshot's own objects.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { takeSnapshot } from '../src/snapshot.js';
import { BIN, cli, git, gitDirectory, repository, state, writeTask } from './snapshot-fixtures.js';

/** Run the real entry point with the temporary directory pointed somewhere the test can watch. */
function cliWithTemp(cwd, temp, ...args) {
  const env = { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp };
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('lint writes nothing to the object store, the index, or the refs', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const { ref } = takeSnapshot(root);
  fs.writeFileSync(path.join(root, 'app.txt'), 'unsnapshotted content that must not become an object\n', 'utf8');
  writeTask(root, `  - ref: ${ref}\n`);
  const before = state(root);
  const lint = cli(root, 'task', 'lint', 'T-001');
  assert.equal(lint.code, 0, lint.err);
  const after = state(root);
  assert.deepEqual(after.objects, before.objects);
  assert.equal(after.index, before.index);
  assert.equal(after.refs, before.refs);
  assert.match(lint.out, /available +candidate +tree:[0-9a-f]+ +\(current\)/);
  assert.match(lint.out, /working tree differs from the snapshot in 1 path: app\.txt/);
});

test('lint states that a later commit has the same tree as an earlier snapshot', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const { ref } = takeSnapshot(root);
  git(root, 'add', 'app.txt');
  git(root, 'commit', '--quiet', '-m', 'the snapshot, committed');
  const commit = git(root, 'rev-parse', '--short', 'HEAD').trim();
  writeTask(root, `  - ref: ${ref}\n  - ref: ${commit}\n`);
  const lint = cli(root, 'task', 'lint', 'T-001');
  assert.match(lint.out, new RegExp(`commit ${commit} has the same tree as snapshot ${ref}`));
  assert.match(lint.out, /1 earlier candidate, 0 unavailable/);
});

test('lint summarises earlier candidates with how many are unavailable', (t) => {
  const root = repository(t);
  const { ref } = takeSnapshot(root);
  writeTask(root, `  - ref: worktree-T005\n  - ref: HEAD\n  - ref: ${ref}\n`);
  const lint = cli(root, 'task', 'lint', 'T-001');
  assert.match(lint.out, /2 earlier candidates, 1 unavailable/);
});

test('the snapshot command prints the reference first, then the base and the paths; --json gives the same', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const printed = cli(root, 'snapshot');
  assert.equal(printed.code, 0, printed.err);
  const lines = printed.out.trimEnd().split('\n');
  assert.match(lines[0], /^tree:[0-9a-f]{40,64}$/);
  assert.equal(lines[1], `base: ${git(root, 'rev-parse', 'HEAD').trim()}`);
  assert.match(printed.out, /differs from base in 1 path\n {2}app\.txt/);

  const data = JSON.parse(cli(root, 'snapshot', '--json').out);
  assert.equal(data.ref, lines[0]);
  assert.deepEqual(data.paths, ['app.txt']);
  assert.equal(fs.readdirSync(path.join(root, '.castwork', 'tasks')).length, 0, 'no record is written');
});

test('a reader that keeps only the first line, as `snapshot | head -1` does, ends the command quietly', async (t) => {
  const root = repository(t);
  // More output than a pipe buffers, so the command is still writing when the
  // reader closes its end. Long names give it from few files: every file is
  // written, hashed and deleted, and that is most of this test's time.
  fs.mkdirSync(path.join(root, 'many'));
  for (let i = 0; i < 800; i += 1) fs.writeFileSync(path.join(root, 'many', `${String(i).padStart(4, '0')}-${'a-long-name-'.repeat(12)}.txt`), `${i}\n`, 'utf8');
  const child = spawn(process.execPath, [BIN, 'snapshot'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let first = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.once('data', (chunk) => {
    first = String(chunk).split('\n')[0];
    child.stdout.destroy();
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.match(first, /^tree:[0-9a-f]{40,64}$/, 'the reader got the reference');
  assert.equal(stderr, '', 'no stack trace');
  assert.equal(code, 0);
});

test('the snapshot command refuses outside a git working tree', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-nogit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = cli(root, 'snapshot');
  assert.equal(result.code, 1);
  assert.match(result.err, /snapshot needs a git working tree/);
});

test('snapshot runs only from the project root, as every other command reads it', (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'a\n', 'utf8');
  const result = cli(path.join(root, 'src'), 'snapshot');
  assert.equal(result.code, 1);
  assert.match(result.err, /\.castwork\/ does not exist here/);
  assert.match(result.err, /Run snapshot from the project root/);
  const whole = cli(root, 'snapshot');
  assert.equal(whole.code, 0, whole.err);
  assert.match(whole.out, /\n {2}src\/a\.txt/, 'from the root it covers the whole tree');
});

test('with a split index, a snapshot adds only its objects to .git, and lint writes nothing there', (t) => {
  const root = repository(t);
  git(root, 'config', 'core.splitIndex', 'true');
  git(root, 'update-index', '--split-index');
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const outsideObjects = (files) => Object.fromEntries(Object.entries(files).filter(([name]) => !name.startsWith(path.join('.git', 'objects'))));
  const beforeSnapshot = outsideObjects(gitDirectory(root));
  const printed = cli(root, 'snapshot');
  assert.equal(printed.code, 0, printed.err);
  const ref = printed.out.split('\n')[0];
  assert.deepEqual(outsideObjects(gitDirectory(root)), beforeSnapshot, 'no shared index or anything else outside the object store');
  writeTask(root, `  - ref: ${ref}\n`);
  const before = gitDirectory(root);
  for (let run = 0; run < 2; run += 1) {
    const lint = cli(root, 'task', 'lint', 'T-001');
    assert.equal(lint.code, 0, lint.err);
    assert.match(lint.out, /working tree matches the snapshot/);
  }
  assert.deepEqual(gitDirectory(root), before);
});

test('the temporary index is removed after the command, through the CLI', (t) => {
  const root = repository(t);
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-temp-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  const snapshot = cliWithTemp(root, temp, 'snapshot', '--json');
  assert.equal(snapshot.code, 0, snapshot.err);
  writeTask(root, `  - ref: ${JSON.parse(snapshot.out).ref}\n`);
  const lint = cliWithTemp(root, temp, 'task', 'lint', 'T-001');
  assert.equal(lint.code, 0, lint.err);
  assert.match(lint.out, /working tree matches the snapshot/, 'the drift check ran');
  assert.deepEqual(fs.readdirSync(temp), [], 'no temporary index is left behind');
});
