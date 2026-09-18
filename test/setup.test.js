import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readManifest } from '../src/generated.js';
import { GENERATED_MANIFEST, PROJECT_FILE, TASKS_DIRECTORY } from '../src/layout.js';
import { detectLegacyLayout, doctor, remove, setup, update } from '../src/setup.js';

/** Each fixture is its own temp tree, removed when the test ends. */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('setup creates the state directories and records what it generated', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: ['codex'] });
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
  assert.ok(fs.existsSync(path.join(root, TASKS_DIRECTORY)));
  assert.ok(fs.existsSync(path.join(root, GENERATED_MANIFEST)));
  assert.ok(result.written.length > 0);
  const manifest = readManifest(root);
  assert.equal(Object.keys(manifest.files).length, result.written.length);
});

test('setup adds the local directory to .gitignore', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.agenticloop\/local\//);
});

test('setup refuses without a host rather than guessing', (t) => {
  const root = fixture(t);
  assert.throws(() => setup(root, { hosts: [] }), /no hosts selected/);
});

test('update skips a modified generated file and regenerates it only when forced', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: ['codex'] });
  const target = result.written[0];
  const full = path.join(root, target);
  fs.writeFileSync(full, 'edited by hand\n', 'utf8');

  const skipped = update(root);
  assert.ok(skipped.skipped.includes(target));
  assert.equal(fs.readFileSync(full, 'utf8'), 'edited by hand\n');

  const forced = update(root, { force: [target] });
  assert.ok(forced.written.includes(target));
  assert.notEqual(fs.readFileSync(full, 'utf8'), 'edited by hand\n');
});

test('a user-owned file at a generated path is preserved, not overwritten', (t) => {
  const root = fixture(t);
  const planned = setup(root, { hosts: ['codex'] });
  const target = planned.written[0];
  remove(root);

  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, target), 'mine\n', 'utf8');

  const result = setup(root, { hosts: ['codex'] });
  assert.ok(result.collisions.includes(target));
  assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), 'mine\n');
});

test('remove deletes generated files and never touches records', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  fs.writeFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n', 'utf8');

  const result = remove(root);
  assert.ok(result.removed.length > 0);
  assert.ok(fs.existsSync(path.join(root, TASKS_DIRECTORY, 'T-001.md')));
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
  assert.ok(!fs.existsSync(path.join(root, GENERATED_MANIFEST)));
});

test('remove keeps a generated file the user modified', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: ['codex'] });
  const target = result.written[0];
  fs.writeFileSync(path.join(root, target), 'edited\n', 'utf8');

  const removed = remove(root);
  assert.ok(removed.kept.includes(target));
  assert.ok(fs.existsSync(path.join(root, target)));
});

test('a 0.4.x layout is refused with manual steps and nothing is written', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '.agenticloop', 'audits'), { recursive: true });
  assert.deepEqual(detectLegacyLayout(root), ['.agenticloop/audits/ exists']);
  assert.throws(
    () => setup(root, { hosts: ['codex'] }),
    (error) => /0\.4\.x installation/.test(error.message) && /run setup again/.test(error.hint),
  );
  assert.ok(!fs.existsSync(path.join(root, GENERATED_MANIFEST)));
});

test('an old manifest declaring layoutVersion is refused', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'agenticloop'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agenticloop', 'manifest.json'), JSON.stringify({ layoutVersion: 3 }), 'utf8');
  assert.equal(detectLegacyLayout(root).length, 1);
});

test('doctor reports a healthy installation and a missing one', (t) => {
  const root = fixture(t);
  const before = doctor(root);
  assert.equal(before.ok, false);

  setup(root, { hosts: ['codex', 'opencode'] });
  const after = doctor(root);
  assert.equal(after.ok, true);
  assert.deepEqual(after.hosts, ['codex', 'opencode']);
  assert.ok(after.generated_files > 0);
});

test('doctor notices a locally modified generated file without failing', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: ['codex'] });
  fs.writeFileSync(path.join(root, result.written[0]), 'edited\n', 'utf8');
  const report = doctor(root);
  assert.equal(report.ok, true);
  assert.ok(report.findings.some((finding) => finding.message.includes('modified locally')));
});

test('setup is idempotent', (t) => {
  const root = fixture(t);
  const first = setup(root, { hosts: ['claude-code'] });
  const second = setup(root, { hosts: ['claude-code'] });
  assert.deepEqual(second.written.sort(), first.written.sort());
  assert.deepEqual(second.collisions, []);
});
