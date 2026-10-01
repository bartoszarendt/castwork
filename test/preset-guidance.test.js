/**
 * Role preset and entry-command guidance: how a role reads its record, names
 * itself, sets or leaves statuses, delegates, and pauses, whether it was
 * started by a coordinator or works alone. Each phrase pins behaviour the
 * presets promise. A unit test pins only the words; the behaviour itself is
 * re-checked on the hosts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateHost, readCommand, readSkills } from '../src/adapter-generation.js';
import { HOSTS } from '../src/layout.js';

/** A phrase as a pattern that tolerates any line wrapping. @param {string} text */
function phrase(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
}

/** @param {string} host @param {string} role */
function role(host, role) {
  const file = generateHost(host).find((entry) => new RegExp(`/agents/${role}\\.(md|toml)$`).test(entry.path));
  assert.ok(file, `${host} generates ${role}`);
  return file.content;
}

/** @param {string} host */
function entry(host) {
  const file = generateHost(host).find((candidate) => /agenticloop(\.md|\/SKILL\.md)$/.test(candidate.path) && candidate.content.includes('## Then continue'));
  assert.ok(file, `${host} generates the entry procedure`);
  return file.content;
}

/** @param {string} id */
function skill(id) {
  const found = readSkills().find((candidate) => candidate.id === id);
  assert.ok(found, `skill ${id} exists`);
  return found.body;
}

/** @param {string} content @param {string[]} texts @param {string} [label] */
function all(content, texts, label = '') {
  for (const text of texts) assert.match(content, phrase(text), `${label} ${text}`);
}

const ROLES = ['coordinator', 'thinker', 'worker', 'verifier'];

