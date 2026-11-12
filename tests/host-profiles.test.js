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

/** The procedure paths a generated role links. @param {string} content */
const links = (content) => [...content.matchAll(/^- `[a-z-]+`: `([^`]+)`$/gm)].map(([, linked]) => linked);

for (const host of HOSTS) {
  test(`${host} roles profile generates the thinker, worker and verifier alone: no entry, coordinator or procedures`, () => {
    const roles = generateHost(host, { profile: 'roles' });
    assert.deepEqual(roles.map((file) => path.posix.parse(file.path).name), ['thinker', 'worker', 'verifier']);
    for (const file of roles) {
      assert.match(file.path, /\/agents\//);
      assert.doesNotMatch(file.content, /^## Procedures$/m, file.path);
      assert.doesNotMatch(file.content, /skills\/castwork/, file.path);
    }
  });

  test(`${host} roles profile links the procedures a full host generates`, () => {
    const other = host === 'pi' ? 'opencode' : 'pi';
    const procedures = generateHost(other).map((file) => file.path);
    for (const file of generateHost(host, { profile: 'roles', procedureHost: other })) {
      const linked = links(file.content);
      assert.ok(linked.length > 0, file.path);
      for (const target of linked) assert.ok(procedures.includes(target), `${file.path} links ${target}`);
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
  assert.ok(!fs.existsSync(path.join(root, '.agents')));
  assert.ok(!fs.existsSync(path.join(root, '.claude/skills')));
  // A roles host's procedure links reach the copies the full host generated.
  for (const role of ['.codex/agents/verifier.toml', '.claude/agents/worker.md']) {
    const linked = links(fs.readFileSync(path.join(root, role), 'utf8'));
    assert.ok(linked.length > 0 && linked.every((target) => target.startsWith('.pi/') && fs.existsSync(path.join(root, target))), role);
  }
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

test('switching a host from full to roles in castwork.json removes its entry, coordinator and procedures', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['opencode', 'claude'] });
  const written = config(root);
  const claudeOnly = ['.claude/agents/coordinator.md', '.claude/skills/castwork/SKILL.md'];
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ ...written, host_profiles: { claude: 'roles' } }));
  const result = update(root);
  assert.deepEqual(result.removed.filter((file) => !file.includes('/references/')).sort(), claudeOnly);
  assert.ok(result.removed.some((file) => file.startsWith('.claude/skills/castwork/references/')));
  // The roles now link OpenCode's copies.
  assert.deepEqual(result.changed.sort(), ['.claude/agents/thinker.md', '.claude/agents/verifier.md', '.claude/agents/worker.md']);
  assert.ok(fs.existsSync(path.join(root, '.opencode/commands/castwork.md')));
  // And back: a host the map leaves out is full again.
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(written));
  assert.deepEqual(update(root).added.filter((file) => !file.includes('/references/')).sort(), claudeOnly);
});

test('a roles host relinks its procedures when the full host they come from changes', (t) => {
  const root = fixture(t);
  const write = (/** @type {object} */ value) => fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(value));
  const linked = () => links(fs.readFileSync(path.join(root, '.codex/agents/worker.toml'), 'utf8'));
  write({ hosts: ['pi', 'opencode', 'codex'], host_profiles: { codex: 'roles' } });
  setup(root);
  assert.ok(linked().every((target) => target.startsWith('.pi/')));
  // Pi becomes roles too: the first full host is now OpenCode.
  write({ hosts: ['pi', 'opencode', 'codex'], host_profiles: { pi: 'roles', codex: 'roles' } });
  const relinked = update(root);
  assert.ok(relinked.changed.includes('.codex/agents/worker.toml'));
  assert.ok(relinked.removed.some((file) => file.startsWith('.pi/skills/castwork/references/')));
  assert.ok(linked().length > 0 && linked().every((target) => target.startsWith('.opencode/') && fs.existsSync(path.join(root, target))));
  // No full host left: the roles carry no procedures section.
  write({ hosts: ['pi', 'opencode', 'codex'], host_profiles: { pi: 'roles', opencode: 'roles', codex: 'roles' } });
  update(root);
  assert.deepEqual(linked(), []);
  assert.equal(validate(root).ok, true);
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
