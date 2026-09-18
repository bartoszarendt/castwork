/**
 * Third review round, findings 1 and 2: the protected-path check and the
 * writes that never reached it.
 *
 * Every test here failed before the remediation commit.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { containedPath, digest } from '../src/generated.js';
import { CONFIG_FILE, GENERATED_MANIFEST, PROJECT_FILE, STATE_DIRECTORY, TASKS_DIRECTORY } from '../src/layout.js';
import { remove, setup, update } from '../src/setup.js';

function tmp(t, label) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `agenticloop-${label}-`)));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * Create a link, or skip the test when this machine will not make one.
 *
 * A caught error must never leave a test passing with no assertions, which is
 * what the second round's containment tests did on Windows.
 */
function link(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code}`);
    return false;
  }
}

function poison(root, relative, content) {
  const file = path.join(root, GENERATED_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.files[relative] = digest(content);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Finding 1: the user-owned comparison was case-sensitive, so a manifest entry
 * spelled `.AGENTICLOOP/TASKS/T-001.md` passed and named the real record on
 * every case-insensitive filesystem.
 */
const CASE_SPELLINGS = [
  '.AGENTICLOOP/TASKS/T-001.md',
  '.AGENTICLOOP/tasks/T-001.md',
  '.agenticloop/TASKS/T-001.md',
  '.agenticloop/Tasks/T-001.md',
  '.Agenticloop/tasks/T-001.md',
  '.agenticloop\\TASKS\\T-001.md',
  '.agenticloop/./TASKS/T-001.md',
  '.agenticloop/DECISIONS/D-001.md',
  '.agenticloop/Decisions/D-001.md',
  '.AGENTICLOOP/PROJECT.MD',
  '.agenticloop/Project.md',
  '.agenticloop/PROJECT.md',
];

for (const spelling of CASE_SPELLINGS) {
  test(`1: a user-owned path spelled ${JSON.stringify(spelling)} is refused`, () => {
    assert.throws(() => containedPath('/repo', spelling), /user-owned path/);
  });
}

test('1: the refusal does not extend to a path that merely starts alike', () => {
  assert.doesNotThrow(() => containedPath('/repo', '.agenticloop/tasksummary.md'));
  assert.doesNotThrow(() => containedPath('/repo', '.agenticloop/TASKSUMMARY.md'));
  assert.doesNotThrow(() => containedPath('/repo', '.agenticloop/generated.json'));
});

test('1: remove refuses an upper-cased protected path and keeps the record', (t) => {
  const root = tmp(t, 'case');
  setup(root, { hosts: ['codex'] });
  const record = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  const content = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n';
  fs.writeFileSync(record, content, 'utf8');
  poison(root, '.AGENTICLOOP/TASKS/T-001.md', content);
  assert.throws(() => remove(root), /user-owned path/);
  assert.equal(fs.readFileSync(record, 'utf8'), content);
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
});

test('1: update refuses an upper-cased protected path and keeps the record', (t) => {
  const root = tmp(t, 'caseup');
  setup(root, { hosts: ['codex'] });
  const record = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  const content = '---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n---\n';
  fs.writeFileSync(record, content, 'utf8');
  poison(root, '.agenticloop/Tasks/T-001.md', content);
  assert.throws(() => update(root), /user-owned path/);
  assert.equal(fs.readFileSync(record, 'utf8'), content);
});

/**
 * Finding 2: writes that used a bare `path.join` and so followed a link placed
 * at `.agenticloop`. A junction reproduces this on Windows; a directory
 * symlink reproduces it where one can be created.
 */
function stateLink(t, label, type) {
  const root = tmp(t, label);
  const outside = tmp(t, `${label}out`);
  setup(root, { hosts: ['codex'] });
  fs.cpSync(path.join(root, STATE_DIRECTORY), path.join(outside, 'state'), { recursive: true });
  fs.rmSync(path.join(root, STATE_DIRECTORY), { recursive: true, force: true });
  if (!link(t, path.join(outside, 'state'), path.join(root, STATE_DIRECTORY), type)) return null;
  const victim = path.join(outside, 'state', 'generated.json');
  return {
    root,
    victim,
    before: { mtime: fs.statSync(victim).mtimeMs, content: fs.readFileSync(victim, 'utf8') },
  };
}

function unchanged(fixture) {
  assert.equal(fs.statSync(fixture.victim).mtimeMs, fixture.before.mtime, 'the outside manifest mtime must not change');
  assert.equal(fs.readFileSync(fixture.victim, 'utf8'), fixture.before.content, 'the outside manifest content must not change');
}

for (const type of ['junction', 'dir']) {
  test(`2: update refuses when ${STATE_DIRECTORY} is a ${type} to an outside directory`, (t) => {
    const fixture = stateLink(t, `upd-${type}`, type);
    if (!fixture) return;
    assert.throws(() => update(fixture.root), /symbolic link/);
    unchanged(fixture);
  });

  test(`2: setup refuses when ${STATE_DIRECTORY} is a ${type} to an outside directory`, (t) => {
    const fixture = stateLink(t, `set-${type}`, type);
    if (!fixture) return;
    assert.throws(() => setup(fixture.root, { hosts: ['codex'] }), /symbolic link/);
    unchanged(fixture);
  });

  test(`2: remove refuses when ${STATE_DIRECTORY} is a ${type} to an outside directory`, (t) => {
    const fixture = stateLink(t, `rm-${type}`, type);
    if (!fixture) return;
    assert.throws(() => remove(fixture.root), /symbolic link/);
    unchanged(fixture);
    assert.ok(fs.existsSync(fixture.victim));
  });

  test(`2: setup refuses when ${TASKS_DIRECTORY} is a ${type} to an outside directory`, (t) => {
    const root = tmp(t, `tasks-${type}`);
    const outside = tmp(t, `tasksout-${type}`);
    fs.mkdirSync(path.join(root, STATE_DIRECTORY), { recursive: true });
    if (!link(t, outside, path.join(root, TASKS_DIRECTORY), type)) return;
    assert.throws(() => setup(root, { hosts: ['codex'] }), /symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was created outside');
  });
}

test('2: setup refuses when the config file is a symlink to an outside file', (t) => {
  const root = tmp(t, 'cfg');
  const outside = tmp(t, 'cfgout');
  const victim = path.join(outside, 'victim.json');
  fs.writeFileSync(victim, '{"hosts":[]}\n', 'utf8');
  if (!link(t, victim, path.join(root, CONFIG_FILE), 'file')) return;
  assert.throws(() => setup(root, { hosts: ['codex'] }), /symbolic link/);
  assert.equal(fs.readFileSync(victim, 'utf8'), '{"hosts":[]}\n');
});

test('2: setup refuses when .gitignore is a symlink to an outside file', (t) => {
  const root = tmp(t, 'ign');
  const outside = tmp(t, 'ignout');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL\n', 'utf8');
  if (!link(t, victim, path.join(root, '.gitignore'), 'file')) return;
  assert.throws(() => setup(root, { hosts: ['codex'] }), /symbolic link/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL\n');
});

test('2: setup refuses when project.md is a symlink to an outside file', (t) => {
  const root = tmp(t, 'prj');
  const outside = tmp(t, 'prjout');
  const victim = path.join(outside, 'victim.md');
  fs.writeFileSync(victim, 'ORIGINAL\n', 'utf8');
  fs.mkdirSync(path.join(root, STATE_DIRECTORY), { recursive: true });
  if (!link(t, victim, path.join(root, PROJECT_FILE), 'file')) return;
  assert.throws(() => setup(root, { hosts: ['codex'] }), /symbolic link/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL\n');
});

test('2: an ordinary installation still sets up, updates and removes', (t) => {
  const root = tmp(t, 'plain');
  const result = setup(root, { hosts: ['codex', 'claude', 'opencode'] });
  assert.ok(result.written.length > 0);
  assert.doesNotThrow(() => update(root));
  assert.doesNotThrow(() => remove(root));
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)), 'project.md survives remove');
});
