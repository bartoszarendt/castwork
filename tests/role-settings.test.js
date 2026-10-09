/**
 * Per-host role settings.
 *
 * A setting is a plain value one host accepts. The toolkit decides which
 * settings exist by asking that host's adapter, projects them into the
 * generated role file under the host's own spelling, and never interprets the
 * value: reasoning effort means whatever the host says it means.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE } from '../src/layout.js';
import { readConfig, settingsFor } from '../src/config.js';
import { setup, update } from '../src/setup.js';
import { shippedConfigFindings, validate } from '../src/validate.js';
import { parseRecord } from '../src/record.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A target with `hosts` installed and `extra` merged into its config. */
function fixture(t, hosts, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-settings-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts });
  const file = path.join(root, CONFIG_FILE);
  const config = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...extra };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return root;
}

/** @param {string} root @param {string} relative */
function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Each host's own spelling                                            */
/* ------------------------------------------------------------------ */

test('Pi accepts model only and preserves provider/id:thinking suffixes', (t) => {
  assert.deepEqual(settingsFor('pi'), ['model']);
  const root = fixture(t, ['pi'], {
    role_settings: { pi: { verifier: { model: 'provider/id:high' } } },
  });
  update(root);
  assert.match(read(root, '.pi/agents/verifier.md'), /^model: "provider\/id:high"$/m);
  assert.deepEqual(validate(root).findings, []);
});

test('Claude effort reaches its role file under the native key', (t) => {
  const root = fixture(t, ['claude'], {
    role_settings: { claude: { verifier: { effort: 'xhigh' } } },
  });
  update(root);
  assert.match(read(root, '.claude/agents/verifier.md'), /^effort: xhigh$/m);
});

test('Codex model_reasoning_effort reaches its role file under the native key', (t) => {
  const root = fixture(t, ['codex'], {
    role_settings: { codex: { verifier: { model_reasoning_effort: 'xhigh' } } },
  });
  update(root);
  assert.match(read(root, '.codex/agents/verifier.toml'), /^model_reasoning_effort = "xhigh"$/m);
});

test('the retired unified effort setting is refused on every host before generation', (t) => {
  for (const [host, migration] of [
    ['opencode', /retired: remove it, and choose a variant .* beside an explicit model/],
    ['claude', /retired: rename it to effort\./],
    ['codex', /retired: rename it to model_reasoning_effort\./],
    ['pi', /thinking as a model suffix.*provider\/id:high/],
  ]) {
    const root = fixture(t, [host], {
      role_settings: { [host]: { worker: { reasoning_effort: 'high' } } },
    });
    const manifest = read(root, '.castwork/generated.json');
    assert.throws(() => update(root), (error) => error.message.includes(`role_settings.${host}.worker.reasoning_effort: host ${host} has no setting reasoning_effort`)
      && migration.test(error.hint), host);
    assert.equal(read(root, '.castwork/generated.json'), manifest, host);
  }
});

test('an OpenCode model and variant are emitted separately without an effort option', (t) => {
  const root = fixture(t, ['opencode'], {
    role_settings: { opencode: { verifier: { model: 'openai/gpt-5.6', variant: 'high' } } },
  });
  update(root);
  const verifier = read(root, '.opencode/agents/verifier.md');
  assert.match(verifier, /^model: openai\/gpt-5.6$/m);
  assert.match(verifier, /^variant: high$/m);
  assert.doesNotMatch(verifier, /^reasoningEffort:/m);
  assert.deepEqual(validate(root).findings, [], 'a separate model and variant are portable');
});

test('an OpenCode inline model variant is refused before update changes generated files', (t) => {
  const root = fixture(t, ['opencode'], {
    role_settings: { opencode: { worker: { model: 'openai/gpt-5.6#high' } } },
  });
  const before = read(root, '.opencode/agents/worker.md');
  const manifest = read(root, '.castwork/generated.json');
  assert.throws(() => update(root), (error) => /role_settings.opencode.worker.model.*inline variant/.test(error.message)
    && /model.*variant.*separate/.test(error.hint));
  assert.equal(read(root, '.opencode/agents/worker.md'), before);
  assert.equal(read(root, '.castwork/generated.json'), manifest);
});

