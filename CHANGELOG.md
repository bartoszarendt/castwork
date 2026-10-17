# Changelog

## Unreleased

- The thinker also reviews completed work, such as a finished phase or an
  abandoned attempt. It starts from `report`, the records, their findings and
  the decisions they cite, and reads session transcripts only when the request
  names them. It separates observations from inferred causes, states material
  evidence gaps, says what helped as well as what caused avoidable rework, and
  proposes only changes the evidence supports, each with how later work would
  show whether it helped. The report goes in `.castwork/findings/`. Reviewing
  an active blocker stays diagnosis.
- The coordinator offers such a review in one line at the end when a phase
  reached its acceptance, work was cancelled or stopped after rounds that did
  not converge, or a shape or level had its first deliberate trial in the
  project. It starts the review without asking where the working policy says
  to, and never offers one after ordinary tasks or during a pause.
- A plan for later work cites an earlier review's findings when they bear on
  it, with the changes to use and how the work will show whether they helped.
- Castwork never assumes a skill outside its own exists. Its guidance
  describes what a step needs, not which skill provides it: a role uses a
  skill its host exposes when its description fits, and works from Castwork's
  guidance alone when none does.
- At the end or a stop, the coordinator checks each open proposal for where a
  fact is kept against its source, keeping a cause that is not established
  worded as unresolved, and applies those for `.castwork/local/setup.md`, for
  `## Setup facts` in `project.md`, and for a `## Checks` line naming a new
  check itself, correcting a line rather than adding a second one, and says
  what it added. Proposals for `## Working policy`, and those that change what
  a named check runs, still wait for the user's approval, since the second
  changes what every task requiring that check accepts. Those for a place
  outside the project, such as the repository a role's guidance comes from,
  are the user's to take there. Before, every proposal waited for the user.
- A cause in how a Castwork command behaves is proposed for the Castwork
  repository, like a cause in a role's or a skill's guidance, and a workaround
  kept in the project meanwhile says whose defect it works around.
- A user's decision binds what they committed to, such as an outcome, a
  guarantee, a risk they accepted, or a scope, and a method only where they
  chose it themselves or a declared requirement or the working policy demands
  it. Approving a decision that names the agents' method does not make that
  method the user's. The thinker frames the user's calls at the commitment,
  decision-capture records the commitment apart from the method and whose
  choice the method was. A method the agents chose, which no declared
  requirement or working policy demands, may change when the replacement keeps
  or tightens the commitment within existing authorization: an engineering
  call, recorded citing theirs, in the task when it settles only that task and
  otherwise in a decision record. One that weakens the commitment still goes to the user. Before, a check or proof named
  in an approved decision could only be changed by asking the user again.

## 0.9.11

- The user is brought only their calls, and the guidance now says which those
  are: what the work delivers, such as its scope, acceptance or product
  direction, including dropping or deferring a requirement; what cannot be
  undone or leaves the project, such as changing real data, deleting what the
  work did not create, or pushing, publishing or releasing, unless the working
  policy allows it; spending or access beyond what is agreed; what only the
  user knows or holds; and whatever the working policy reserves. Everything
  else is engineering: the approach, a compatibility correction, a fix to an
  instrument or a test, another round within the work's scope, how to read a
  condition. The thinker decides it, the coordinator carries it out and says
  what was decided, and a proposal is no longer read as needing the user for
  a fix or another run within the work's scope.
- Where the working policy names a second reviewer for such calls, such as
  another host's agent, the coordinator asks it as well as the thinker; the
  thinker combines both views and decides where they differ.
- A stop a plan sets returns the work to the thinker to re-plan, and reaches
  the user only where what follows is their call. The thinker's plan names the
  user's calls it foresees, each with one recommendation, so the user is asked
  once, when the plan is agreed; when the path stops converging and the way
  out is the user's, such as deferring a requirement, it recommends that then.
  `decision-capture` says the same of a condition written into a decision;
  used without a coordinator, such a stop returns the work to the agent doing
  it.
- A choice that changes future work is recorded where it lasts, as a decision
  record when it outlives the task; how long it lasts decides where it goes,
  not who makes it. Only the user's calls go to them.
- A routed delegate's open questions are answered as the coordinator's
  `Who answers a question` says, instead of being relayed to the user, and a
  plan that must outlive the session goes in the task record body unless the
  working policy names another place, instead of asking the user where.
- A question reaches the user in their terms: what changes for them, the risk
  and cost, and what proceeds after their answer. The technical terms stay in
  the record, and the answer adopts them.
- An instruction on how the user wants to be consulted outlives the session
  only once it is written down: the coordinator proposes it for
  `## Working policy` in `.castwork/project.md`, in the user's words, in the
  reply where it is given, and says that until the user approves the line it
  holds for that session only. The work carries on under it meanwhile and
  never waits on that answer. `project.md` still changes only with the user's
  say-so, so a user can keep such an instruction to one session.
- After a bare `/castwork`, the user saying to continue carries on with the
  proposed step and what the records and plan name after it. The
  coordinator's own bookkeeping, such as Current state, statuses and
  reconciling the records with the workspace, needs no permission.
- A running role's question about whether a stop rule applies goes to the
  thinker, like any other condition read one way.

To pick up the guidance, move the Castwork pin and lockfile to this version, or
run a local checkout as `node <checkout>/bin/castwork.js` in place of
`npx castwork`; `update` regenerates from the copy you run and never upgrades
it. Then run `update`, commit the generated files, and start a new session.
Projects whose working policy or decisions require the user's approval for
each run keep that requirement until the user narrows it.

## 0.9.10

- `.castwork/local/castwork.json`, gitignored with the rest of
  `.castwork/local/`, chooses the models this machine's roles run on without
  changing the project's configuration. It is the user's: `update` and
  `remove` never write or delete it. It holds `role_settings` and `role_levels` only,
  set over the project's key by key and checked the same way; `null` clears a
  setting the project pins. Hosts, routes, permissions, and new levels stay
  the project's and are refused.
- `update` writes this machine's models into the generated files while
  `.castwork/generated.json` keeps the project's digests, so the tracked
  manifest is the same on every machine. `.castwork/local/generated.json`
  records what this machine wrote, so `update`, `remove`, and `doctor` still
  treat those files as generated. `update`, `update --check`, and `doctor`
  list them. Applying, switching, or dropping this machine's models is never
  advice to commit. Where the host folders are gitignored, Git sees nothing;
  a listed file Git does not ignore is marked to be left out of commits.
- Whether anything is left to commit is judged against the last commit,
  not the manifest on disk: a role file whose model the project adopted from
  this machine is named to commit with the manifest, and dropping local
  models over an uncommitted project change still says to commit.
- `update --shared` writes the project's output alone, never reading
  `.castwork/local/castwork.json`, so a stale override cannot stop it. Where
  generated files are tracked and the project's output changes under a file
  carrying this machine's models, `update` and `doctor` name it: run
  `update --shared`, commit, then `update`, so the committed manifest and
  files agree and a clone does not refuse to update.
