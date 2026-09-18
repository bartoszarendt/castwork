/**
 * Third review round, findings 3 and 9.
 *
 * Finding 3: flow mappings accepted a duplicate key and silently kept the last
 * value, so `requirements: {checks: [test], checks: []}` dropped a declared
 * requirement while the block form correctly refused it.
 *
 * Finding 9: the generated-frontmatter tests parsed our own output with our own
 * parser, so a mistake shared by the formatter and the parser would pass. Every
 * assertion about generated frontmatter here goes through the `yaml` package,
 * an independent implementation, and is compared against the canonical source.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as independentYaml from 'yaml';

import { generateHost, readRoles, readSkills, readCommand } from '../src/adapter-generation.js';
import { HOSTS, TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';
import { taskLint, taskSet } from '../src/task-cli.js';
import { formatScalar, parseYaml } from '../src/yaml.js';

/* ------------------------------------------------------------------ */
/* Finding 3: duplicate keys in a flow mapping                         */
/* ------------------------------------------------------------------ */

const FLOW_DUPLICATES = [
  ['requirements: {checks: [test], checks: []}', /duplicate key checks/],
  ['a: {b: 1, b: 2}', /duplicate key b/],
  ['a: {b: {c: 1, c: 2}}', /duplicate key c/],
  ['a: {b: [1], c: {d: 1, d: 2}}', /duplicate key d/],
  ['a: {"k": 1, k: 2}', /duplicate key k/],
  ["a: {k: 1, 'k': 2}", /duplicate key k/],
  ['a: {k: 1, j: 2, k: 3}', /duplicate key k/],
];

for (const [text, pattern] of FLOW_DUPLICATES) {
  test(`3: the flow mapping ${JSON.stringify(text)} is refused`, () => {
    assert.throws(() => parseYaml(text), pattern);
  });

  test(`3: the independent parser also refuses ${JSON.stringify(text)}`, () => {
    assert.throws(() => independentYaml.parse(text), /unique/i);
  });
}

test('3: a duplicate key in a flow mapping inside a sequence entry is refused', () => {
  assert.throws(() => parseYaml('evidence:\n  - { check: test, check: lint, candidate: a, result: pass }'), /duplicate key check/);
});

test('3: the block form still reports a duplicate key the same way', () => {
  assert.throws(() => parseYaml('requirements:\n  checks: [test]\n  checks: []\n'), /duplicate key checks/);
});

test('3: distinct keys in a flow mapping are untouched', () => {
  const parsed = parseYaml('a: {b: 1, c: 2, d: {e: 3, f: 4}}');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { a: { b: 1, c: 2, d: { e: 3, f: 4 } } });
});

test('3: a repeated key in two sibling flow mappings is not a duplicate', () => {
  const parsed = parseYaml('a: [{ref: x}, {ref: y}]');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { a: [{ ref: 'x' }, { ref: 'y' }] });
});

test('3: a flow duplicate is a frontmatter.unparseable structural error', () => {
  const record = parseRecord('---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements: {checks: [test], checks: []}\n---\n\n## Intent\nx\n');
  assert.ok(record.errors.some((error) => error.code === 'frontmatter.unparseable'), 'expected frontmatter.unparseable');
  assert.match(record.errors.find((error) => error.code === 'frontmatter.unparseable').message, /duplicate key checks/);
});

test('3: task set status done refuses a record whose flow mapping repeats a key', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-flowdup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(
    file,
    '---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\nrequirements: {checks: [test], checks: []}\ncandidates:\n  - ref: aaa\n---\n\n## Intent\nx\n',
    'utf8',
  );
  const before = fs.readFileSync(file, 'utf8');
  // Named, because a bare `assert.throws` accepted any error and this one is
  // not the requirement refusal: a duplicate flow key makes the whole
  // frontmatter unparseable, so the record has no readable id and the lookup
  // refuses first. The structural refusal itself is covered by
  // `done-gate.test.js`, on records whose YAML parses.
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /no task record with id T-001/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written');
  assert.equal(taskLint(root, null, { json: true }).ok, false, 'lint reports the same record as invalid');
});

