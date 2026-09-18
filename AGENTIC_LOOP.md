# Agentic Loop

A small, portable vocabulary for agent work.

Agentic Loop provides the task record format and its status vocabulary, pure
checks over recorded facts, four role presets, reusable skills, and thin host
adapters. **Agents choose the workflow. Hosts execute it.**

Agentic Loop interprets what was recorded. It does not prove who recorded it.

**Status:** version 0.5.0, a breaking reset. There is no migration from 0.4.x.

## What the toolkit provides, and what it does not

| Agentic Loop provides | Agent, host, and user decide |
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
requires a delegation sequence.

| Role | Responsibility |
|---|---|
| `engineer` | produces implementation and evidence |
| `maintainer` | shapes work and assesses engineering quality |
| `auditor` | independently assesses a result |
| `orchestrator` | coordinates |

Independence is evaluated against the recorded `producers` of the candidate, not
against role names. The same actor string appearing as producer and reviewer is
not independent regardless of the roles it claimed.

## Skills

Ordinary reusable procedures. Loading a skill grants no authority and activates
nothing. No skill requires a prior command. Agents may use project and host
skills directly alongside these.

## Policy is prose

The project's working policy is an ordinary sentence or paragraph in
`.agenticloop/project.md`. The toolkit does not compile prose into rules.
Checkable requirements are declared per task.

## Files

```
.agenticloop/
  project.md        prose: setup facts, working policy, pointers
  tasks/            one Markdown record per task
  decisions/        one Markdown file per durable decision
  generated.json    tracked ownership manifest for generated files
  local/            gitignored machine-specific state
agenticloop.json    machine configuration: hosts, per-role and per-host
                    model bindings and role settings
```

Nothing else is written under `.agenticloop/`.

## Getting started

`npx agenticloop setup --host <name>` installs for the hosts you name. See
[docs/getting-started.md](docs/getting-started.md).

## What this is not

Not an agent host, graph runtime, autonomous controller, rigid universal
workflow, transcript archive, skill marketplace, policy engine, semantic
database, action registry, or coordinator. Structure is added only when a named
consumer requires it.