- `doctor` asks Git whether `.castwork/local/castwork.json` is ignored and
  untracked, so a `.gitignore` that no longer covers `.castwork/local/`, or a
  file committed earlier, is reported.
- To adopt: write `.castwork/local/castwork.json` and run `update`. `setup`
  already gitignores `.castwork/local/`, so nothing else changes; without the
  file, nothing changes at all.

## 0.9.9

- A choice put to the user carries the thinker's recommendation, not the
  coordinator's own. Who decides is still the user's; which option to
  recommend, and whether the user needs asking at all, are the thinker's to
  answer first. A permission with no alternative, such as a command only the
  user can run, and a fact only the user holds still go straight to the user.
- A stop that leaves a choice the thinker's plan does not already settle, such
  as between ways forward or whether to accept a shortfall, goes to the thinker
  before the user. A branch the plan settles proceeds as planned, and an
  explicit stop is honoured as before. When the thinker's
  path stays within current authority, the coordinator takes it and says so,
  without asking whether to proceed; only what lies beyond comes to the user,
  once.
- A running role's question is routed the same way: the coordinator answers
  what is written and grants within the role's scope, and sends a limitation
  to accept, a condition to read one way, or a design to choose to the thinker
  before replying. A role that cannot wait stops its round cleanly and resumes
  with the answer.
- The coordinator looks for authorization in the decisions and records before
  asking for it. A brief of its own that contradicts a recorded decision the
  user has not narrowed since is corrected with a new brief rather than taken
  to the user again; a newer restriction from the user still holds.
- The thinker says whether its path needs the user: each decision with one
  recommended answer and wording to bring as it is, or plainly that none is
  needed. `blocked-state` says the same for coordinated work.
- The role preset line limit is 150 for all four roles, up from 125.

To pick up the guidance, move the Castwork pin and lockfile to this version, or
run a local checkout as `node <checkout>/bin/castwork.js` in place of
`npx castwork`; `update` regenerates from the copy you run and never upgrades
it. Then run `update`, commit the generated files, and start a new session.

## 0.9.8

- `role_levels` in `castwork.json` can give the thinker, worker, or verifier a
  `simple` or `complex` variant beside the role itself, which is `standard`:
  the same role with other model settings, for assignments that need a cheaper
  or a stronger model. A repository without it gets no variants or level
  lists; the new guidance below reaches every entry command and role.
  - A level is a complete setting set under the host's own names: it must name
    its `model`, and nothing of the role's own model settings is carried into
    it. `permission_mode` stays with the role. A `standard` or `coordinator`
    entry, an unknown level, and a level without a model are refused with a
    hint. `validate` warns when a level leaves an effort setting to the host,
    which can pair the model with an effort chosen for another.
  - Each level is generated as `<role>_<level>` beside the role, such as
    `.claude/agents/worker_complex.md`, with the role's body and one line:
    an agent launched as it, or a fresh routed process given the file and its
    listed settings, runs at that level and records `level`; its actor names
    its role, never the variant; and reading the file in a session already
    running establishes no level. The entry command lists the levels after
    the routes, the generated coordinator closes with them, and a route lists
    each level's role file and settings for the routed role.
  - The thinker's plan names a level per role with a reason. Without a plan the
    coordinator may choose `complex` itself when the difficulty is evident,
    never `simple`. The verifier's level follows how hard the candidate is to
    verify, not the worker's level. A level is raised only with a stated reason,
    and a level the user names comes first. An agent is resumed only at its
    own level; changing level starts the chosen variant under the same actor,
    unless the host has been seen to apply every setting of the new level to
    the running agent, which is then told its level. The procedure is the entry
    command's new `## Levels` section; the coordinator's "Do not assign a
    model" is replaced by a pointer to it.
  - A level changes which model runs and nothing else: requirements,
    independence and permissions are as they were.
- Candidates, evidence and assessments take an optional `level`, written by an
  agent whose role file names one. `task add` accepts `simple`, `standard`, or
  `complex`. An omitted level means unrecorded, never `standard`.
- `report` counts entries by kind and recorded level in `quality.levels`, with
  unrecorded and unrecognized values apart, and project text shows a Levels
  line once any entry records one. Round and rework counts are unchanged.

To use levels, add `role_levels` to `castwork.json`, run `update`, commit the
generated files, and start a new session.

## 0.9.7

- A fact that outlives its task is kept where it holds, with no new record
  kind. The thinker and worker propose the place in the task record:
  - a line in `project.md` for this repository, pointing to the project's own
    documents for detail and saying what they hold and when to read them;
  - `.castwork/local/setup.md` for this machine only, never `project.md`;
  - the host's user-level instructions or a user skill for a quirk beyond the
    project, which Castwork does not keep;
  - the repository a role's or skill's guidance comes from, when that guidance
    caused it, never the generated copy.

  A choice that changes future work is a decision, and a finding about one
  candidate stays in its assessment. `docs/record-format.md` has the table.
- The coordinator brings the open proposals once, at the end of the work or
  at a stop, and applies those the user approves. Before, they stayed in the
  records they were written in.
- `.castwork/findings/` sits beside `tasks/` and `decisions/` for what is
  written about the work and linked from records, such as review notes,
  findings, run logs, and reports of how the work went. Each file is named after
  its task, such as `T-012-review.md`.
  - `setup` creates the folder, `remove` never touches it, and nothing parses
    it. `setup` refuses, writing nothing, when a file stands where it or any
    other state directory belongs.
  - A snapshot leaves it out, as it leaves out `tasks/`, so a verifier writing
    its findings after the candidate exists does not change it.
  - For the same reason it never holds the work. A file the task delivers, or
    a script a declared check runs, is part of the candidate, so a reviewer who
    extracts the candidate has it.
  - Support never goes in ignored scratch or `.castwork/tasks/`.

  Three projects had each improvised such a place: `.castwork/reports/`,
  `.castwork/findings/`, and links into a gitignored `tmp/`. A review of how
  the work went is a task whose result is findings, and its report goes in this
  folder.
- `/castwork` and every role read `.castwork/local/setup.md` when it exists. A
  handoff points to it rather than repeating facts about the machine that will
  still hold next time. The `project.md` scaffold asks for one line per setup
  fact and names that file for local facts.
- `## Current state` opens with what holds now, and attribution goes after it,
  since the project `report` shows its first paragraph.
- `doctor` warns when a written `project.md` grows past 12 KB, since every role
  reads it.
- Before saying where a candidate stands, the coordinator reads `task lint`.
  `report` refreshes what was recorded, not whether the files in front of it
  are still that candidate.
- The project `report` reads in the order a person needs:
  - Attention, where each row names its title and shows the first paragraph of
    its `## Current state`, falling back to the Blockers excerpt;
  - Recent, one line per record and day with its title;
  - Decisions;
  - Rework and Record quality condensed to their totals.

  JSON gains `title`, `current_state` and `current_state_pointer` on Attention
  rows and otherwise keeps every field and entry. The most failed declared
  checks are ranked by count, also when check names look like integers.
- `docs/cli.md` says what a fresh report establishes, how large the JSON gets
  on a large project, and how to take only the fields you need.