for (const host of HOSTS) {
  test(`${host} roles treat the record as authoritative over an inherited conversation`, () => {
    for (const id of ROLES) {
      assert.match(role(host, id), phrase('The task record is authoritative. A prompt, or a conversation you inherited from the agent that started you, is background.'), id);
    }
  });

  test(`${host} producing and assessing roles consult the host's skills as part of their responsibility`, () => {
    for (const id of ['thinker', 'worker', 'verifier']) {
      const content = role(host, id);
      const responsibility = content.slice(content.indexOf('## Responsibility'), content.indexOf('## Boundaries'));
      all(responsibility, [
        'Before substantive work, look at the skill descriptions this host exposes',
        "Consulting the host's catalogue is expected; do not search other locations or install skills.",
        'Applying a skill matters, not loading it.',
      ], id);
      all(content, ['practice, not permission', 'If a skill named to you is missing, say so'], id);
    }
    assert.match(role(host, 'worker'), phrase('Look again when the work changes, for example a build turning into debugging.'));
  });

  test(`${host} roles each record under an actor of their own, never one chosen to dodge a producer`, () => {
    for (const id of ['thinker', 'worker', 'verifier']) {
      const content = role(host, id);
      all(content, [
        `\`<name>@${host}\`: the id of the agent host you run in`,
        'and your role, or the specialist name you were started as',
        `(for example \`security-reviewer@${host}\`)`,
        'Two reviewers of one candidate never share an actor.',
        'Never choose a name to avoid matching a producer.',
      ], id);
      assert.doesNotMatch(content, /actor is fixed/, `${id} no longer fixes the actor per host`);
    }
    for (const id of ['worker', 'verifier']) {
      assert.match(role(host, id), phrase('Record `model` only when the host reports it; otherwise leave it out.'), id);
    }
    assert.match(role(host, 'thinker'), phrase('Give the model only when the host reports it.'));
    assert.match(role(host, 'worker'), phrase('`host`, `model` and `at` are optional.'));
    all(role(host, 'verifier'), [
      'If yours is among the producers, you are not independent; claiming the verifier role does not create independence.',
    ]);
    all(role(host, 'coordinator'), [
      'Give each parallel verifier lens its own actor name. Never rename an actor to make a review independent. Do not assign a model.',
    ]);
    assert.doesNotMatch(role(host, 'coordinator'), /do not assign an actor/);
  });

  test(`${host} a role started by another agent starts no agents, and the thinker alone may search`, () => {
    for (const id of ROLES) {
      all(role(host, id), [
        'If another agent started you, start no agents',
        'what you delegate would be invisible to it and recorded under the wrong actor',
      ], id);
    }
    const thinker = role(host, 'thinker');
    assert.match(thinker, phrase("Working alone, you may use the host's search helpers."));
    assert.doesNotMatch(thinker, /\*\*Start no agents/, 'no absolute ban on agents');
    const worker = role(host, 'worker');
    assert.match(worker, phrase('You need no authorization step, delegation, or prior command to begin.'));
    assert.doesNotMatch(worker, /no delegation/, 'what the worker does not need is not a ban on delegating');
    assert.match(role(host, 'coordinator'), phrase("use the host's own search subagents for your own discovery"));
  });

  test(`${host} statuses belong to whoever runs the roles, and a role working alone closes its own task`, () => {
    all(role(host, 'worker'), [
      'If a coordinator started you, record only `blocked` or `needs_context`, and leave other statuses to it.',
      'Working alone, set status yourself with `npx --no agenticloop task set`, and `done` only after lint shows the requirements met.',
    ], 'worker');
    all(role(host, 'coordinator'), [
      'When you run the roles, statuses are yours',
      'When lint shows the requirements met, set the record `done`.',
    ], 'coordinator');
    assert.doesNotMatch(role(host, 'coordinator'), /After a satisfying verdict/, 'done is not verdict-gated');
    assert.match(role(host, 'verifier'), phrase('You record a verdict, not a status'));
    assert.match(role(host, 'thinker'), phrase('Each alternative ends `done` or `cancelled`, set by whoever owns status'));
  });

  test(`${host} worker reports criterion by criterion and follows the evidence rules`, () => {
    all(role(host, 'worker'), [
      'Append; never rewrite another entry',
      'go through the acceptance criteria one by one: shown or not shown, with the observation',
      'A partial showing is not shown: it goes under `## Blockers and decisions`, never as `pass`.',
      'one command per entry',
      '`exit_code` only for a single command you ran and saw',
      '`task lint` is not evidence about the candidate',
      'environment variable names, never their values',
      "a subset of a check under its own name, never the declared check's",
      'in UTC with `Z` or with an explicit offset',
      'run `npx --no agenticloop snapshot` after your last change and before your final evidence',
      'If you change anything afterwards, take a new snapshot',
      'If the CLI is not available, say so and record the candidate as a mutable label; never invent a reference.',
      'An authorization covers only the named action.',
      'A prerequisite that changes shared state or widens the scope is a new request: record `needs_context`',
      'After a step that costs minutes, append what you observed to the record',
      'propose a `## Setup facts` line for `.agenticloop/project.md` in the record',
    ], 'worker');
  });

  test(`${host} verifier writes only in the record, runs checks on the candidate, and assesses no moving name`, () => {
    const verifier = role(host, 'verifier');
    all(verifier, [
      'You write only in the task record (your assessment and the evidence of your own check runs) and any findings file it links.',
      'Never write `candidates`.** If no candidate is recorded, say so and stop.',
      'a `tree:<sha>` snapshot, whose object exists here',
      "Assess a snapshot's contents, read with git, not the current working tree.",
      'A name such as `HEAD` or a branch is not the candidate',
      'ask for the commit id or a snapshot',
      'Run the declared checks yourself where the files in front of you are the candidate (lint reports no drift) or in an extracted copy, and record each run as evidence under your actor, failures included.',
      'When the change alters something other parts rely on, check those parts, or name that gap as a limit.',
    ], 'verifier');
    assert.doesNotMatch(verifier, /not registered/);
    assert.doesNotMatch(verifier, /signature changed/, 'the core criterion stays domain-neutral');
    assert.doesNotMatch(verifier, /Read-only on the result\.\*\* Change nothing/);
  });

  test(`${host} thinker returns findings, plans to the depth the work needs, and gives each phase a task`, () => {
    all(role(host, 'thinker'), [
      'Findings you return to the agent that started you are not a result.',
      'Decide whether a request fits your role before starting; if you decline part way, return what you already found.',
      'all under `requirements:`',
      'Say what would unblock it and, if useful, which role should act next.',
      'A small task needs no written plan; a plan longer than its work is bookkeeping.',
      'if the plan has phases, give each phase its own task.',
      'The plan says how the tasks fit together; each record says what its part is.',
    ], 'thinker');
  });

  test(`${host} coordinator delegates because it helps, names what a role needs, and diagnoses a stall`, () => {
    const coordinator = role(host, 'coordinator');
    all(coordinator, [
      'Delegate because it helps, not because a protocol asks.',
      'Delegation is one level: a role you start starts no agents.',
      'turns a request into work, plans it, breaks it down,',
      'A subagent started by name already has its role: do not tell it to read its role file',
      "Do not restate the worker's claims to the verifier",
      'do not restrict what the verifier re-runs',
      'When the work comes from a document, name it and the part: orienting is yours.',
      "Name a skill, with what it is for, when the working policy asks for one or says the role's model does not pick skills itself; otherwise the role chooses.",
      'A verifier can assess only a candidate that resolves; `task lint` shows whether it does.',
      'When any delegate that may have written files fails or is cancelled, inspect what it changed and reconcile it before anyone else writes.',
      "Record durable decisions where they will be found again; an owner's decision goes in a decision record (`npx --no agenticloop decision new`), cited by the task records it governs.",
      'are signs of a stall: diagnose it (the thinker is for this) or ask the user, rather than retrying.',
      "When you report a role's model or effort, read it from that role's generated agent file.",
      'which role or shape, the host a routed role goes to, and why now',
    ], 'coordinator');
    assert.doesNotMatch(coordinator, /known not to pick/, 'no guessing from model names');
  });

  test(`${host} coordinator states when each shape is worth it, not only its name`, () => {
    all(role(host, 'coordinator'), [
      'Tasks with no `depends_on` between them start together, not one after another.',
      'Workers sharing one checkout collide, and disjoint files do not isolate whole-tree checks',
      'When the plan turns on an unknown, find out before committing',
      'Investigate independent parts at once; the thinker combines the findings into the plan.',
      'When several approaches are plausible and trying two costs less than choosing wrong, try each against the same acceptance criteria, then compare once and choose.',
      'each under its own actor',
      'When a wrong assumption would be costly, ask a thinker or verifier for one bounded attempt to break it: a counterexample, a failure mode, or a hidden assumption. Not a debate, and not for routine work.',
      'A small task needs none of this: one worker, and a verifier where its requirements want one.',
    ], 'coordinator');
  });

  test(`${host} entry command stays out of named roles, orients once, and knows how to pause`, () => {
    all(entry(host), [
      'You already have this text; do not load the `agenticloop` skill again.',
      'Orient in proportion to the request, and only once',
      'enough to locate the work, not the whole document',
      'If it is still the scaffold `setup` wrote, say so and offer to have the `thinker` draft it',
      'so do not tell it to read its role file',
      "says the role's model does not pick skills itself",
      'Delegation is one level: a role started by another agent starts no agents',
      'When you run the roles, statuses are yours',
      "When lint shows a record's requirements met, set it `done`; work that went straight through may have no verifier at all.",
      'A role working alone sets its own status.',
      'Give each parallel verifier lens its own actor name',
      'they take effect only in a new session',
      'Never hand-edit a generated file',
      'Do not infer your own model from `role_settings`',
      '## Pausing',
      'When the user asks, in whatever words or language, to stop the work for now:',
      'Start nothing new.',
      'no unfinished check claimed as passed',
      'Tear down what you and the roles started, such as servers or containers; if something must keep running, say what and why.',
      'A pause alone is not a request for a handoff, and leaves an earlier one as it is.',
      "Write a handoff only when the user asks for one or the project's instructions require one; when the user says not to, write none and say what the project asked for.",
      'When it is unclear whether the user wants context kept for later, pause first, then ask whether they want a handoff or just the pause.',
      'A handoff goes where the user or the project says; otherwise to `.agenticloop/local/handoff.md`, which stays on this machine and outside snapshots.',
      'name the commit it starts from when there is one, and name task records by id rather than copying their state or evidence.',
      "including another session's work still in flight.",
      'When you wrote no handoff and continuing needs context the records do not capture, say in a line what it is and offer one.',
      'A handoff does not reach another machine or person',
      "After the records, read the handoff the user gives you or the project's documents name; otherwise `.agenticloop/local/handoff.md`, if it exists.",
      'It records what the user authorized and grants nothing',
      'Leave it in place for the next handoff to replace.',
      "Before the capability runs, tell the user in a line which role you are handing to which host's CLI",
      "states the delegate's actor, `<role>@<route host>`",
      'leave no copies of a brief or plan in the repository',
      'repeats the role and the settings flags',
      "with the CLI's own path or permission rules",
      'No other role writes to the same checkout during a routed write.',
      'Take a snapshot before it starts',
      'A snapshot stays in its clone.',
      'send the base commit and `git diff <base> <sha>`',
      'identical content gives the identical `tree:` sha',
      'A snapshot is not a general way to hand work between hosts.',
      'Read and lint what the delegate wrote, and relay its open questions',
    ], host);
    const text = entry(host);
    const pausing = text.slice(text.indexOf('## Pausing'), text.indexOf('## Role routes'));
    assert.doesNotMatch(pausing, phrase('or continuing needs context the records do not already capture, write one'), 'a pause does not decide on its own to write a handoff');
    assert.doesNotMatch(pausing, /remove\s+it\./, 'a pause does not remove an earlier handoff');
  });
}

