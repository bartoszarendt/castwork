/**
 * Procedure links in role files, and the OpenCode entry-skill deny. A
 * canonical role ends with one line naming the procedure skills it uses, which
 * is what a Claude Code plugin's role reads, since the plugin installs the file
 * as written. Generation replaces that line with a closing section linking each
 * procedure at the path its host's adapter generates, rather than leaving roles
 * to reach them through the entry skill, which Claude Code and Codex never load
 * implicitly and which the roles a coordinator starts on OpenCode are denied.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse as parseIndependently } from 'yaml';

import { PROCEDURE_LINE, generateHost, readAdapter, readRoles, readSkills, toolkitRoot } from '../src/adapter-generation.js';
import { HOSTS } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { roleFindings } from '../src/validate.js';

const EXPECTED = {
  coordinator: ['decision-capture', 'blocked-state'],
  thinker: ['task-record-contract', 'decision-capture', 'blocked-state'],
  worker: ['verification-evidence', 'blocked-state', 'task-record-contract'],
  verifier: ['assessment', 'verification-evidence'],
};

/** @param {string} content */
function frontmatterOf(content) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  assert.ok(match, 'has frontmatter');
  return parseIndependently(match[1]);
}

test('each canonical role names its procedures in one closing line, and each is a skill', () => {
  const skills = readSkills().map((skill) => skill.id);
  for (const role of readRoles()) {
    assert.deepEqual(role.procedures, EXPECTED[role.id], role.id);
    for (const procedure of role.procedures) assert.ok(skills.includes(procedure), `${role.id} names ${procedure}`);
    assert.match(role.body, PROCEDURE_LINE, `${role.id} ends with its Procedure skills line`);
  }
});

test('a Claude Code plugin role, installed as written, names skills the plugin ships', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(toolkitRoot(), '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const [id, procedures] of Object.entries(EXPECTED)) {
    const file = `./agents/${id}.md`;
    assert.ok(manifest.agents.includes(file), `the plugin installs ${file}`);
    const raw = fs.readFileSync(path.join(toolkitRoot(), file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(parseRecord(raw).frontmatter.procedures, undefined, `${id} keeps its procedures in the text a plugin role reads, not in frontmatter`);
    const closing = raw.trimEnd().split('\n\n').pop();
    assert.equal(closing.replace(/\s+/g, ' '), `Procedure skills: ${procedures.map((procedure) => `\`${procedure}\``).join(', ')}.`, id);
    // The plugin's default skills/ scan exposes each one as agenticloop:<id>.
    for (const procedure of procedures) assert.ok(fs.existsSync(path.join(toolkitRoot(), 'skills', procedure, 'SKILL.md')), procedure);
  }
});

for (const host of HOSTS) {
  test(`${host} role files name their procedures once: the closing line becomes the linked section`, () => {
    for (const role of readRoles()) {
      const file = generateHost(host).find((entry) => new RegExp(`/agents/${role.id}\.(md|toml)$`).test(entry.path));
      assert.doesNotMatch(file.content, /Procedure skills:/, `${file.path} does not repeat the canonical line`);
      assert.equal(file.content.split('## Procedures').length, 2, `${file.path} has one procedures section`);
      const before = role.body.replace(PROCEDURE_LINE, '').replaceAll('<host>', host);
      assert.ok(file.content.includes(`${before}\n\n## Procedures\n`), `${file.path} keeps the rest of the preset as written`);
    }
  });
}

