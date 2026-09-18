# Record format

The task record is the product. Everything else — the roles, the skills, the
adapters, the CLI — exists to help agents write one and read one.

A record is ordinary Markdown, editable directly. Structured data lives in the
YAML frontmatter; the body is prose.

## Where records live

```
.agenticloop/
  project.md        prose: setup facts, working policy, pointers
  tasks/            one Markdown record per task
  decisions/        one Markdown file per durable decision
  generated.json    tracked ownership manifest for generated files
  local/            gitignored machine-specific state
agenticloop.json    machine configuration: hosts, per-role model bindings
```

Nothing else is written under `.agenticloop/`. Machine configuration lives in
`agenticloop.json` and nowhere else; `project.md` owns prose only.

## The four concepts

One record carries all four. They are concepts, not files or subsystems.

| Concept | Meaning |
|---|---|
| **Work** | the requested outcome, scope, out of scope, acceptance criteria, and declared requirements |
| **Candidate** | the specific artifact being assessed, referenced by commit or equivalent, with its recorded producers |
| **Evidence** | a check result or observation, with its source and the candidate it concerns |
| **Assessment** | an actor's findings and verdict about the work and a candidate |

## Frontmatter

**Required:** `schema` (integer, initially `1`), `id`, `title`, `status`.

**Optional:** `depends_on` (list of ids), `allowed_paths` (list of globs),
`requirements` (map), `candidates`, `evidence`, `assessments` (lists of entries).

Unrecognized fields are permitted and reported as informational. They are never
an error — a project may carry its own fields, and a later version of the format
may recognize them.

Every machine field and multiword enum value is snake_case.

### Status

Status describes progress. **There is no transition graph.** Any status may
follow any other, and no status grants a permission.

`draft`, `agent_ready`, `in_progress`, `in_review`, `needs_revision`, `blocked`,
`needs_context`, `done`, `cancelled`

### Candidate entry

| Field | Required | Meaning |
|---|---|---|
| `ref` | yes | a commit or equivalent reference |
| `producers` | no | list of actor strings that produced it |
| `note` | no | free text |

### Evidence entry

| Field | Required | Meaning |
|---|---|---|
| `check` | yes | the check name |
| `candidate` | yes | a `ref` from `candidates` |
| `result` | yes | `pass` or `fail` |
| `command` | no | what was run |
| `exit_code` | no | its exit code |
| `actor`, `host`, `model`, `at` | no | optional attributes |
| `output` | no | a short string, or a repository-root-relative path to a linked file |

### Assessment entry

| Field | Required | Meaning |
|---|---|---|
| `candidate` | yes | a `ref` from `candidates` |
| `role` | yes | one of `orchestrator`, `maintainer`, `engineer`, `auditor` |
| `verdict` | yes | `accept`, `reject`, or `needs_revision` |
| `actor`, `host`, `model`, `at` | no | optional attributes |
| `findings` | no | a short string, a repository-root-relative path, or a body heading anchor |

### Actor

A non-empty string the agent writes, for example `engineer@claude`. The
toolkit compares strings and reports them as **asserted**. It has no way to
verify that the actor named is the actor that wrote the entry, and it never
claims to.

A blank identity is not somebody. `producers: [""]` does not make a reviewer
independent of nobody: it leaves `independent_review` `unknown`, and the blank
entry is reported as a structural error. The same holds for a blank `actor`.

### Linked paths

A linked path in `output` or `findings` is **relative to the repository root**,
so `logs/lint.txt` means the same thing wherever the record lives. A path that
is absolute or climbs out with `..` is not treated as a link and is never
resolved: doing so would let a record ask whether an arbitrary file exists on
whatever machine runs the checks, which is not evidence about the work.

## Body

**Recognized headings:** Intent, Scope, Out of scope, Acceptance criteria,
Blockers and decisions.

Any additional heading is permitted and raises no diagnostic. A duplicate
recognized heading is a structural error.

## Requirements

A task declares explicit, mechanically checkable requirements. The checks
evaluate recorded facts against them. Nothing else is imposed, and a task with
no `requirements` block is normal.

An undeclared requirement is never introduced. A declared one cannot be dropped
by an assessment in order to obtain a satisfied result.

**A requirement means a favorable outcome was obtained, not that an assessment
was performed.** Presence-only requirements are not defined; none has a
consumer.

| Requirement | Satisfied when | Unknown when |
|---|---|---|
| `checks: [name, ...]` | every named check has an effective `pass` evidence entry for the current candidate | never; absent evidence is `not_satisfied` with reason `evidence.missing` |
| `independent_review: true` | at least one effective assessment of the current candidate has verdict `accept` and an `actor` not listed in the candidate's `producers` | the candidate has no `producers`, or every accepting assessment lacks `actor` |
| `assessment_roles: [role, ...]` | for each role, the effective assessment of the current candidate by that role has verdict `accept` | never; absent assessment is `not_satisfied` with reason `assessment.missing` |

