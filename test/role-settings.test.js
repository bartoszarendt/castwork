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
import { shippedConfigFindings } from '../src/validate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A target with `hosts` installed and `extra` merged into its config. */
function fixture(t, hosts, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-settings-')));
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

test('reasoning effort reaches a Claude role as the host key effort', (t) => {
  const root = fixture(t, ['claude'], {
    role_settings: { claude: { verifier: { reasoning_effort: 'xhigh' } } },
  });
  update(root);
  assert.match(read(root, '.claude/agents/verifier.md'), /^effort: xhigh$/m);
});

test('reasoning effort reaches a Codex role as the host key model_reasoning_effort', (t) => {
  const root = fixture(t, ['codex'], {
    role_settings: { codex: { verifier: { reasoning_effort: 'xhigh' } } },
  });
  update(root);
  assert.match(read(root, '.codex/agents/verifier.toml'), /^model_reasoning_effort = "xhigh"$/m);
});

test('reasoning effort reaches an OpenCode role as the host key reasoningEffort', (t) => {
  const root = fixture(t, ['opencode'], {
    role_settings: { opencode: { verifier: { reasoning_effort: 'high' } } },
  });
  update(root);
  assert.match(read(root, '.opencode/agents/verifier.md'), /^reasoningEffort: high$/m);
});

test('an OpenCode variant is its own setting, beside the effort option', (t) => {
  const root = fixture(t, ['opencode'], {
    role_settings: { opencode: { verifier: { model: 'openai/gpt-5.6', variant: 'high' } } },
  });
  update(root);
  const verifier = read(root, '.opencode/agents/verifier.md');
  assert.match(verifier, /^model: openai\/gpt-5.6$/m);
  assert.match(verifier, /^variant: high$/m);
});

test('the adapter is the only place a host declares what it accepts', () => {
  assert.deepEqual(settingsFor('claude'), ['model', 'permission_mode', 'reasoning_effort']);
  assert.deepEqual(settingsFor('codex'), ['model', 'reasoning_effort']);
  assert.deepEqual(settingsFor('opencode'), ['model', 'reasoning_effort', 'variant']);
});

/* ------------------------------------------------------------------ */
/* Values are the host's vocabulary, not ours                          */
/* ------------------------------------------------------------------ */

test('a value this toolkit has never heard of reaches the host intact', (t) => {
  const root = fixture(t, ['codex'], {
    role_settings: { codex: { worker: { reasoning_effort: 'ultra' } } },
  });
  update(root);
  assert.match(read(root, '.codex/agents/worker.toml'), /^model_reasoning_effort = "ultra"$/m);
});

test('a value that is not a scalar is refused rather than stringified into the file', (t) => {
  for (const value of [{ level: 'high' }, ['high'], true, 3, '']) {
    const root = fixture(t, ['claude'], { role_settings: { claude: { worker: { reasoning_effort: value } } } });
    assert.throws(
      () => readConfig(root),
      /role_settings.claude.worker.reasoning_effort (must be a string|is empty)/,
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
    role_settings: { claude: { worker: { reasoning_effort: '1e3' } } },
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
    role_settings: { codex: { worker: { reasoning_effort: 'high' } } },
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
    (error) => /has no setting variant/.test(error.message) && /accepts: model, permission_mode, reasoning_effort/.test(error.hint),
  );
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
  assert.doesNotMatch(read(root, '.claude/agents/verifier.md'), /effort/);
  assert.doesNotMatch(read(root, '.codex/agents/verifier.toml'), /reasoning_effort/);
  assert.doesNotMatch(read(root, '.opencode/agents/verifier.md'), /effort|variant/);
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

  const messages = shippedConfigFindings(shipped).map((finding) => finding.message);
  assert.ok(messages.some((m) => /reasoning_efort is not a setting claude accepts/.test(m)), 'a misspelled key');
  assert.ok(messages.some((m) => /role_settings.engineer is not a role id/.test(m)), 'an unknown role');
  assert.ok(messages.some((m) => /permission_mode is not a setting codex accepts/.test(m)), 'a key from another host');
});
