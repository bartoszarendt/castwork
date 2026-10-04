/**
 * Role routes.
 *
 * A route says which host the project prefers a role to run in when the
 * coordinator works from another one; when that host cannot run it, the role
 * runs where the coordinator is. It is not a host setting: the coordinator acts on it, so it reaches the
 * entry command of every other host, with the role file the delegate reads
 * first and the settings the route's host resolves for that role.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CONFIG_FILE } from '../src/layout.js';
import { readConfig, settingsFor } from '../src/config.js';
import { generateHost } from '../src/adapter-generation.js';
import { setup, update } from '../src/setup.js';
import { validate } from '../src/validate.js';

/** A target with `hosts` installed and `extra` merged into its config. */
function fixture(t, hosts, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-routes-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts });
  writeExtra(root, extra);
  return root;
}

/** @param {string} root @param {Record<string, unknown>} extra */
function writeExtra(root, extra) {
  const file = path.join(root, CONFIG_FILE);
  const config = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...extra };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** @param {string} root @param {string} relative */
function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/** The section the routes close, as one host's entry files carry it. */
function routesSection(content) {
  const start = content.indexOf('### Routes from this host');
  assert.ok(start >= 0, 'the entry file lists routes');
  const next = content.indexOf('\n## ', start);
  return content.slice(start, next < 0 ? undefined : next);
}

/* ------------------------------------------------------------------ */
/* Where a route appears                                               */
/* ------------------------------------------------------------------ */

test('a route reaches the routing host with the role file and the target settings', (t) => {
  const root = fixture(t, ['claude', 'codex'], {
    role_routes: { worker: 'codex' },
    role_settings: { codex: { worker: { model: 'gpt-5.4', model_reasoning_effort: 'high' } } },
  });
  update(root);
  for (const file of ['.claude/commands/castwork.md', '.claude/skills/castwork/SKILL.md']) {
    const section = routesSection(read(root, file));
    assert.match(section, /`worker` runs in Codex \(`codex`\)/, file);
    assert.match(section, /Role file: `\.codex\/agents\/worker\.toml`/, file);
    assert.match(section, /model `gpt-5\.4`, model_reasoning_effort `high`/, file);
    assert.doesNotMatch(section, /Fallback/, file);
  }
});

test('the route host itself runs the role as usual and lists no route', (t) => {
  const root = fixture(t, ['claude', 'codex'], {
    role_routes: { worker: 'codex' },
  });
  update(root);
  assert.match(routesSection(read(root, '.agents/skills/castwork/SKILL.md')), /None: every role runs in this host\./);
});

