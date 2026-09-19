# Agentic Loop

**A small, portable vocabulary for agent work.** Markdown task records carrying
work, candidates, evidence, and assessments; four role presets; reusable skills;
thin adapters for Codex, Claude Code, and OpenCode; and a few pure checks over
what the records say.

Agents choose the workflow. Hosts execute it.

Agentic Loop reports what was recorded and who asserted it; it does not prove
who wrote a record.

> **Status:** 0.5.0 is a breaking reset. There is no migration path from 0.4.x.

## Why

Coding agents drift scope, conflate implementation with proof, and lose context
between sessions. A shared record helps.

The previous version of this toolkit answered that with a full lifecycle:
activation, dispatch, receipts, gates, closeout. In sustained field use the
control plane began spending its effort governing itself — agents repaired and
reconciled workflow artifacts while the product work was already correct.

So the lifecycle is gone. What remains is the part that earned its place: a
record format agents can read and write by hand, and checks that tell you
whether what a task declared it needed has actually been obtained.

## Install

```sh
npx agenticloop setup --host codex --host claude
```

Name the hosts you want; `--host` is repeatable and takes `codex`,
`claude`, or `opencode`. There is no prompt — `setup` never asks a question
it could be told, and a run with no hosts and none recorded refuses rather than
guessing. Later runs reuse the `hosts` recorded in `agenticloop.json`, so
`npx agenticloop setup` on its own is enough once it is installed.

This generates host integrations for the hosts you named and creates
`.agenticloop/` in your repository. Generated files are tracked and contain no
absolute paths.

```sh
npx agenticloop doctor     # read-only diagnosis
npx agenticloop update     # refresh generated files
npx agenticloop remove     # remove generated files, keep your records
```

`remove` never touches `project.md`, `tasks/`, or `decisions/`.

## A task record

Ordinary Markdown. Structured data in the frontmatter, prose in the body.

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
  - check: test
    candidate: 007c7f8
    result: pass
    command: "npm test"
    exit_code: 0
    host: claude
    model: claude-opus-5
    at: "2026-09-18T12:34:56Z"
  - { check: lint, candidate: 007c7f8, result: pass }
assessments:
  - { candidate: 007c7f8, role: maintainer, actor: maintainer@codex, verdict: accept, host: codex }
---

## Intent
Users should be greeted by name.

## Acceptance criteria
- `greet("Ada")` returns `"Hello, Ada"`.
```

The record declares what it needs. The checks report whether it was obtained.

```sh
npx agenticloop task lint T-001
```

Three separate outputs, never merged: structural validity, reference
availability, and requirement evaluation. Each supporting fact is reported as
**checked** (the CLI observed it) or **asserted** (an agent wrote it).

## Commands

| Command | Purpose |
|---|---|
| `setup`, `update`, `remove`, `doctor` | install lifecycle with ownership tracking |
| `validate` | skills, config, links, generated adapter output |
| `task new`, `task list`, `task show [--json]`, `task lint [--json]` | records and checks |
| `task set <id> <field> <value>` | one safe frontmatter write |
| `decision new <title>` | Create a decision record from the template. |
| `version`, `help` | |

Thirteen command paths. A dedicated command exists only where it does something
materially better than editing the record by hand — everything else is a text
edit. See [docs/cli.md](docs/cli.md).

## The one refusal

`task set <id> status done` refuses, without writing, when a declared
requirement is not satisfied. That is the only place the toolkit declines to do
what you asked, and it is validation on one value — not an authorization gate.
Every other field and every direct edit is unrestricted. Failed checks and
rejecting assessments are always recordable.

## Roles

`engineer` produces implementation and evidence. `maintainer` shapes work and
assesses engineering quality. `auditor` independently assesses a result.
`orchestrator` coordinates.

Each is a responsibility and boundary preset, independently usable, with no
mandatory delegation sequence. Loading a role creates no authority.

`independent_review` compares the reviewer's actor string against the
candidate's recorded producers — not against role names. The same actor as
producer and reviewer is not independent whatever roles it claimed.

## What this is not

Not an agent host, graph runtime, autonomous controller, rigid universal
workflow, transcript archive, skill marketplace, or policy engine. There is no
activation, no receipts, no signatures, no hardened mode, and no GitHub backend.
Structure is added only when a named consumer requires it.

## Documentation

- [AGENTIC_LOOP.md](AGENTIC_LOOP.md) — the vocabulary and its rules
- [docs/record-format.md](docs/record-format.md) — the record contract
- [docs/cli.md](docs/cli.md) — the command paths
- [docs/getting-started.md](docs/getting-started.md) — first task, end to end
- [docs/host-adapters.md](docs/host-adapters.md) — how generation works
- [docs/downstream-adoption.md](docs/downstream-adoption.md) — adopting it in a project

## Requirements

Node 22 or newer.

## License

MIT
