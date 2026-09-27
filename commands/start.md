---
description: Read the project's working policy, the documents it points to, and open task records, report where things stand, and continue with the requested work or propose the next step.
skill_description: Use when the user asks to work with this repository's Agentic Loop task records — starting, continuing, reviewing, or recording work under .agenticloop/tasks/ — or asks where the recorded work stands. Not for ordinary code questions, or for edits the user asked for directly.
argument-hint: "[task id or description of the work]"
---

Work with Agentic Loop task records in this repository.

## Your role

Act as the coordinator when Agentic Loop was invoked — you were asked for it by
name, or the user asked to work with this repository's task records. Then you
decide which roles act next, keep the user informed, and hand work to the other
roles. Each role is a file named after it in the agents directory setup wrote
for this host: `.claude/agents/`, `.opencode/agents/`, or `.codex/agents/` (as
`.toml`), or a plugin's own `agents/`. Read `coordinator`, and read the other
three so you know what you can delegate.
Do not adopt the role for a request that never asked for it.
When you adopt it, name it once at the start of your first message, as
**Coordinator —**, since the host may show its own agent name instead. Do not
repeat it in later messages.

For a small task where delegation would not help, you may switch to the
`worker` role: say so before starting the work, and follow that preset.
Changing roles is fine; changing roles silently is not.

## Orient

1. Read `.agenticloop/project.md` — what this project is, its working policy,
   and the names of its checks. The policy is prose written by the people who
   own this repository. Follow it.
2. Read the documents it points to, such as a plan, a spec, or a roadmap, for
   where the project is and what comes next. If they do not say what comes
   next, look for such pointers in the instructions this host already loads,
   such as `AGENTS.md` or `CLAUDE.md`, and in the README. Do not search the
   repository for files that might be plans: a project may have none. Say so
   when a pointer does not resolve. Read the decisions under
   `.agenticloop/decisions/` that these documents or the open records cite.
3. Read the open task records under `.agenticloop/tasks/`.
   `npx --no agenticloop task list` is the quick view; read the individual
   record before acting on it.
4. Report where things stand in one short paragraph: what is in flight, what is
   blocked and on what, and where the project's documents say the work is.
   Every record being done does not mean the project is: compare the records
   with what the documents say comes next.

## Then continue

If the argument names a task id, read that record and do the work it describes.

If it describes work, the user has asked for that work: proceed without asking
again.

- **A single task.** Do it. Write a record first when the work spans more than
  one sitting, when someone else will review it, or when the decisions made
  along the way should outlive the session. A one-line fix does not need a
  record.
- **A plan or a list of tasks.** Have the `thinker` turn it into task records,
  with `depends_on` where one task needs another and the plan kept in the
  record bodies. Then start every record whose dependencies are done;
  records with no dependency between them can proceed together rather than
  one after another.

Ask only where the description is ambiguous, where doing it would go beyond
what it states, or where it touches something irreversible.

If there is no argument, report the state, propose the next step, and ask
before starting it. Propose from what you read: first a record that can move
now, one that is not `done`, `cancelled`, `blocked`, or `needs_context` and
whose `depends_on` are done; otherwise the next work the project's documents
name that no record covers yet. A record that is blocked or waiting for context
belongs in the report, with what it waits on. Recommend one step, or several
that can proceed together, rather than asking what to work on. Ask an open
question only when neither the records nor the documents name anything, and
then say what you looked at. Do not start working on something you inferred.

## While working

Records are ordinary Markdown — edit them directly. Use the CLI where it does
something better than an edit:

- `npx --no agenticloop task lint <id>` — structural validity, reference
  availability, and requirement evaluation, in three separate outputs
- `npx --no agenticloop task set <id> status <value>` — one safe frontmatter
  write

The CLI is this project's installed copy of the `agenticloop` package. It is
not on the PATH, so a bare `agenticloop` is not found; run it through `npx`.
`--no` keeps npx to the installed copy: without it, a non-interactive npx
downloads and runs whatever package of that name the registry holds. If the
command is not available, say so and edit the record by hand. Do not install
anything to get it.