- A Markdown file without frontmatter among the records now says that a file
  that is not a record, such as findings or a log, belongs outside the records
  directory.

## 0.9.6

- `main(argv, { cwd })`, exported from the package root, takes an optional
  project root, as `run` already did; without it the command still reads the
  working directory.
- `task-record-contract` covers criteria that something stays unchanged: the
  five questions such a criterion settles when it is written, an example, and
  what a missed capture step means. Most tasks need none.
- A coordinator's brief that limits what a role may write names each kind of
  write it allows, and asks for every file written, scratch included, in the
  return.
- The thinker plans a check of a changed candidate against a runtime or
  real-data target it can move before the final declared checks.
- A running role is no reason for the coordinator to end its turn: a new
  `## While roles run` section says what it does meanwhile without waiting on
  the role's result or touching its candidate, files, or the environment its
  checks use, and that it lets the host wake it, or follows the delegation
  capability's monitoring procedure where the host cannot.
- Orientation judges where things stand from where the work is meant to
  finish, such as a phase's acceptance, and a bare `/castwork` says when records
  keep moving and that finish does not, proposing what would move it.
- The coordinator treats rounds spent around an acceptance check that never
  runs as a stall, has a costly failure reproduced cheaply where practical
  before paying for another run, settles the cause before asking, and asks for the remaining path
  in one request rather than a decision per failure.
- The coordinator resumes the same worker or verifier for its next round where
  the host can, starting a fresh one when its context is spent or a fresh view
  is the point.
- The verifier tries to break a candidate with inputs its evidence does not
  cover where the risk warrants and authorization allows, and confirms in an
  extracted copy that a test offered as evidence of a fix fails without it, or
  names that as a limit.
- The generated entry command carries the coordinator role's text, one
  heading level down, after its routes. A coordinator started from `/castwork`
  was told to read its role file, and some never did. The Claude Code plugin
  still installs `commands/start.md` as written and reads the role file.
- `commands/start.md` no longer repeats the coordinator role: role-taking,
  delegation, when to ask the thinker, diagnosis boundaries, statuses, actors
  and boundaries come from the coordinator text, and the entry keeps
  orientation, continuing, CLI use, updates, pausing and role routes. The
  plugin's `castwork:thinker` prefix moved into the coordinator. A generated
  Pi prompt is about 29,000 characters rather than 36,000.
- A new `## Who answers a question` section in the coordinator: traffic is the
  coordinator's, and so is a question it can answer by pointing at something
  written or settle with a quick read-only look. Delegating now refers to this
  section instead of keeping its own rule for when to ask the thinker. A
  question that needs an argument about the work goes to the
  thinker, gathered into one request. Only what needs the user goes to them,
  with one recommendation and never "ask the thinker" as their option. The
  thinker's answer covers the steps it names, and asking it hands over that
  question, not the coordination. A role's finding that would change what is
  asked of the user, such as a cost, is checked once before it is relayed.
- The coordinator asks for the remaining path when it proposes the work, from
  the thinker's plan where there is one, and does not ask the same question
  again. It reads `task lint` or `report` before saying where a candidate
  stands. Its end report says who accepted what, what was not assessed, and
  how the work departed from the request.
- The user's current instructions come before the task record for the
  coordinator. For the thinker, worker, and verifier, limits from a brief or the
  user, such as what they may write, run, or spend, bind even where the record
  describes more; the rest of a prompt stays background. An instruction narrows
  only what it names: the coordinator may drop a planned review or check that no
  requirement or working policy demands, telling the user the risk, and a
  required one stays until the user changes it. When the user's instructions
  exclude delegation, the coordinator takes the roles itself whatever the
  task's size. Running a declared check, or writing an entry under another
  role's actor, is changing roles.
- A failing check the user accepts changes the requirement to exactly what
  they accepted, citing their decision and keeping the failed evidence: a
  waived check is removed, and accepted known failures become a narrower check
  under its own name that still runs and passes, so a new failure still shows.
  No substitute check passes by restating the disposition. Closing a task whose
  last assessment was blocking, with no assessment of the current candidate,
  is said to the user with its risk.
- An owner's choice that settles only one task's next step is recorded in that
  task, quoted and dated; a decision record is for what outlives the task.
  `decision-capture` keeps the owner's words apart from reasons or conditions
  an agent adds, and treats a condition that returns the work to the owner as a
  scheduled stop.
- The thinker's plan says which checks each step needs and where the user's
  permission will be needed along the path. When fixes keep exposing nearby
  defects, it names the rule they share and frames one correction. Its answer
  settles the steps that follow where the evidence allows.
- Fewer findings each round is no sign of convergence while each fix brings a
  defect next to it, and an intermittent failure that passes in isolation is
  not explained by that pass. A snapshot does not identify work kept in ignored
  paths.
- The verifier gets its own copy when a writer shares the checkout, rather
  than limits on what it runs; a brief carries the checks the thinker's plan
  names for a step.
- A working-policy line naming a model or host for a role is not a route; the
  coordinator says so and offers to move it to `castwork.json`.
- `castwork task --help` and `castwork decision --help` print the command list
  instead of refusing the group's name.
- All four role presets share a 125-line guidance limit.
- `docs/pi-setup.md` notes three `pi-subagents` behaviours: agents are found
  from the run's working directory, a next round resumes with
  `subagent({ action: "resume", id, message })`, and a run stops after 30
  minutes unless `options.timeoutMs` raises it.

## 0.9.5

**Record integrity**

- `task set` no longer damages records. It matched the field name as a pattern,
  so `a.` replaced an unrelated `ab:` line; it read the value as a replacement
  template, so `$&` or `` $` `` copied other text in, and `` $` `` could leave
  the record unreadable; it cut a block-scalar value or a list in half; and it
  added a field with a bare LF to a CRLF file. It now matches the key literally,
  replaces a value's whole span, keeps the file's line endings, refuses a field
  that is not a plain name or that holds a list or mapping, and checks the new
  text in memory before writing: unless only that field changed, nothing is
  written. A record with structural errors stays editable. `task new` and
  `decision new` insert titles literally too.
- A candidate's `ref` and an entry's `candidate` keep the text written. An
  all-digit commit id such as `0123456` was read as the number `123456`, so it
  named nothing and its evidence stopped matching; a long one lost precision.
  Every other integer is still a number.
- A record whose body starts with the archive pointer, read without its
  archive, has the structural error `archive.missing`, so lint fails and `done`
  refuses instead of earlier entries dropping out in silence.
- Actors are trimmed when choosing the effective assessment, as they already
  were when comparing independence.

**Interpretation and guidance**

- `independent_review` is `unknown`, reason
  `assessment.blocking_without_actor`, when an effective `reject` or
  `needs_revision` has no `actor`: it may have come from an independent
  reviewer. As the effective-entry rules have it, only a later assessment by
  the same role, also without an actor, replaces it; a new candidate starts
  afresh.
- Lint notes `candidate.producers_changed` when an accepting actor is listed as
  a producer by an earlier entry for the same ref but not by the current one.
  Evaluation is unchanged.
