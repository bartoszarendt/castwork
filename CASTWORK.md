# Castwork

A small, portable vocabulary for agent work.

Castwork provides the task record format and its status vocabulary, pure
checks over recorded facts, four role presets, reusable skills, and thin host
adapters. **Agents choose the workflow. Hosts execute it.**

Castwork interprets what was recorded. It does not prove who recorded it.

**Status:** version 0.8.0 is current.

## What the toolkit provides, and what it does not

| Castwork provides | Agent, host, and user decide |
|---|---|
| The task record format and its status vocabulary | Task breakdown, sequencing, parallelism |
| Pure checks over recorded facts and optional local observations | What an unmet or unknown requirement means now |
| Role definitions as responsibility and boundary presets | Which roles to invoke, when, in which host |
| Reusable skills and access to project and host skills | Which skills apply |
| Install, update, remove, diagnose | Which hosts to generate for |
| Durable decisions and task history in ordinary files | Whether to ask the user, within real authorization |

## The four concepts

One task record carries all four. They are concepts, not files or subsystems.

| Concept | Meaning |
|---|---|
| **Work** | the requested outcome, scope, out of scope, acceptance criteria, and declared requirements |
| **Candidate** | the specific artifact being assessed, referenced by commit or equivalent, with its recorded producers |
| **Evidence** | a check result or observation, with its source and the candidate it concerns |
| **Assessment** | an actor's findings and verdict about the work and a candidate |

## Around the four concepts

The four concepts are what a record carries. The rest of the vocabulary sits
around them in layers, and none of it is a fifth concept:

| Layer | Terms | What they are |
|---|---|---|
| Relations and constraints | requirement, actor, dependency | a requirement is part of the work, satisfied by effective evidence and assessments of the current candidate; an actor is who produced a candidate or recorded an entry, and independence compares actors, not roles; a dependency (`depends_on`) says one task needs another |
| Adjacent durable artifact | decision | one file under `.castwork/decisions/`, for a choice that outlives a task |
| Execution context | role, skill, policy, host, model | how the work was done; an assessment names its `role`, evidence and assessments may name their `host` and `model`, and skill and policy are not record fields |

## Requirements, not workflow

A task record declares explicit, mechanically checkable requirements. The checks
evaluate recorded facts against those requirements and report a result. That is
the whole mechanism.

There is no transition graph, mandatory role sequence, delegation prerequisite,
retry budget, or authorization gate. A task status grants no permission. Loading
a role creates no authority.

An undeclared requirement is never introduced, and a declared one cannot be
dropped by an assessment in order to obtain a satisfied result.

The three requirement kinds are `checks`, `independent_review`, and
`assessment_roles`. A requirement means a favorable outcome was obtained, not
that an assessment was performed. See [docs/record-format.md](docs/record-format.md)
for their exact rules.

## Three separate outputs

The checks never merge these:

1. **Structural validity** — is the record well formed?
2. **Reference availability** — does each candidate reference and linked file
   resolve in this checkout? `available`, `unavailable`, or `not_checked`. An
   unavailable reference is not malformed; it may resolve elsewhere.
3. **Requirement evaluation** — for each declared requirement: `satisfied`,
   `not_satisfied`, or `unknown`, with a reason code.

Each supporting fact carries its trust: **checked** when the CLI observed it
locally or compared two recorded values, **asserted** when an agent wrote it. A
checked comparison between two asserted values does not upgrade them. Equality
of two actor strings is checked; the identities behind them stay asserted.

## The one write validation

`task set <id> status done` refuses, without writing, when that record's
structure is invalid or its requirement evaluation is not all `satisfied`.

This is validation on one value, not a gate on work. Every other `task set`
value and every direct edit is unrestricted. Failed checks, rejecting
assessments, and blocked states are always recordable, and every record stays
readable and editable in every state.

## Roles

Four responsibility and boundary presets. Each is independently usable; none
requires a delegation sequence. They are based on the role model of *TRINITY:
An Evolved LLM Coordinator* (Xu et al., arXiv:2512.04695); see
[docs/background.md](docs/background.md) for what the project takes from the
paper and what it does not.

| Role | Responsibility |
|---|---|
| `coordinator` | decides which roles act next and keeps the user informed |
| `thinker` | turns a request into work, plans the approach, breaks it down, critiques partial results, diagnoses a stall |
| `worker` | produces the candidate and its evidence |
| `verifier` | assesses the exact candidate for responsiveness, completeness, and correctness, and records a verdict |

The thinker is responsible for the work, the worker for the candidate and its
evidence, and the verifier for the assessment. That is guidance in the
presets, not a checked boundary: any role may write any entry, and the checks
read only what was recorded.

Independence is evaluated against the recorded `producers` of the candidate, not
against role names. The same actor string appearing as producer and reviewer is
not independent regardless of the roles it claimed.

These four are responsibilities, not personas, and they do not vary by project:
a record means the same thing in every repository that uses one. A specialist is
expressed alongside them, not as a fifth role:

| | |
|---|---|
| role | the canonical responsibility a record names |
| actor | who performed it |
| skill | the specialist knowledge they brought |
| policy | the prose saying when that specialist is worth using |

So a security review by a specialist agent is recorded as a `verifier`
assessment whose `actor` says who it was:

```yaml
assessments:
  - candidate: 007c7f8
    role: verifier
    actor: security-reviewer@codex
    verdict: accept
```

The project's policy may say that authentication changes want a security
specialist, and the host may create or invoke one. Neither adds a role: the
toolkit does not compile policy into roles, and the four responsibilities stay
comparable across repositories.

Only `role` and `actor` in that table are record fields. Skill and policy are
how the work is done, not something a record carries.

## Skills

Ordinary reusable procedures. Loading a skill grants no authority and activates
nothing. No skill requires a prior command. Agents may use project, user, and
host skills directly alongside these: each role uses one its host exposes, or
one the user or working policy points to, when it fits the step at hand. The
deliverable goes where the task asks; plans, decisions, evidence, and verdicts
go where the record conventions say.
See [docs/skill-anatomy.md](docs/skill-anatomy.md#project-and-host-skills).

## Policy is prose

The project's working policy is an ordinary sentence or paragraph in
`.castwork/project.md`. The toolkit does not compile prose into rules.
Checkable requirements are declared per task.

## Files

```
.castwork/
  project.md        prose: setup facts, working policy, pointers
  tasks/            one Markdown record per task
  decisions/        one Markdown file per durable decision
  generated.json    tracked ownership manifest for generated files
  local/            gitignored machine-specific state
castwork.json    project configuration: hosts, per-host role settings,
                    role routes
```

Nothing else is written under `.castwork/`.

## Getting started

Install it from GitHub with `npm install --save-dev github:bartoszarendt/castwork`,
then `npx castwork setup --host <name>` installs for the hosts you name. See
[docs/getting-started.md](docs/getting-started.md).

## What this is not

Not an agent host, graph runtime, autonomous controller, rigid universal
workflow, transcript archive, skill marketplace, policy engine, semantic
database, action registry, or automated coordinator. Structure is added only when a named
consumer requires it.
