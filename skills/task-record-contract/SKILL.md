---
name: task-record-contract
description: Use when writing or revising a task record — deciding its intent, scope, acceptance criteria, and which requirements to declare. Covers the frontmatter fields, the status vocabulary, and what each requirement kind actually demands.
metadata:
  area: records
  side_effects: writes-files
  credentials: none
  runs_scripts: none
---

# Task record contract

A task record is ordinary Markdown under `.agenticloop/tasks/`. Structured data
lives in the YAML frontmatter; the body is prose. The full contract is
`docs/record-format.md`; this is how to write a good one.

## Minimum

```yaml
---
schema: 1
id: T-001
title: Greet by name
status: draft
---
```

Then a body with `## Intent`, `## Scope`, `## Out of scope`, and
`## Acceptance criteria`. Any additional heading is fine.

## Writing the body

- **Intent** — the outcome, in the user's terms. Why this is being done.
- **Scope** — what changes. Name files or areas when you know them.
- **Out of scope** — the nearby work that must *not* be bundled in. This is the
  most useful heading in the record and the most often skipped.
- **Acceptance criteria** — observable outcomes, one per bullet. If you cannot
  say how you would see it, it is not a criterion yet.
- **Blockers and decisions** — what got in the way and what was decided, written
  as it happens rather than reconstructed later.

Candidates, evidence, and assessments go in the frontmatter lists, never in a
fenced block in the body: the checks read only the frontmatter, and lint reports
body entries as `entries.in_body`. Append to the lists; do not rewrite someone
else's entry.

Record durable decisions and material failures. Do not paste command
transcripts, lint output, or a table of every check you ran. Routine successful
output does not need to be retained; link a file under `output` only when its
contents materially support a failure, reproduction, or review finding. A
milestone narrative belongs in the milestone document, not repeated in every
task that contributed to it. Run logs go in linked files: a record past 100 KB
is reported as `record.large`.

## Declaring requirements

Requirements are the one thing the toolkit checks. Declare only what you would
actually insist on, because every declared requirement must be satisfied before
the task can be set to `done`.

```yaml
requirements:
  checks: [test, lint]
  independent_review: true
  assessment_roles: [verifier]
```

Every requirement key goes under `requirements:`. Written at the top level, it
is a structural error, `requirement.misplaced`: lint fails and the task cannot
be set to `done` until the key is moved.

- `checks: [name, ...]` — each name needs a passing evidence entry for the
  current candidate. Name them after the project's real commands.
- `independent_review: true` — someone whose actor string is not among the
  candidate's producers must record an `accept`.
- `assessment_roles: [role, ...]` — each named role must record an `accept`.

`independent_review` asks for an accept from anyone who is not a recorded
producer; `assessment_roles` asks for an accept from a specific role. Declare
the second when a specific role's verdict is what you need.

A task with no `requirements` block is completely normal. Most tasks want
`checks` and nothing else.

Do not declare a requirement you intend to remove later to get a green result.
Removing it defeats the reason for writing it down.

## Status

`draft`, `agent_ready`, `in_progress`, `in_review`, `needs_revision`, `blocked`,
`needs_context`, `done`, `cancelled`.

Status describes progress. Any status may follow any other, and no status
grants a permission. The record stays readable and editable in every state.

Who sets it depends on who is working. When a coordinator runs the roles,
statuses are the coordinator's: a role it started records only `blocked` or
`needs_context`. An agent working alone sets status itself with
`npx --no agenticloop task set`, and `done` only once `task lint` shows the
declared requirements met. `done` does not wait for a verdict: work that went straight
through may have no verifier, and its requirements decide.

## Sizing

One task is what one agent can finish in one sitting. If it needs phases, it is
several tasks. If it cannot be described without the word "and", check whether
the second half belongs in `## Out of scope`.

## Revising

Edit the file. It is Markdown and nothing objects. If the scope was wrong, fix
the scope and say why under `## Blockers and decisions` — a record that quietly
grew to match what was built is not worth keeping.