- Lint without an id no longer compares the working tree with the snapshots of
  done or cancelled tasks, which differ from today's tree as a matter of
  course; it says how many it left uncompared. Their references and structure
  are still checked, and `task lint <id>` still compares one.
- Current state stays the coordinator's when roles are coordinated, and it may
  now assign the update to one role, never two at once. A coordinator's brief
  adds only what the record does not say: no status but `blocked` or
  `needs_context`, no Current state update it did not assign, and no check
  broader than the working policy's cadence for that step.
- Archiving is no longer a step for every record over 100 KB; the presets use
  it when the entry lists make a record hard to work with.
- A snapshot handed to another clone travels as
  `git diff --binary --no-textconv <base> <sha>`, so binary changes survive.
- Claude Code: `.claude/commands/castwork.md` is no longer generated, since
  the `castwork` skill of the same name takes precedence; `update` removes the
  old file unless you edited it. The entry command now says that Claude Code
  reloads role files during a session. `allowed_paths` is documented as
  checked for shape, not enforced.

**Measured conveniences**

- Added `task add <id> candidate|evidence|assessment key=value...`. It appends
  one entry with the fields the record format defines, typed and checked,
  keeping the list's indentation and the file's line endings. An evidence or
  assessment `candidate` must be a recorded ref. It fills in nothing that was
  not given; `at=now` is the CLI's clock. Editing by hand stays equally valid.
- `task set`, `task add` and `task archive` hold a lock beside the record while
  they read and replace it, and replace it in one rename, so simultaneous
  writers, such as parallel verifier lenses, all land. An edit by hand made
  meanwhile is not covered.
- `task archive` moves list entries only: the body is never moved, and the
  archive gains an `Entries moved YYYY-MM-DD` part. Verification now exempts
  exactly the two changes writing the pair makes to the selected record, its
  uncommitted state and its size note, and the Blockers pointer, a line
  number, in attention rows. On copies of the five projects using Castwork, it
  archived 28 of the 29 records over 100 KB, which had all been refused, with
  every lint outcome unchanged; 21 stay over 100 KB because their size is prose.
- Regenerate projections with `update`, then start a new host session.

## 0.9.4

- Added explicit `task archive [<id>] [--check] [--json]`: raw earlier-round
  proposals, paired archives read by all task evaluators, strict in-memory
  comparison and staged writes with change detection and archive restoration.
  A move that changes report content is refused by name and writes nothing;
  `--check` distinguishes proposed sizes from unchanged refused files.
- Optional `## Current state` stays in place with one writer. Task reports
  add Contract pointers, bounded Current state, latest section ranges and
  Archive counts; current candidate facts and requirements stay uncut.
- Lint text folds earlier-candidate undeclared-check and lint-as-evidence notes,
  retaining mixed current groups and every credential note. JSON stays complete.
- Roles write short observations and bounded findings, link durable support
  before snapshots, and refresh Current state from both files when resuming
  archived work. Regenerate projections with `update`, then start a new host
  session.

## 0.9.3

- A stop is not the end of the work. A failed check, a blocking verdict, and a
  stopped workflow no longer read as "no authorized next step remains": the
  coordinator considers permitted diagnosis or independent work, records genuine
  external blockers promptly, honors explicit stops, and honors owner budgets
  rather than inventing a retry count as the reason to stop. A workflow's
  termination returns the problem to the agent that wrote it, like a role's
  return.
- A cause must be established, not labeled. "Environmental", "flaky", "known",
  or "busy" and an owner's disposition name no mechanism: when progress depends
  on a cause not established, the coordinator investigates it, reuses a
  documented diagnosis whose evidence applies here, reaches for the thinker when
  deeper investigation or another perspective would help, and gives an
  established answer directly. An unclear criterion still needs a clarified
  record, not a retry.
- A proposal grants no authority to implement it. Diagnosis using information
  and resources already authorized for the task needs no further approval; fixes,
  access, spending, and additional runs keep their existing boundaries. The
  thinker traces a consequential stop claim to the contract and the permitted
  evidence, distinguishes a contradictory requirement from an unavailable
  prerequisite or an action not currently authorized, and looks for repeated
  repairs rather than candidate counts.
- At a stop, the coordinator reports verified state, the obstacle and its cause
  or remaining uncertainty, what can proceed, and only decisions the user owns,
  with a recommended answer and concrete approval wording carrying scope, cost,
  stop conditions, and what proceeds after approval.
- Checks run as declared. The verifier and the verification-evidence skill
  resolve a declared check to the project's actual invocation — working
  directory, paths, flags, and selection — and name the gap when it is unclear
  or cannot be run, since a scoped variant is a different check. Baseline or
  batch comparison is reused where its evidence applies, and matching baseline
  failures establish non-introduction, not the cause.
- Regenerate projections with `update`, then start a new host session.

## 0.9.2

- The thinker is no longer only a first step. Its description and preset now
  cover examining the problem and the approach during the work as well as
  before it: critiquing and replanning when a worker returns `blocked` or
  `needs_context`, diagnosing a stall or a dispute over a criterion, and
  auditing the work against the project's documents. It revises unstarted
  records only within what was asked and proposes anything more to the user;
  clarifying a criterion supersedes no assessment. Judging the approach is the
  thinker's; assessing a candidate stays the verifier's.
- The coordinator hands questions about the work or its approach to the
  thinker and candidate assessments to the verifier. A blocking finding that
  questions the work is a sign of a stall the first time; the coordinator
  resolves what the evidence answers, asks the thinker when that would help,
  and asks the user what only they can decide. A plain defect goes back to the
  worker. Nothing requires a thinker step.
- Regenerate projections with `update`, then start a new host session.

## 0.9.1

- Added read-only `report [<id>] [--json]`: project state and rework with named
  counting bases, bounded task history and recorded-prose excerpts, and decision
  views with descriptive mentions. JSON preserves omitted material and reports
  derivation coverage and problems, even on errors. Local Git is optional.
- Corrected report/lint reference and current-mapping parity, canonical section
  selection, nested logical excerpts and sub-millisecond date comparisons.
  Attention retains all blocked/context tasks beyond its ordinary-row bound;
  findings references and Blockers-cited decision mentions stay visible. Report
  reads reuse validated directories while checking every leaf and real destination.
  Report ids use the same key as `task show` and lint, so an array id and its
  scalar twin are one ambiguous id; a literal trailing `#` stays in a heading's
  title; a heading indented into a list item stays with that item.
- Documented optional candidate `host`, exact reported `model`, and recorded-at
  `at`; omit unknown models and mixed-producer attributes. No validation change.
- Roles keep `task list` for finding work and use reports for project context or
  earlier rounds; the task contract and current-candidate assessment still apply.
  Regenerate projections with `update`, then start a new host session.

## 0.9.0

**Added**

- Pi as a fourth host: four `.pi/agents/` role presets, the `/castwork` prompt
  template, and procedure references by path, with no Pi skill index, extension,
  runner, or settings file. Pi accepts `model` only, preserving
  `provider/id:thinking` suffixes in roles and routes.
- Pi's thinker, worker and verifier opt into appended prompts, project and
  global instructions, and skills under `pi-subagents`; the coordinator is the
  `/castwork` session and carries no child-inheritance keys.
