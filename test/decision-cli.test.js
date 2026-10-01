import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../src/cli-main.js';
import { decisionList, decisionNew } from '../src/decision-cli.js';
import { DECISIONS_DIRECTORY } from '../src/layout.js';
import { setup } from '../src/setup.js';

/** Each fixture is its own temp tree, removed when the test ends. */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-decision-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  return root;
}

/** Run the CLI with stdout captured. */
function capture(argv, cwd) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    const code = run(argv, { cwd });
    return { code, out: chunks.join('') };
  } finally {
    process.stdout.write = original;
  }
}

/** @param {string} root @param {string} name @param {string} content */
function writeDecision(root, name, content) {
  fs.writeFileSync(path.join(root, DECISIONS_DIRECTORY, name), content, 'utf8');
}

test('decision list --json gives every decision in id order, superseded ones included', (t) => {
  const root = fixture(t);
  writeDecision(root, 'D-002.md', '---\nschema: 1\nid: D-002\ntitle: Keep amounts as minor units\ndate: 2026-03-05\nstatus: accepted\n---\n');
  writeDecision(root, 'D-001.md', '---\nschema: 1\nid: D-001\ntitle: Store money as floats\ndate: 2026-03-04\nstatus: superseded\n---\n');
  const { code, out } = capture(['decision', 'list', '--json'], root);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), [
    { id: 'D-001', status: 'superseded', date: '2026-03-04', title: 'Store money as floats', path: path.join(DECISIONS_DIRECTORY, 'D-001.md'), error: null },
    { id: 'D-002', status: 'accepted', date: '2026-03-05', title: 'Keep amounts as minor units', path: path.join(DECISIONS_DIRECTORY, 'D-002.md'), error: null },
  ]);
});

test('decision list prints the status a record carries, without judging it', (t) => {
  const root = fixture(t);
  decisionNew(root, 'Store money as integer minor units');
  writeDecision(root, 'D-002.md', '---\nid: D-002\ntitle: Something odd\nstatus: whatever_we_wrote\n---\n');
  const { code, out } = capture(['decision', 'list'], root);
  assert.equal(code, 0);
  assert.match(out, /^ID\s+STATUS\s+DATE\s+TITLE$/m);
  assert.match(out, /^D-001\s+accepted\s+\d{4}-\d{2}-\d{2}\s+Store money as integer minor units$/m);
  assert.match(out, /^D-002\s+whatever_we_wrote\s+Something odd$/m);
});

test('an unreadable decision is listed with the reason, not dropped', (t) => {
  const root = fixture(t);
  decisionNew(root, 'Readable');
  writeDecision(root, 'D-002.md', '# No frontmatter at all\n');
  const rows = decisionList(root, { json: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, 'D-002');
  assert.equal(rows[1].status, null);
  assert.match(rows[1].error, /no --- delimited frontmatter/);

  const { out } = capture(['decision', 'list'], root);
  assert.match(out, /^D-002\s+unreadable/m);
  assert.match(out, /D-002\.md: the record has no --- delimited frontmatter/);
});

test('a decision with malformed YAML is listed with the parser error, beside readable ones', (t) => {
  const root = fixture(t);
  decisionNew(root, 'Readable');
  writeDecision(root, 'D-002.md', '---\nid: D-002\ntitle: Broken\n  status: accepted\n---\n');
  const rows = decisionList(root, { json: true });
  assert.deepEqual(rows.map((row) => row.id), ['D-001', 'D-002']);
  assert.equal(rows[0].error, null);
  assert.equal(rows[1].status, null);
  assert.match(rows[1].error, /^frontmatter could not be parsed: /);
});

test('decision list says so when there are no decisions', (t) => {
  const root = fixture(t);
  const { code, out } = capture(['decision', 'list'], root);
  assert.equal(code, 0);
  assert.equal(out, `no decision records in ${DECISIONS_DIRECTORY}/\n`);
});

test('decision list writes nothing', (t) => {
  const root = fixture(t);
  decisionNew(root, 'One');
  const directory = path.join(root, DECISIONS_DIRECTORY);
  const before = fs.readFileSync(path.join(directory, 'D-001.md'), 'utf8');
  decisionList(root, { json: true });
  assert.deepEqual(fs.readdirSync(directory), ['D-001.md']);
  assert.equal(fs.readFileSync(path.join(directory, 'D-001.md'), 'utf8'), before);
});