test('an OpenCode variant without a model is refused, since v2 drops it', (t) => {
  for (const settings of [{ variant: 'high' }, { model: null, variant: 'high' }]) {
    const root = fixture(t, ['opencode'], { role_settings: { opencode: { verifier: settings } } });
    const manifest = read(root, '.castwork/generated.json');
    assert.throws(() => update(root), (error) => /role_settings.opencode.verifier.variant is set without a model/.test(error.message)
      && /set model as provider\/model beside it/.test(error.hint), JSON.stringify(settings));
    assert.equal(read(root, '.castwork/generated.json'), manifest);
  }
});

test('the adapter is the only place a host declares what it accepts', () => {
  assert.deepEqual(settingsFor('claude'), ['model', 'permission_mode', 'effort']);
  assert.deepEqual(settingsFor('codex'), ['model', 'model_reasoning_effort']);
  assert.deepEqual(settingsFor('opencode'), ['model', 'variant']);
});

/* ------------------------------------------------------------------ */
/* Values are the host's vocabulary, not ours                          */
/* ------------------------------------------------------------------ */

test('a value this toolkit has never heard of reaches the host intact', (t) => {
  const root = fixture(t, ['codex'], {
    role_settings: { codex: { worker: { model_reasoning_effort: 'ultra' } } },
  });
  update(root);
  assert.match(read(root, '.codex/agents/worker.toml'), /^model_reasoning_effort = "ultra"$/m);
});

test('a value that is not a scalar is refused rather than stringified into the file', (t) => {
  for (const value of [{ level: 'high' }, ['high'], true, 3, '']) {
    const root = fixture(t, ['claude'], { role_settings: { claude: { worker: { effort: value } } } });
    assert.throws(
      () => readConfig(root),
      /role_settings.claude.worker.effort (must be a string|is empty)/,
      `${JSON.stringify(value)} should be refused`,
    );
  }
});

test('null leaves a setting unset, which is how a shipped default is cleared', (t) => {
  const root = fixture(t, ['claude'], { role_settings: { claude: { worker: { permission_mode: null } } } });
  update(root);
  assert.doesNotMatch(read(root, '.claude/agents/worker.md'), /permissionMode/);
});

test('an effort value a YAML reader would take for a number is quoted', (t) => {
  const root = fixture(t, ['claude'], {
    role_settings: { claude: { worker: { effort: '1e3' } } },
  });
  update(root);
  assert.match(read(root, '.claude/agents/worker.md'), /^effort: "1e3"$/m);
});

/* ------------------------------------------------------------------ */
/* Per host, because one string rarely suits two hosts                 */
/* ------------------------------------------------------------------ */

test('each host gets its own model id, which is the point of the per-host map', (t) => {
  const root = fixture(t, ['claude', 'opencode'], {
    role_settings: {
      claude: { worker: { model: 'claude-opus-5' } },
      opencode: { worker: { model: 'anthropic/claude-opus-5' } },
    },
  });
  update(root);
  assert.match(read(root, '.claude/agents/worker.md'), /^model: claude-opus-5$/m);
  assert.match(read(root, '.opencode/agents/worker.md'), /^model: anthropic\/claude-opus-5$/m);
});

test('a leftover models map is refused with the setting that replaced it', (t) => {
  const root = fixture(t, ['claude'], { models: { worker: 'claude-opus-5' } });
  assert.throws(
    () => readConfig(root),
    (error) => /no longer has a models map/.test(error.message) && /role_settings\.<host>\.<role>\.model/.test(error.hint),
  );
});

test('a shipped default is overridable now that settings are user-writable', (t) => {
  const root = fixture(t, ['claude'], {
    role_settings: { claude: { worker: { permission_mode: 'default' } } },
  });
  update(root);
  assert.match(read(root, '.claude/agents/worker.md'), /^permissionMode: default$/m);
});

test('settings for a host that is not selected are checked but not projected', (t) => {
  const root = fixture(t, ['claude'], {
    role_settings: { codex: { worker: { model_reasoning_effort: 'high' } } },
  });
  assert.doesNotThrow(() => readConfig(root));
  update(root);
  assert.ok(!fs.existsSync(path.join(root, '.codex')));
});

/* ------------------------------------------------------------------ */
/* Refusals, rather than a setting silently ignored                    */
/* ------------------------------------------------------------------ */

test('an unknown host in role_settings is refused', (t) => {
  const root = fixture(t, ['claude'], { role_settings: { cursor: { worker: { model: 'x' } } } });
  assert.throws(() => readConfig(root), /unknown host cursor/);
});