- Optional adapter command `arguments`: argument-hint propagation and a closing
  Argument section. Pi uses `${ARGUMENTS:-none}`. Setup, update and validate
  refuse every other dollar sign in that command, naming its source, before
  writes. Existing hosts without this field retain their rendering contract.

**Changed**

- The coordinator preset and the entry command now say when the coordinator may
  take a role itself: the existing small-task switch to worker, and any role
  where no subagent or delegation capability can start an agent. Being started
  by another agent does not qualify. Role changes are announced, and a session
  that produced a candidate never accepts it under any actor. The verifier
  preset says the same.
- Codex's generated entry skill also carries `disable-model-invocation: true`,
  keeping it out of Pi's implicit skill catalog when both hosts are generated.
  The Codex invocation policy remains.
- `validate` reports a generation refusal with its hint, as `setup` prints it.

Run `update` and start a new host session for the new shared prose and Codex
marker. See [Pi setup](docs/pi-setup.md) for trust, optional delegation,
argument parsing, write limits, and what has not yet been checked live.

## 0.8.0

Role settings use each host's own effort control, and the generated OpenCode
files work in both OpenCode v1 and v2.

**Breaking: what to do.** The unified `reasoning_effort` setting is gone, with
no alias and no automatic conversion: a `castwork.json` that still sets it is
refused, and the refusal names the replacement for that host. Edit
`role_settings` before running `update`, then start a new host session.

- **Codex:** rename `reasoning_effort` to `model_reasoning_effort`.
- **Claude Code:** rename `reasoning_effort` to `effort`.
- **OpenCode:** remove `reasoning_effort` and choose a `variant` the model
  supports, beside an explicit `model`. A variant is a provider-defined bundle,
  not an effort level, so a same-named one need not have the same effect.

**Changed**

- Routes list every setting the route's host declares, under that host's
  names, except `permission_mode`.

**Fixed**

- OpenCode's delegated roles explicitly set `mode: all`, preserving direct and
  subagent use across v1 and v2. The entry skill sets
  `disable-model-invocation: true` for v2; v1 keeps its description guidance and
  the delegated roles' skill deny. Run `update` and start a new host session.
- OpenCode model bindings containing an inline `#variant` are refused before
  generation, with a hint to use separate `model` and `variant` settings.
- An OpenCode `variant` without a `model` is refused before generation: v2
  drops a variant whose agent names no model.
- A setting a host does not accept is reported with its place in
  `castwork.json`, and a retired `reasoning_effort` says what replaces it on
  that host.

## 0.7.1

A fix for Windows checkouts. Run `update`; nothing else changes.

**Fixed**

- **Generated files checked out with CRLF line endings no longer block
  `update`.** With `core.autocrlf=true`, Git checks tracked generated files out
  with CRLF, so a fresh clone or a branch switch made every one of them look
  modified: `update` refused, `remove` kept them, and `doctor` and `validate`
  reported them as changed by hand. Line endings are now ignored when a file on
  disk is compared with the manifest; any other change still counts as an edit.

## 0.7.0

Agentic Loop is now Castwork. Every name changes with it: the package and
command, the state directory, the configuration file, the generated skill and
entry command, and the repository. Nothing else changes.

**Breaking: what to do.** There is no alias for any old name, and nothing
recognises an installation under the old names.

- **Rename the state and configuration** — `.agenticloop/` to `.castwork/` and
  `agenticloop.json` to `castwork.json` — then run `npx castwork setup`. It
  regenerates the host files under the new names, deletes the old ones it still
  owns, and adds `.castwork/local/` to `.gitignore`. Delete the
  `.agenticloop/local/` line there yourself.
- **Replace the remaining mentions in files you own:** `project.md`, task and
  decision records, scripts, and an `agenticloop` dependency in
  `package.json`. `setup` and `update` never rewrite them.
- **The entry command is `/castwork`** (`$castwork` in Codex). Start new host
  sessions after the update.
- **The 0.4.x refusal is gone.** It looked for 0.4.x state under the old
  names, which no Castwork installation has, so `setup`, `update`, and
  `doctor` no longer check for it.

## 0.6.0

Uncommitted candidates get a checkable reference, lint says more about records
that are well formed but unlikely to mean what they say, the CLI refuses a
mistyped command before it writes, and the role presets name themselves
honestly, work alone as well as under a coordinator, and delegate one level.
Generated role, skill, and entry files change: run `update`, commit what it
lists, and start new host sessions.

**Breaking: what to do.** There is no compatibility mode or alias for the old
behaviour; each change below says what to edit.

- **A requirement key outside `requirements:` is a structural error,**
  `requirement.misplaced`. `checks`, `independent_review`, or
  `assessment_roles` at the top level of the frontmatter used to be accepted
  as an unrecognized field, and the requirement silently stopped counting.
  Such a record now fails `task lint`, and `task set <id> status done` refuses
  it. Indent the key under `requirements:`; nothing else changes.
- **Usage errors exit 2.** An unknown command, an unknown or misplaced flag, a
  switch given a value (`--check=yes`), a flag missing its value, a stray
  argument, and `task show` without an id exit 2 instead of 1. A script that treated exit 1 as "typed
  wrong" checks for 2; `update --check` still exits 1 when the installation is
  not current.
- **Unknown flags and stray arguments are refused** before anything is read or
  written. Each command takes only the flags `help` lists for it, and a
  single-dash option is refused. A flag that takes a value no longer takes the
  next flag as it: `setup --host --json` is refused rather than naming a host
  `--json`. Remove the flag or argument; an argument that starts with a dash
  goes after `--`, as in `task new -- "-x title"`, and a value that starts
  with a dash goes after `=`, as in `--force-generated=-x`.
- **`role_settings.<host>.coordinator` is refused.** The coordinator is the
  session Agentic Loop is invoked in, which runs on the host's own settings,
  so a coordinator entry configured only a generated agent file the entry
  command never runs in. Delete the entry; set the session's model and effort
  in the host. Settings for the `thinker`, `worker`, and `verifier` are
  unchanged.

**Added**

- `snapshot` names the working tree as a candidate reference, `tree:<sha>`,
  without a commit: a git tree object built in a temporary index under the
  repository's own ignore and line-ending rules, leaving out
  `.agenticloop/tasks/` and `.agenticloop/local/`. It runs from the project
  root, prints the reference, the base commit, and the paths that differ
  (`--json` too), writes no record, and writes nothing into `.git` but the
  tree's objects. A snapshot exists only in the clone that took it; to review
  it elsewhere, send the base commit and `git diff`, and the reviewer's own
  snapshot of the result has the same sha. The reference is the first line,
  and a reader that keeps only it, as `snapshot | head -1` does, ends the
  command quietly: any command whose reader closes early keeps its own exit
  code, with no stack trace.
- `task lint` resolves a `tree:<sha>`, reports whether the working tree still
  matches the current snapshot (or in which paths it differs; not checked in a
  sparse checkout, and a dirty submodule is not a difference), and says when a
  later commit has the same tree as an earlier snapshot. References are looked
  up with one git process per run. It prints the current candidate in full and
  the earlier ones as one summary line; `--json` keeps every reference.
