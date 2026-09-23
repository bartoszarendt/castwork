/**
 * Phase 39: the roles follow the TRINITY role model (D-017). The four ids are
 * `coordinator`, `thinker`, `worker` and `verifier`, and the record mechanism
 * is unchanged. These are the phase's acceptance cases that a unit test can
 * reach: a solo and a delegated task reaching `done`, the negative case, the
 * documented independence limit, a task that is not code, the previous ids
 * refused, and the generated output.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateHost, readAdapter } from '../src/adapter-generation.js';
import { requirementEvaluation } from '../src/checks.js';
import { HOSTS, TASKS_DIRECTORY } from '../src/layout.js';
import { parseRecord, ROLE_IDS } from '../src/record.js';
import { setup } from '../src/setup.js';
import { taskSet } from '../src/task-cli.js';

const PREVIOUS_IDS = ['orchestrator', 'maintainer', 'engineer', 'auditor'];

function fixture(t, frontmatter, body = '## Intent\nx\n') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenticloop-roles-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, TASKS_DIRECTORY, 'T-001.md');
  fs.writeFileSync(file, `---\n${frontmatter}---\n\n${body}`, 'utf8');
  return { root, file };
}

/** @param {string} root */
function status(root) {
  const text = fs.readFileSync(path.join(root, TASKS_DIRECTORY, 'T-001.md'), 'utf8');
  return /^status: (.*)$/m.exec(text)?.[1];
}

/** @param {string} frontmatter */
function evaluation(frontmatter) {
  const record = parseRecord(`---\n${frontmatter}---\n`);
  assert.deepEqual(record.errors, []);
  return Object.fromEntries(requirementEvaluation(record).map((entry) => [entry.requirement, entry]));
}

const HEAD = 'schema: 1\nid: T-001\ntitle: t\nstatus: in_review\n';
const DELEGATED = `${HEAD}requirements:\n  checks: [test]\n  independent_review: true\n  assessment_roles: [verifier]\ncandidates:\n  - ref: aaa\n    producers: [worker@codex]\nevidence:\n  - { check: test, candidate: aaa, result: pass, command: "npm test", exit_code: 0 }\n`;

test('the canonical role ids are coordinator, thinker, worker and verifier', () => {
  assert.deepEqual([...ROLE_IDS], ['coordinator', 'thinker', 'worker', 'verifier']);
});

test('case A, solo: a worker records a candidate and passing evidence, and done is accepted', (t) => {
  const { root } = fixture(
    t,
    `${HEAD}requirements:\n  checks: [test]\ncandidates:\n  - ref: aaa\n    producers: [worker@codex]\nevidence:\n  - { check: test, candidate: aaa, result: pass, command: "npm test", exit_code: 0 }\n`,
  );
  taskSet(root, 'T-001', 'status', 'done');
  assert.equal(status(root), 'done');
});

test('case B, delegated: a different-actor verifier accepts, both requirements hold, and done is accepted', (t) => {
  const { root } = fixture(
    t,
    `${DELEGATED}assessments:\n  - { candidate: aaa, role: verifier, actor: verifier@claude, verdict: accept, findings: "criteria checked" }\n`,
    '## Intent\nShaped by thinker@claude.\n\n## Acceptance criteria\n- x\n',
  );
  taskSet(root, 'T-001', 'status', 'done');
  assert.equal(status(root), 'done');
});

test('case C, negative: the verifier is the producer, independence is not satisfied, and done is refused without writing', (t) => {
  const { root, file } = fixture(
    t,
    `${DELEGATED}assessments:\n  - { candidate: aaa, role: verifier, actor: worker@codex, verdict: accept }\n`,
  );
  const results = evaluation(fs.readFileSync(file, 'utf8').split('---\n')[1]);
  assert.equal(results.independent_review.status, 'not_satisfied');
  assert.equal(results.independent_review.reason, 'actor.is_producer');

  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'));
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written');
});

/**
 * The documented independence limit (docs/record-format.md). The two
 * requirements are evaluated separately, so together they do not guarantee an
 * independent verifier: the producer's own `role: verifier` accept satisfies
 * `assessment_roles`, and a different actor's accept under another role
 * satisfies `independent_review`. This pins that behaviour so that changing it
 * is a deliberate decision, not an accident.
 */
test('case D, independence limit: a producer as verifier plus a different-actor thinker satisfies both requirements', (t) => {
  const frontmatter = `${DELEGATED}assessments:\n  - { candidate: aaa, role: verifier, actor: worker@codex, verdict: accept }\n  - { candidate: aaa, role: thinker, actor: thinker@claude, verdict: accept }\n`;
  const results = evaluation(frontmatter);
  assert.equal(results['assessment_roles:verifier'].status, 'satisfied');
  assert.equal(results.independent_review.status, 'satisfied');

  const { root } = fixture(t, frontmatter);
  taskSet(root, 'T-001', 'status', 'done');
  assert.equal(status(root), 'done');
});

