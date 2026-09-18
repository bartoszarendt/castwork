# Getting started

Agentic Loop gives your agents a shared way to record work, candidates,
evidence, and assessments, and a way to check whether a task got what it
declared it needed. It does not tell them how to work.

## 1. Install

From the root of the repository you want to work in:

```sh
npx agenticloop setup --host codex --host claude-code --host opencode
```

Name the hosts you want. `--host` is repeatable and accepts `codex`,
`claude-code`, and `opencode`; `setup` does not prompt, and refuses rather than
guessing if you name none and none are recorded. It writes:

```
.agenticloop/
  project.md        prose: setup facts, working policy, pointers
  tasks/
  decisions/
  generated.json    tracked ownership manifest
  local/            gitignored
agenticloop.json    machine configuration
```

plus the host directories for the hosts you named. They are recorded under
`hosts` in `agenticloop.json`, so later `setup` and `update` runs reuse them and
need no flags. Commit all of it except
`.agenticloop/local/`, which `setup` adds to your `.gitignore`. Generated files
contain no absolute paths, so they work for everyone who clones the repository.

If `setup` finds a 0.4.x installation it refuses and prints the manual steps. It
will not migrate or overwrite anything.

## 2. Write the working policy

`.agenticloop/project.md` is prose. Put your project's working policy there in a
sentence or a paragraph — how careful to be, what needs a second pair of eyes,
when to ask. Agents read it. The toolkit does not compile it into rules.

> Work in small commits. Anything touching billing gets an independent review
> before it is marked done. Ask before adding a dependency.

Machine configuration does not go here; it lives in `agenticloop.json`.

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
- `assessment_roles: [maintainer]` — the named role has to accept it.

A task with no `requirements` block is legitimate. Nothing is imposed.

## 5. Do the work and record it

The agent implements, then records what it produced and what it observed:

```yaml
candidates:
  - ref: 007c7f8
    producers: [engineer@claude-code]
evidence:
  - { check: test, candidate: 007c7f8, result: pass, command: "npm test", exit_code: 0 }
  - { check: lint, candidate: 007c7f8, result: pass }
```

`ref` is normally a commit. Evidence binds to that exact candidate, never to
whatever HEAD happens to be later. `actor` is a free string the agent writes,
like `engineer@claude-code`; the toolkit compares such strings and reports them
as asserted.

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
  - { candidate: 007c7f8, role: maintainer, actor: maintainer@codex, verdict: accept }
```

`maintainer@codex` is not in `producers`, so `independent_review` is satisfied.
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
npx agenticloop doctor             # is the installation healthy
npx agenticloop decision new       # record a durable decision
```

## When a candidate changes

Add a new candidate. Earlier evidence and assessments concern the old one and
are simply not applied to the new one — no diagnostic is raised against them,
and nothing is invalidated. Re-record evidence for the new candidate.

## What you will not find

No activation step, no dispatch, no receipts, no gates, no closeout. An
authorized task starts by editing a file. If a tool ever seems to require a
ceremony before you can begin, that is a bug.
