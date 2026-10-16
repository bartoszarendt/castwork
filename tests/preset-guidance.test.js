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
  const file = generateHost(host).find((candidate) => /castwork(\.md|\/SKILL\.md)$/.test(candidate.path) && candidate.content.includes('## Then continue'));
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
    for (const id of ['thinker', 'worker', 'verifier']) {
      assert.match(role(host, id), phrase('The task record is authoritative for the work. Limits from your brief or the user, such as what you may write, run or spend, bind you even where the record describes more; the rest of a prompt, or a conversation you inherited from the agent that started you, is background.'), id);
    }
    assert.match(role(host, 'coordinator'), phrase("The task record is authoritative, and the user's current instructions come before it; a brief, or a conversation you inherited from the agent that started you, is background."));
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
    assert.match(role(host, 'thinker'), phrase('Give the model only when the host reports it, and the level only when this file names the one you run at.'));
    assert.match(role(host, 'worker'), phrase('`host`, `model`, `level` and `at` are optional.'));
    all(role(host, 'verifier'), [
      'If yours is among the producers, you are not independent.',
      'A session that produced a candidate never accepts it under any actor; taking this role creates no independence.',
    ]);
    all(role(host, 'coordinator'), [
      "Give each parallel verifier lens its own actor name. Never rename an actor to make a review independent. Where the host lists levels for a role, start the one the work calls for, as the entry command's `## Levels` says; choose no model otherwise.",
    ]);
    assert.doesNotMatch(role(host, 'coordinator'), /do not assign an actor/);
  });

  test(`${host} role-taking keeps both conditions explicit without manufacturing independence`, () => {
    all(role(host, 'coordinator'), [
      'For a small task where delegation would not help, you may switch to worker.',
      'Where no subagent or delegation capability can start an agent, you may take any role yourself; being started by another agent is not such a case.',
      'Announce either change first, follow its preset, and record its actor',
      'Taking a role creates no independence: a session never accepts a candidate it produced, under any actor.',
      'the accepting actor must not be a recorded producer',
    ]);
    // The entry carries the coordinator's own wording rather than a second copy.
    all(entry(host), [
      'For a small task where delegation would not help, you may switch to worker.',
      'Where no subagent or delegation capability can start an agent, you may take any role yourself; being started by another agent is not such a case.',
      'Announce either change first, follow its preset, and record its actor',
      'Taking a role creates no independence: a session never accepts a candidate it produced, under any actor.',
      'the accepting actor must not be a recorded producer',
    ]);
    assert.doesNotMatch(entry(host), phrase('you may switch to the `worker` role.'), 'no second copy of role-taking');
  });

  test(`${host} coordinator offers a draft of an unwritten project.md when started directly`, () => {
    all(role(host, 'coordinator'), ['offer a thinker draft of whatever is still unwritten'], 'coordinator');
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
      'Working alone, set status yourself with `npx --no castwork task set`, and `done` only after lint shows the requirements met.',
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
      'Append, by hand or with `npx --no castwork task add <id> candidate|evidence key=value ...`; never rewrite another entry',
      'go through the acceptance criteria one by one: shown or not shown, with the observation',
      'A partial showing is not shown: it goes under `## Blockers and decisions`, never as `pass`.',
      'one command per entry',
      '`exit_code` only for a single command you ran and saw',
      '`task lint` is not evidence about the candidate',
      'environment variable names, never their values',
      "a subset of a check under its own name, never the declared check's",
      'in UTC with `Z` or with an explicit offset',
      'run `npx --no castwork snapshot` after your last change and before your final evidence',
      'If you change anything afterwards, take a new snapshot',
      'If the CLI is not available, say so and record the candidate as a mutable label; never invent a reference.',
      'An authorization covers only the named action.',
      'A prerequisite that changes shared state or widens the scope is a new request: record `needs_context`',
      'After a step that costs minutes, append a short observation: what was seen, what it means, what is next',
      'A routine successful probe is a sentence in the body, or nothing',
      'an observation supporting acceptance or a finding stays candidate-bound evidence',
      'not a new narrative section per run or a long paragraph on one line',
      "it is the coordinator's, and you update it only when the coordinator assigns that to you",
      "propose where it is kept, in the record under `## Blockers and decisions`: a `## Setup facts` line for `.castwork/project.md` when it holds for this repository,",
      "a line for `.castwork/local/setup.md` when it holds only on this machine; or the host's user-level instructions or a user skill when it holds beyond this project.",
      'Edit none of them unless the user asks.',
      'Read `.castwork/project.md` for the policy, and `.castwork/local/setup.md`, if it exists, for facts about this machine.',
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
      "Keep the project's declared working directory, paths, flags and selection; a scoped variant is a different check and leaves the declared one unmet.",
      'Name an unclear or unavailable invocation.',
      'When the change alters something other parts rely on, check those parts, or name that gap as a limit.',
      'Try to break it with inputs and conditions its evidence does not cover, such as malformed, hostile, or real data, where the risk warrants and authorization allows.',
      'When a test is the evidence that a defect is fixed, confirm in an extracted copy that it fails without the fix, such as on the previous candidate, or name that as a limit.',
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
      '`independent_review: true` where the task must not be done without a second pair of eyes',
      "`assessment_roles: [verifier]` where it must not be done without the verifier's verdict.",
      'A review that would help but is not required needs no requirement: it can happen anyway.',
      'Say what would unblock it and, if useful, which role should act next, and at which level: a higher level is a remedy only for a cause in the difficulty itself, and an unchanged retry at a higher level is still an unchanged retry.',
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
      "Record a decision where it will be found again: one that outlives the task in a decision record (`npx --no castwork decision new`), cited by the task records it governs; one that settles only this task's next step under its `## Blockers and decisions`. Quote the user's words",
      "Do not just retry; the same goes for a worker's `needs_context`.",
      'A plain defect goes back to the worker.',
      "When you report a role's model, effort, or variant, read it from the generated agent file you started.",
      'which role or shape, its level where the host lists levels, the host a routed role goes to, and why now',
      'Resume the same agent for its next round where the host can, the worker with findings, the verifier with the next candidate; start a fresh one when its context is spent or a fresh view is the point.',
      '## While roles run',
      'A running role is no reason to end your turn. Meanwhile do what neither waits on its result nor touches its candidate, files, or the environment its checks use:',
      "update records and Current state from returned roles, prepare the next step and check that what it needs is ready, diagnose open failures, start independent work, gather the user's open decisions into one request.",
      "When nothing remains, end the turn and let the host wake you; where it cannot, follow the delegation capability's monitoring procedure rather than busy polling.",
    ], 'coordinator');
    assert.doesNotMatch(coordinator, /known not to pick/, 'no guessing from model names');
    assert.doesNotMatch(coordinator, /do not poll/i, 'a routed run without completion notification is still collected');
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
      'The default: one worker, and a verifier where its requirements want one. Use another shape only when its condition holds.',
      'Hand the work to the worker, a question about the work or its approach to the thinker, and an assessment of the candidate to the verifier.',
    ], 'coordinator');
  });

  test(`${host} the thinker is asked whenever the work comes into question, not only before it starts`, () => {
    const thinker = role(host, 'thinker');
    all(thinker, [
      'before it starts and whenever that comes into question: is this the right problem, and is the approach sound?',
      'You do not produce the result or record a verdict on it.',
      'When the plan, or work already under way, turns on something not yet known, find out first',
      'When a worker returns `blocked` or `needs_context`, a blocking finding questions the work rather than the candidate, or a plan is half done,',
      "Revise unstarted records a finding changes, saying why; changing what was asked is for the user.",
      "try once to break the approach, even of work that passed, and say if it held; breaking the candidate is the verifier's.",
      "For `needs_context`, answer what the repository and documents can, and narrow the rest to the user's decision.",
      'When a worker and a verifier read a criterion differently, say where they diverge and clarify the record as above.',
      'Never rewrite an assessment. Clarifying a criterion supersedes none: for one candidate, only a later assessment by the same actor replaces it, and a new candidate needs its own.',
      'Asked for an audit, or a review of how the work went, audit the work, not a candidate',
      'Answer with the question, the evidence, your conclusion or what is uncertain, and the next step.',
      'Trace consequential stop claims to the contract, decisions and permitted supporting evidence',
      'Identify what current authority permits and what only the user can decide.',
      'choose a cheap, authorized probe whose outcomes distinguish plausible explanations',
      'do not investigate a clear blocker merely to complete a checklist',
      'Distinguish a contradictory requirement from an unavailable prerequisite or an action not currently authorized',
      'actual recorded attempts, not candidate counts or a new retry limit',
      'Conflicting verdicts alone do not establish an ambiguous criterion',
      'Name what can proceed independently and the precise owner decision, if any.',
      "Judging the approach is yours; assessing the candidate is the verifier's.",
    ], 'thinker');
    assert.doesNotMatch(thinker, phrase('or judge it'), 'judging the approach is not forbidden');
    all(role(host, 'coordinator'), [
      'A blocking finding that questions the work rather than the candidate',
      'is a sign of a stall the first time;',
      'ask it what `Who answers a question` sends it: its fresh context, its own model or route, and the reasoning it keeps in the record are why.',
      'When progress depends on a cause not established, investigate it.',
      "A category or an owner's disposition establishes no mechanism; reuse a documented diagnosis when its evidence applies here.",
      'A workflow you write returns unresolved causes and changed approaches to your judgement.',
      'Its termination returns the problem to you, not a decision to end the work.',
      'Honor explicit owner budgets; do not invent a retry count as the reason to stop.',
      'So is work that moves while what it should reach does not, such as rounds spent around an acceptance check that never runs: run it once it can tell you something and authorization allows, and where practical reproduce a costly failure cheaply, such as in an offline test, before paying for another run; otherwise say what the evidence shows and take the next authorized step.',
    ], 'coordinator');
    assert.doesNotMatch(role(host, 'coordinator'), phrase('with the thinker or the user rather than retrying'), 'the coordinator may resolve a stall itself');
    assert.doesNotMatch(role(host, 'coordinator'), phrase('rather than thinking alone'), 'one rule for when the thinker is asked');
    const start = entry(host);
    all(start, [
      'A question that needs an argument about the work goes to the thinker, gathered into one request:',
      "A category or an owner's disposition establishes no mechanism; reuse a documented diagnosis when its evidence applies here.",
      'A workflow you write returns unresolved causes and changed approaches to your judgement.',
    ], 'entry');
    assert.doesNotMatch(start, phrase('consider the thinker when deeper investigation'), 'the entry no longer keeps an older copy of when to ask the thinker');
    for (const content of [role(host, 'coordinator'), start]) {
      all(content, [
        'Diagnosis using information and resources already authorized for the task needs no further approval.',
        "A proposal grants no authority of its own: a fix or another run within the work's scope is an engineering call, and access and spending keep their existing boundaries.",
        'Honor explicit stops.',
        'Give an established answer directly unless the user or working policy asks for another perspective; passing on that answer is coordination, not producing or assessing a candidate.',
        'A failed check, blocking verdict, or stopped workflow does not itself mean no authorized next step remains: consider permitted diagnosis or independent work',
      ], 'diagnosis boundaries');
    }
    assert.doesNotMatch(start, phrase('before another round'), 'the thinker is an option, not a required step');
    all(role(host, 'coordinator'), [
      "At a stop, report verified state, the obstacle and its cause or remaining uncertainty, what can proceed, and only the user's calls.",
      "A stop that leaves a choice the thinker's plan does not already settle, such as between ways forward or whether to accept a shortfall, goes to the thinker before the user: ask it for the path, where current authority ends, and a recommendation for what lies beyond.",
      'When its path stays within authority, take it and tell the user what you are doing; do not ask whether to proceed.',
      "Bring the thinker's recommendation for each of the user's calls that remains, in their terms: what changes for them, the risk and cost, and what proceeds after their answer; the technical terms stay in the record, and their answer adopts them.",
      'Settle the cause the evidence allows before asking, then ask for the path, not the step: one request for what remains.',
      'A stop the plan sets, such as a new kind of failure, returns the work to the thinker, and reaches the user only where what follows is their call.',
    ], 'stop report');
  });

  test(`${host} the coordinator answers what is written, sends arguments to the thinker, and asks the user once for permission`, () => {
    const coordinator = role(host, 'coordinator');
    all(coordinator, [
      '## Who answers a question',
      'Traffic is yours: who acts next, in what shape, on which record and when, statuses from lint, and what reaches the user.',
      'So is a question you can answer by pointing at something written, such as a record, a decision, the working policy, the thinker\'s plan, or lint output, or settle with a quick read-only look, such as one file or one command.',
      'A question that needs an argument about the work goes to the thinker, gathered into one request:',
      'Its answer covers the steps it names: carry them out, and return when the work departs from it.',
      'Asking the thinker, even when the user says to let it decide, hands over that question, not the coordination.',
      'Only what needs the user goes to them: their calls, as Boundaries lists them, such as acceptance or a fact only they hold.',
      "That the user decides does not make the choice yours to weigh: which option to recommend, and whether the user needs asking at all, are the thinker's to answer before you ask them.",
      "Bring one recommendation, the thinker's, and never offer asking the thinker as their choice.",
      'A permission with no alternative, such as a command only the user can run, and a fact only the user holds need no thinker.',
      "A running role's question is routed the same way: answer what is written and grants within its scope yourself; a limitation to accept, a condition to read one way, such as whether a stop rule applies, or a design to choose goes to the thinker before you reply,",
      'where the role cannot wait for that, have it stop its round cleanly and resume it with the answer.',
      "Look for authorization in the decisions and records before asking for it: a brief of yours that contradicts a recorded decision the user has not narrowed since is yours to correct with a new brief, not the user's to authorize again.",
      "Before relaying a role's finding that would change what you ask, such as a cost or a shortfall, check it once against its source.",
      "Ask it up front, from the thinker's plan where there is one; a question asked stays asked.",
      'Before you say where a candidate stands, read it fresh with `task lint` and name it, and correct an earlier claim you find wrong; `report` refreshes the record, not whether the files in front of you are still that candidate.',
      'At the end or a stop, bring once the unapplied proposals for where a fact is kept from the records this work touched, with place and wording; apply those the user approves.',
      '`.castwork/local/setup.md` if it exists',
      'at the end, what is done and who accepted it, what was not assessed, how the work departed from the request, and what is blocked on what.',
      'If the last assessment was blocking and the current candidate has none, say so with the risk as you close it.',
      'When the user accepts a failing check, change the requirement to exactly what they accepted, citing their decision and keeping the failed evidence: a disposition is a decision, not a check that passes.',
      "If you find yourself changing the result, running its declared checks, or writing an entry under another role's actor, you have changed roles without saying so.",
      'An instruction narrows only what it names. Dropping a planned review or check that no requirement or working policy demands is your choice, to tell the user with its risk; a required one stays until the user changes it.',
      "When the user's instructions exclude delegation, take the roles yourself whatever the task's size, and say how you read an instruction that may exclude it before you start any agent.",
      'check that the name resolves where you start it, such as the directory the host finds agents from.',
      "where the thinker's plan names the checks a step needs, the brief carries them.",
      'where a writer shares its checkout, give it its own copy instead.',
      'a fix that brings a new defect of the same kind or next to it, even as findings shrink,',
      'which a pass in isolation does not explain',
    ], 'coordinator');
    assert.doesNotMatch(coordinator, phrase("the thinker's where judgement went into it"), 'the coordinator does not decide for itself whether a recommendation needed the thinker');
    assert.doesNotMatch(coordinator, phrase('Recommend an answer for each'), 'at a stop the recommendation is the thinker\'s, not the coordinator\'s own');
    all(role(host, 'thinker'), [
      'Say which checks each step needs: focused ones while a correction is under way, where the working policy allows, and the declared ones on the final candidate.',
      "Name the user's calls the plan foresees, as defined below, each with one recommendation, so the user is asked once, when the plan is agreed; settle the rest yourself as the work unfolds.",
      'A stop you set returns the work to you to re-plan, and goes to the user only where what follows is their call.',
      "When the path stops converging and the way out is the user's, such as deferring a requirement, recommend it then rather than planning another round around it.",
      'When fixes keep exposing defects next to the last one, name the rule they share and what depends on it, and frame one correction that covers it.',
      'Where the evidence allows, settle the steps that follow too, so they need no new question.',
      'Say whether the path needs the user.',
      "For each call that remains, give one recommended answer in the user's terms, what changes for them and the risk and cost, which the coordinator can bring as it is, keeping the technical terms in the record; if none remains, say so plainly.",
    ], 'thinker');
    all(entry(host), [
      "When the user's instructions exclude delegation, take the roles yourself whatever the task's size",
      "When that work will need the user's calls along the way, ask for the whole path in the same request: what is already authorized and the calls it will need, from the thinker's plan where there is one.",
      'The coordinator role says how to delegate, when to take a role yourself, and who answers which question; this command says how to orient, continue, pause, and route a role to another host.',
      'Date it from the clock',
      'Check what it says about a candidate against `task lint` before you write it.',
      'A working-policy line naming a model or host for a role is not a route: `castwork.json` sets those, through `role_routes`, `role_settings` and `role_levels`.',
    ], 'entry');
  });

  test(`${host} the user is brought only their calls, and the thinker decides the engineering ones`, () => {
    for (const content of [role(host, 'coordinator'), entry(host)]) {
      all(content, [
        "**Bring the user only their calls.** These are the user's: what the work delivers, such as its scope, acceptance or product direction, including dropping or deferring a requirement;",
        'what cannot be undone or leaves the project, such as changing real data, deleting what the work did not create, or pushing, publishing or releasing, unless the working policy allows it;',
        'spending or access beyond what is agreed; what only they know or hold; and whatever the working policy reserves.',
        "Everything else is engineering: the approach, a compatibility correction, a fix to an instrument or a test, another round within the work's scope, how to read a condition.",
        'The thinker decides what needs an argument, as `Who answers a question` says; carry out its decision and tell the user what was decided.',
        'Where the working policy names a second reviewer for such calls, ask it as well as the thinker; the thinker combines both views and decides where they differ.',
        'An instruction on how the user wants to be consulted outlives the session only once it is written down: in the reply where they give it, propose it for `## Working policy` in `.castwork/project.md`, in their words, and say that until they approve the line it holds for this session only. Carry on under it meanwhile: the work never waits on that answer.',
      ], 'coordinator');
      assert.doesNotMatch(content, phrase('Ask the user when the work goes beyond what they asked for'), 'the user is asked for their calls, not for anything not named');
    }
    all(role(host, 'thinker'), [
      'Their calls are what the work delivers, such as its scope, acceptance or product direction, including dropping or deferring a requirement;',
      'what cannot be undone or leaves the project; spending or access beyond what is agreed; what only they know or hold; and what the working policy reserves.',
      'Everything else is engineering, and yours to decide: decide it rather than turning it into a question,',
      "and weigh a second reviewer's view when you are given one, saying where you differ and why.",
      "A choice that changes future work is recorded, as a decision record when it outlives the task: how long it lasts decides where it goes, not who makes it, and only the user's calls go to them.",
    ], 'thinker');
    assert.doesNotMatch(role(host, 'thinker'), phrase('A choice that changes future work is a decision for the user'), 'a durable engineering choice is not the user\'s for being durable');
    assert.doesNotMatch(entry(host), phrase('relay its open questions to the user'), "a delegate's questions are routed like any other");
    assert.doesNotMatch(entry(host), phrase('ask the user where it lives'), 'a lasting plan has a default home');
    all(entry(host), [
      'Ask only for the user\'s calls, as the coordinator role lists them, such as a description that leaves open what the work delivers, or a step that cannot be undone.',
      'When the user says to continue, carry on with the step you proposed and what the records and the plan name after it; ask again only for their calls.',
      'Your own bookkeeping, such as Current state, statuses, and reconciling the records with the workspace, needs no permission.',
    ], 'entry');
  });

  test(`${host} entry command carries the coordinator role, so a coordinator started from it needs no separate read`, () => {
    const text = entry(host);
    all(text, ['Read `coordinator`, unless this command carries its text under `## Coordinator`'], 'entry');
    const start = text.indexOf('\n## Coordinator\n');
    assert.ok(start > text.indexOf('### Routes from this host'), 'the coordinator follows the routes');
    const section = text.slice(start);
    all(section, [
      'You keep the work moving and the user informed.',
      '### Who answers a question',
      '### While roles run',
      '### Procedures',
      '`decision-capture`',
    ], 'entry coordinator');
    assert.doesNotMatch(section, /^# /m, 'the role sits under the command, one heading level down');
    assert.doesNotMatch(section, /^Procedure skills:/m, 'the procedure line is replaced by the linked list');
    assert.ok(!section.includes('<host>'), 'the host id is written in');
    if (text.includes('## Argument')) assert.ok(text.indexOf('## Argument') > start, 'the argument still closes the command');
  });

  test(`${host} roles choose a shape before work starts, where the choice is made`, () => {
    const coordinator = role(host, 'coordinator');
    all(coordinator, [
      'Decide what happens next, which role does it, in what shape, and on which host',
      'Choose a shape before each batch; shapes combine, and none is a loop to repeat:',
    ], 'coordinator');
    const shapes = coordinator.indexOf('## Choosing the shape');
    const delegating = coordinator.indexOf('## Delegating');
    assert.ok(shapes >= 0 && delegating >= 0, 'both sections are generated');
    assert.ok(shapes < delegating, 'shapes come before delegating');
    all(role(host, 'thinker'), [
      'which steps are independent and can proceed in parallel, alternatives worth trying',
    ], 'thinker');
    all(entry(host), [
      'Before anything starts, choose its shape from the `coordinator` role file.',
      'Straight through is the default for small, clear work.',
      'Name the shape when you announce what starts.',
    ], 'entry');
  });

  test(`${host} entry command stays out of named roles, orients once, and knows how to pause`, () => {
    all(entry(host), [
      'You already have this text; do not load the `castwork` skill again.',
      'Orient in proportion to the request, and only once',
      "Judge it from where the work is meant to finish, such as a phase's acceptance: what still stands between here and there, what the rest waits on, and whether recent rounds and decisions moved that or only the work around it.",
      "When records keep moving and the work's finish does not, say so and propose what would move it, such as running the acceptance check, or asking the user to close a task whose further rounds would not.",
      'A running role is no reason to end your turn.',
      'enough to locate the work, not the whole document',
      'If it is missing, empty, or still the scaffold `setup` wrote, in whole or in part, say so and offer to have the `thinker` draft it',
      "what is written there changes only with the user's say-so",
      'ask only when the gap affects the work',
      'A subagent started by name already has its role: do not tell it to read its role file',
      "says the role's model does not pick skills itself",
      'Delegation is one level: a role you start starts no agents.',
      'When you run the roles, statuses are yours',
      'When lint shows the requirements met, set the record `done`.',
      'a task can go straight from a worker to done when its requirements allow',
      'Give each parallel verifier lens its own actor name',
      'count on them only in a new session',
      'Claude Code reloads role files in an existing `.claude/agents/` for the next role it starts',
      'A brief adds only what the record does not say',
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
      'A handoff goes where the user or the project says; otherwise to `.castwork/local/handoff.md`, which stays on this machine and outside snapshots.',
      'name the commit it starts from when there is one, and name task records by id rather than copying their state or evidence.',
      "including another session's work still in flight.",
      'When you wrote no handoff and continuing needs context the records do not capture, say in a line what it is and offer one.',
      'A handoff does not reach another machine or person',
      "After the records, read the handoff the user gives you or the project's documents name; otherwise `.castwork/local/handoff.md`, if it exists.",
      'It records what the user authorized and grants nothing',
      'Leave it in place for the next handoff to replace.',
      'Then read `.castwork/local/setup.md`, if it exists: facts about this machine, such as local paths, ports, and wrappers, kept out of the repository.',
      'A fact about this machine that will still hold next time belongs in `.castwork/local/setup.md`, not in the handoff: propose it with the other proposals for where a fact is kept, and point to that file rather than repeating it.',
      "Before the capability runs, tell the user in a line which role you are handing to which host's CLI",
      "states the delegate's actor, `<role>@<route host>`",
      'leave no copies of a brief or plan in the repository',
      'repeats the role and the settings flags',
      "with the CLI's own path or permission rules",
      'No other role writes to the same checkout during a routed write.',
      'Take a snapshot before it starts',
      'A snapshot stays in its clone.',
      'send the base commit and `git diff --binary --no-textconv <base> <sha>`',
      'identical content gives the identical `tree:` sha',
      'A snapshot is not a general way to hand work between hosts.',
      "Read and lint what the delegate wrote, and answer its open questions as the coordinator's `Who answers a question` says, before starting work that depends on it.",
      'A plan that must outlive the session goes in the task record body, where the thinker writes plans, unless the working policy names another place.',
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
    'An agent working alone sets status itself with `npx --no castwork task set`, and `done` only once `task lint` shows the declared requirements met.',
    '`done` does not wait for a verdict',
  ], 'task-record-contract');
  all(skill('blocked-state'), [
    'tear down what you started, such as a server or a container; if something must keep running, say what and why.',
    'working alone, you set it yourself',
    'A failed check, blocking verdict, or stopped workflow does not itself mean no authorized next step remains.',
    'Record genuine external blockers promptly; consider permitted diagnosis or independent work while execution is blocked, and honor explicit stops.',
    "A workflow's termination returns the problem to the agent running it, like a role's return; it does not decide that all work must end.",
    'pursue diagnosis within existing authority',
    'Diagnosis using information and resources already authorized for the task needs no further approval.',
    "A proposal grants no authority of its own: a fix or another run within the work's scope is an engineering call, and access and spending keep their existing boundaries.",
    'Honor explicit owner budgets; do not invent a retry count as the reason to stop.',
    'only the calls that are theirs: what the work delivers, what cannot be undone or leaves the project, spending or access beyond what is agreed, what only they know or hold, and what the working policy reserves.',
    'Everything else is an engineering call, settled without them.',
    'Give a recommended answer for each of their calls in their terms, what changes for them and the risk and cost, and keep the technical terms in the record.',
    "When a coordinator runs the roles, a choice reaches the user with the thinker's recommendation, and a path the thinker finds within current authority is taken, not asked about.",
    'Prepare what existing authority permits before asking',
    'Keep temporary proposals in the task body; use a separate decision record only when the choice outlives the task, and distinguish a proposal from an accepted owner decision.',
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
  all(skill('verification-evidence'), [
    'A snapshot exists only in the clone that took it',
    '`candidate.moving_ref`',
    "Resolve a declared check to the project's actual invocation: working directory, paths, flags and selection.",
    'a narrower or modified command is a different check and leaves the declared one unmet.',
    'Matching baseline failures may establish non-introduction; they do not establish the cause.',
    'Do not require a fresh baseline run for every check or silently spend another run allowance.',
    'A pass in isolation shows a failure did not reproduce; it does not explain it either.',
    'it does not identify work kept in ignored paths',
  ], 'verification-evidence');
  all(skill('decision-capture'), [
    "An owner's choice that settles only this task's next step, such as whether to try again, goes in the task, quoted and dated.",
    "**Whose decision it is.** Quote the owner's words and date them.",
    'A reason, condition, or alternative you add is yours: say so.',
    "A condition that returns the work to the owner is a stop you schedule; add one only where what follows is the owner's call, and let any other stop return the work to the agent doing it, or to the thinker when a coordinator runs the roles.",
    "An owner's instruction on how they want to be consulted belongs in the working policy in `.castwork/project.md`, in their words, rather than in one record: propose the line, and it lasts beyond the session once they approve it.",
    'If their answer could select more than one option, ask before you record it.',
  ], 'decision-capture');
  all(skill('task-record-contract'), [
    'When the owner accepts a check that fails, change the requirement deliberately to exactly what they accepted. When they waive the whole check, remove it.',
    'When they accept known failures within it, replace it with a narrower check under its own name that excludes exactly those and still has to run and pass on the candidate, so a new failure still shows.',
    'Cite their decision under `## Blockers and decisions` and keep the failed evidence. A disposition is a decision, not evidence: declare no check that passes by restating it.',
  ], 'task-record-contract');
});

test('generated guidance keeps archives explicit, Current state with the coordinator and findings bounded', () => {
  for (const host of HOSTS) {
    for (const content of [entry(host), role(host, 'coordinator')]) all(content, [
      "Archiving is explicit: `task archive <id>` moves earlier candidates' entries to a paired archive when those lists make a record hard to work with.",
      'review `## Current state` against the record and its archive and refresh it before substantive work',
      'propose separate tasks linked by `depends_on` for independently finishable parts',
      'never a mechanical split or by size alone',
    ]);
    all(role(host, 'verifier'), ['the contract item, observation and location, and why it blocks or accepts', 'not every file read or a restatement of earlier rounds']);
    all(role(host, 'coordinator'), ['Current state is yours', "from the roles' reports", 'or assign its update to one role, never two at once', 'it grants nothing', 'A brief adds only what the record does not say', "no check broader than the working policy's cadence for that step"]);
    for (const content of [entry(host), role(host, 'coordinator')]) assert.ok(!phrase('for a task you will work on over 100 KB run').test(content), `${host} still asks to archive every large record`);
  }
  all(skill('assessment'), ['the contract item, observation and location', 'Not a walk through every file read or a restatement of earlier rounds']);
  all(skill('verification-evidence'), ['A routine successful probe is a sentence in the body, or nothing', 'Snapshots leave that folder out, so writing there never changes a candidate.']);
  all(skill('task-record-contract'), ["written from the roles' reports or assigned to one role at a time", '`task archive [<id>] [--check]`']);
});

test('the skill description keeps a role started by name from loading the entry skill', () => {
  assert.match(readCommand().skill_description, /Not for a thinker, worker, or verifier that was started by name\./);
});

test('a routed role is listed with the actor it records', () => {
  const [routed] = generateHost('claude', {
    routes: [{ role: 'thinker', host: 'codex', label: 'Codex', role_file: '.codex/agents/thinker.toml', settings: {} }],
  }).filter((file) => file.path === '.claude/skills/castwork/SKILL.md');
  assert.match(routed.content, /`thinker` runs in Codex \(`codex`\)\. Role file: `\.codex\/agents\/thinker\.toml`\. Actor: `thinker@codex`\./);
});

test('report-first guidance prevents loading large entry lists just to discover record size', () => {
  for (const host of HOSTS) {
    for (const id of ROLES) {
      const content = role(host, id);
      assert.match(content, phrase('file size without loading its contents'), `${host} ${id}`);
      assert.match(content, phrase('before reading the task record'), `${host} ${id}`);
      assert.match(content, phrase('section-only reads on large files'), `${host} ${id}`);
    }
    assert.match(entry(host), phrase('file size without loading its contents'));
    assert.match(entry(host), phrase('before reading the task record'));
    assert.match(entry(host), phrase('section-only reads on large files'));
  }
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

for (const host of HOSTS) {
  test(`${host} every role finds this machine's setup facts, and support goes in .castwork/findings/`, () => {
    for (const id of ['thinker', 'worker', 'verifier']) {
      assert.match(role(host, id), phrase('`.castwork/local/setup.md`, if it exists, for facts about this machine'), id);
    }
    assert.match(role(host, 'verifier'), phrase('Read `.castwork/project.md` for the policy and the commands its checks name'));
    for (const id of ['worker', 'verifier']) {
      const content = role(host, id);
      assert.match(content, phrase('not ignored scratch or `.castwork/tasks/`'), id);
      assert.match(content, phrase('in `.castwork/findings/`, named after the task'), id);
    }
    assert.match(role(host, 'worker'), phrase('A file the task delivers, or a script a declared check runs, is part of the candidate: never there.'));
    all(role(host, 'worker'), [
      "pointing to the project's own documents when it needs more than a line and saying what they hold and when to read them",
      "the host's user-level instructions or a user skill when it holds beyond this project",
      "When the cause is a role's or a skill's own guidance, propose the change for the repository that guidance comes from, never as an edit to its generated copy.",
    ], 'worker');
    all(role(host, 'thinker'), [
      "When the cause is a role's or a skill's own guidance, the change is proposed for the repository that guidance comes from, never as an edit to its generated copy here.",
      'Asked for an audit, or a review of how the work went, audit the work, not a candidate',
      'and its report in `.castwork/findings/`.',
    ], 'thinker');
    assert.match(role(host, 'coordinator'), phrase('about fifteen lines, what holds now first and attribution after, which `report` shows,'));
  });
}

test('the procedure skills send supporting files to .castwork/findings/ and open Current state with what holds now', () => {
  for (const id of ['assessment', 'task-record-contract', 'verification-evidence']) {
    const body = skill(id);
    assert.match(body, phrase('not ignored scratch or `.castwork/tasks/`'), id);
    assert.match(body, phrase('write it in `.castwork/findings/`, named after the task'), id);
  }
  assert.match(skill('task-record-contract'), phrase('Open with what holds now; who wrote it and when go after, since the first paragraph is what `report` shows.'));
  assert.match(skill('task-record-contract'), phrase('a file the task delivers, or a script a declared check runs, never goes there: it is part of the candidate.'));
  assert.match(skill('verification-evidence'), phrase('A script a declared check runs is part of the candidate, never there: a reviewer extracting the candidate must have it.'));
});