- Informational lint notes, none of which changes an outcome, each listed with
  what to do in `docs/record-format.md`: `candidate.moving_ref` (the current
  candidate is `HEAD`, a branch, or a label, not an object id),
  `entries.in_body`, `evidence.undeclared_check` (once per check name, with a
  count), `evidence.lint_as_evidence`, `evidence.credential_like`, and
  `record.large`.
- `task list` marks a structurally valid record that declares at least one
  requirement, all satisfied, and that is not `done` or `cancelled`, as
  `ready to close`.
  `--json` rows carry `requirements_satisfied`: requirement evaluation alone,
  `null` when none are declared.
- `decision list [--json]` lists decision records with their ids, statuses as
  recorded, dates, and titles, superseded ones included, and lists a record
  whose frontmatter cannot be read with the reason. It validates nothing. The
  entry command uses it to find decisions no document cites, and
  `decision-capture` checks it before a new decision, marking a replaced one
  `status: superseded`.
- When an actor replaces its own blocking verdict with an `accept`, the
  satisfied requirement says so as a supporting fact.
- `.agenticloop/generated.json` records `source_digest`, a sha256 over the
  files that shape generated output, so builds that share a version can be told
  apart; `docs/cli.md` lists them. A manifest written by a newer version makes
  `setup` and `update` refuse and write nothing, and `doctor` then says to run
  that newer copy. `doctor` and `update --check` print the running copy's
  version, location, and digest; `doctor` also warns about a hand-edited
  generated file and a `project.md` that is missing, empty, or has
  sections still as `setup` wrote them; the entry command and the
  coordinator offer a thinker draft for it.
- `help` lists each command's flags.
- Each role names the procedure skills it uses in a closing line of its
  canonical file, so a Claude Code plugin role, which reads that file as
  written, finds them among the plugin's skills. In a generated role file the
  line becomes a `## Procedures` section linking each one at the path its
  host's adapter generates. On OpenCode, the thinker, worker, and verifier are
  denied the entry skill.
- `docs/host-adapters.md` compares the hosts: how a subagent starts, how deep
  each lets subagents nest, and how each refuses implicit entry-skill use.

**Changed**

- Role presets. Every role treats the task record as authoritative and an
  inherited conversation as background. An actor is `<name>@<host id>`: the
  role, or the specialist name the agent was started as, and two reviewers of
  one candidate never share one; a verifier lens gets its own name, and no
  name is chosen to avoid matching a producer. When a coordinator runs the
  roles, statuses are its own and a role records only `blocked` or
  `needs_context`; working alone, a role sets its own status, and `done` once
  lint shows the requirements met, with or without a verdict. A role started
  by another agent starts no agents. The thinker, worker, and verifier consult
  the host's skills as part of their responsibility. The worker follows
  written evidence rules and snapshots uncommitted work; the verifier writes
  only in the record, runs checks on the candidate itself, and asks for a
  commit id or a snapshot when given a moving name; the coordinator states
  when each shape of work is worth it and treats repeated revisions as a stall
  to diagnose.
- Entry command: roles started by name do not load it; orientation is
  proportional and happens once; a `## Pausing` section; changes to roles,
  models, and skills reach only new sessions; routed roles get their actor in
  the brief, one writer at a time, and a snapshot before a routed write.
- A review is compulsory only where a task requires one. The `thinker`
  declares `independent_review` or `assessment_roles` where the task must not
  be done without that review; a review that would help needs no requirement
  and can happen anyway. The `coordinator` hands the verifier any judgement
  the work needs rather than every result, and the entry command says work
  that went straight through needs no verifier unless the requirements, the
  working policy, or the user ask for one. In field use nearly every task
  record declared a review, which made a verifier compulsory before `done`.
- Skills: `task-record-contract`, `verification-evidence`, `assessment`,
  `blocked-state`, and `decision-capture` say the same as the presets. The
  snapshot extraction recipe runs both git commands against an absolute
  temporary index, so the repository's own index is never overwritten.
- Record scanning, used by every `task` and `decision` command, checks each
  entry as it checks the directory: a record that is a symbolic link or
  junction is refused rather than read from wherever it points, and a
  directory named like a record is passed over instead of failing the command
  with `EISDIR`.

## 0.5.0

Breaking reset. There is no migration path from 0.4.x and no compatibility mode,
alias, or deprecated command. Existing records under `.agenticloop/tasks/` and
`.agenticloop/decisions/` are left untouched; `setup` refuses a 0.4.x layout and
prints the manual steps.

Agentic Loop is now a small, portable vocabulary for agent work: Markdown task
records carrying work, candidates, evidence, and assessments; four role presets;
five reusable skills; thin adapters for three hosts; and a few pure checks.
Agents choose the workflow. Hosts execute it.

The host ids are `codex`, `claude`, and `opencode` — each host's own command
name. The bundled skills are `task-record-contract`, `verification-evidence`,
`assessment`, `decision-capture`, and `blocked-state`.

If a pre-release build wrote `claude-code` into your `agenticloop.json`, change
that value to `claude` before running `setup` or `update`. Both read the file
before applying `--host`, so an unknown host id is refused first and the error
lists the known ids. Likewise, move any `models` map to
`role_settings.<host>.<role>.model`. There is no alias: 0.5.0 is the first
release, so there is nothing to stay compatible with.

The role ids are `coordinator`, `thinker`, `worker`, and `verifier`. The
pre-release ids `orchestrator`, `maintainer`, `engineer`, and `auditor` are
unknown roles, with no alias: an assessment `role` or an `assessment_roles`
entry naming one is a structural error, and `role_settings` naming one is
refused. A pre-release record or `agenticloop.json` that uses them is edited by
hand. `update` removes an unmodified old role file it generated; a modified
one makes it write nothing until you merge and delete the file, or name it with
`--force-generated` to have it deleted.

**Added**

- Generated skills are invoked, not inferred. The entry command carries a
  `skill_description` — separate from its command `description`, with no
  fallback between them — that says when to use Agentic Loop and when not to.
  Codex additionally gets `.agents/skills/agenticloop/agents/openai.yaml` with
  `policy.allow_implicit_invocation: false`, and Claude Code gets
  `disable-model-invocation: true` in its skill index. Explicit invocation
  (`$agenticloop`, `/agenticloop`) is unaffected. Adapters can now declare a
  `literal` file and `skill_frontmatter`, so this stayed a descriptor change.
- Work described after the entry command is the request. `/agenticloop <text>`
  (`$agenticloop <text>` on Codex) no longer asks whether the work needs a
  record: a single task is done, with a record when it spans sittings or needs
  review; a plan or task list is turned into records with `depends_on` by the
  `thinker`, and each record starts once its dependencies are done. The agent
  asks only when the description is ambiguous, would be exceeded, or touches
  something irreversible.