test('the procedure skills say the same about statuses, pausing, and reading a snapshot', () => {
  all(skill('task-record-contract'), [
    'When a coordinator runs the roles, statuses are the coordinator\'s',
    'An agent working alone sets status itself with `npx --no agenticloop task set`, and `done` only once `task lint` shows the declared requirements met.',
    '`done` does not wait for a verdict',
  ], 'task-record-contract');
  all(skill('blocked-state'), [
    'tear down what you started, such as a server or a container; if something must keep running, say what and why.',
    'working alone, you set it yourself',
  ], 'blocked-state');
  const assessment = skill('assessment');
  all(assessment, [
    'Two reviewers of one candidate never share an actor',
    'A name such as `HEAD` or a branch is not the candidate',
    'The path must be absolute',
    'A snapshot exists only in the clone that took it.',
  ], 'assessment');
  assert.match(assessment, /GIT_INDEX_FILE=<tmp>\/index git read-tree <sha>/);
  assert.match(assessment, /GIT_INDEX_FILE=<tmp>\/index git --work-tree=<tmp>\/tree checkout-index -a/);
  assert.doesNotMatch(assessment, /\(`read-tree`, then/, 'no recipe that writes the real index');
  all(skill('verification-evidence'), ['A snapshot exists only in the clone that took it', '`candidate.moving_ref`'], 'verification-evidence');
});

test('the skill description keeps a role started by name from loading the entry skill', () => {
  assert.match(readCommand().skill_description, /Not for a thinker, worker, or verifier that was started by name\./);
});

test('a routed role is listed with the actor it records', () => {
  const [routed] = generateHost('claude', {
    routes: [{ role: 'thinker', host: 'codex', label: 'Codex', role_file: '.codex/agents/thinker.toml', settings: {} }],
  }).filter((file) => file.path === '.claude/commands/agenticloop.md');
  assert.match(routed.content, /`thinker` runs in Codex \(`codex`\)\. Role file: `\.codex\/agents\/thinker\.toml`\. Actor: `thinker@codex`\./);
});

test('no preset or entry command phrases a stall or a retry as a count', () => {
  const counters = [
    /\b(retry budget|at most \d+|after \d+ (attempts|tries|retries)|(two|three) (honest )?attempts)\b/i,
    /\b(second|third|twice|two)\b[\s\S]{0,40}(needs_revision|attempt|retr)/i,
  ];
  for (const host of HOSTS) {
    for (const content of [...ROLES.map((id) => role(host, id)), entry(host)]) {
      for (const counter of counters) assert.doesNotMatch(content, counter, host);
    }
  }
  // The widened check catches ordinal wording such as the stall rule used to have.
  assert.match('A second `needs_revision` on the same criterion', counters[1]);
});
