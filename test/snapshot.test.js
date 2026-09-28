/**
 * Uncommitted candidate snapshots: a `tree:<sha>` names exactly what is in the
 * working tree, under the repository's own ignore and line-ending rules,
 * without a commit. Taking one, and comparing the working tree with one during
 * lint, leaves the real index, HEAD, refs, and working tree alone and writes
 * nothing into `.git` but the snapshot's own objects.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { referenceAvailability } from '../src/checks.js';
import { observe } from '../src/observations.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { snapshotDrift, snapshotTree, takeSnapshot } from '../src/snapshot.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agenticloop.js');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A repository with one commit and Agentic Loop installed. */
function repository(t, { commit = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-snapshot-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.log\n', 'utf8');
  fs.writeFileSync(path.join(root, 'app.txt'), 'one\n', 'utf8');
  setup(root, { hosts: ['codex'] });
  if (commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'base');
  }
  return root;
}

function cli(cwd, ...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

/** Everything a snapshot or a lint must leave alone. */
function state(root) {
  const gitDir = path.join(root, '.git');
  const objects = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else objects.push(path.relative(gitDir, full));
    }
  };
  walk(path.join(gitDir, 'objects'));
  return {
    index: fs.existsSync(path.join(gitDir, 'index')) ? fs.readFileSync(path.join(gitDir, 'index')).toString('base64') : null,
    head: fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8'),
    refs: git(root, 'for-each-ref'),
    // Without --no-optional-locks, status itself may rewrite the real index.
    status: git(root, '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all'),
    app: fs.readFileSync(path.join(root, 'app.txt'), 'utf8'),
    objects: objects.sort(),
  };
}

/** @param {string} root @param {string} candidates */
function writeTask(root, candidates) {
  fs.writeFileSync(
    path.join(root, '.agenticloop', 'tasks', 'T-001.md'),
    `---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n${candidates}---\n\n## Intent\nx\n`,
    'utf8',
  );
}

/** @param {string} root @param {string} candidates */
function references(root, candidates) {
  const record = parseRecord(`---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n${candidates}---\n`);
  return referenceAvailability(record, observe(record, root));
}

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
  fs.mkdirSync(path.join(root, '.agenticloop', 'local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agenticloop', 'local', 'state.json'), '{}\n', 'utf8');
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
  assert.equal(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`agenticloop-index-${process.pid}-`)).length, 0, 'the temporary index is deleted');
});

test('a repository without a commit has no base, and every path differs', (t) => {
  const root = repository(t, { commit: false });
  const snapshot = takeSnapshot(root);
  assert.equal(snapshot.base, null);
  assert.ok(snapshot.paths.includes('app.txt'));
  assert.ok(!snapshot.paths.some((relative) => relative.startsWith('.agenticloop/tasks')));
});

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
  assert.equal(fs.readdirSync(path.join(root, '.agenticloop', 'tasks')).length, 0, 'no record is written');
});

test('a reader that keeps only the first line, as `snapshot | head -1` does, ends the command quietly', async (t) => {
  const root = repository(t);
  // More paths than a pipe buffers, so the command is still writing when the
  // reader closes its end.
  fs.mkdirSync(path.join(root, 'many'));
  for (let i = 0; i < 3000; i += 1) fs.writeFileSync(path.join(root, 'many', `a-file-with-a-long-name-${i}.txt`), `${i}\n`, 'utf8');
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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-nogit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = cli(root, 'snapshot');
  assert.equal(result.code, 1);
  assert.match(result.err, /snapshot needs a git working tree/);
});

/** Every file under `.git`, with its bytes. */
function gitDirectory(root) {
  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(path.join(root, '.git'));
  return files;
}

/** Run the CLI with the temporary directory pointed somewhere the test can watch. */
function cliWithTemp(cwd, temp, ...args) {
  const env = { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp };
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('a tasks directory that is tracked and then ignored does not stop a snapshot or change it', (t) => {
  const root = repository(t);
  writeTask(root, '  - ref: 0123abc\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'a tracked record');
  fs.appendFileSync(path.join(root, '.gitignore'), '.agenticloop/tasks/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '--quiet', '-m', 'ignore the records');
  const before = takeSnapshot(root);
  assert.equal(before.tree, git(root, 'rev-parse', 'HEAD^{tree}').trim());

  writeTask(root, '  - ref: 0123abc\n  - ref: 4567def\n');
  fs.writeFileSync(path.join(root, '.agenticloop', 'tasks', 'T-002.md'), '---\nschema: 1\n---\n', 'utf8');
  const printed = cli(root, 'snapshot');
  assert.equal(printed.code, 0, printed.err);
  assert.equal(printed.out.split('\n')[0], before.ref, 'records do not change the snapshot');
  fs.writeFileSync(path.join(root, 'app.txt'), 'two\n', 'utf8');
  assert.deepEqual(takeSnapshot(root).paths, ['app.txt']);
});

test('machine-local state never changes the snapshot, ignored or not', (t) => {
  const root = repository(t);
  const before = takeSnapshot(root).ref;
  const local = path.join(root, '.agenticloop', 'local');
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

test('snapshot runs only from the project root, as every other command reads it', (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'a\n', 'utf8');
  const result = cli(path.join(root, 'src'), 'snapshot');
  assert.equal(result.code, 1);
  assert.match(result.err, /\.agenticloop\/ does not exist here/);
  assert.match(result.err, /Run snapshot from the project root/);
  const whole = cli(root, 'snapshot');
  assert.equal(whole.code, 0, whole.err);
  assert.match(whole.out, /\n {2}src\/a\.txt/, 'from the root it covers the whole tree');
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
  const module = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-module-')));
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
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-temp-')));
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
