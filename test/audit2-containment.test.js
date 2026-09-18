import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { containedPath, digest, readManifest } from '../src/generated.js';
import { GENERATED_MANIFEST, PROJECT_FILE, TASKS_DIRECTORY } from '../src/layout.js';
import { remove, setup, update } from '../src/setup.js';

function tmp(t, label) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `agenticloop-${label}-`)));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function poison(root, relative, content) {
  const file = path.join(root, GENERATED_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.files[relative] = digest(content);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
}

/** Finding 1a: the protected-path check must see through normalisation. */
const PROTECTED_SPELLINGS = [
  '.agenticloop/./tasks/T-001.md',
  './.agenticloop/tasks/T-001.md',
  '.agenticloop/tasks/../tasks/T-001.md',
  '.agenticloop/decisions/../tasks/T-001.md',
  '.agenticloop//tasks/T-001.md',
  '.agenticloop\\tasks\\T-001.md',
  '.agenticloop/./project.md',
  './.agenticloop/decisions/D-001.md',
];

for (const spelling of PROTECTED_SPELLINGS) {
  test(`1a: a user-owned path spelled ${JSON.stringify(spelling)} is refused`, () => {
    assert.throws(() => containedPath('/repo', spelling), /user-owned path/);
  });
}

test('1a: remove refuses a normalised protected path and keeps the record', (t) => {
  const root = tmp(t, 'prot');
  setup(root, { hosts: ['codex'] });
  const record = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  const content = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n';
  fs.writeFileSync(record, content, 'utf8');
  poison(root, '.agenticloop/./tasks/T-001.md', content);
  assert.throws(() => remove(root), /user-owned path/);
  assert.equal(fs.readFileSync(record, 'utf8'), content);
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
});

/** Finding 1b: a symlinked directory whose descendants do not exist yet. */
test('1b: a descendant of a symlinked directory is refused even when absent', (t) => {
  const root = tmp(t, 'link');
  const outside = tmp(t, 'out');
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  } catch {
    return;
  }
  assert.throws(() => containedPath(root, 'link/absent/evil.txt'), /symbolic link/);
  assert.throws(() => containedPath(root, 'link/deeper/still/absent.txt'), /symbolic link/);
  assert.throws(() => containedPath(root, 'link/child.txt'), /symbolic link/);
});

test('1b: update cannot create a file through a symlinked directory', (t) => {
  const root = tmp(t, 'linkw');
  const outside = tmp(t, 'outw');
  setup(root, { hosts: ['codex'] });
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  } catch {
    return;
  }
  poison(root, 'link/absent/evil.txt', 'anything');
  assert.throws(() => update(root), /symbolic link/);
  assert.ok(!fs.existsSync(path.join(outside, 'absent')), 'nothing was created outside');
});

/** Finding 1c: the generated path is itself a symlink. */
test('1c: a generated path that is a symlink is refused', (t) => {
  const root = tmp(t, 'final');
  const outside = tmp(t, 'finalout');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL\n', 'utf8');
  setup(root, { hosts: ['codex'] });
  try {
    fs.symlinkSync(victim, path.join(root, 'final-link.txt'), 'file');
  } catch {
    return;
  }
  assert.throws(() => containedPath(root, 'final-link.txt'), /symbolic link/);
});

test('1c: a forced update cannot write through a symlinked generated file', (t) => {
  const root = tmp(t, 'force');
  const outside = tmp(t, 'forceout');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL\n', 'utf8');
  const result = setup(root, { hosts: ['codex'] });
  const generated = result.written[0];
  fs.rmSync(path.join(root, generated));
  try {
    fs.symlinkSync(victim, path.join(root, generated), 'file');
  } catch {
    return;
  }
  assert.throws(() => update(root, { force: [generated] }), /symbolic link/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL\n', 'the external file must be untouched');
});

test('1c: remove cannot delete through a symlinked generated file', (t) => {
  const root = tmp(t, 'rmlink');
  const outside = tmp(t, 'rmout');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'VICTIM\n', 'utf8');
  setup(root, { hosts: ['codex'] });
  try {
    fs.symlinkSync(victim, path.join(root, 'final-link.txt'), 'file');
  } catch {
    return;
  }
  poison(root, 'final-link.txt', 'VICTIM\n');
  assert.throws(() => remove(root), /symbolic link/);
  assert.ok(fs.existsSync(victim));
});

test('containment failures happen before any mutation', (t) => {
  const root = tmp(t, 'atomic');
  const outside = tmp(t, 'atomicout');
  const result = setup(root, { hosts: ['codex'] });
  const before = Object.fromEntries(result.written.map((relative) => [relative, fs.readFileSync(path.join(root, relative), 'utf8')]));
  poison(root, path.relative(root, path.join(outside, 'x.txt')), 'x');
  assert.throws(() => update(root));
  for (const [relative, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), content, `${relative} must be untouched`);
  }
});

test('an ordinary installation is unaffected by the hardening', (t) => {
  const root = tmp(t, 'ok');
  const result = setup(root, { hosts: ['codex', 'claude-code', 'opencode'] });
  assert.ok(result.written.length > 0);
  assert.equal(readManifest(root).files[result.written[0]] !== undefined, true);
  assert.doesNotThrow(() => update(root));
  assert.doesNotThrow(() => remove(root));
});
