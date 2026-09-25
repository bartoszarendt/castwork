import assert from 'node:assert/strict';
import test from 'node:test';

import { commandDescriptions, generateHost, readCommand, readRoles, readSkills, skillFrontmatter } from '../src/adapter-generation.js';
import { formatScalar } from '../src/yaml.js';
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
  test(`${host} entry file claims the coordinator role only when invoked`, () => {
    const entry = generateHost(host).find((file) => /agenticloop\.md$|agenticloop\/SKILL\.md$/.test(file.path));
    assert.ok(entry, `${host} has no entry file`);
    assert.match(entry.content, /Act as the coordinator when Agentic Loop was invoked/);
    assert.match(entry.content, /Do not adopt the role for a request that never asked for it/);
    assert.match(entry.content, /name\s+it\s+once\s+at\s+the\s+start\s+of\s+your\s+first\s+message,\s+as\s+\*\*Coordinator —\*\*/);
    assert.doesNotMatch(entry.content, /You are the coordinator for this session/);
  });

  test(`${host} skill index says when to use Agentic Loop, not what to do`, () => {
    const index = generateHost(host).find((file) => file.path.endsWith('agenticloop/SKILL.md'));
    assert.ok(index, `${host} has no skill index`);
    const command = readCommand();
    assert.ok(
      index.content.includes(`description: ${formatScalar(command.skill_description)}`),
      `${host} skill index does not carry skill_description`,
    );
    assert.ok(!index.content.includes(command.description), `${host} skill index repeats the command description`);
  });
}

test('the entry command carries two distinct descriptions', () => {
  const command = readCommand();
  assert.notEqual(command.description.trim(), '');
  assert.notEqual(command.skill_description.trim(), '');
  assert.notEqual(command.skill_description, command.description);
});

test('a generated command file is described by what it does', () => {
  for (const host of ['claude', 'opencode']) {
    const file = generateHost(host).find((entry) => entry.path.endsWith('commands/agenticloop.md'));
    assert.ok(file, `${host} has no command file`);
    assert.ok(
      file.content.includes(`description: ${formatScalar(readCommand().description)}`),
      `${host} command does not carry the command description`,
    );
  }
});

test('codex declines implicit invocation of the Agentic Loop skill', () => {
  const policy = generateHost('codex').find((file) => file.path === '.agents/skills/agenticloop/agents/openai.yaml');
  assert.ok(policy, 'codex generates no invocation policy');
  assert.equal(policy.content, 'policy:\n  allow_implicit_invocation: false\n');
});

test('claude declines model invocation of the Agentic Loop skill', () => {
  const index = generateHost('claude').find((file) => file.path.endsWith('agenticloop/SKILL.md'));
  assert.match(index.content, /^disable-model-invocation: true$/m);
  for (const host of ['codex', 'opencode']) {
    const other = generateHost(host).find((file) => file.path.endsWith('agenticloop/SKILL.md'));
    assert.doesNotMatch(other.content, /disable-model-invocation/, `${host} declares a key it does not document`);
  }
});

test('codex role files carry the prompt under the key Codex reads', () => {
  const roleFiles = generateHost('codex').filter((file) => file.path.endsWith('.toml'));
  assert.equal(roleFiles.length, readRoles().length);
  for (const file of roleFiles) {
    assert.match(file.content, /^developer_instructions = """$/m, `${file.path} has no developer_instructions`);
    assert.doesNotMatch(file.content, /^instructions = /m, `${file.path} sets base instructions`);
  }
});

test('a model binding reaches the generated role file', () => {
  const files = generateHost('claude', { roleSettings: { worker: { model: 'claude-opus-5' } } });
  const worker = files.find((file) => file.path.endsWith('worker.md'));
  assert.ok(worker.content.includes('model: claude-opus-5'));
});

test('an entry command without two usable descriptions is refused', () => {
  const good = { description: 'Do the thing.', skill_description: 'Use when the thing is asked for.' };
  assert.deepEqual(commandDescriptions(good), good);

  assert.throws(() => commandDescriptions({ description: 'Do the thing.' }), /no skill_description/);
  assert.throws(() => commandDescriptions({ ...good, skill_description: '' }), /no skill_description/);
  assert.throws(() => commandDescriptions({ ...good, skill_description: '   ' }), /no skill_description/);
  assert.throws(() => commandDescriptions({ ...good, skill_description: {} }), /no skill_description/);
  assert.throws(() => commandDescriptions({ ...good, skill_description: ['a'] }), /no skill_description/);
  assert.throws(() => commandDescriptions({ ...good, skill_description: true }), /no skill_description/);

  assert.throws(() => commandDescriptions({ skill_description: 'Use when asked.' }), /no description/);
  assert.throws(() => commandDescriptions({ ...good, description: '' }), /no description/);
  assert.throws(() => commandDescriptions({ ...good, description: {} }), /no description/);

  assert.throws(
    () => commandDescriptions({ description: 'Same words.', skill_description: 'Same words.' }),
    /repeats its description/,
  );
  assert.throws(
    () => commandDescriptions({ description: 'Same words.', skill_description: ' Same words. ' }),
    /repeats its description/,
  );
});

test('skill_frontmatter takes scalars and refuses the rest', () => {
  assert.deepEqual(skillFrontmatter({ id: 'test' }), []);
  assert.deepEqual(skillFrontmatter({ id: 'test', skill_frontmatter: { 'disable-model-invocation': true } }), [
    'disable-model-invocation: true',
  ]);
  assert.deepEqual(skillFrontmatter({ id: 'test', skill_frontmatter: { mode: 'manual' } }), ['mode: manual']);

  for (const value of [{}, ['a'], 1, null, '']) {
    assert.throws(
      () => skillFrontmatter({ id: 'test', skill_frontmatter: { key: value } }),
      /other than a string or a boolean/,
      `${JSON.stringify(value)} was accepted`,
    );
  }
});
