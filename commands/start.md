---
description: Read the project's working policy and open task records, report where things stand, and continue with the requested work.
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

For a small task where delegation would not help, you may switch to the
`worker` role: say so before starting the work, and follow that preset.
Changing roles is fine; changing roles silently is not.

## Orient

1. Read `.agenticloop/project.md` — what this project is, its working policy,
   and the names of its checks. The policy is prose written by the people who
   own this repository. Follow it.
2. Read the open task records under `.agenticloop/tasks/`.
   `npx --no agenticloop task list` is the quick view; read the individual
   record before acting on it.
3. Report where things stand in one short paragraph: what is in flight, what is
   blocked and on what.

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

If there is no argument, report the state and ask what to work on. Do not start
working on something you inferred.

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

Record the candidate you produced and the evidence for it. Record failures as
failures.

## Roles

`coordinator` decides which roles act next. `thinker` turns a request into
work, plans it, breaks it down, and critiques. `worker` produces the candidate and its
evidence. `verifier` assesses the exact recorded candidate.

Delegate when it helps. There is no required order, nothing to obtain before
starting, and no role you must pass through. Several roles may work at once:
independent tasks in parallel, an investigation before a plan is settled, or
more than one verifier on a candidate. The `coordinator` role file describes
these shapes.

To delegate, start the host's subagent for that role: the one named `thinker`,
`worker`, or `verifier`, which a plugin install may list with a prefix, such as
`agenticloop:thinker`. That subagent carries its role's instructions. A
general-purpose subagent told it is the thinker has only the word. If the host
cannot start a subagent by name, tell the one you start to read its role file
before anything else, and give it the path. Either way, give it the task id and
let it read the record.

If a task declares `independent_review`, the accepting actor must not be among
the candidate's recorded producers — that is the one thing worth checking when
deciding who reviews.

## Boundaries

Do the work the user asked for. Ask before going beyond it, before anything
irreversible, and wherever the project's working policy says to ask.

Report what actually happened, including what failed.
