/**
 * Role routes.
 *
 * A route says which host the project prefers a role to run in when the
 * coordinator works from another one, and what to do when that host cannot run
 * it. It is not a host setting: the coordinator acts on it, so it reaches the
 * entry command of every other host, with the role file the delegate reads
 * first and the settings the route's host resolves for that role.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CONFIG_FILE } from '../src/layout.js';
import { readConfig } from '../src/config.js';
import { generateHost } from '../src/adapter-generation.js';
import { setup, update } from '../src/setup.js';
import { validate } from '../src/validate.js';

/** A target with `hosts` installed and `extra` merged into its config. */
function fixture(t, hosts, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-routes-')));
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
    role_routes: { worker: { host: 'codex', fallback: 'current_host' } },
    role_settings: { codex: { worker: { model: 'gpt-5.4', reasoning_effort: 'high' } } },
  });
  update(root);
  for (const file of ['.claude/commands/agenticloop.md', '.claude/skills/agenticloop/SKILL.md']) {
    const section = routesSection(read(root, file));
    assert.match(section, /`worker` runs in Codex \(`codex`\)/, file);
    assert.match(section, /Role file: `\.codex\/agents\/worker\.toml`/, file);
    assert.match(section, /model `gpt-5\.4`, reasoning_effort `high`/, file);
    assert.match(section, /Fallback: `current_host`/, file);
  }
});

test('the route host itself runs the role as usual and lists no route', (t) => {
  const root = fixture(t, ['claude', 'codex'], {
    role_routes: { worker: { host: 'codex', fallback: 'current_host' } },
  });
  update(root);
  assert.match(routesSection(read(root, '.agents/skills/agenticloop/SKILL.md')), /None: every role runs in this host\./);
});

test('a route reaches the routing coordinator, with the file that says how to follow it', (t) => {
  const root = fixture(t, ['claude', 'codex']);
  update(root);
  const before = Object.fromEntries(['thinker', 'worker', 'verifier'].map((role) => [role, read(root, `.claude/agents/${role}.md`)]));
  assert.doesNotMatch(read(root, '.claude/agents/coordinator.md'), /## Role routes/);

  writeExtra(root, { role_routes: { worker: { host: 'codex', fallback: 'leave_open' }, verifier: { host: 'claude', fallback: 'leave_open' } } });
  update(root);
  for (const role of ['thinker', 'worker', 'verifier']) {
    assert.equal(read(root, `.claude/agents/${role}.md`), before[role], `${role} is unchanged`);
  }

  // A coordinator started directly as the host's agent, without the entry
  // command, still sees the route and where its procedure is.
  const claude = read(root, '.claude/agents/coordinator.md');
  assert.match(claude, /## Role routes/);
  assert.match(claude, /`## Role routes` section of `\.claude\/skills\/agenticloop\/SKILL\.md`/);
  assert.match(claude, /`worker` runs in Codex \(`codex`\)\. Role file: `\.codex\/agents\/worker\.toml`/);
  assert.doesNotMatch(claude, /### Routes from this host|None: every role/);

  const codex = read(root, '.codex/agents/coordinator.toml');
  assert.match(codex, /`## Role routes` section of `\.agents\/skills\/agenticloop\/SKILL\.md`/);
  assert.match(codex, /`verifier` runs in Claude Code \(`claude`\)/);
  assert.doesNotMatch(codex, /`worker` runs in/);
  assert.ok(codex.trimEnd().endsWith('"""'), 'the routes stay inside developer_instructions');
});

test('a route lists model and reasoning only, never a permission setting', (t) => {
  const root = fixture(t, ['claude', 'opencode'], {
    role_routes: {
      verifier: { host: 'opencode', fallback: 'leave_open' },
      thinker: { host: 'claude', fallback: 'current_host' },
    },
    role_settings: { opencode: { verifier: { model: 'openai/gpt-5.6', variant: 'high' } } },
  });
  update(root);
  assert.match(routesSection(read(root, '.claude/commands/agenticloop.md')), /Settings: model `openai\/gpt-5\.6`, variant `high`\. Fallback: `leave_open`\./);

  // Claude's shipped thinker default is a permission mode, which the
  // delegation capability chooses for the run; the route leaves it out.
  const opencode = routesSection(read(root, '.opencode/commands/agenticloop.md'));
  assert.match(opencode, /`thinker` runs in Claude Code \(`claude`\)\. .*Settings: the host's own defaults\./);
  assert.doesNotMatch(opencode, /permission_mode/);
});

test('with no routes every entry file says so', () => {
  for (const host of ['codex', 'claude', 'opencode']) {
    const entries = generateHost(host).filter((file) => /agenticloop(\.md|\/SKILL\.md)$/.test(file.path));
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.match(routesSection(entry.content), /None: every role runs in this host\./, entry.path);
    }
  }
});

test('validate accepts a routed repository as current', (t) => {
  const root = fixture(t, ['claude', 'codex'], {
    role_routes: { verifier: { host: 'claude', fallback: 'leave_open' } },
  });
  update(root);
  const findings = validate(root).findings;
  const generated = findings.filter((finding) => /out of date|not in the manifest|generation failed/.test(finding.message));
  assert.deepEqual(generated, []);

  // And the check is live: the same repository without the route is behind.
  writeExtra(root, { role_routes: {} });
  const stale = validate(root).findings.filter((finding) => /out of date/.test(finding.message));
  assert.ok(stale.some((finding) => /agenticloop/.test(finding.where)), 'dropping the route makes the entry files stale');
});

/* ------------------------------------------------------------------ */
/* A route's host must be generated                                    */
/* ------------------------------------------------------------------ */

test('a route to a host that is not generated is refused before anything is written', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { worker: { host: 'codex', fallback: 'current_host' } } });
  const before = read(root, '.claude/commands/agenticloop.md');
  assert.throws(
    () => update(root),
    (error) => /role_routes\.worker\.host codex is not a host this repository generates for/.test(error.message) && /setup --host codex/.test(error.hint),
  );
  assert.equal(read(root, '.claude/commands/agenticloop.md'), before);
});

