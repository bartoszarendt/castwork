/**
 * This machine's models and routes.
 *
 * `.castwork/local/castwork.json`, gitignored with the machine's other state, changes the
 * model settings of roles and levels the project already has, and which of the
 * project's hosts runs a role, and nothing else. Generated files on disk carry them; the tracked manifest keeps the
 * project's digests, so it reads the same on every machine, and a gitignored
 * local manifest records what this machine wrote so those files stay ours.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE, GENERATED_MANIFEST, LOCAL_CONFIG_FILE, LOCAL_MANIFEST } from '../src/layout.js';
import { readConfig } from '../src/config.js';
import { doctor, remove, setup, update } from '../src/setup.js';
import { validate } from '../src/validate.js';

/** A target with `hosts` installed, `extra` merged into its config, and updated. */
function fixture(t, hosts, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-local-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts });
  const file = path.join(root, CONFIG_FILE);
  const config = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...extra };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  update(root);
  return root;
}

/** @param {string} root @param {unknown} local */
function writeLocal(root, local) {
  fs.writeFileSync(path.join(root, LOCAL_CONFIG_FILE), `${JSON.stringify(local, null, 2)}\n`, 'utf8');
}

/** @param {string} root @param {string} relative */
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');
/** @param {string} root @param {string} relative */
const exists = (root, relative) => fs.existsSync(path.join(root, relative));

/** The refusal `readConfig` gives for a local file. */
function refusal(t, local, hosts = ['claude', 'codex', 'opencode'], extra = {}) {
  const root = fixture(t, hosts, extra);
  writeLocal(root, local);
  try {
    readConfig(root);
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  assert.fail(`${LOCAL_CONFIG_FILE} was accepted`);
}

/* ------------------------------------------------------------------ */
/* Generation and ownership                                            */
/* ------------------------------------------------------------------ */

test('the local file lives in .castwork/local/, which setup already gitignores', (t) => {
  const root = fixture(t, ['claude']);
  assert.equal(LOCAL_CONFIG_FILE, '.castwork/local/castwork.json');
  assert.deepEqual(read(root, '.gitignore').split('\n').filter(Boolean), ['.castwork/local/'], 'no line of its own');
});

test('update and remove keep the local file as the user wrote it', (t) => {
  const root = fixture(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  const written = read(root, LOCAL_CONFIG_FILE);
  update(root);
  update(root, { shared: true });
  assert.equal(read(root, LOCAL_CONFIG_FILE), written);
  remove(root);
  assert.equal(read(root, LOCAL_CONFIG_FILE), written);
});

/** @param {string} root @param {...string} args */
const git = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' });

/** The doctor messages about how Git treats the local file. @param {string} root */
const localFileFindings = (root) => doctor(root).findings.map((finding) => finding.message).filter((message) => message.startsWith(LOCAL_CONFIG_FILE));

test('doctor asks Git whether the local file is ignored and untracked', (t) => {
  const root = fixture(t, ['claude']);
  git(root, 'init', '-q');
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  assert.deepEqual(localFileFindings(root), [], 'setup ignored .castwork/local/');

  // The owner's .gitignore no longer covers it.
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n', 'utf8');
  assert.deepEqual(localFileFindings(root), [`${LOCAL_CONFIG_FILE} is not ignored by Git`]);

  // Tracked before the rule came back: ignoring it no longer hides it.
  git(root, 'add', LOCAL_CONFIG_FILE);
  fs.writeFileSync(path.join(root, '.gitignore'), '.castwork/local/\n', 'utf8');
  assert.deepEqual(localFileFindings(root), [`${LOCAL_CONFIG_FILE} is tracked by Git`]);
});

test('applying and dropping this machine models is never advice to commit', (t) => {
  const root = fixture(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  const before = doctor(root).findings.map((finding) => finding.message);
  assert.ok(before.includes(`1 generated file(s) differ only in this machine's models and routes from ${LOCAL_CONFIG_FILE}`));
  assert.equal(update(root, { check: true }).plan.commit, false);
  assert.equal(update(root).commit, false);

  fs.rmSync(path.join(root, LOCAL_CONFIG_FILE));
  assert.equal(update(root, { check: true }).plan.commit, false);
  assert.equal(update(root).commit, false);

  // A change to the project's output is still one to commit.
  const file = path.join(root, CONFIG_FILE);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...config, role_settings: { claude: { verifier: { model: 'claude-shared' } } } }), 'utf8');
  assert.equal(update(root).commit, true);
});

/** A git repository holding `hosts` installed, with the generated files committed. */
function committed(t, hosts, extra = {}) {
  const root = fixture(t, hosts, extra);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'install');
  return root;
}

