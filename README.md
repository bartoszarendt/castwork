# Castwork

**A small, portable vocabulary for agent work.** Markdown task records carrying
work, candidates, evidence, and assessments; four role presets based on the
[TRINITY](https://arxiv.org/abs/2512.04695) role model; reusable skills; thin
adapters for Codex, Claude Code, and OpenCode; and a few pure checks over what
the records say.

Code, documents, analyses: any result that lives in a repository and can be
checked.

Agents choose the workflow. Hosts execute it.

Castwork reports what was recorded and who asserted it; it does not prove
who wrote a record.

> **Status:** 0.7.0 is current.

## Why

Agents drift scope, conflate producing a result with proving it, and lose
context between sessions. A shared record helps.

The previous version of this toolkit answered that with a full lifecycle:
activation, dispatch, receipts, gates, closeout. In sustained field use the
control plane began spending its effort governing itself — agents repaired and
reconciled workflow artifacts while the product work was already correct.

So the lifecycle is gone. What remains is the part that earned its place: a
record format agents can read and write by hand, and checks that tell you
whether what a task declared it needed has actually been obtained.

## Install

```sh
npx castwork setup --host codex --host claude
```

Name the hosts you want; `--host` is repeatable and takes `codex`,
`claude`, or `opencode`. There is no prompt — `setup` never asks a question
it could be told, and a run with no hosts and none recorded refuses rather than
guessing. Later runs reuse the `hosts` recorded in `castwork.json`, so
`npx castwork setup` on its own is enough once it is installed.

This generates host integrations for the hosts you named and creates
`.castwork/` in your repository. Generated files are tracked and contain no
absolute paths.

```sh
npx castwork doctor          # read-only diagnosis, including whether generated files are current
npx castwork update --check  # list what update would change; write nothing
npx castwork update          # refresh generated files; refuses before writing on a conflict
npx castwork remove     # remove generated files, keep your records
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
    producers: [worker@claude]
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
  - candidate: 007c7f8
    role: verifier
    actor: verifier@codex
    verdict: accept
    host: codex
    model: openai/gpt-5.6-sol
    at: "2026-09-18T13:02:10Z"
---

## Intent
Users should be greeted by name.

## Acceptance criteria
- `greet("Ada")` returns `"Hello, Ada"`.
```

The record declares what it needs. The checks report whether it was obtained.

```sh
npx castwork task lint T-001
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
| `decision new <title>`, `decision list [--json]` | decision records |
| `snapshot [--json]` | name the uncommitted working tree as a `tree:<sha>` candidate |
| `version`, `help` | |

Fifteen command paths. A dedicated command exists only where it does something
materially better than editing the record by hand — everything else is a text
edit. See [docs/cli.md](docs/cli.md).

## The one refusal

`task set <id> status done` refuses, without writing, when a declared
requirement is not satisfied. That is the only place the toolkit declines to do
what you asked, and it is validation on one value — not an authorization gate.
Every other field and every direct edit is unrestricted. Failed checks and
rejecting assessments are always recordable.

## Roles

The role model is based on *TRINITY: An Evolved LLM Coordinator* (Xu et al.,
[arXiv:2512.04695](https://arxiv.org/abs/2512.04695)). In TRINITY a small
coordinator picks, turn by turn, a model and one of three roles: a **Thinker**
that plans, decomposes, and critiques; a **Worker** that makes concrete
progress; and a **Verifier** that checks whether the result is correct,
complete, and responsive. The paper evaluates the same three roles on coding,
math, reasoning, and knowledge benchmarks, and removing the role split lowered
its average score.

Castwork keeps those responsibilities and adds what the paper leaves open:
work grounded in a real repository, durable records instead of a transcript,
verdicts bound to an exact candidate, and declared requirements, not a single
accept, deciding when a task is done. It is based on TRINITY's role model, not
an implementation of TRINITY: there is no learned coordinator.
[docs/background.md](docs/background.md) sets out the paper's findings, how the
project applies them, and what it does not adopt.

| Role | Responsibility |
|---|---|
| `coordinator` | decides which roles act next and keeps the user informed |
| `thinker` | turns a request into work: intent, scope, acceptance criteria, requirements; plans the approach and breaks it into tasks; critiques and diagnoses |
| `worker` | produces the candidate and its evidence |
| `verifier` | assesses the exact candidate: responsive, complete, correct |

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

- [CASTWORK.md](CASTWORK.md) — the vocabulary and its rules
- [docs/record-format.md](docs/record-format.md) — the record contract
- [docs/cli.md](docs/cli.md) — the command paths
- [docs/getting-started.md](docs/getting-started.md) — first task, end to end
- [docs/host-adapters.md](docs/host-adapters.md) — how generation works
- [docs/downstream-adoption.md](docs/downstream-adoption.md) — adopting it in a project

## Requirements

Node 22 or newer.

## License

MIT