test('a route reaches the routing coordinator, with the file that says how to follow it', (t) => {
  const root = fixture(t, ['claude', 'codex']);
  update(root);
  const before = Object.fromEntries(['thinker', 'worker', 'verifier'].map((role) => [role, read(root, `.claude/agents/${role}.md`)]));
  assert.doesNotMatch(read(root, '.claude/agents/coordinator.md'), /## Role routes/);

  writeExtra(root, { role_routes: { worker: 'codex', verifier: 'claude' } });
  update(root);
  for (const role of ['thinker', 'worker', 'verifier']) {
    assert.equal(read(root, `.claude/agents/${role}.md`), before[role], `${role} is unchanged`);
  }

  // A coordinator started directly as the host's agent, without the entry
  // command, still sees the route and where its procedure is.
  const claude = read(root, '.claude/agents/coordinator.md');
  assert.match(claude, /## Role routes/);
  assert.match(claude, /`## Role routes` section of `\.claude\/skills\/castwork\/SKILL\.md`/);
  assert.match(claude, /`worker` runs in Codex \(`codex`\)\. Role file: `\.codex\/agents\/worker\.toml`/);
  assert.doesNotMatch(claude, /### Routes from this host|None: every role/);

  const codex = read(root, '.codex/agents/coordinator.toml');
  assert.match(codex, /`## Role routes` section of `\.agents\/skills\/castwork\/SKILL\.md`/);
  assert.match(codex, /`verifier` runs in Claude Code \(`claude`\)/);
  assert.doesNotMatch(codex, /`worker` runs in/);
  assert.ok(codex.trimEnd().endsWith('"""'), 'the routes stay inside developer_instructions');
});

test('a route lists model and reasoning only, never a permission setting', (t) => {
  const root = fixture(t, ['claude', 'opencode'], {
    role_routes: {
      verifier: 'opencode',
      thinker: 'claude',
    },
    role_settings: {
      opencode: { verifier: { model: 'openai/gpt-5.6', variant: 'high' } },
      claude: { thinker: { effort: 'xhigh' } },
    },
  });
  update(root);
  assert.match(routesSection(read(root, '.claude/commands/castwork.md')), /Settings: model `openai\/gpt-5\.6`, variant `high`\.$/m);

  // Claude's shipped thinker default is a permission mode, which the
  // delegation capability chooses for the run; the route leaves it out.
  const opencode = routesSection(read(root, '.opencode/commands/castwork.md'));
  assert.match(opencode, /`thinker` runs in Claude Code \(`claude`\)\. .*Settings: effort `xhigh`\./);
  assert.doesNotMatch(opencode, /permission_mode/);
});

test('a route lists every non-permission setting its host declares', (t) => {
  for (const [target, from] of [['codex', 'claude'], ['claude', 'codex'], ['opencode', 'claude']]) {
    const worker = Object.fromEntries(settingsFor(target).map((key) => [key, key === 'permission_mode' ? 'acceptEdits' : `${key}-value`]));
    const root = fixture(t, [from, target], {
      role_routes: { worker: target },
      role_settings: { [target]: { worker } },
    });
    update(root);
    const entry = { claude: '.claude/commands/castwork.md', codex: '.agents/skills/castwork/SKILL.md' }[from];
    const section = routesSection(read(root, entry));
    for (const key of Object.keys(worker)) {
      if (key === 'permission_mode') assert.doesNotMatch(section, /permission_mode/, target);
      else assert.match(section, new RegExp(`${key} \`${key}-value\``), `${target} ${key}`);
    }
  }
});

test('with no routes every entry file says so', () => {
  for (const host of ['codex', 'claude', 'opencode']) {
    const entries = generateHost(host).filter((file) => /castwork(\.md|\/SKILL\.md)$/.test(file.path));
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.match(routesSection(entry.content), /None: every role runs in this host\./, entry.path);
    }
  }
});

test('validate accepts a routed repository as current', (t) => {
  const root = fixture(t, ['claude', 'codex'], {
    role_routes: { verifier: 'claude' },
  });
  update(root);
  const findings = validate(root).findings;
  const generated = findings.filter((finding) => /out of date|not in the manifest|generation failed/.test(finding.message));
  assert.deepEqual(generated, []);

  // And the check is live: the same repository without the route is behind.
  writeExtra(root, { role_routes: {} });
  const stale = validate(root).findings.filter((finding) => /out of date/.test(finding.message));
  assert.ok(stale.some((finding) => /castwork/.test(finding.where)), 'dropping the route makes the entry files stale');
});

/* ------------------------------------------------------------------ */
/* A route's host must be generated                                    */
/* ------------------------------------------------------------------ */

test('a route to a host that is not generated is refused before anything is written', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { worker: 'codex' } });
  const before = read(root, '.claude/commands/castwork.md');
  assert.throws(
    () => update(root),
    (error) => /role_routes\.worker names codex, which is not a host this repository generates for/.test(error.message) && /setup --host codex/.test(error.hint),
  );
  assert.equal(read(root, '.claude/commands/castwork.md'), before);
});

test('setup --host adds the host a route already names', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { worker: 'codex' } });
  setup(root, { hosts: ['codex'] });
  assert.match(routesSection(read(root, '.claude/commands/castwork.md')), /`worker` runs in Codex/);
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

test('the coordinator cannot be routed', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { coordinator: 'claude' } });
  assert.throws(
    () => readConfig(root),
    (error) => /cannot route the coordinator/.test(error.message) && /thinker, worker, verifier/.test(error.hint),
  );
});

test('an unknown or previous role id is refused', (t) => {
  for (const role of ['engineer', 'auditor', 'reviewer']) {
    const root = fixture(t, ['claude'], { role_routes: { [role]: 'claude' } });
    assert.throws(() => readConfig(root), new RegExp(`unknown role ${role}`));
  }
});

test('a route written as a map, with or without a fallback, is refused with the host-id form', (t) => {
  for (const route of [{ host: 'claude' }, { host: 'claude', fallback: 'current_host' }, { host: 'claude', model: 'x' }]) {
    const root = fixture(t, ['claude'], { role_routes: { worker: route } });
    assert.throws(
      () => readConfig(root),
      (error) => /role_routes\.worker must be a host id/.test(error.message)
        && /"worker": "<host>"/.test(error.hint)
        && /no fallback/.test(error.hint)
        && /role_settings\.<host>\.worker/.test(error.hint),
      JSON.stringify(route),
    );
  }
});

test('an unknown host is refused', (t) => {
  for (const host of ['cursor', 'claude-code', '']) {
    const root = fixture(t, ['claude'], { role_routes: { worker: host } });
    assert.throws(
      () => readConfig(root),
      (error) => new RegExp(`role_routes\.worker names unknown host ${host}`).test(error.message) && /codex, claude, opencode/.test(error.hint),
      JSON.stringify(host),
    );
  }
});

test('role_routes shaped as anything but a map of role to host is refused', (t) => {
  for (const value of [['worker'], 'worker', { worker: ['codex'] }, { worker: null }, { worker: 3 }]) {
    const root = fixture(t, ['claude'], { role_routes: value });
    assert.throws(() => readConfig(root), /role_routes/, JSON.stringify(value));
  }
});
