import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE, HOSTS } from '../src/layout.js';
import { setup, update } from '../src/setup.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-contract-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('setup refuses rather than guessing when no host is named or recorded', (t) => {
  const root = fixture(t);
  assert.throws(() => setup(root, { hosts: [] }), /no hosts selected/);
  assert.ok(!fs.existsSync(path.join(root, CONFIG_FILE)));
});

test('the refusal names the flag and the valid hosts', (t) => {
  const root = fixture(t);
  assert.throws(
    () => setup(root, { hosts: [] }),
    (error) => /--host/.test(error.hint) && HOSTS.every((host) => error.hint.includes(host)),
  );
});

test('a named host is recorded so later runs need no flag', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')).hosts, ['codex']);
  assert.doesNotThrow(() => setup(root, { hosts: [] }), 'a bare rerun reuses the recorded hosts');
  assert.doesNotThrow(() => update(root));
});

test('several hosts can be named at once', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: [...HOSTS] });
  assert.deepEqual(result.hosts, [...HOSTS]);
});

test('an unknown host in the config is refused', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, CONFIG_FILE);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.hosts = ['copilot'];
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  assert.throws(() => update(root), /unknown host copilot/);
});

test('no shipped document shows a bare setup as a first-install command', () => {
  const docs = ['README.md', 'docs/getting-started.md', 'docs/downstream-adoption.md', 'docs/codex-setup.md', 'docs/claude-setup.md', 'docs/opencode-setup.md'];
  for (const relative of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    for (const block of text.matchAll(/```sh\n([\s\S]*?)```/g)) {
      for (const line of block[1].split('\n')) {
        if (!/^\s*npx agenticloop setup\b/.test(line)) continue;
        assert.match(line, /--host/, `${relative} shows a bare setup in a shell block: ${line.trim()}`);
      }
    }
  }
});

test('no shipped document claims setup prompts for a host', () => {
  const docs = ['README.md', 'docs/getting-started.md', 'docs/downstream-adoption.md', 'docs/codex-setup.md', 'docs/claude-setup.md', 'docs/opencode-setup.md'];
  for (const relative of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.doesNotMatch(text, /when asked|asks which hosts/i, `${relative} still describes a prompt`);
  }
});

test('the written config carries no pointer to a path that is not there', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
  assert.ok(!('extends' in config), 'agenticloop.json must not declare extends');
  assert.deepEqual(Object.keys(config).sort(), ['hosts']);
});

test('an existing extends key is dropped rather than carried forward', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, CONFIG_FILE);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.extends = './agenticloop/config.json';
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  setup(root, { hosts: ['codex'] });
  assert.ok(!('extends' in JSON.parse(fs.readFileSync(file, 'utf8'))));
});

test('a user key in agenticloop.json survives a rerun', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, CONFIG_FILE);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.note = 'mine';
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  setup(root, { hosts: ['codex'] });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).note, 'mine');
});