- Orientation reaches the project's own plan. The entry command reads the
  documents `project.md` points to (a plan, a spec, a roadmap). When they do
  not say what comes next, it looks for pointers in `AGENTS.md`, `CLAUDE.md`,
  or the README, without searching the repository for plans. It also reads the
  decisions those documents or the open records cite. The report says where
  the documents put the work, and records that are all done no longer read as
  a finished project. With no argument, the coordinator proposes the next step
  and asks before starting it, instead of asking what to work on: first a
  record that can move now (not `done`, `cancelled`, `blocked`, or
  `needs_context`, with its `depends_on` done), otherwise the next work the
  documents name. Orienting is the coordinator's job: it names the document
  and the part the work comes from when it delegates, and the `thinker` cites
  that part in the record. Sessions had reported every record done and asked
  what to do next while the project's plan named the next items. `setup`
  never rewrites an existing `project.md`, so a project set up earlier adds
  its pointers under `## Documents` by hand.
- The presets name shapes of work besides one worker followed by one verifier.
  The `coordinator` preset describes independent tasks running in parallel,
  with a separate working copy per worker where the host offers one; discovery
  before a plan is settled; and several verifiers on one candidate. The
  `thinker` plans which steps can run in parallel, investigates what the plan
  turns on before planning on a guess, and declares `depends_on` only where a
  task truly needs another. Sessions had delegated one role at a time almost
  without exception, and nothing in the presets said otherwise was an option.
- Three more shapes are named, chosen because agents rarely take them
  unprompted: fan-out then synthesize, competing alternatives, and adversarial
  challenge. Critique and revise is not named, since the roles already produce
  it. The `thinker` says how the shapes are written with existing records:
  one task per alternative plus a comparison task that depends on them and
  records the choice, never several alternatives as candidates of one task,
  because the checks read only the last candidate. An alternative that
  delivered is `done` whether or not it was chosen; an abandoned one is
  `cancelled` and leaves the comparison's `depends_on`. The thinker combines a
  fan-out's findings into the plan; a synthesis that is itself a deliverable
  is a worker's task. The `verifier` records a blocking verdict from a
  challenge only for a concrete failure against the recorded work, proposes a
  change to the work for anything else, and a challenge that finds nothing is
  not an `accept`. `AGENTIC_LOOP.md` places requirement, actor, dependency,
  decision, and execution context around the four concepts.
- The coordinator says what it is doing. Before each batch of roles it starts,
  it gives one sentence on what moves next, which role or shape, and why now,
  with parallel work grouped in it; at the end, what is done and what is
  blocked. Sessions had chained subagents with no word to the user between
  them. The coordinator also sets a status with
  `npx --no agenticloop task set` itself instead of starting a role for it,
  spelled in full because a preset may be read without the entry command.
  Sessions had spent a whole worker subagent on
  marking a task `done`, which the CLI refuses unless its requirements are
  satisfied anyway.
- Records name the agent host, not the computer. The `worker` and `verifier`
  presets showed `worker@<host>` and `host: <host>` without saying what a host
  is, and subagents filled in the machine's name, the way `user@hostname`
  reads. Records then carried computer names, and the same host looked like a
  different one on each device. Generated roles now have the host's own id
  written in (`worker@claude`), and the presets, the task record template, and
  the record format say the host is `claude`, `codex`, or `opencode`, never
  the machine's name.
- The session names its role. When the entry command's session adopts the
  coordinator role, its first message starts with **Coordinator —**, once.
  The host keeps showing its own agent name, such as OpenCode's `Build`, so
  nothing else told the user which role the session had taken.
- Delegation reaches the role. The entry command names where this host's role
  files live and tells the coordinator to start the subagent named after the
  role (`agenticloop:thinker` under a plugin install), not a general-purpose
  subagent told which role it plays, which never sees the role's instructions.
  Where a host cannot start a subagent by name, the subagent is told to read its
  role file first. The `coordinator` preset says the same.
- Agents run the CLI as `npx --no agenticloop`. The entry command and the
  `decision-capture` skill spelled it as a bare `agenticloop`, which is not on
  the PATH in a project that installs the package locally, so agents got
  `command not found`. `--no` keeps npx to the installed copy rather than
  downloading a package of that name, and where the CLI is unavailable the
  agent says so and edits the record by hand.
- A recurring stall becomes a policy proposal, not a policy change. The
  `thinker` names the cause, not only the symptom, and when the cause is likely
  to affect other tasks it writes a proposed edit to the matching `project.md`
  section (`## Working policy`, `## Checks`, or `## Setup facts`) in the task
  record. It does not edit `project.md` unless asked. The scaffold asks for a
  short policy that evolves from what recurs, preferring to replace or remove a
  stale sentence over adding another.
- Roles consider skills. Each role preset, the coordinator's included, says to
  use a skill when it fits the step at hand, to read it first, and to look
  again when the work changes: one the host exposes, or one the user or the
  working policy points to by path, never found by searching or installed. A
  skill named to a role but missing from its host is reported; the role
  carries on with what does not depend on it and leaves the rest open, as
  `needs_context` for a worker or an unassessed point for a verifier. The
  coordinator names a fitting skill, with its purpose, when delegating. A skill
  supplies practice, not permission: the deliverable goes where the task asks,
  plans, decisions, evidence, and verdicts where the record conventions say,
  and a verifier using a review skill still fixes nothing. The `project.md`
  scaffold's policy example asks for a security skill without naming one.
  Nothing about skills is registered, generated, or recorded.
- Roles can run in another host. `role_routes` in `agenticloop.json` names,
  for the `thinker`, `worker`, or `verifier`, a preferred host:
  `"worker": "codex"`. When that host cannot run the role, it runs where the
  coordinator works, and the coordinator says so; there is no fallback to
  configure. The coordinator is never routed. The route's host must be
  generated, so the delegate has its role file; a route to another host is
  refused until `setup --host` adds it. Model and reasoning for a routed role
  are its `role_settings` under the route's host, and a route written as a map
  is refused with that hint. Each host's entry command lists the routes from
  it, with the role file to read first and the model and reasoning settings to
  pass; the generated coordinator lists them too, with the path of that entry
  file, so a coordinator started directly still sees them. The new
  `## Role routes` section says how to use them: start the role in that host's
  CLI through a delegation capability the host exposes or the policy points
  to, recognized by its description rather than its name; run the role here
  only when nothing can have changed, reconciling a writing run that failed
  partway instead; let a host the user names override the route; and leave
  open work that a record or the policy says requires the other host. A routed
  role writes only where it writes anyway: the worker its scope and task
  record, the thinker task records and decisions, the verifier its task record
  and any findings file. Other role files, records, and checks are unchanged:
  the actor string records where the role actually ran.
- A documented record format with a `schema` field, a nine-value status
  vocabulary, and three requirement kinds: `checks`, `independent_review`, and
  `assessment_roles`.
- `docs/background.md`: the role model's basis in *TRINITY: An Evolved LLM
  Coordinator* (arXiv:2512.04695), what the paper found and what those figures
  do not show, how the project applies it, and what it does not adopt. The
  roles are based on the TRINITY role model; this is not an implementation of
  TRINITY and there is no learned coordinator.
