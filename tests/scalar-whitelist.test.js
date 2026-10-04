/**
 * Fourth review round, finding 2: `formatScalar` quoted on a blacklist, so
 * `1e3`, `+1`, `0x10`, `0o17`, `.inf` and `.nan` were emitted bare and read as
 * numbers by an independent YAML parser while our own parser read them as
 * strings. The rule is now a closed whitelist.
 *
 * Every assertion here compares the independent `yaml` package's reading of the
 * emitted document against the original string, because that is what a host's
 * own parser does with generated frontmatter.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as independentYaml from 'yaml';

import { CONFIG_FILE } from '../src/layout.js';
import { setup, update } from '../src/setup.js';
import { formatScalar, parseYaml } from '../src/yaml.js';

/**
 * Values a blacklist misses or has missed. Each must come back as the exact
 * original string from both parsers.
 */
const CLOSED_LIST = [
  '1e3',
  '+1',
  '-1',
  '0x10',
  '0o17',
  '.inf',
  '-.inf',
  '.nan',
  '1_000',
  '2026-09-18',
  '12:30',
  '1:2:3',
  '0.5',
  '5.',
  '~',
  'Yes',
  'n',
  'y',
  '-',
  '?',
  '',
  'T-001',
  'in_review',
  'worker@claude',
];

for (const value of CLOSED_LIST) {
  test(`r4-2: ${JSON.stringify(value)} reads back as the same string`, () => {
    const document = `description: ${formatScalar(value)}`;
    const independent = independentYaml.parse(document).description;
    assert.equal(typeof independent, 'string', `the independent parser read ${JSON.stringify(value)} as a ${typeof independent}`);
    assert.equal(independent, value, 'the independent parser disagrees');
    assert.equal(parseYaml(document).description, value, 'our parser disagrees');
  });
}

test('r4-2: the values a record uses every day stay bare', () => {
  for (const value of ['T-001', 'in_review', 'done', 'worker', 'blocked', 'ordinary title', 'a-b_c.d/e']) {
    assert.equal(formatScalar(value), value, `${value} should not be quoted`);
  }
});

test('r4-2: boolean-like words and everything outside the whitelist are quoted', () => {
  for (const value of ['true', 'True', 'no', 'OFF', 'y', 'N', 'null', '1e3', '0x10', '.inf', '5.', '+1', 'worker@claude', 'trailing ']) {
    assert.ok(formatScalar(value).startsWith('"'), `${value} should be quoted`);
  }
});

/* ------------------------------------------------------------------ */
/* The real generation path                                            */
/* ------------------------------------------------------------------ */

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-r4model-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex', 'claude', 'opencode'] });
  const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'));
  // Per host: the `models` shorthand is refused for a multi-host install, since
  // one id cannot name a model to three hosts. The binding under test is the
  // same `1e3` in all three.
  config.role_settings = Object.fromEntries(
    ['codex', 'claude', 'opencode'].map((host) => [host, { worker: { model: '1e3' } }]),
  );
  fs.writeFileSync(path.join(root, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  update(root);
  return root;
}

/** @param {string} content */
function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

for (const [host, file] of [
  ['claude', '.claude/agents/worker.md'],
  ['opencode', '.opencode/agents/worker.md'],
]) {
  test(`r4-2: a model binding of 1e3 reaches ${host} frontmatter as the string "1e3"`, (t) => {
    const root = fixture(t);
    const content = fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
    const parsed = independentYaml.parse(frontmatterOf(content));
    assert.equal(parsed.model, '1e3');
    assert.equal(typeof parsed.model, 'string', 'an independent parser read the model binding as a number');
    assert.equal(parseYaml(frontmatterOf(content)).model, '1e3');
  });
}

test('r4-2: a model binding of 1e3 reaches codex TOML as a quoted string', (t) => {
  const root = fixture(t);
  const content = fs.readFileSync(path.join(root, '.codex', 'agents', 'worker.toml'), 'utf8');
  assert.match(content, /^model = "1e3"$/m);
});
