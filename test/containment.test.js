import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { containedPath, digest, readManifest } from '../src/generated.js';
import { GENERATED_MANIFEST, PROJECT_FILE, TASKS_DIRECTORY } from '../src/layout.js';
import { doctor, remove, setup, update } from '../src/setup.js';

/** Each fixture is its own temp tree, removed when the test ends. */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-contain-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Point the manifest at `relative`, giving it the digest of `content`. */
function poison(root, relative, content) {
  const file = path.join(root, GENERATED_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.files[relative] = digest(content);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
}

test('containedPath accepts an ordinary path inside the repository', () => {
  const root = '/repo';
  assert.equal(containedPath(root, '.codex/agents/worker.toml'), path.resolve('/repo/.codex/agents/worker.toml'));
});

for (const escape of ['../outside.txt', '../../etc/passwd', 'a/../../outside.txt', './../outside.txt']) {
  test(`containedPath refuses the escaping path ${escape}`, () => {
    assert.throws(() => containedPath('/repo', escape), /outside the repository/);
  });
}

for (const absolute of ['/etc/passwd', 'C:\\Windows\\system32\\drivers\\etc\\hosts']) {
  test(`containedPath refuses the absolute path ${absolute}`, () => {
    assert.throws(() => containedPath('/repo', absolute), /absolute generated path/);
  });
}

test('containedPath refuses an empty path', () => {
  assert.throws(() => containedPath('/repo', '   '), /empty generated path/);
});

test('containedPath refuses a user-owned path claimed as generated', () => {
  assert.throws(() => containedPath('/repo', PROJECT_FILE), /user-owned path/);
  assert.throws(() => containedPath('/repo', `${TASKS_DIRECTORY}/T-001.md`), /user-owned path/);
});

test('remove does not delete a file outside the repository', (t) => {
  const root = fixture(t);
  const outsideDir = fixture(t);
  const outside = path.join(outsideDir, 'protected.txt');
  fs.writeFileSync(outside, 'PROTECTED\n', 'utf8');

  setup(root, { hosts: ['codex'] });
  poison(root, path.relative(root, outside), 'PROTECTED\n');

  assert.throws(() => remove(root), /outside the repository/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'PROTECTED\n', 'the external file must survive');
});

test('remove does not delete a user-owned record even when the manifest claims it', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const record = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  const content = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n';
  fs.writeFileSync(record, content, 'utf8');
  poison(root, `${TASKS_DIRECTORY}/T-001.md`, content);

  assert.throws(() => remove(root), /user-owned path/);
  assert.ok(fs.existsSync(record), 'the record must survive');
});

test('update does not write through an escaping manifest path', (t) => {
  const root = fixture(t);
  const outsideDir = fixture(t);
  const outside = path.join(outsideDir, 'target.txt');
  fs.writeFileSync(outside, 'ORIGINAL\n', 'utf8');

  setup(root, { hosts: ['codex'] });
  poison(root, path.relative(root, outside), 'ORIGINAL\n');

  assert.throws(() => update(root), /outside the repository/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'ORIGINAL\n');
});

test('reading a manifest with an escaping entry fails closed', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  poison(root, '../escape.txt', 'x');
  assert.throws(() => readManifest(root), /outside the repository/);
});

test('doctor reports the poisoned manifest instead of acting on it', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  poison(root, '../escape.txt', 'x');
  assert.throws(() => doctor(root), /outside the repository/);
});

test('a symlinked parent cannot carry a write outside the repository', (t) => {
  const root = fixture(t);
  const outsideDir = fixture(t);
  setup(root, { hosts: ['codex'] });

  const link = path.join(root, 'escape-link');
  try {
    fs.symlinkSync(outsideDir, link, 'dir');
  } catch {
    return; // symlinks unavailable on this platform
  }
  // Any symlink on a generated path is refused, whether or not it escapes.
  assert.throws(() => containedPath(root, 'escape-link/evil.txt'), /symbolic link/);
});

test('an ordinary generated path still resolves after hardening', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: ['codex'] });
  assert.ok(result.added.length > 0);
  assert.equal(readManifest(root).files[result.added[0]], digest(fs.readFileSync(path.join(root, result.added[0]), 'utf8')));
});