An effective `reject` or `needs_revision` from a relevant actor or role leaves
the requirement `not_satisfied` until a later effective assessment changes it.
When several actors are relevant, one blocking verdict is enough: an accept
from one and a reject from another is `not_satisfied` with reason
`assessment.rejected`, and only a later effective assessment by the rejecting
actor can clear it.

A new requirement kind needs a real consumer before it is added.

### Independence

Independence is evaluated against the recorded `producers` of the current
candidate, **not against role names**. The same actor string appearing as
producer and reviewer is not independent regardless of the roles it claimed.
Missing identity on either side is `unknown`, and a blank one counts as missing.

## Selection rules

Document order is the only ordering the checks use. There is no supersession
protocol, timestamp comparison, or freshness rule.

- The **current candidate** is the last entry in the `candidates` list.
- For a named check and a candidate, the **last evidence entry in document
  order** with that check and candidate is the effective result. A later `fail`
  overrides an earlier `pass`.
- For assessments, the **last entry in document order per (candidate, actor)**
  is the effective assessment for that actor. When `actor` is absent, per
  (candidate, role).
- Entries that reference a candidate other than the current one are **ignored**
  by requirement evaluation and never invalidate anything.

Adding a new candidate therefore makes prior evidence and assessments
inapplicable, with no diagnostic raised against them.

## Checked versus asserted

Every supporting fact carries its trust:

- **checked** — the CLI observed it locally, or the check compared two recorded
  values.
- **asserted** — an agent wrote it.

A checked comparison between two asserted values does not upgrade the values.
Equality of two actor strings is checked; the identities behind those strings
remain asserted.

This distinction is the honest limit of the format. Agentic Loop interprets what
was recorded. It does not prove who recorded it.

## The three outputs

The checks produce three results and **never merge them**:

**1. Structural validity.** Unparseable frontmatter, unknown status value,
unknown requirement kind, missing required entry field, duplicate task id,
duplicate recognized heading, or a recognized structured list that is not a
list. Unrecognized frontmatter fields are informational, not errors. Additional
prose headings raise no diagnostic.

**2. Reference availability.** For each candidate reference and linked file:
`available`, `unavailable`, or `not_checked`. **Unavailable is not malformed** —
the reference may resolve in another checkout. Nothing is fetched from a remote.

**3. Requirement evaluation.** For each declared requirement: `satisfied`,
`not_satisfied`, or `unknown`, with a reason code and, for each supporting fact,
its trust.

### Observations

The CLI may gather local observations and pass them to the checks: whether a
candidate reference resolves in the local repository, whether a linked evidence
or assessment file exists in the current checkout. Gathering is optional and
local only, and never looks outside the checkout: a linked path that resolves
elsewhere is skipped rather than reported.

**A pure check never performs I/O.** The pure functions take the parsed record
plus an optional observation map, and are exported from the package so an
independent consumer uses the same interface.

## Command behavior

- **`task lint`** prints all three outputs. It exits non-zero when any
  structural error exists, or when the record claims `status: done` while any
  declared requirement is `not_satisfied` or `unknown`. **It never writes.**
- **`task show`** loads any record it can parse, in every state, and reports the
  same three outputs under `--json`.
- **`task set <id> status done`** refuses, without writing, when that record's
  requirement evaluation is not all `satisfied`.

That refusal is write validation on one value — not an authorization or
transition gate. Every other `task set` value and every direct edit is
unrestricted. Failed checks, rejecting assessments, and blocked states are
always recordable, and every record stays readable and editable in every state.

## Canonical example

```markdown
---
schema: 1
id: T-001
title: Greet by name
status: in_review
requirements:
  checks: [test, lint]
  independent_review: true
candidates:
  - ref: 007c7f8
    producers: [engineer@claude]
evidence:
  - { check: test, candidate: 007c7f8, result: pass, command: "npm test", exit_code: 0 }
  - { check: lint, candidate: 007c7f8, result: pass }
assessments:
  - { candidate: 007c7f8, role: maintainer, actor: maintainer@codex, verdict: accept, findings: "none" }
---

## Intent
...
## Scope
...
## Acceptance criteria
...
## Design notes
Any extra heading is fine.
```

## Worked examples

- [examples/solo.md](examples/solo.md) — checks only, one agent
- [examples/delegated.md](examples/delegated.md) — `independent_review` and
  `assessment_roles`, satisfied
- [examples/not-independent.md](examples/not-independent.md) — the reviewer is
  also a producer, so independence is `not_satisfied`

## Decision record

One Markdown file per durable decision under `.agenticloop/decisions/`. There is
a template and nothing more. `decision new <title>` writes it, numbering the
record for you; the title is required, as it is for `task new`.