test('an unknown role in role_settings is refused, and a previous role id is unknown', (t) => {
  for (const role of ['engineer', 'maintainer', 'auditor', 'orchestrator', 'reviewer']) {
    const root = fixture(t, ['claude'], { role_settings: { claude: { [role]: { model: 'x' } } } });
    assert.throws(
      () => readConfig(root),
      (error) => new RegExp(`unknown role ${role}`).test(error.message) && /coordinator, thinker, worker, verifier/.test(error.hint),
    );
  }
});

test('a setting the host cannot express is refused and the hint lists what it can', (t) => {
  const root = fixture(t, ['claude'], { role_settings: { claude: { worker: { variant: 'high' } } } });
  assert.throws(
    () => readConfig(root),
    (error) => /has no setting variant/.test(error.message) && /accepts: model, permission_mode, effort/.test(error.hint),
  );
});

test('the coordinator takes no role settings: it is the session Castwork is invoked in', (t) => {
  for (const [host, settings] of [['claude', { model: 'x' }], ['codex', { model_reasoning_effort: 'high' }], ['opencode', { variant: 'high' }], ['claude', {}]]) {
    const root = fixture(t, [host], { role_settings: { [host]: { coordinator: settings } } });
    assert.throws(
      () => readConfig(root),
      (error) => /cannot configure the coordinator/.test(error.message) && new RegExp(`Remove role_settings\\.${host}\\.coordinator`).test(error.hint) && /thinker, worker, verifier/.test(error.hint),
    );
  }
});

test('role_settings shaped as anything but nested maps is refused', (t) => {
  for (const value of [['claude'], 'claude', { claude: ['worker'] }, { claude: { worker: 'opus' } }]) {
    const root = fixture(t, ['claude'], { role_settings: value });
    assert.throws(() => readConfig(root), /role_settings/);
  }
});

/* ------------------------------------------------------------------ */
/* Nothing appears where nothing was configured                        */
/* ------------------------------------------------------------------ */

test('no effort key appears in a generated role when none is configured', (t) => {
  const root = fixture(t, ['claude', 'codex', 'opencode']);
  update(root);
  // Prose may discuss effort or a scoped variant; only setting keys configure the host.
  const claude = parseRecord(read(root, '.claude/agents/verifier.md')).frontmatter;
  const opencode = parseRecord(read(root, '.opencode/agents/verifier.md')).frontmatter;
  const codex = read(root, '.codex/agents/verifier.toml').replace(/developer_instructions = """[\s\S]*?"""/, '');
  assert.equal(Object.hasOwn(claude, 'effort'), false);
  assert.doesNotMatch(codex, /^\s*(?:model_)?reasoning_effort\s*=/m);
  assert.equal(Object.hasOwn(opencode, 'effort'), false);
  assert.equal(Object.hasOwn(opencode, 'variant'), false);
});

/* ------------------------------------------------------------------ */
/* The shipped defaults answer to the same contract                    */
/* ------------------------------------------------------------------ */

test('validate reports a shipped default that no host could accept', () => {
  // Checked as an object: rewriting the toolkit's own config.json raced with
  // every other test file that installs from it while this one ran.
  const shipped = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
  shipped.adapters.claude.role_settings.worker.reasoning_efort = 'high';
  shipped.adapters.claude.role_settings.engineer = { model: 'x' };
  shipped.adapters.codex.role_settings.worker = { permission_mode: 'acceptEdits' };
  shipped.adapters.opencode.role_settings.coordinator = { model: 'x' };
  shipped.adapters.opencode.role_settings.worker = { model: 'openai/gpt-5.6#high' };
  shipped.adapters.opencode.role_settings.verifier = { variant: 'high' };

  const messages = shippedConfigFindings(shipped).map((finding) => finding.message);
  assert.ok(messages.some((m) => /reasoning_efort is not a setting claude accepts/.test(m)), 'a misspelled key');
  assert.ok(messages.some((m) => /role_settings.engineer is not a role id/.test(m)), 'an unknown role');
  assert.ok(messages.some((m) => /permission_mode is not a setting codex accepts/.test(m)), 'a key from another host');
  assert.ok(messages.some((m) => /opencode.role_settings.coordinator configures the session/.test(m)), 'the coordinator');
  assert.ok(messages.some((m) => /opencode.role_settings.worker.model.*inline variant/.test(m)), 'inline OpenCode variants');
  assert.ok(messages.some((m) => /opencode.role_settings.verifier.variant is set without a model/.test(m)), 'an OpenCode variant alone');
});