/** @param {string} root @param {(config: Record<string, any>) => Record<string, any>} change */
function changeConfig(root, change) {
  const file = path.join(root, CONFIG_FILE);
  fs.writeFileSync(file, JSON.stringify(change(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2), 'utf8');
}

/** Clone `root` as committed and return the clone's doctor verdict. */
function cloneVerdict(t, root) {
  const clone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-clone-')));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', root, clone]);
  return doctor(clone).generated;
}

const CLI = fileURLToPath(new URL('../bin/castwork.js', import.meta.url));

test('the project adopting this machine model still names the role file to commit', (t) => {
  const root = committed(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  update(root);
  changeConfig(root, (config) => ({ ...config, role_settings: { claude: { worker: { model: 'claude-mine' } } } }));

  const result = update(root);
  assert.equal(result.commit, true);
  assert.deepEqual(result.local, [], 'the file now holds the project output');
  assert.ok(!result.changed.includes('.claude/agents/worker.md'), 'unchanged on disk');
  assert.deepEqual(result.pending, ['.claude/agents/worker.md']);
  assert.deepEqual(result.local_conflicts, []);
  assert.ok(doctor(root).findings.some((finding) => finding.message.endsWith('as the manifest records them: .claude/agents/worker.md')));

  // Committing what update named, the role file among it, leaves a current clone.
  git(root, 'add', CONFIG_FILE, GENERATED_MANIFEST, '.claude/agents/worker.md');
  git(root, 'commit', '-qm', 'adopt the model');
  assert.equal(cloneVerdict(t, root), 'current');
  assert.deepEqual(update(root, { check: true }).plan.pending, []);
});

test('update --shared ignores a stale local file', (t) => {
  const levels = { role_levels: { codex: { worker: { complex: { model: 'gpt-strong' } } } } };
  const root = fixture(t, ['codex'], levels);
  writeLocal(root, { role_levels: { codex: { worker: { complex: { model: 'gpt-mine' } } } } });
  update(root);
  // The project drops the level the local file still overrides.
  changeConfig(root, (config) => { const { role_levels: _levels, ...rest } = config; return rest; });
  assert.throws(() => update(root), /castwork\.json declares no complex level/);

  const shared = update(root, { shared: true });
  assert.equal(shared.reapply, true);
  assert.ok(shared.removed.includes('.codex/agents/worker_complex.toml'));
  assert.equal(exists(root, LOCAL_MANIFEST), false);
});

test('dropping local models over an uncommitted project change is still advice to commit', (t) => {
  const root = committed(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  update(root);
  changeConfig(root, (config) => ({ ...config, role_settings: { claude: { worker: { permission_mode: 'plan' } } } }));
  update(root);

  fs.rmSync(path.join(root, LOCAL_CONFIG_FILE));
  assert.equal(update(root, { check: true }).plan.commit, true);
  const output = execFileSync(process.execPath, [CLI, 'update'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(output, /nothing to commit/);
  assert.match(output, /commit them together/);
  assert.match(output, /changed \.claude\/agents\/worker\.md/);

  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'worker permission');
  assert.equal(cloneVerdict(t, root), 'current');
  const after = execFileSync(process.execPath, [CLI, 'update'], { cwd: root, encoding: 'utf8' });
  assert.match(after, /everything is up to date/);
});

test('update advice to commit never covers files carrying this machine models', (t) => {
  const root = committed(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  update(root);

  // A project change elsewhere: commit it, leaving the worker out.
  changeConfig(root, (config) => ({ ...config, role_settings: { claude: { verifier: { model: 'claude-shared' } } } }));
  const elsewhere = execFileSync(process.execPath, [CLI, 'update'], { cwd: root, encoding: 'utf8' });
  assert.match(elsewhere, /commit them together/);
  assert.match(elsewhere, /Leave out of that commit the files marked above/);
  git(root, 'add', CONFIG_FILE, GENERATED_MANIFEST, '.claude/agents/verifier.md');
  git(root, 'commit', '-qm', 'verifier model');

  // A project change under the worker itself: no advice to commit at all.
  changeConfig(root, (config) => ({ ...config, role_settings: { claude: { verifier: { model: 'claude-shared' }, worker: { permission_mode: 'plan' } } } }));
  const under = execFileSync(process.execPath, [CLI, 'update'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(under, /commit them together|Leave out of that commit/);
  assert.match(under, /Commit nothing yet: run update --shared first/);
});

test('a project change under a tracked file carrying local models commits cleanly through update --shared', (t) => {
  const root = fixture(t, ['claude']);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'install');
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  update(root);

  // The project changes the same role's permission.
  const file = path.join(root, CONFIG_FILE);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...config, role_settings: { claude: { worker: { permission_mode: 'plan' } } } }), 'utf8');
  const result = update(root);
  assert.equal(result.commit, true);
  assert.deepEqual(result.local_conflicts, ['.claude/agents/worker.md']);
  assert.ok(doctor(root).findings.some((finding) => finding.message.startsWith("the project's output changed under files carrying this machine's models and routes")));

  // The workflow: the project's output, commit, then this machine's models again.
  const shared = update(root, { shared: true });
  assert.equal(shared.reapply, true);
  assert.deepEqual(shared.local, []);
  assert.doesNotMatch(read(root, '.claude/agents/worker.md'), /claude-mine/);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'worker permission');
  update(root);
  assert.match(read(root, '.claude/agents/worker.md'), /^model: claude-mine$/m);
  assert.deepEqual(doctor(root).findings.filter((finding) => /conflict|output changed/.test(finding.message)), []);

  // A fresh clone of what was committed is current.
  const clone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-clone-')));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', root, clone]);
  assert.equal(doctor(clone).generated, 'current');
  assert.match(read(clone, '.claude/agents/worker.md'), /^permissionMode: plan$/m);
});

