import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateHost } from '../src/adapter-generation.js';
import { CONFIG_FILE, GENERATED_MANIFEST, HOSTS, LOCAL_CONFIG_FILE, PROJECT_FILE, TASKS_DIRECTORY } from '../src/layout.js';
import { doctor, setup, update } from '../src/setup.js';
import { validate } from '../src/validate.js';

/** Each fixture is its own temp tree, removed when the test ends. */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** @param {string} root */
const config = (root) => JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));

for (const host of HOSTS) {
  test(`${host} roles profile generates the thinker, worker and verifier and their procedures, and no entry or coordinator`, () => {
    const full = generateHost(host);
    const roles = generateHost(host, { profile: 'roles' });
    const paths = roles.map((file) => file.path);
    for (const id of ['thinker', 'worker', 'verifier']) {
      assert.ok(paths.some((file) => file.includes(`agents/${id}.`)), id);
    }
    assert.ok(!paths.some((file) => file.includes('agents/coordinator.')), 'no coordinator');
    assert.ok(!paths.some((file) => file.endsWith('SKILL.md') || file.endsWith('castwork.md') || file.endsWith('openai.yaml')), 'no entry');
    // Each role is the same file the full install writes, so the procedures it links are there.
    const byPath = new Map(full.map((file) => [file.path, file.content]));
    for (const file of roles) assert.equal(file.content, byPath.get(file.path), file.path);
    for (const file of roles.filter((entry) => entry.path.includes('/agents/'))) {
      for (const [, linked] of file.content.matchAll(/^- `[a-z-]+`: `([^`]+)`$/gm)) {
        assert.ok(paths.includes(linked), `${file.path} links ${linked}`);
      }
    }
  });
}

test('without host_profiles every host is full, as before', (t) => {
  const root = fixture(t);
  const installed = setup(root, { hosts: ['codex'] });
  assert.deepEqual(installed.host_profiles, { codex: 'full' });
  assert.equal(config(root).host_profiles, undefined);
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/castwork/SKILL.md')));
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
});

test('setup --roles beside a full host records the profile, keeps the records, and validates clean', (t) => {
  const root = fixture(t);
  const installed = setup(root, { hosts: ['pi'], roles: ['codex', 'claude'] });
  assert.deepEqual(config(root).host_profiles, { codex: 'roles', claude: 'roles' });
  assert.deepEqual(config(root).hosts, ['pi', 'codex', 'claude']);
  assert.ok(fs.existsSync(path.join(root, '.pi/prompts/castwork.md')));
  assert.ok(fs.existsSync(path.join(root, '.codex/agents/worker.toml')));
  assert.ok(!fs.existsSync(path.join(root, '.codex/agents/coordinator.toml')));
  assert.ok(!fs.existsSync(path.join(root, '.agents/skills/castwork/SKILL.md')));
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/castwork/references/assessment.md')));
  assert.ok(!fs.existsSync(path.join(root, '.claude/skills/castwork/SKILL.md')));
  assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)));
  assert.ok(installed.created.includes(TASKS_DIRECTORY));
  assert.deepEqual(update(root).changed, []);
  const result = validate(root);
  assert.deepEqual(result.findings.filter((finding) => finding.level !== 'info'), []);
});

test('a repository whose every host is roles seeds no records or project prose', (t) => {
  const root = fixture(t);
  setup(root, { roles: ['codex'] });
  assert.ok(fs.existsSync(path.join(root, GENERATED_MANIFEST)));
  assert.ok(!fs.existsSync(path.join(root, PROJECT_FILE)));
  assert.ok(!fs.existsSync(path.join(root, TASKS_DIRECTORY)));
  const report = doctor(root);
  assert.equal(report.ok, true);
  assert.ok(!report.findings.some((finding) => finding.message.includes(PROJECT_FILE)), JSON.stringify(report.findings));
});

test('switching a host from full to roles in castwork.json removes only its entry and coordinator', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['opencode', 'claude'] });
  const written = config(root);
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ ...written, host_profiles: { claude: 'roles' } }));
  const result = update(root);
  assert.deepEqual(result.removed.sort(), ['.claude/agents/coordinator.md', '.claude/skills/castwork/SKILL.md']);
  assert.ok(fs.existsSync(path.join(root, '.opencode/commands/castwork.md')));
  // And back: a host the map leaves out is full again.
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(written));
  assert.deepEqual(update(root).added.sort(), ['.claude/agents/coordinator.md', '.claude/skills/castwork/SKILL.md']);
});

test('a route to a roles host still reaches its role file', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({
    hosts: ['pi', 'codex'],
    host_profiles: { codex: 'roles' },
    role_routes: { worker: 'codex' },
  }));
  setup(root);
  const prompt = fs.readFileSync(path.join(root, '.pi/prompts/castwork.md'), 'utf8');
  assert.match(prompt, /\.codex\/agents\/worker\.toml/);
  assert.ok(fs.existsSync(path.join(root, '.codex/agents/worker.toml')));
});

test('host_profiles refuses an unknown host, a host not in hosts, and an unknown profile', (t) => {
  for (const [profiles, pattern] of [
    [{ cursor: 'roles' }, /names unknown host cursor/],
    [{ claude: 'roles' }, /names claude, which is not in hosts/],
    [{ codex: 'skills' }, /host_profiles\.codex must be one of full, roles/],
    [['codex'], /must be a map of host to profile/],
    [null, /must be a map of host to profile/],
  ]) {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ hosts: ['codex'], host_profiles: profiles }));
    assert.throws(() => setup(root), pattern);
    // Nor merged away under a host setup adds.
    assert.throws(() => setup(root, { roles: ['claude'] }), /host_profiles/);
  }
});

test('a host made full in an all-roles repository gets its records from setup', (t) => {
  const root = fixture(t);
  setup(root, { roles: ['codex'] });
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ hosts: ['codex'] }));
  // update regenerates and seeds nothing; setup seeds what a full host needs.
  update(root);
  assert.ok(!fs.existsSync(path.join(root, PROJECT_FILE)));
  const result = setup(root);
  assert.ok(result.created.includes(PROJECT_FILE));
  assert.ok(fs.existsSync(path.join(root, TASKS_DIRECTORY)));
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/castwork/SKILL.md')));
  assert.ok(fs.existsSync(path.join(root, '.codex/agents/coordinator.toml')));
  assert.equal(doctor(root).ok, true);
});

test('dropping a profiled host means removing its profile too', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['pi'], roles: ['claude'] });
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ hosts: ['pi'], host_profiles: { claude: 'roles' } }));
  assert.throws(() => update(root), /names claude, which is not in hosts/);
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ hosts: ['pi'] }));
  assert.ok(update(root).removed.includes('.claude/agents/worker.md'));
});

test('an all-roles repository still has an existing project.md checked', (t) => {
  const root = fixture(t);
  setup(root, { roles: ['codex'] });
  fs.writeFileSync(path.join(root, PROJECT_FILE), '');
  assert.ok(doctor(root).findings.some((finding) => finding.message === `${PROJECT_FILE} is empty`));
});

test('setup --roles adds and never substitutes', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  assert.throws(() => setup(root, { roles: ['codex'] }), /codex is already installed in full/);
  assert.throws(() => setup(root, { hosts: ['claude'], roles: ['claude'] }), /named with both --host and --roles/);
  setup(root, { roles: ['claude'] });
  // --host on a roles host leaves it as it is, as --host does for any listed host.
  setup(root, { hosts: ['claude'] });
  assert.deepEqual(config(root).host_profiles, { claude: 'roles' });
});

test('host_profiles is the project\'s: the local file cannot set it', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  fs.writeFileSync(path.join(root, LOCAL_CONFIG_FILE), JSON.stringify({ host_profiles: { codex: 'roles' } }));
  assert.throws(() => update(root), /cannot set host_profiles/);
});