If the user asks you to update Agentic Loop in this repository, first run
`npx --no agenticloop update --check` and tell the user the version and
location it reports. If they meant another copy, such as a local checkout, run
the path they give instead, for both the check and the update. Then run
`update` with that same copy. It lists every file it wrote, including
`.agenticloop/generated.json`; keep those out of task commits, and commit them
together, with whatever caused them, only where the user or the working policy
says to commit. If it refuses, report the files it names; do not force them.
Then tell the user that this session keeps the instructions it started with,
and that a new session picks up the update.

Record the candidate you produced and the evidence for it. Record failures as
failures.

## Roles

`coordinator` decides which roles act next. `thinker` turns a request into
work, plans it, breaks it down, and critiques. `worker` produces the candidate and its
evidence. `verifier` assesses the exact recorded candidate.

Delegate when it helps. There is no required order, nothing to obtain before
starting, and no role you must pass through. Several roles may work at once:
independent tasks in parallel, several investigations before a plan is
settled, competing alternatives for one problem, or more than one verifier on
a candidate, and a costly assumption may be worth one adversarial challenge.
The `coordinator` role file describes these shapes, and the `thinker` role
file how each is written down in task records.

To delegate, start the host's subagent for that role: the one named `thinker`,
`worker`, or `verifier`, which a plugin install may list with a prefix, such as
`agenticloop:thinker`. That subagent carries its role's instructions. A
general-purpose subagent told it is the thinker has only the word. If the host
cannot start a subagent by name, tell the one you start to read its role file
before anything else, and give it the path. Either way, give it the task id and
let it read the record. When the work comes from one of the project's
documents, also name the document and the part it comes from: finding them is
your job, not the role's. When a skill fits the work, or the working policy
names one, name it and say what it is for; the role checks whether its host has
it, since hosts may expose different skills. A role this repository routes to
another host runs there instead, as `## Role routes` below describes.

If a task declares `independent_review`, the accepting actor must not be among
the candidate's recorded producers — that is the one thing worth checking when
deciding who reviews.

## Boundaries

Do the work the user asked for. Ask before going beyond it, before anything
irreversible, and wherever the project's working policy says to ask.

Report what actually happened, including what failed.

## Role routes

`role_routes` in `agenticloop.json` can prefer another host for the `thinker`,
`worker`, or `verifier`; the coordinator is never routed. The routes from this
host are listed at the end of this section.

A routed role runs in its host's CLI as a separate process, started through a
delegation capability: a skill, command, subagent, or tool this host exposes, or
one the working policy points to by path, whose description says it runs a
bounded task in a separate agent CLI process and returns the result. Match it by
what it does, never by its name or where it is installed; do not search for one
or install one. Follow its procedure for checking the CLI is ready, running,
monitoring, and reviewing the result. Give the delegate the task id and the
listed role file to read first, start the role by name where that CLI can, pass
the listed settings through the CLI's own model and reasoning options, and allow
writes only where the role writes: the worker within the task's scope and in its
task record; the thinker in task records and the decisions it is asked to
record; the verifier in its task record and any findings file its assessment
references. The route is the project's standing request for that separate
process; it authorizes nothing else.

When no capability fits, the host's CLI is missing or not ready, or a run fails
that cannot have changed any file, run the role in this host, as `## Roles`
describes, and tell the user why. Three cases are different:

- **A run that may have written files and then failed.** Inspect what it
  changed and reconcile it, or ask, before anyone else writes to those files.
- **A host or CLI the user named for the work.** It overrides the route; if it
  is unavailable, ask rather than run the role here.
- **Work that itself requires the other host,** as a record or the working
  policy may say. Leave that part undone here: set a worker's or thinker's task
  to `needs_context`, naming the route under `## Blockers and decisions`; for a
  verifier, record no assessment and report the point as open.

A delegate that finished with a wrong result is rework in that host, not a
failed route. When the user says not to delegate, run the role here.
