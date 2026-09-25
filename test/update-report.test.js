/**
 * What `setup` and `update` print is what an agent commits, so every path they
 * write has to be named, the manifest included.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../src/cli-main.js';
import { GENERATED_MANIFEST } from '../src/layout.js';
import { setup } from '../src/setup.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-report-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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

test('update names a manifest it rebuilds and does not call that up to date', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  fs.rmSync(path.join(root, GENERATED_MANIFEST));

  const check = capture(['update', '--check'], root);
  assert.equal(check.code, 1);
  assert.match(check.out, new RegExp(`added +${GENERATED_MANIFEST.replace(/\./g, '\\.')}`));

  const applied = capture(['update'], root);
  assert.match(applied.out, new RegExp(`added +${GENERATED_MANIFEST.replace(/\./g, '\\.')}`));
  assert.doesNotMatch(applied.out, /everything is up to date/);
  assert.match(applied.out, /commit them together/);

  assert.match(capture(['update'], root).out, /everything is up to date/);
});

test('update --json says when it wrote the manifest', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const manifestFile = path.join(root, GENERATED_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  delete manifest.files[Object.keys(manifest.files)[0]];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), 'utf8');

  assert.equal(JSON.parse(capture(['update', '--check', '--json'], root).out).manifest, 'changed');
  const applied = JSON.parse(capture(['update', '--json'], root).out);
  assert.equal(applied.manifest, 'changed');
  assert.deepEqual([...applied.added, ...applied.changed, ...applied.removed], []);
  assert.equal(JSON.parse(capture(['update', '--json'], root).out).manifest, null);
});

test('setup --json reports hosts it added apart from files it added', (t) => {
  const root = fixture(t);
  const first = JSON.parse(capture(['setup', '--host', 'codex', '--json'], root).out);
  assert.deepEqual(first.added_hosts, ['codex']);
  assert.ok(first.added.every((relative) => relative.startsWith('.')), 'added lists generated paths, not hosts');
  assert.equal(first.manifest, 'added');

  const second = JSON.parse(capture(['setup', '--host', 'claude', '--json'], root).out);
  assert.deepEqual(second.added_hosts, ['claude']);
  assert.ok(second.added.some((relative) => relative.startsWith('.claude/')));
});
