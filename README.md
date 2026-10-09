# Castwork

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-brightgreen.svg)](package.json)

**Shared task records and roles for agent work.**

Castwork keeps agent work clear across sessions: what you asked for, which
result was produced, what was checked, and what is still open. Task records are
Markdown files in your repository, written in a small shared vocabulary — work,
candidate, evidence, assessment — defined once and used by every supported host.
Role guidance covers planning, producing, and reviewing, and a CLI checks the
recorded evidence against each task's declared requirements. Integrations are generated for Claude Code, Codex, OpenCode, and Pi.

Agents choose how to approach the work. The record gives you and the next agent
something concrete to inspect and continue.

> **Status:** pre-1.0 and not yet on npm. Breaking changes are expected; the
> [changelog](CHANGELOG.md) says what changed and what to do. Version 0.9.3 is
> current.

## When it helps

- **Work that spans sessions or hosts.** The next session reads the record
  instead of reconstructing what happened.
- **Work you delegate.** The record shows what was asked, what was produced,
  and what was checked, so you review the result rather than a transcript.
- **Changes that need proof before they count as done.** A task can require
  named checks or an independent review, and the CLI reports whether the record
  shows them for the exact result.
- **Decisions worth keeping.** Decision records outlive the task that made them.

A small, direct edit needs no record; ask your agent for it as usual.

## Read back the work