- Block scalars in record frontmatter: `|` and `>` with strip, clip, and keep
  chomping, so a long `findings` or `note` no longer makes the record
  unparseable. Folding preserves the breaks around more-indented content, and
  malformed mapping or tab indentation is refused rather than reinterpreted.
- Pure checks, exported from the package, reporting three separate outputs:
  structural validity, reference availability, and requirement evaluation. Each
  supporting fact is reported as `checked` or `asserted`.
- `.agenticloop/generated.json`, a tracked ownership manifest. `remove` deletes
  only entries whose digest still matches.
- `update` checks for conflicts before writing, and says what it wrote. It
  plans every generated file first and writes nothing while a generated file is
  modified locally or a file of yours stands where one is generated, naming
  each one, unless `--force-generated` names it; `setup` refuses the same way.
  It used to skip such a file, write the rest, and exit 0, leaving a
  half-updated installation that an agent could not tell apart from a current
  one. It now names every path it writes, as `changed`, `added`, or `removed`,
  `.agenticloop/generated.json` included, since committing the files without
  it leaves digests that make the next update refuse them; `--json` carries
  the manifest as `manifest`. It leaves the manifest alone when nothing
  changed, and adopts a file that already holds exactly what would be
  generated, so a write that fails partway is finished by running `update`
  again. After a change it says to commit the listed files together with what
  caused them and to start a new host session, since a running one keeps the
  instructions it started with. `--force-generated` accepts `./` and backslash
  spellings and refuses a path that names nothing generated or recorded, which
  it used to ignore. `setup --json` reports the hosts it added as
  `added_hosts`.
- `update --check` runs the same plan and writes nothing. It lists what would
  change, prints the toolkit version and location it ran from, and exits 1
  unless the installation is current — which the package version could not
  say, since unreleased builds share it. `doctor` uses the same plan and
  reports the generated files as `current`, `behind`, or `blocked`, including
  a manifest that no longer matches files that do; for a lost manifest it now
  says to run `update`, which rebuilds it, rather than `setup`. When asked to
  update Agentic Loop, the entry command first runs `update --check`, reports
  which copy it ran, uses the copy the user names, commits the listed files
  only where the user or the working policy says to, and does not force a
  refusal.
  `docs/downstream-adoption.md` gives the recipes: a clean upgrade, an upgrade
  in the middle of work, and personal versus project-pinned models.

**Changed**

- 13 command paths, down from 110.
- The examples now show the optional `host`, `model`, and `at` attributes on an
  evidence entry and an assessment, and `docs/record-format.md` states the YAML
  subset the frontmatter parser accepts and refuses.
- A colon inside a flow collection is part of the word unless a space, a flow
  indicator, or the end follows it, as in YAML. `checks: [test:api, lint:api]`
  used to make the whole frontmatter unparseable, and `{k:v}` read as `k: v`
  where YAML reads a key `k:v`; the first now parses and the second is refused.
  Unparseable frontmatter now reports its parse error alone instead of also
  listing every required field as missing.
- YAML anchors, aliases and tags are refused explicitly; they are never read as
  literal strings with a different meaning from a full YAML parser.
- `independent_review` and `assessment_roles` are distinguished where they are
  declared: the first asks for an accept from anyone who is not a recorded
  producer, the second for an accept from a specific role.
- Configuration lives only in `agenticloop.json` at the target root, and it
  describes the repository rather than the machine: `hosts` are the hosts the
  project supports, not the one a contributor happens to run, and role settings
  are the project's deliberate choices. Omit a setting to let the host's own
  configuration decide it. `project.md` is prose, including the project's
  working policy, and `.agenticloop/local/` is machine-local state rather than
  a configuration layer.
- `setup --host` adds a host to the recorded set instead of replacing it.
  Previously `setup --host claude` in a repository already generating for Codex
  left `hosts` as `["claude"]`, and the ownership pass then deleted the Codex
  projections it still owned. Dropping a host is now a deliberate edit to
  `agenticloop.json` followed by `update`.
- The four roles are responsibilities and do not vary by project. A specialist
  is an `actor` under a canonical role, carrying a skill, chosen by the prose
  policy — not a fifth role and not something the toolkit derives.
- Per-host `role_settings` in `agenticloop.json`. Each host's adapter declares
  which settings it accepts and what it calls them: reasoning effort is
  `effort` for Claude Code, `model_reasoning_effort` for Codex, and
  `reasoningEffort` for OpenCode, which also takes a `variant`. A setting's
  value is a string passed to the host as written, or `null` to leave it unset.
  A setting a host cannot express, and a value it could not carry, are each
  refused with a hint rather than written into a file the host ignores or
  stringified into nonsense.
- A model binding is one of those settings, written at
  `role_settings.<host>.<role>.model`. There is no separate `models` map: a
  model id is host-specific, so one string per role could not serve two hosts
  at once. A leftover `models` key is refused with the setting that replaces
  it.
- Evidence and assessments bind to an explicit candidate reference an agent
  records, never to the repository's moving HEAD.
- Roles are concise, domain-neutral responsibility and boundary presets with no
  mandatory delegation sequence, based on the TRINITY role model. The
  `coordinator` decides which roles act next and keeps the user informed. The
  `thinker` turns a request into work, plans the approach, breaks it down,
  and critiques; it replaces the maintainer's shaping and adds planning. The
  `worker` produces the candidate and its evidence, as the engineer did. The
  `verifier` assesses the exact candidate and records a verdict, covering the
  auditor and the maintainer's assessing. The record mechanism is unchanged;
  only the role ids are new. In the shipped defaults, `thinker` and `worker`
  carry `permission_mode: acceptEdits` for Claude Code, and `verifier` has no
  default.
- `independent_review` and `assessment_roles: [verifier]` are evaluated
  separately and together do not guarantee an independent verifier. This is a
  documented limitation in `docs/record-format.md`, not a change in behaviour.
- snake_case for every machine field and enum value; kebab-case for command
  names.
- `config.json` carries per-host role settings and nothing else. Role ids,
  descriptions and bodies come from `agents/*.md`, and every bundled skill is
  projected to every selected host.

**Removed**

Activation and the activation store, grants, revocation, host trust, receipts
and signatures, hardened mode, event logging, dispatch packets, handoff
preflight, readiness, prepare and verify return, execution attempts, repair and
remediation protocols, the transition contract and refusal catalogue, the
semantic evaluator, audit records, certificates, gates, overrides and waivers,
closeout, workflow evidence commits, parallel scan and lane state, worktree
guards, the GitHub backend and its projection, improvement capture, guidance
blocks, hydrate, setup certificates, layout migration, retry and review budgets,
and the Copilot and Cursor adapters.

Also removed: the shipped root `manifest.json` and `agenticloop.template.json`,
neither of which 0.5.0 installs or reads; the unread `config.json` keys,
including the role-to-skill lists; and four generic skills — `ponytail`,
`frontend-design-quality`, `tdd-implementation`, and `debugging-before-fixes` —
whose content is engineering practice rather than how to use these records.

Agentic Loop reports what was recorded and who asserted it. It does not prove
who wrote a record.

---

Release history for 0.4.7 and earlier is in Git history, last present at commit
`2d8cd99`.
