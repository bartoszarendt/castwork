import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GENERATED_MANIFEST, LEGACY_STATE_DIRECTORIES, LEGACY_STATE_FILES, PROJECT_FILE, STATE_DIRECTORY, TASKS_DIRECTORY } from '../src/layout.js';
import { detectLegacyLayout, setup, update } from '../src/setup.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-legacy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A 0.4.x target: records the user owns, plus one legacy signal. */
function legacyTarget(root, signal, kind) {
  fs.mkdirSync(path.join(root, TASKS_DIRECTORY), { recursive: true });
  fs.writeFileSync(path.join(root, PROJECT_FILE), '# project\n', 'utf8');
  fs.writeFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n', 'utf8');
  const target = path.join(root, STATE_DIRECTORY, signal);
  if (kind === 'dir') {
    fs.mkdirSync(target, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{}\n', 'utf8');
  }
}

for (const signal of LEGACY_STATE_FILES) {
  test(`the legacy file ${signal} is recognised`, (t) => {
    const root = fixture(t);
    legacyTarget(root, signal, 'file');
    assert.deepEqual(detectLegacyLayout(root), [`${STATE_DIRECTORY}/${signal} exists`]);
  });

  test(`setup refuses on ${signal} and writes nothing`, (t) => {
    const root = fixture(t);
    legacyTarget(root, signal, 'file');
    assert.throws(() => setup(root, { hosts: ['codex'] }), /0\.4\.x installation/);
    assert.ok(!fs.existsSync(path.join(root, GENERATED_MANIFEST)));
    assert.ok(!fs.existsSync(path.join(root, '.codex')));
  });

  test(`update refuses on ${signal}`, (t) => {
    const root = fixture(t);
    legacyTarget(root, signal, 'file');
    assert.throws(() => update(root), /0\.4\.x installation/);
  });
}

for (const signal of LEGACY_STATE_DIRECTORIES) {
  test(`the legacy directory ${signal} is recognised`, (t) => {
    const root = fixture(t);
    legacyTarget(root, signal, 'dir');
    assert.deepEqual(detectLegacyLayout(root), [`${STATE_DIRECTORY}/${signal}/ exists`]);
  });
}

test('the 0.4.x ownership manifest alone is enough to refuse', (t) => {
  const root = fixture(t);
  legacyTarget(root, 'generated-artifacts.json', 'file');
  const reasons = detectLegacyLayout(root);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /generated-artifacts\.json/);
});

test('a 0.4.x target whose directories were cleaned is still recognised by its manifest', (t) => {
  const root = fixture(t);
  legacyTarget(root, 'generated-artifacts.json', 'file');
  for (const name of LEGACY_STATE_DIRECTORIES) {
    fs.rmSync(path.join(root, STATE_DIRECTORY, name), { recursive: true, force: true });
  }
  assert.throws(() => setup(root, { hosts: ['codex'] }), /0\.4\.x installation/);
});

test('the refusal never migrates or overwrites the user records', (t) => {
  const root = fixture(t);
  legacyTarget(root, 'lifecycle-receipt.json', 'file');
  const before = fs.readFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), 'utf8');
  assert.throws(() => setup(root, { hosts: ['codex'] }));
  assert.equal(fs.readFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), 'utf8'), before);
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
});

test('the refusal names every signal it found', (t) => {
  const root = fixture(t);
  legacyTarget(root, 'audits', 'dir');
  fs.writeFileSync(path.join(root, STATE_DIRECTORY, 'generated-artifacts.json'), '{}\n', 'utf8');
  const reasons = detectLegacyLayout(root);
  assert.equal(reasons.length, 2);
  assert.throws(() => setup(root, { hosts: ['codex'] }), /audits.*generated-artifacts\.json|generated-artifacts\.json.*audits/s);
});

test('the refusal prints the manual steps and keeps records', (t) => {
  const root = fixture(t);
  legacyTarget(root, 'generated-artifacts.json', 'file');
  assert.throws(
    () => setup(root, { hosts: ['codex'] }),
    (error) => /no migration/i.test(error.hint) && /run setup again/.test(error.hint) && /they are yours/.test(error.hint),
  );
});

test('a clean 0.5.0 target is not mistaken for a legacy one', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  assert.deepEqual(detectLegacyLayout(root), []);
  assert.doesNotThrow(() => update(root));
});

test('the current local directory is not a legacy signal', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  fs.mkdirSync(path.join(root, STATE_DIRECTORY, 'local'), { recursive: true });
  assert.deepEqual(detectLegacyLayout(root), []);
});