test('local models reach the role file while the tracked manifest keeps the project digests', (t) => {
  const root = fixture(t, ['claude'], { role_settings: { claude: { worker: { model: 'claude-shared' } } } });
  const manifest = read(root, GENERATED_MANIFEST);
  const shared = read(root, '.claude/agents/worker.md');

  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine', effort: 'high' } } } });
  const result = update(root);

  const worker = read(root, '.claude/agents/worker.md');
  assert.match(worker, /^model: claude-mine$/m);
  assert.match(worker, /^effort: high$/m);
  assert.match(worker, /^permissionMode: acceptEdits$/m, 'the project permission stays');
  assert.deepEqual(result.local, ['.claude/agents/worker.md']);
  assert.deepEqual(result.changed, ['.claude/agents/worker.md']);
  assert.equal(result.manifest, null, 'the tracked manifest is not rewritten');
  assert.equal(read(root, GENERATED_MANIFEST), manifest);
  assert.ok(exists(root, LOCAL_MANIFEST));

  const report = doctor(root);
  assert.equal(report.generated, 'current');
  assert.deepEqual(report.local_models, ['.claude/agents/worker.md']);
  assert.deepEqual(report.findings.filter((finding) => /generated/.test(finding.message)), []);
  assert.deepEqual(validate(root).findings, []);
  assert.equal(update(root, { check: true }).plan.current, true);

  // Changing this machine's models again rewrites the file rather than refusing it.
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-other' } } } });
  update(root);
  assert.match(read(root, '.claude/agents/worker.md'), /^model: claude-other$/m);

  // Without the local file, the project's file comes back and the local manifest goes.
  fs.rmSync(path.join(root, LOCAL_CONFIG_FILE));
  const restored = update(root);
  assert.deepEqual(restored.local, []);
  assert.equal(read(root, '.claude/agents/worker.md'), shared);
  assert.equal(exists(root, LOCAL_MANIFEST), false);
});

test('only files Git does not ignore are marked for leaving out of commits', (t) => {
  const root = fixture(t, ['claude', 'codex']);
  execFileSync('git', ['init', '-q', root]);
  fs.appendFileSync(path.join(root, '.gitignore'), '.claude/\n', 'utf8');
  writeLocal(root, {
    role_settings: { claude: { worker: { model: 'claude-mine' } }, codex: { worker: { model: 'gpt-mine' } } },
  });
  const result = update(root);
  assert.deepEqual(result.local, ['.claude/agents/worker.md', '.codex/agents/worker.toml']);
  assert.deepEqual(result.local_visible, ['.codex/agents/worker.toml']);
  assert.deepEqual(doctor(root).local_visible, ['.codex/agents/worker.toml']);
  assert.deepEqual(update(root, { check: true }).plan.local_visible, ['.codex/agents/worker.toml']);
});