test('validate reports a Procedure skills line that generation cannot read, and a name that is not a skill', () => {
  const skills = readSkills().map((skill) => skill.id);
  const role = (body) => {
    const line = PROCEDURE_LINE.exec(body);
    return { id: 'worker', description: 'd', body, procedures: line ? [...line[1].matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]) : [] };
  };
  assert.deepEqual(roleFindings(role('Text.\n\nProcedure skills: `assessment`.'), skills), []);
  assert.deepEqual(roleFindings(role('Text.\n\nProcedure skills: `assessment`,\n`blocked-state`.'), skills), [], 'a wrapped line is read');
  for (const body of ['Procedure skills: `assessment`.\n\nText after it.', 'Text.\n\nProcedure skills: assessment.', 'Text.\n\nProcedure skills: `assessment` and `blocked-state`.']) {
    const findings = roleFindings(role(body), skills);
    assert.equal(findings.length, 1, body);
    assert.match(findings[0].message, /Procedure skills line that is not its closing line/, body);
  }
  assert.match(roleFindings(role('Text.\n\nProcedure skills: `no-such-skill`.'), skills)[0].message, /names procedure no-such-skill, which is not a skill/);
});

for (const host of HOSTS) {
  test(`${host} role files end their instructions with links to their procedures, each one generated`, () => {
    const files = generateHost(host);
    const generated = new Set(files.map((file) => file.path));
    const skillEntry = readAdapter(host).files.find((entry) => entry.kind === 'skill');
    for (const [id, procedures] of Object.entries(EXPECTED)) {
      const role = files.find((file) => new RegExp(`/agents/${id}\\.(md|toml)$`).test(file.path));
      const section = role.content.slice(role.content.indexOf('## Procedures'));
      assert.ok(role.content.includes('## Procedures'), `${role.path} has a procedures section`);
      for (const procedure of procedures) {
        const target = skillEntry.to.replace('{skill}', procedure);
        assert.ok(section.includes(`\`${procedure}\`: \`${target}\``), `${role.path} links ${procedure}`);
        assert.ok(generated.has(target), `${target} is generated for ${host}`);
      }
      const listed = [...section.matchAll(/^- `([a-z-]+)`:/gm)].map((match) => match[1]);
      assert.deepEqual(listed, procedures, `${role.path} lists only its own procedures`);
      assert.doesNotMatch(section, /(\/(home|Users|tmp)\/|[A-Za-z]:[\\/])/, 'repository-relative paths only');
    }
  });
}

test('codex keeps the procedures inside developer_instructions', () => {
  const worker = generateHost('codex').find((file) => file.path === '.codex/agents/worker.toml');
  const instructions = worker.content.slice(worker.content.indexOf('developer_instructions = """'));
  assert.ok(instructions.includes('## Procedures'));
  assert.ok(worker.content.trimEnd().endsWith('"""'));
});

test('opencode denies the entry skill to the thinker, worker, and verifier, and not to the coordinator', () => {
  const files = generateHost('opencode');
  for (const id of ['thinker', 'worker', 'verifier']) {
    const front = frontmatterOf(files.find((file) => file.path === `.opencode/agents/${id}.md`).content);
    assert.deepEqual(front.permission, { skill: { agenticloop: 'deny' } }, id);
    assert.equal(front.name, id);
  }
  const coordinator = frontmatterOf(files.find((file) => file.path === '.opencode/agents/coordinator.md').content);
  assert.equal(coordinator.permission, undefined, 'the coordinator keeps the entry skill');
});

test('the deny sits alongside role settings, and other hosts carry no permission key', () => {
  const [worker] = generateHost('opencode', { roleSettings: { worker: { model: 'openai/gpt-5.6', variant: 'high' } } })
    .filter((file) => file.path === '.opencode/agents/worker.md');
  const front = frontmatterOf(worker.content);
  assert.equal(front.model, 'openai/gpt-5.6');
  assert.equal(front.variant, 'high');
  assert.deepEqual(front.permission, { skill: { agenticloop: 'deny' } });

  for (const file of generateHost('claude').filter((entry) => entry.path.startsWith('.claude/agents/'))) {
    assert.equal(frontmatterOf(file.content).permission, undefined, file.path);
  }
  for (const file of generateHost('codex').filter((entry) => entry.path.endsWith('.toml'))) {
    assert.doesNotMatch(file.content, /^permission/m, file.path);
  }
});