/* ------------------------------------------------------------------ */
/* Finding 9: generated frontmatter, read by an independent parser      */
/* ------------------------------------------------------------------ */

/** @param {string} content */
function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

const MARKDOWN_HOSTS = HOSTS.filter((name) => name !== 'codex');

for (const host of MARKDOWN_HOSTS) {
  test(`9: every ${host} role file carries its canonical description, read independently`, () => {
    const roles = readRoles();
    assert.ok(roles.length > 0, 'no canonical roles to compare against');
    let checked = 0;
    for (const role of roles) {
      const file = generateHost(host).find((entry) => entry.path.endsWith(`/${role.id}.md`));
      assert.ok(file, `${host} generated no file for role ${role.id}`);
      const parsed = independentYaml.parse(frontmatterOf(file.content));
      assert.equal(parsed.name, role.id);
      assert.equal(parsed.description, role.description);
      checked += 1;
    }
    assert.equal(checked, roles.length);
  });

  test(`9: the ${host} skill index frontmatter is valid for an independent parser`, () => {
    const index = generateHost(host).find((entry) => entry.path.endsWith('SKILL.md'));
    assert.ok(index, `${host} generated no skill index`);
    const parsed = independentYaml.parse(frontmatterOf(index.content));
    assert.equal(parsed.name, 'agenticloop');
    assert.equal(parsed.description, readCommand().description);
  });

  test(`9: the ${host} entry command frontmatter is valid for an independent parser`, () => {
    const command = generateHost(host).find((entry) => entry.path.endsWith('commands/agenticloop.md'));
    assert.ok(command, `${host} generated no entry command`);
    const parsed = independentYaml.parse(frontmatterOf(command.content));
    assert.equal(parsed.description, readCommand().description);
  });

  test(`9: every ${host} frontmatter block parses independently and agrees with ours`, () => {
    let checked = 0;
    for (const file of generateHost(host)) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      const independent = independentYaml.parse(frontmatter);
      const ours = parseYaml(frontmatter);
      assert.deepEqual(JSON.parse(JSON.stringify(ours)), independent, `${file.path} is read differently by the two parsers`);
      checked += 1;
    }
    assert.ok(checked > 0, `${host} produced no frontmatter to check`);
  });

  test(`9: per-role settings reach ${host} frontmatter as independent YAML`, () => {
    const files = generateHost(host, { roleSettings: { engineer: { model: 'a:model # with hash', permission_mode: 'acceptEdits' } } });
    const engineer = files.find((entry) => entry.path.endsWith('/engineer.md'));
    const parsed = independentYaml.parse(frontmatterOf(engineer.content));
    assert.equal(parsed.model, 'a:model # with hash');
  });
}