test('outside a Git repository every local file counts as seen', (t) => {
  const root = fixture(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  assert.deepEqual(update(root).local_visible, ['.claude/agents/worker.md']);
});

test('null clears a model the project pins, leaving it to the host', (t) => {
  const root = fixture(t, ['claude'], { role_settings: { claude: { verifier: { model: 'claude-pinned' } } } });
  writeLocal(root, { role_settings: { claude: { verifier: { model: null } } } });
  update(root);
  assert.doesNotMatch(read(root, '.claude/agents/verifier.md'), /^model:/m);
});

test('a level the project declares takes this machine model', (t) => {
  const root = fixture(t, ['codex'], {
    role_levels: { codex: { worker: { complex: { model: 'gpt-strong', model_reasoning_effort: 'high' } } } },
  });
  writeLocal(root, { role_levels: { codex: { worker: { complex: { model: 'gpt-mine' } } } } });
  const result = update(root);
  const variant = read(root, '.codex/agents/worker_complex.toml');
  assert.match(variant, /^model = "gpt-mine"$/m);
  assert.match(variant, /^model_reasoning_effort = "high"$/m, 'a setting the local file leaves out stays the project one');
  assert.ok(result.local.includes('.codex/agents/worker_complex.toml'));
});

test('a routed role setting reaches the routing host entry files', (t) => {
  const root = fixture(t, ['claude', 'codex'], { role_routes: { worker: 'codex' } });
  writeLocal(root, { role_settings: { codex: { worker: { model: 'gpt-mine' } } } });
  const result = update(root);
  assert.match(read(root, '.codex/agents/worker.toml'), /^model = "gpt-mine"$/m);
  assert.match(read(root, '.claude/skills/castwork/SKILL.md'), /gpt-mine/);
  assert.ok(result.local.includes('.claude/skills/castwork/SKILL.md'));
  assert.ok(result.local.includes('.claude/agents/coordinator.md'));
});

test('a local route reaches only the routing host entry files, and the tracked manifest keeps the project digests', (t) => {
  const root = fixture(t, ['claude', 'codex']);
  const manifest = read(root, GENERATED_MANIFEST);
  const thinker = read(root, '.claude/agents/thinker.md');
  const entry = read(root, '.agents/skills/castwork/SKILL.md');

  writeLocal(root, {
    role_routes: { thinker: 'claude' },
    role_settings: { claude: { thinker: { model: 'opus', effort: 'high' } } },
  });
  const result = update(root);
  const routed = read(root, '.agents/skills/castwork/SKILL.md');
  assert.match(routed, /`thinker` runs in Claude Code \(`claude`\)\. Role file: `\.claude\/agents\/thinker\.md`\./);
  assert.match(routed, /Actor: `thinker@claude`\. Settings: model `opus`, effort `high`\./);
  assert.match(read(root, '.codex/agents/coordinator.toml'), /`thinker` runs in Claude Code/);
  assert.doesNotMatch(read(root, '.claude/skills/castwork/SKILL.md'), /`thinker` runs in/, 'a route to the host itself is no route');
  assert.deepEqual([...result.local].sort(), ['.agents/skills/castwork/SKILL.md', '.claude/agents/thinker.md', '.codex/agents/coordinator.toml']);
  assert.deepEqual(result.added, [], 'a local route adds no file');
  assert.equal(result.manifest, null);
  assert.equal(read(root, GENERATED_MANIFEST), manifest);
  assert.equal(doctor(root).generated, 'current');
  assert.deepEqual(validate(root).findings, []);

  // update --shared writes the project's output alone, without the route.
  update(root, { shared: true });
  assert.equal(read(root, '.agents/skills/castwork/SKILL.md'), entry);
  update(root);
  fs.rmSync(path.join(root, LOCAL_CONFIG_FILE));
  update(root);
  assert.equal(read(root, '.agents/skills/castwork/SKILL.md'), entry);
  assert.equal(read(root, '.claude/agents/thinker.md'), thinker);
  assert.equal(exists(root, LOCAL_MANIFEST), false);
});

test('a local route replaces the project route, and null drops it', (t) => {
  const root = fixture(t, ['claude', 'codex', 'opencode'], { role_routes: { worker: 'codex', verifier: 'codex' } });
  writeLocal(root, { role_routes: { worker: 'opencode', verifier: null } });
  update(root);
  const entry = read(root, '.claude/skills/castwork/SKILL.md');
  assert.match(entry, /`worker` runs in OpenCode \(`opencode`\)/);
  assert.doesNotMatch(entry, /`verifier` runs in/);
  assert.deepEqual(readConfig(root).local?.role_routes, { worker: 'opencode' });
  assert.deepEqual(readConfig(root).role_routes, { worker: 'codex', verifier: 'codex' }, 'the project routes stay as written');

  writeLocal(root, { role_routes: { worker: null, verifier: null } });
  update(root);
  assert.match(read(root, '.claude/skills/castwork/SKILL.md'), /None: every role runs in this host\./);
});

test('a file carrying another machine models reads as modified where there is no local file', (t) => {
  const root = fixture(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  update(root);
  // A clone that received the overridden file in a commit has neither file.
  fs.rmSync(path.join(root, LOCAL_CONFIG_FILE));
  fs.rmSync(path.join(root, LOCAL_MANIFEST));
  const report = doctor(root);
  assert.equal(report.generated, 'blocked');
  assert.ok(report.findings.some((finding) => finding.message === 'generated file modified locally: .claude/agents/worker.md'));
});

test('remove deletes files carrying this machine models, and the local manifest', (t) => {
  const root = fixture(t, ['claude']);
  writeLocal(root, { role_settings: { claude: { worker: { model: 'claude-mine' } } } });
  update(root);
  const result = remove(root);
  assert.ok(result.removed.includes('.claude/agents/worker.md'));
  assert.deepEqual(result.kept, []);
  assert.equal(exists(root, LOCAL_MANIFEST), false);
});

/* ------------------------------------------------------------------ */
/* What the local file may hold                                        */
/* ------------------------------------------------------------------ */

test('the local file holds role_settings, role_routes and role_levels only', (t) => {
  for (const key of ['hosts', 'permissions']) {
    const error = refusal(t, { [key]: {} });
    assert.match(error.message, new RegExp(`^${LOCAL_CONFIG_FILE} cannot set ${key}$`));
  }
});

test('a local route names a host the project generates, and never the coordinator', (t) => {
  const missing = refusal(t, { role_routes: { worker: 'pi' } });
  assert.equal(missing.message, `${LOCAL_CONFIG_FILE} role_routes.worker names pi, which ${CONFIG_FILE} does not list in hosts`);
  assert.match(missing.hint ?? '', /setup --host pi/);

  // The command the hint names adds the host, and the route then applies.
  const root = fixture(t, ['claude', 'codex']);
  writeLocal(root, { role_routes: { worker: 'pi' } });
  assert.throws(() => update(root), /does not list in hosts/);
  setup(root, { hosts: ['pi'] });
  assert.deepEqual(readConfig(root).hosts, ['claude', 'codex', 'pi']);
  assert.match(read(root, '.claude/skills/castwork/SKILL.md'), /`worker` runs in Pi \(`pi`\)/);
  assert.match(refusal(t, { role_routes: { coordinator: 'codex' } }).message, /role_routes cannot route the coordinator/);
  assert.match(refusal(t, { role_routes: { worker: 'nope' } }).message, /names unknown host nope/);
  assert.match(refusal(t, { role_routes: { worker: 3 } }).message, /role_routes\.worker must be a host id/);
});

test('the local file sets no permission', (t) => {
  const error = refusal(t, { role_settings: { claude: { worker: { permission_mode: 'bypassPermissions' } } } });
  assert.equal(error.message, `${LOCAL_CONFIG_FILE} role_settings.claude.worker.permission_mode: ${LOCAL_CONFIG_FILE} chooses models only`);
});

test('the local file is checked like castwork.json and named in its refusals', (t) => {
  assert.equal(refusal(t, { role_settings: { nope: {} } }).message, `${LOCAL_CONFIG_FILE} role_settings names unknown host nope`);
  assert.match(refusal(t, { role_settings: { claude: { coordinator: { model: 'x' } } } }).message, /cannot configure the coordinator/);
  assert.match(refusal(t, { role_settings: { codex: { worker: { effort: 'high' } } } }).message, /host codex has no setting effort/);
  assert.match(refusal(t, { role_settings: { claude: { worker: { model: '' } } } }).message, /is empty/);
  assert.match(refusal(t, ['not', 'an', 'object']).message, /must be an object/);
});

test('the local file adds no level and keeps a level model', (t) => {
  const noLevel = refusal(t, { role_levels: { codex: { worker: { complex: { model: 'gpt-mine' } } } } });
  assert.match(noLevel.message, /castwork\.json declares no complex level for worker on codex/);

  const levels = { role_levels: { codex: { worker: { complex: { model: 'gpt-strong' } } } } };
  const cleared = refusal(t, { role_levels: { codex: { worker: { complex: { model: null } } } } }, ['codex'], levels);
  assert.match(cleared.message, /sets no model/);
});

test('an OpenCode variant is checked against the project model it joins', (t) => {
  const extra = { role_settings: { opencode: { worker: { model: 'openai/shared' } } } };
  const root = fixture(t, ['opencode'], extra);
  writeLocal(root, { role_settings: { opencode: { worker: { variant: 'high' } } } });
  update(root);
  assert.match(read(root, '.opencode/agents/worker.md'), /^variant: high$/m);

  const error = refusal(t, { role_settings: { opencode: { verifier: { variant: 'high' } } } }, ['opencode']);
  assert.match(error.message, /variant is set without a model/);
});
