import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateHost, readRoles, readSkills } from '../src/adapter-generation.js';
import { HOSTS, LEGACY_STATE_DIRECTORIES, LEGACY_STATE_FILES, STATE_DIRECTORY } from '../src/layout.js';
import { parseYaml } from '../src/yaml.js';
import { detectLegacyLayout, setup } from '../src/setup.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-baseline-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * Finding 2 asks for baseline evidence, not a self-referential check.
 *
 * This is the independent ground truth: every `.agenticloop/<segment>` literal
 * in the Phase 37 checkpoint's own source. Reading it from Git means the test
 * fails if a name 0.4.x really wrote is missing from our list, which iterating
 * the list itself could never catch.
 */
const BASELINE_COMMIT = '2d8cd99';

function baselineStateSegments() {
  const files = execFileSync('git', ['-C', repoRoot, 'ls-tree', '-r', '--name-only', BASELINE_COMMIT], { encoding: 'utf8' })
    .split('\n')
    .filter((name) => name.startsWith('src/') && name.endsWith('.js'));
  const segments = new Set();
  for (const file of files) {
    const source = execFileSync('git', ['-C', repoRoot, 'show', `${BASELINE_COMMIT}:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const match of source.matchAll(/[`'"]\.agenticloop\/([A-Za-z0-9._/-]+)/g)) {
      segments.add(match[1].split('/')[0]);
    }
  }
  return segments;
}

/** Names 0.5.0 still uses, so they are not legacy signals. */
const CURRENT = new Set(['decisions', 'local', 'project.md', 'tasks', 'generated.json']);

/**
 * `agents` appears in the baseline only inside prose declaring
 * `.agenticloop/agents` an invalid path; 0.4.x never created it. Treating it as
 * a signal would refuse a clean install, so it is excluded deliberately.
 */
const NEVER_WRITTEN = new Set(['agents']);

test('2: every legacy state name 0.4.x wrote is recognised', () => {
  const baseline = baselineStateSegments();
  assert.ok(baseline.size > 10, 'baseline evidence could not be read from Git');

  const expectedDirectories = [...baseline].filter((name) => !name.includes('.') && !CURRENT.has(name) && !NEVER_WRITTEN.has(name));
  const known = new Set(LEGACY_STATE_DIRECTORIES);
  const missing = expectedDirectories.filter((name) => !known.has(name));
  assert.deepEqual(missing, [], `legacy directories missing from the refusal list: ${missing.join(', ')}`);

  const expectedFiles = [...baseline].filter((name) => name.includes('.') && !CURRENT.has(name));
  const knownFiles = new Set(LEGACY_STATE_FILES.map((name) => name.split('/').pop()));
  const missingFiles = expectedFiles.filter((name) => !knownFiles.has(name));
  assert.deepEqual(missingFiles, [], `legacy files missing from the refusal list: ${missingFiles.join(', ')}`);
});

test('2: the names the second audit listed are all recognised', () => {
  for (const name of ['adoptions', 'decompositions', 'scope', 'host-role-capabilities', 'host-trust']) {
    assert.ok(LEGACY_STATE_DIRECTORIES.includes(name), `${name} must be a legacy signal`);
  }
});

test('2: agents is deliberately not a signal, so a clean install is not refused', (t) => {
  assert.ok(!LEGACY_STATE_DIRECTORIES.includes('agents'));
  const root = tmp(t);
  setup(root, { hosts: ['codex'] });
  fs.mkdirSync(path.join(root, STATE_DIRECTORY, 'agents'), { recursive: true });
  assert.deepEqual(detectLegacyLayout(root), []);
});

for (const name of ['adoptions', 'decompositions', 'scope', 'host-role-capabilities', 'host-trust']) {
  test(`2: setup refuses a target carrying ${name}`, (t) => {
    const root = tmp(t);
    fs.mkdirSync(path.join(root, STATE_DIRECTORY, name), { recursive: true });
    assert.throws(() => setup(root, { hosts: ['codex'] }), /0\.4\.x installation/);
  });
}

/** Finding 3: generated frontmatter must be valid YAML for the host, not just for us. */
function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

for (const host of HOSTS.filter((name) => name !== 'codex')) {
  test(`3: every generated ${host} file has parseable frontmatter`, () => {
    const files = generateHost(host);
    let checked = 0;
    for (const file of files) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      checked += 1;
      const parsed = parseYaml(frontmatter);
      assert.equal(typeof parsed.name === 'string' || typeof parsed.description === 'string', true, `${file.path} has no usable frontmatter`);
    }
    assert.ok(checked > 0, `${host} produced no frontmatter to check`);
  });

  test(`3: the ${host} auditor description survives generation intact`, () => {
    const auditor = generateHost(host).find((file) => file.path.endsWith('auditor.md'));
    const parsed = parseYaml(frontmatterOf(auditor.content));
    const canonical = readRoles().find((role) => role.id === 'auditor');
    assert.equal(parsed.name, 'auditor');
    assert.equal(parsed.description, canonical.description);
    assert.match(parsed.description, /Read-only: implements nothing/, 'the colon-bearing clause must survive');
  });

  test(`3: no generated ${host} frontmatter line carries a bare second colon`, () => {
    for (const file of generateHost(host)) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      for (const line of frontmatter.split('\n')) {
        const match = line.match(/^([A-Za-z_][\w-]*): (.*)$/);
        if (!match) continue;
        const value = match[2];
        if (value.startsWith('"') || value.startsWith("'")) continue;
        assert.ok(!/:\s/.test(value), `${file.path} emits an unquoted colon: ${line}`);
      }
    }
  });
}

test('3: a role or skill description containing a colon is quoted', () => {
  const withColon = [...readRoles(), ...readSkills()].filter((entry) => /:\s/.test(entry.description));
  assert.ok(withColon.length > 0, 'expected at least one colon-bearing description to exercise this');
  for (const host of HOSTS.filter((name) => name !== 'codex')) {
    for (const file of generateHost(host)) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      const parsed = parseYaml(frontmatter);
      if (typeof parsed.description !== 'string') continue;
      assert.ok(!parsed.description.endsWith(':'), `${file.path} truncated a description`);
    }
  }
});