`npx --no castwork report` shows the project's recorded state, rework, decisions,
and record quality. `report <id>` gives a bounded account of a task's earlier
rounds and current requirements, or of a decision and its mentions. Add `--json`
to retain everything text folds away. It reads records and local Git, writes
nothing, and never replaces the task contract or a review of the candidate.
See [CLI](docs/cli.md#report).

## Why this approach

Castwork comes from running agents on real projects. Each part of its design
answers something that went wrong there.

| Lesson | Design choice | What you get |
|---|---|---|
| Context is lost between sessions. | Intent, scope, decisions, and progress live in repository files. | Another session, host, or person resumes from a record they can inspect. |
| Producing a result and judging it are different jobs. | Separate roles for planning, producing, and reviewing. Independence compares who produced and who reviewed. | You can tell the plan, the result, and the assessment apart, and see whether the review came from someone other than the producer. |
| Checks and reviews drift to a different revision. | Evidence and assessments name the exact candidate: a commit or a snapshot. | A pass for an earlier revision does not count for a new one. |
| Requiring review everywhere creates work without value. | Each task declares its own requirements. | Checks and review where the consequences warrant them, none where they do not. |
| Workflow administration can crowd out the product work. | Records are edited directly, and agents choose the workflow. | Routine work carries little procedural overhead. |

The last lesson cost the most. An earlier version enforced a full task
lifecycle, and in sustained use agents spent their effort keeping the workflow
consistent while the product work was already correct. Castwork keeps only the
record and the checks over it. [docs/background.md](docs/background.md) covers
this and the research behind the roles.

## Quick start

Requires Node.js 22 or newer. Castwork is not published to npm; install it from
GitHub as a development dependency of the repository you want to work in, then
run `setup` for the hosts you use:

```sh
npm install --save-dev github:bartoszarendt/castwork
npx castwork setup --host claude --host codex
```

`--host` is repeatable and takes `claude`, `codex`, `opencode`, or `pi`. Later runs
reuse the hosts recorded in `castwork.json`. Add `#<commit>` to the dependency
to pin one commit.

`setup` creates `.castwork/` with `project.md`, `tasks/`, and `decisions/`,
plus the files each host needs. Commit all of it except `.castwork/local/`; the
generated files contain no absolute paths, so they work for everyone who clones
the repository.

Write your working policy in `.castwork/project.md`: a few sentences on how
careful to be, what needs a review, and when to ask. Agents read it as written.

Then start your agent in the repository and invoke Castwork:

| Host | Invocation |
|---|---|
| Claude Code, OpenCode, Pi | `/castwork` |
| Codex | `$castwork` |

On its own, it reads your policy, the documents the policy points to, and the
open task records, reports where things stand, and proposes a next step. It asks
before starting that step. With a task id or a request — `/castwork T-004`,
`/castwork add rate limiting to the login endpoint` — it does that work and
writes a record where the work warrants one.

[docs/getting-started.md](docs/getting-started.md) walks through a first task
end to end.

## An example

```
/castwork Renewals charge the request locale's currency instead of the
subscription's. Fix it; it needs tests, lint, and an independent review.
```

One way this can go — the agents choose:

1. The thinker writes task `T-011`: intent, scope, acceptance criteria, and the
   requirements `checks: [test, lint]`, `independent_review: true`, and
   `assessment_roles: [verifier]`.
2. A worker in Claude Code fixes it, commits `8c1d004`, and records the test
   and lint results against that commit.
3. A verifier in Codex reviews `8c1d004` and records `accept` with its findings.

Afterwards you can see what the record supports:

```sh
npx castwork task lint T-011
```

Illustrative output, with an example commit id:

```
Structural validity
-------------------
valid

Reference availability
----------------------
available    candidate  8c1d004  (current)

Requirement evaluation
----------------------
satisfied      checks:test  (evidence.pass)
               asserted  evidence for test on 8c1d004 is pass
               asserted  recorded exit_code 0
satisfied      checks:lint  (evidence.pass)
               asserted  evidence for lint on 8c1d004 is pass
               asserted  recorded exit_code 0
satisfied      independent_review  (actor.independent)
               asserted  accepting actor verifier@codex
               asserted  candidate producers worker@claude
               checked   verifier@codex is not among the producers
satisfied      assessment_roles:verifier  (assessment.accepted)
               asserted  effective verifier verdicts: accept
```

Each fact is marked **checked**, when the CLI observed it, or **asserted**, when
an agent wrote it. Castwork evaluates recorded claims: it does not prove that a
test ran, and it does not authenticate the people or agents behind actor names.

`npx castwork task set T-011 status done` refuses while a declared requirement
is unmet. `task lint` also reports unmet requirements when a record has been
marked done by hand. Every other field is an ordinary edit. The full record is in
[docs/examples/delegated.md](docs/examples/delegated.md), and the format in
[docs/record-format.md](docs/record-format.md).

## Roles and skills

The roles are based on the role model of *TRINITY: An Evolved LLM Coordinator*
(Xu et al., [arXiv:2512.04695](https://arxiv.org/abs/2512.04695)), in which a
coordinator assigns each turn to a thinker, a worker, or a verifier. Castwork
grounds those roles in a real repository, with durable records and verdicts
bound to an exact candidate. It is not an implementation of TRINITY: there is no
learned coordinator.

| Role | Responsibility |
|---|---|
| `coordinator` | decides which roles act next and keeps you informed |
| `thinker` | examines the problem and the approach, before or during the work: turns a request into work (intent, scope, acceptance criteria, requirements), plans, breaks work into tasks, critiques, and diagnoses stalls and disputes |
| `worker` | produces the candidate and its evidence |
| `verifier` | assesses the exact candidate: responsive, complete, correct |

Each role is usable on its own, with no required order, and loading one grants
no authority. The thinker, worker, and verifier can each have their own model
and settings per host under `role_settings` in `castwork.json`. The
coordinator uses the settings of the session in which you invoke Castwork.
`role_routes` can run a role in another host — for example, to have Codex
review work produced in Claude Code. See
[docs/host-adapters.md](docs/host-adapters.md#role-routes).

Castwork bundles five skills for working with its records:
`task-record-contract`, `verification-evidence`, `assessment`,
`decision-capture`, and `blocked-state`. Guidance for the work itself —
planning, debugging, testing, review — comes from your project or your host.
[Agent Skills](https://github.com/bartoszarendt/agent-skills) provides reusable
guidance for how agents work; Castwork gives that work a shared record and role
structure. They can be used together, and each is independently usable.

## Day-to-day commands

```sh
npx castwork task list          # task records and statuses
npx castwork task lint T-011    # what one record satisfies
npx castwork decision list      # decisions recorded so far
npx castwork doctor             # installation health, including generated files
npx castwork update             # refresh generated files after upgrading
npx castwork remove             # remove generated files; records stay
```

[docs/cli.md](docs/cli.md) lists every command and flag.

## Scope

Castwork does not run agents, order their work, or grant permissions. Your host
runs the agents; you and your project's policy decide what is authorized.

## Documentation

- [docs/getting-started.md](docs/getting-started.md) — first task, end to end
- [docs/downstream-adoption.md](docs/downstream-adoption.md) — adopting it in an existing project
- [Claude Code](docs/claude-setup.md), [Codex](docs/codex-setup.md), [OpenCode](docs/opencode-setup.md), and [Pi](docs/pi-setup.md) setup
- [docs/record-format.md](docs/record-format.md) — the record contract
- [CASTWORK.md](CASTWORK.md) — the vocabulary and its rules
- [docs/cli.md](docs/cli.md) — commands and flags
- [docs/host-adapters.md](docs/host-adapters.md) — how host files are generated
- [docs/background.md](docs/background.md) — design experience and the TRINITY role model

## Contributing

[AGENTS.md](AGENTS.md) describes the repository layout and the rules for
changes. Run `npm test` and `npx castwork validate` before proposing one.

## License

[MIT](LICENSE)
