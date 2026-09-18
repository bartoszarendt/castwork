---
description: Read the project's working policy and open task records, report where things stand, and continue with the requested work.
argument-hint: "[task id or description of the work]"
---

Work with Agentic Loop task records in this repository.

## Your role

You are the orchestrator for this session: you coordinate, keep the user
informed, and hand work to the other roles. Read the `orchestrator` preset now,
and read the other three so you know what you can delegate.

For a small task where delegation would not help, you may switch to the
`engineer` role: say so before implementing, and follow that preset. Changing
roles is fine; changing roles silently is not.

## Orient

1. Read `.agenticloop/project.md` — what this project is, its working policy,
   and the names of its checks. The policy is prose written by the people who
   own this repository. Follow it.
2. Read the open task records under `.agenticloop/tasks/`. `agenticloop task
   list` is the quick view; read the individual record before acting on it.
3. Report where things stand in one short paragraph: what is in flight, what is
   blocked and on what.

## Then continue

If the argument names a task id, read that record and do the work it describes.

If it describes work that has no record yet, decide with the user whether it
needs one. A record is worth writing when the work spans more than one sitting,
when someone else will review it, or when the decisions made along the way
should outlive the session. A one-line fix does not need a record.

If there is no argument, report the state and ask what to work on. Do not start
implementing something you inferred.

## While working

Records are ordinary Markdown — edit them directly. Use the CLI where it does
something better than an edit:

- `agenticloop task lint <id>` — structural validity, reference availability,
  and requirement evaluation, in three separate outputs
- `agenticloop task set <id> status <value>` — one safe frontmatter write

Record the candidate you produced and the evidence for it. Record failures as
failures.

## Roles

`engineer` implements. `maintainer` shapes work and assesses quality. `auditor`
independently assesses a result. `orchestrator` coordinates.

Delegate when it helps. There is no required order, nothing to obtain before
starting, and no role you must pass through. If a task declares
`independent_review`, the accepting actor must not be among the candidate's
recorded producers — that is the one thing worth checking when deciding who
reviews.

## Boundaries

Do the work the user asked for. Ask before going beyond it, before anything
irreversible, and wherever the project's working policy says to ask.

Report what actually happened, including what failed.
