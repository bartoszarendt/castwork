import assert from 'node:assert/strict';
import test from 'node:test';

import { commandDescriptions, generateHost, readCommand, readRoles, readSkills, skillFrontmatter, readAdapter, renderCommand, resolveRoutes } from '../src/adapter-generation.js';
import { roleLineLimit } from '../src/validate.js';
import { formatScalar } from '../src/yaml.js';
import { HOSTS } from '../src/layout.js';
import { ROLE_IDS } from '../src/record.js';

test('exactly four hosts are supported', () => {
  assert.deepEqual([...HOSTS], ['codex', 'claude', 'opencode', 'pi']);
});

test('no adapter exists for a removed host', () => {
  assert.throws(() => generateHost('copilot'), /unknown host/);
  assert.throws(() => generateHost('cursor'), /unknown host/);
});

test('the four canonical role ids are present and unchanged', () => {
  assert.deepEqual(readRoles().map((role) => role.id).sort(), [...ROLE_IDS].sort());
});

test('every role preset stays under 100 lines, the coordinator under 110', () => {
  assert.deepEqual(ROLE_IDS.map(roleLineLimit), ROLE_IDS.map((id) => (id === 'coordinator' ? 110 : 100)));
  for (const role of readRoles()) {
    assert.ok(role.body.split('\n').length < roleLineLimit(role.id), `${role.id} is too long`);
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

  test(`${host} writes its own id where a role names the host`, () => {
    for (const file of generateHost(host)) {
      assert.ok(!file.content.includes('<host>'), `${file.path} leaves <host> for the agent to fill`);
    }
    const byRole = (id) => generateHost(host).find((file) => file.path.includes(`agents/${id}.`));
    assert.ok(byRole('worker').content.includes(`producers: [worker@${host}]`));
    assert.ok(byRole('worker').content.includes(`host: ${host}\n`));
    assert.ok(byRole('verifier').content.includes(`actor: verifier@${host}\n`));
    for (const id of ['worker', 'verifier']) {
      assert.match(byRole(id).content, /never\s+the\s+machine's\s+name/);
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
    const entry = generateHost(host).find((file) => /castwork\.md$|castwork\/SKILL\.md$/.test(file.path));
    assert.ok(entry, `${host} has no entry file`);
    assert.match(entry.content, /Act as the coordinator when Castwork was invoked/);
    assert.match(entry.content, /Do not adopt the role for a request that never asked for it/);
    assert.match(entry.content, /name\s+it\s+once\s+at\s+the\s+start\s+of\s+your\s+first\s+message,\s+as\s+\*\*Coordinator —\*\*/);
    assert.doesNotMatch(entry.content, /You are the coordinator for this session/);
  });

  if (!readAdapter(host).files.some((entry) => entry.kind === 'index' || (entry.kind === 'command' && entry.format === 'skill'))) continue;
  test(`${host} skill index says when to use Castwork, not what to do`, () => {
    const index = generateHost(host).find((file) => file.path.endsWith('castwork/SKILL.md'));
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
  for (const host of ['opencode', 'pi']) {
    const destination = readAdapter(host).files.find((entry) => entry.kind === 'command').to;
    const file = generateHost(host).find((entry) => entry.path === destination);
    assert.ok(file, `${host} has no command file`);
    assert.ok(
      file.content.includes(`description: ${formatScalar(readCommand().description)}`),
      `${host} command does not carry the command description`,
    );
  }
});

test('claude generates no command its skill would shadow, and the skill carries the entry procedure', () => {
  const files = generateHost('claude');
  assert.ok(!files.some((file) => file.path.startsWith('.claude/commands/')), 'claude generates a command file');
  const index = files.find((file) => file.path === '.claude/skills/castwork/SKILL.md');
  assert.ok(index, 'claude generates no entry skill');
  assert.ok(index.content.includes(readCommand().body), 'the entry skill does not carry the entry procedure');
});

test('codex declines implicit invocation of the Castwork skill', () => {
  const policy = generateHost('codex').find((file) => file.path === '.agents/skills/castwork/agents/openai.yaml');
  assert.ok(policy, 'codex generates no invocation policy');
  assert.equal(policy.content, 'policy:\n  allow_implicit_invocation: false\n');
});

test('every generated Castwork skill declines model invocation', () => {
  for (const host of HOSTS) {
    for (const index of generateHost(host).filter((file) => file.path.endsWith('castwork/SKILL.md'))) {
      assert.match(index.content, /^disable-model-invocation: true$/m, host);
    }
  }
  assert.ok(!generateHost('pi').some((file) => file.path.endsWith('SKILL.md')));
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

test('Pi projects only four roles, a prompt and procedure references with inheritance on delegated roles', () => {
  const files = generateHost('pi');
  assert.deepEqual(files.map((file) => file.path).sort(), [
    ...ROLE_IDS.map((role) => `.pi/agents/${role}.md`),
    '.pi/prompts/castwork.md',
    ...readSkills().map((skill) => `.pi/skills/castwork/references/${skill.id}.md`),
  ].sort());
  for (const role of ROLE_IDS) {
    const content = files.find((file) => file.path === `.pi/agents/${role}.md`).content;
    for (const [key, value] of Object.entries({ systemPromptMode: 'append', inheritProjectContext: true, inheritGlobalContext: true, inheritSkills: true })) {
      if (role === 'coordinator') assert.doesNotMatch(content, new RegExp(`^${key}:`, 'm'));
      else assert.match(content, new RegExp(`^${key}: ${value}$`, 'm'));
    }
  }
});

test('Pi command forwards arguments and carries the canonical hint with no other dollar sign', () => {
  const prompt = generateHost('pi').find((file) => file.path === '.pi/prompts/castwork.md').content;
  assert.ok(prompt.includes(`argument-hint: ${formatScalar(readCommand().argument_hint)}`));
  assert.ok(prompt.endsWith('\n## Argument\n\n${ARGUMENTS:-none}\n'));
  assert.equal(prompt.split('$').length, 2);
});

test('command arguments declarations are non-empty strings and all other dollar signs name their source', () => {
  const command = readCommand();
  for (const value of ['', '  ', 1, {}, [], null, undefined]) {
    assert.throws(() => renderCommand(command, [], { arguments: value }), /arguments.*non-empty string/);
  }
  const entry = { arguments: '${ARGUMENTS:-none}' };
  for (const field of ['description', 'argument_hint', 'body']) {
    assert.throws(() => renderCommand({ ...command, [field]: '$1' }, [], entry),
      new RegExp(`commands/start\\.md ${field === 'argument_hint' ? 'argument-hint' : field}`));
  }
  assert.throws(() => renderCommand({ ...command, argument_hint: {} }, [], entry), /argument-hint.*non-empty string/);
});

test('the argument generator change alone preserves existing-host command bytes', () => {
  const command = readCommand();
  for (const host of ['opencode']) {
    const actual = generateHost(host).find((file) => file.path.endsWith('commands/castwork.md')).content;
    const previous = `---\ndescription: ${formatScalar(command.description)}\n---\n\n${command.body}\n\n### Routes from this host\n\nNone: every role runs in this host.\n`;
    assert.equal(actual, previous, host);
  }
});

test('the argument generator change alone preserves existing-host command bytes with routes', () => {
  const command = readCommand();
  const hosts = ['claude', 'opencode', 'codex'];
  const settings = { codex: { verifier: { model: 'custom-$1', model_reasoning_effort: 'high' } } };
  for (const host of ['opencode']) {
    const routes = resolveRoutes(host, { verifier: 'codex' }, settings, hosts);
    const actual = generateHost(host, { routes }).find((file) => file.path.endsWith('commands/castwork.md')).content;
    const route = '- `verifier` runs in Codex (`codex`). Role file: `.codex/agents/verifier.toml`. Actor: `verifier@codex`. ' +
      'Settings: model `custom-$1`, model_reasoning_effort `high`.';
    const previous = `---\ndescription: ${formatScalar(command.description)}\n---\n\n${command.body}\n\n### Routes from this host\n\n${route}\n`;
    assert.equal(actual, previous, host);
  }
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