test('case E, a task that is not code: a document goes through thinker, worker and verifier with a non-test check', (t) => {
  const { root } = fixture(
    t,
    `schema: 1\nid: T-001\ntitle: Write the onboarding guide\nstatus: in_review\nrequirements:\n  checks: [sources_cited]\n  assessment_roles: [verifier]\n  independent_review: true\ncandidates:\n  - ref: guide-draft-2\n    producers: [worker@claude]\nevidence:\n  - check: sources_cited\n    candidate: guide-draft-2\n    result: pass\n    actor: worker@claude\n    output: "every claim in the guide names its source"\nassessments:\n  - candidate: guide-draft-2\n    role: verifier\n    actor: verifier@codex\n    verdict: accept\n    findings: >-\n      Responsive to the request, complete against all three criteria, and\n      correct where checked. The glossary was not checked.\n`,
    '## Intent\nNew team members can set up their accounts on the first day.\n\n## Acceptance criteria\n- Every step names who to ask.\n- Every claim names its source.\n- The guide fits on two pages.\n',
  );
  taskSet(root, 'T-001', 'status', 'done');
  assert.equal(status(root), 'done');
});

test('a previous role id in an assessment is a structural error', () => {
  for (const role of PREVIOUS_IDS) {
    const record = parseRecord(`---\n${HEAD}candidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: ${role}, actor: a, verdict: accept }\n---\n`);
    assert.ok(
      record.errors.some((error) => error.code === 'entry.unknown_value' && error.message.includes('.role')),
      `role: ${role} is refused`,
    );
  }
});

test('a previous role id in assessment_roles is a structural error', () => {
  for (const role of PREVIOUS_IDS) {
    const record = parseRecord(`---\n${HEAD}requirements:\n  assessment_roles: [${role}]\n---\n`);
    assert.ok(
      record.errors.some((error) => error.code === 'requirement.unknown_role' && error.message.includes(role)),
      `assessment_roles: [${role}] is refused`,
    );
  }
});

test('a previous role id in an assessment refuses done without writing', (t) => {
  const { root, file } = fixture(
    t,
    `${HEAD}candidates:\n  - ref: aaa\nassessments:\n  - { candidate: aaa, role: maintainer, actor: m, verdict: accept }\n`,
  );
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => taskSet(root, 'T-001', 'status', 'done'), /structural/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written');
});

for (const host of HOSTS) {
  test(`${host} generates exactly the four role files and no previous id`, () => {
    const files = generateHost(host);
    const roles = files
      .filter((file) => /\/agents\/[^/]+\.(md|toml)$/.test(file.path))
      .map((file) => path.basename(file.path).replace(/\.(md|toml)$/, ''))
      .sort();
    assert.deepEqual(roles, [...ROLE_IDS].sort());
    for (const file of files) {
      for (const id of PREVIOUS_IDS) {
        assert.doesNotMatch(file.content, new RegExp(`\\b${id}\\b`), `${file.path} names ${id}`);
        assert.ok(!file.path.includes(id), `${file.path} is named after ${id}`);
      }
    }
  });
}

for (const host of HOSTS) {
  test(`${host} entry treats a described task or plan as the request`, () => {
    const entry = generateHost(host).find((file) => /agenticloop(\.md|\/SKILL\.md)$/.test(file.path) && file.content.includes('## Then continue'));
    assert.ok(entry, 'the entry procedure is generated');
    assert.match(entry.content, /the user has asked for that work: proceed without asking\s+again/);
    assert.match(entry.content, /A plan or a list of tasks\.\*\* Have the `thinker` turn it into task records/);
    assert.doesNotMatch(entry.content, /decide with the user whether it\s+needs one/);
  });
}

for (const host of HOSTS) {
  test(`${host} entry delegates to the named role subagent and says where roles live`, () => {
    const adapter = readAdapter(host);
    const roleDir = adapter.files.find((/** @type {{kind: string}} */ entry) => entry.kind === 'role').to.split('{role}')[0];
    const entry = generateHost(host).find((file) => /agenticloop(\.md|\/SKILL\.md)$/.test(file.path) && file.content.includes('## Then continue'));
    assert.ok(entry, 'the entry procedure is generated');
    assert.ok(entry.content.includes(`\`${roleDir}\``), `names ${roleDir}`);
    assert.match(entry.content, /start the host's subagent for that role/);
    assert.match(entry.content, /A\s+general-purpose subagent told it is the thinker has only the word/);
  });
}

for (const host of HOSTS) {
  test(`${host} generated files run the CLI through npx --no, never bare`, () => {
    const files = generateHost(host);
    const entry = files.find((file) => /agenticloop(\.md|\/SKILL\.md)$/.test(file.path) && file.content.includes('## Then continue'));
    assert.ok(entry, 'the entry procedure is generated');
    assert.match(entry.content, /`npx --no agenticloop task lint <id>`/);
    const decisions = files.find((file) => file.path.endsWith('references/decision-capture.md'));
    assert.match(decisions.content, /`npx --no agenticloop decision new "<title>"`/);
    for (const file of files) {
      assert.doesNotMatch(file.content, /`agenticloop (task|decision)\b/, file.path);
    }
  });
}