test('setup --host adds the host a route already names', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { worker: { host: 'codex', fallback: 'current_host' } } });
  setup(root, { hosts: ['codex'] });
  assert.match(routesSection(read(root, '.claude/commands/agenticloop.md')), /`worker` runs in Codex/);
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

test('the coordinator cannot be routed', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { coordinator: { host: 'claude', fallback: 'current_host' } } });
  assert.throws(
    () => readConfig(root),
    (error) => /cannot route the coordinator/.test(error.message) && /thinker, worker, verifier/.test(error.hint),
  );
});

test('an unknown or previous role id is refused', (t) => {
  for (const role of ['engineer', 'auditor', 'reviewer']) {
    const root = fixture(t, ['claude'], { role_routes: { [role]: { host: 'claude', fallback: 'current_host' } } });
    assert.throws(() => readConfig(root), new RegExp(`unknown role ${role}`));
  }
});

test('a route without a fallback is refused and the hint names both values', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { worker: { host: 'claude' } } });
  assert.throws(
    () => readConfig(root),
    (error) => /role_routes\.worker has no fallback/.test(error.message) && /current_host/.test(error.hint) && /leave_open/.test(error.hint),
  );
});

test('a fallback outside the two values is refused, a host id included', (t) => {
  for (const fallback of ['claude', 'ask', '', null, ['current_host']]) {
    const root = fixture(t, ['claude'], { role_routes: { worker: { host: 'claude', fallback } } });
    assert.throws(
      () => readConfig(root),
      (error) => /role_routes\.worker\.fallback must be one of current_host, leave_open/.test(error.message) && /leave_open \(leave its part undone\)/.test(error.hint),
      JSON.stringify(fallback),
    );
  }
});

test('an unknown host is refused', (t) => {
  for (const host of ['cursor', 'claude-code', '', ['codex']]) {
    const root = fixture(t, ['claude'], { role_routes: { worker: { host, fallback: 'current_host' } } });
    assert.throws(() => readConfig(root), /role_routes\.worker\.host must name a known host/, JSON.stringify(host));
  }
});

test('a model on a route is refused with where it belongs', (t) => {
  const root = fixture(t, ['claude'], { role_routes: { worker: { host: 'claude', fallback: 'current_host', model: 'x' } } });
  assert.throws(
    () => readConfig(root),
    (error) => /role_routes\.worker has no key model/.test(error.message) && /role_settings\.<host>\.worker/.test(error.hint),
  );
});

test('role_routes shaped as anything but a map of maps is refused', (t) => {
  for (const value of [['worker'], 'worker', { worker: 'codex' }, { worker: ['codex'] }]) {
    const root = fixture(t, ['claude'], { role_routes: value });
    assert.throws(() => readConfig(root), /role_routes/, JSON.stringify(value));
  }
});
