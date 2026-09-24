# Getting started

Agentic Loop gives your agents a shared way to record work, candidates,
evidence, and assessments, and a way to check whether a task got what it
declared it needed. It does not tell them how to work.

## 1. Install

From the root of the repository you want to work in:

```sh
npx agenticloop setup --host codex --host claude --host opencode
```

Name the hosts you want. `--host` is repeatable and accepts `codex`,
`claude`, and `opencode`; `setup` does not prompt, and refuses rather than
guessing if you name none and none are recorded. It writes:

```
.agenticloop/
  project.md        prose: setup facts, working policy, pointers
  tasks/
  decisions/
  generated.json    tracked ownership manifest
  local/            gitignored
agenticloop.json    project configuration: hosts, per-host role settings
```

plus the host directories for the hosts you named. They are recorded under
`hosts` in `agenticloop.json`, so later `setup` and `update` runs reuse them and
need no flags, and naming another host later adds it rather than replacing what
is there. Commit all of it except `.agenticloop/local/`, which `setup` adds to
your `.gitignore`. Generated files contain no absolute paths, so they work for
everyone who clones the repository — a contributor does not run `setup` to pick
a host of their own, because `hosts` says which hosts the project supports.

If `setup` finds a 0.4.x installation it refuses and prints the manual steps. It
will not migrate or overwrite anything.

## 2. Write the working policy

`.agenticloop/project.md` is prose. Put your project's working policy there in a
sentence or a paragraph — how careful to be, what needs a second pair of eyes,
when to ask. Agents read it. The toolkit does not compile it into rules.

> Work in small commits. Anything touching billing gets an independent review
> before it is marked done. Ask before adding a dependency.

If the project has a plan, spec, or roadmap, list it under `## Documents` and
say which one says what comes next. That is where the coordinator looks to
report where the work is and to propose the next step:

> - `docs/PLAN.md`: the current phase and what comes next.
> - `docs/architecture.md`: how the system fits together.

Project configuration does not go here; it lives in `agenticloop.json`.

## 3. Create a task

```sh
npx agenticloop task new "Greet by name"
```

That writes `.agenticloop/tasks/T-001.md`:

```markdown
---
schema: 1
id: T-001
title: Greet by name
status: draft
---

## Intent

## Scope

## Out of scope

## Acceptance criteria
```

Edit it by hand. It is ordinary Markdown and nothing objects.

## 4. Declare what the task needs

Requirements are the one thing the toolkit checks. Add only what you actually
want enforced:

```yaml
requirements:
  checks: [test, lint]
  independent_review: true
```

- `checks: [name, ...]` — every named check needs a passing evidence entry.
- `independent_review: true` — someone whose actor string is not among the
  candidate's producers has to accept it.
- `assessment_roles: [verifier]` — the named role has to accept it.

A task with no `requirements` block is legitimate. Nothing is imposed.

## 5. Do the work and record it

The agent implements, then records what it produced and what it observed:

```yaml
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
```

`ref` is normally a commit. Evidence binds to that exact candidate, never to
whatever HEAD happens to be later. `actor` is a free string the agent writes,
like `worker@claude`; the toolkit compares such strings and reports them
as asserted. `host`, `model` and `at` are optional — record them when the record
must stay self-contained or comparable without host-local telemetry. Use the
exact model id reported by the host and an RFC 3339 timestamp; they remain
asserted, informational metadata.

## 6. Check it

```sh
npx agenticloop task lint T-001
```

Three separate outputs, never merged:

- **Structural validity** — is the record well formed?
- **Reference availability** — does `007c7f8` resolve here? `available`,
  `unavailable`, or `not_checked`. Unavailable is not an error; it may resolve
  in another checkout.
- **Requirement evaluation** — `satisfied`, `not_satisfied`, or `unknown` per
  requirement, with a reason code, and each supporting fact marked `checked` or
  `asserted`.

`--json` gives you the same three outputs for a script.

## 7. Get it reviewed

Independence is about actor strings, not roles:

```yaml
assessments:
  - candidate: 007c7f8
    role: verifier
    actor: verifier@codex
    verdict: accept
    host: codex
    model: openai/gpt-5.6-sol
    at: "2026-09-18T13:02:10Z"
```

`verifier@codex` is not in `producers`, so `independent_review` is satisfied.
Had the same actor produced and reviewed the candidate, it would not be —
whatever roles it claimed.

A `reject` or `needs_revision` leaves the requirement unsatisfied until a later
assessment by that actor changes it. Record it honestly; nothing stops you.

## 8. Mark it done

```sh
npx agenticloop task set T-001 status done
```

This is the one place the toolkit refuses: if a declared requirement is not
satisfied, it declines and writes nothing. Every other field and every direct
edit is unrestricted, and the record stays readable and editable either way.

## Day to day

```sh
npx agenticloop task list          # what is open
npx agenticloop task show T-001    # one record, --json for the checks
npx agenticloop doctor             # is the installation healthy (see docs/cli.md)
npx agenticloop decision new "Store money as minor units"   # a durable decision
```

## When a candidate changes

Add a new candidate. Earlier evidence and assessments concern the old one and
are simply not applied to the new one — no diagnostic is raised against them,
and nothing is invalidated. Re-record evidence for the new candidate.

## What you will not find

No activation step, no dispatch, no receipts, no gates, no closeout. An
authorized task starts by editing a file. If a tool ever seems to require a
ceremony before you can begin, that is a bug.
