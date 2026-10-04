import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../src/cli-main.js';
import { doctor, setup } from '../src/setup.js';
import { validate } from '../src/validate.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-exit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Run the CLI with stdout captured, so the JSON body can be asserted too. */
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

test('doctor --json exits non-zero when the report is not ok', (t) => {
  const root = fixture(t);
  assert.equal(doctor(root).ok, false, 'precondition: an empty directory is not ok');
  const { code, out } = capture(['doctor', '--json'], root);
  assert.equal(code, 1);
  assert.equal(JSON.parse(out).ok, false, 'the JSON body is still emitted');
});

test('doctor --json exits zero on a healthy installation', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const { code, out } = capture(['doctor', '--json'], root);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).ok, true);
});

test('doctor agrees with itself across output modes', (t) => {
  const root = fixture(t);
  assert.equal(capture(['doctor', '--json'], root).code, capture(['doctor'], root).code);
  setup(root, { hosts: ['codex'] });
  assert.equal(capture(['doctor', '--json'], root).code, capture(['doctor'], root).code);
});

test('validate --json exit status matches the report', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const report = validate(root);
  const { code, out } = capture(['validate', '--json'], root);
  assert.equal(code, report.ok ? 0 : 1);
  assert.equal(JSON.parse(out).ok, report.ok);
});

test('validate agrees with itself across output modes', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  assert.equal(capture(['validate', '--json'], root).code, capture(['validate'], root).code);
});

test('task lint --json exit status matches the report', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  fs.writeFileSync(path.join(root, '.castwork', 'tasks', 'T-001.md'), '---\nschema: 1\nid: T-001\ntitle: t\nstatus: nonsense\n---\n', 'utf8');
  const { code, out } = capture(['task', 'lint', '--json'], root);
  assert.equal(code, 1);
  assert.equal(JSON.parse(out).ok, false);
});

test('a JSON body is still valid JSON when the command fails', (t) => {
  const root = fixture(t);
  const { out } = capture(['doctor', '--json'], root);
  assert.doesNotThrow(() => JSON.parse(out));
});

test('update --check exits zero only when the installation is current, in both output modes', (t) => {
  const root = fixture(t);
  const result = setup(root, { hosts: ['codex'] });
  assert.equal(capture(['update', '--check'], root).code, 0);
  assert.equal(capture(['update', '--check', '--json'], root).code, 0);

  const stale = path.join(root, result.added[0]);
  fs.writeFileSync(stale, 'edited\n', 'utf8');
  const plain = capture(['update', '--check'], root);
  const json = capture(['update', '--check', '--json'], root);
  assert.equal(plain.code, 1);
  assert.equal(json.code, 1);
  assert.equal(JSON.parse(json.out).blocked, true);
  assert.equal(fs.readFileSync(stale, 'utf8'), 'edited\n', '--check writes nothing');
});