test('9: the skill index lists every bundled skill with its canonical description', () => {
  const skills = readSkills();
  assert.ok(skills.length > 0);
  for (const host of MARKDOWN_HOSTS) {
    const index = generateHost(host).find((entry) => entry.path.endsWith('SKILL.md'));
    for (const skill of skills) {
      assert.ok(index.content.includes(`\`${skill.id}\``), `${host} index omits ${skill.id}`);
      assert.ok(index.content.includes(skill.description), `${host} index omits the description of ${skill.id}`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Finding 9: one targeted regression per YAML failure of all rounds    */
/* ------------------------------------------------------------------ */

/** Each entry names the round that found it. */
const REPORTED_SCALARS = [
  ['round 1: a bare colon becomes a mapping', 'Read-only: implements nothing'],
  ['round 1: a hash starts a comment', 'Fix #1 regression'],
  ['round 1: a leading bracket is a flow sequence', '[bracketed] start'],
  ['round 1: a leading brace is a flow mapping', '{braced} start'],
  ['round 1: true comes back as a boolean', 'true'],
  ['round 1: 123 comes back as a number', '123'],
  ['round 2: an escaped quote before a hash', 'say "hi" # not a comment'],
  ['round 2: a carriage return', 'first\rsecond'],
  ['round 2: a literal backslash n', 'back\\nslash'],
  ['round 2: an escaped backslash before a quote', 'trailing\\'],
  ['round 3: a colon directly before a hash', 'a: b # c'],
  ['round 3: a newline', 'first\nsecond'],
  ['round 3: a tab', 'tab\there'],
  ['round 3: an empty value', ''],
  ['round 3: a single quote', "It's here"],
];

for (const [label, value] of REPORTED_SCALARS) {
  test(`9: ${label} survives an independent parser`, () => {
    const document = `description: ${formatScalar(value)}`;
    assert.equal(independentYaml.parse(document).description, value, 'the independent parser disagrees');
    assert.equal(parseYaml(document).description, value, 'our parser disagrees');
  });
}

const REPORTED_DUPLICATES = [
  ['round 3: a duplicate block key', 'requirements:\n  checks: [test]\n  checks: []\n'],
  ['round 3: a duplicate flow key', 'requirements: {checks: [test], checks: []}'],
];

for (const [label, document] of REPORTED_DUPLICATES) {
  test(`9: ${label} is refused by both parsers`, () => {
    assert.throws(() => parseYaml(document), /duplicate key/);
    assert.throws(() => independentYaml.parse(document), /unique/i);
  });
}

/* ------------------------------------------------------------------ */
/* Finding 9: a bounded generative pass over scalars only              */
/* ------------------------------------------------------------------ */

/**
 * Deterministic, bounded, and scalar-only on purpose.
 *
 * Generated scalars cannot produce a duplicate key, so this is a supplement to
 * the targeted cases above and never a substitute for them.
 *
 * Round four: the previous generator multiplied a 31-bit seed by 1103515245,
 * which leaves the safe integer range, so the sequence degenerated to 271
 * distinct values over the four lengths 0, 4, 5 and 8, and its alphabet could
 * not spell `1e3` or `0x10` at all. It is a 32-bit LCG through `Math.imul`
 * now, and the two assertions below fail loudly if it degenerates again.
 */
const SCALAR_ALPHABET = [...'abcdefgijklmnprstuvwEXxOo :#[]{},"\'\\|>*&!?%@`-~+_/\t\r\n0123456789.'];
const SCALAR_MAX_LENGTH = 12;

function* generatedScalars(count) {
  let seed = 0x2f6e2b1;
  // The high bits: an LCG's low bits cycle far too short to vary a length.
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 8;
  };
  for (let i = 0; i < count; i += 1) {
    const length = next() % (SCALAR_MAX_LENGTH + 1);
    let value = '';
    for (let j = 0; j < length; j += 1) value += SCALAR_ALPHABET[next() % SCALAR_ALPHABET.length];
    yield value;
  }
}

test('9: the scalar generator does not degenerate', () => {
  const values = [...generatedScalars(400)];
  assert.equal(values.length, 400);
  const distinct = new Set(values).size;
  assert.ok(distinct >= 350, `only ${distinct} distinct values of 400`);
  const lengths = new Set(values.map((value) => value.length));
  for (let length = 0; length <= SCALAR_MAX_LENGTH; length += 1) {
    assert.ok(lengths.has(length), `no generated scalar of length ${length}`);
  }
});

test('9: generated scalars round-trip through both parsers', () => {
  let checked = 0;
  for (const value of generatedScalars(400)) {
    const document = `description: ${formatScalar(value)}`;
    let independent;
    try {
      independent = independentYaml.parse(document);
    } catch (error) {
      assert.fail(`the independent parser rejected ${JSON.stringify(value)} formatted as ${JSON.stringify(formatScalar(value))}: ${error.message}`);
    }
    assert.equal(independent.description, value, `independent parse of ${JSON.stringify(value)}`);
    assert.equal(parseYaml(document).description, value, `our parse of ${JSON.stringify(value)}`);
    checked += 1;
  }
  assert.equal(checked, 400);
});
