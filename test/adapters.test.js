import assert from 'node:assert/strict';
import test from 'node:test';

import { generateHost, readRoles, readSkills } from '../src/adapter-generation.js';
import { HOSTS } from '../src/layout.js';
import { ROLE_IDS } from '../src/record.js';

test('exactly three hosts are supported', () => {
  assert.deepEqual([...HOSTS], ['codex', 'claude', 'opencode']);
});

test('no adapter exists for a removed host', () => {
  assert.throws(() => generateHost('copilot'), /unknown host/);
  assert.throws(() => generateHost('cursor'), /unknown host/);
});

test('the four canonical role ids are present and unchanged', () => {
  assert.deepEqual(readRoles().map((role) => role.id).sort(), [...ROLE_IDS].sort());
});

test('every role preset stays under 100 lines', () => {
  for (const role of readRoles()) {
    assert.ok(role.body.split('\n').length < 100, `${role.id} is too long`);
  }
});

for (const host of HOSTS) {
  test(`${host} generates a file for every role and skill`, () => {
    const files = generateHost(host);
    for (const role of readRoles()) {
      assert.ok(files.some((file) => file.path.includes(role.id)), `${host} is missing ${role.id}`);
    }
    for (const skill of readSkills()) {
      assert.ok(files.some((file) => file.path.includes(skill.id)), `${host} is missing ${skill.id}`);
    }
  });

  test(`${host} generates no absolute paths`, () => {
    for (const file of generateHost(host)) {
      assert.doesNotMatch(file.content, /(\/(home|Users)\/|[A-Za-z]:\\)/, `${file.path} contains an absolute path`);
    }
  });

  test(`${host} generates no removed vocabulary`, () => {
    for (const file of generateHost(host)) {
      const body = file.content.toLowerCase();
      for (const word of ['activation slot', 'capability declaration', 'dispatch packet', 'closeout', 'receipt']) {
        assert.ok(!body.includes(word), `${file.path} mentions ${word}`);
      }
    }
  });

  test(`${host} generates files only under its own directories`, () => {
    for (const file of generateHost(host)) {
      assert.match(file.path, /^\.[a-z-]+\//, `${file.path} escapes the host directory`);
      assert.ok(!file.path.includes('..'), `${file.path} traverses upward`);
    }
  });
}

for (const host of HOSTS) {
  test(`${host} entry file tells the session it is the orchestrator`, () => {
    const entry = generateHost(host).find((file) => /agenticloop\.md$|agenticloop\/SKILL\.md$/.test(file.path));
    assert.ok(entry, `${host} has no entry file`);
    assert.match(entry.content, /You are the orchestrator for this session/);
    assert.match(entry.content, /Read the `orchestrator` preset/);
  });
}

test('codex role files carry the prompt under the key Codex reads', () => {
  const roleFiles = generateHost('codex').filter((file) => file.path.endsWith('.toml'));
  assert.equal(roleFiles.length, readRoles().length);
  for (const file of roleFiles) {
    assert.match(file.content, /^developer_instructions = """$/m, `${file.path} has no developer_instructions`);
    assert.doesNotMatch(file.content, /^instructions = /m, `${file.path} sets base instructions`);
  }
});

test('a model binding reaches the generated role file', () => {
  const files = generateHost('claude', { roleSettings: { engineer: { model: 'claude-opus-5' } } });
  const engineer = files.find((file) => file.path.endsWith('engineer.md'));
  assert.ok(engineer.content.includes('model: claude-opus-5'));
});
