# Downstream adoption

How to adopt Agentic Loop in a project that has its own way of working, and what
you are committing to.

> **Status:** 0.5.0, a breaking reset. There is no migration path from 0.4.x.

## What you are adopting

A record format, four role presets, reusable skills, host adapters, and a few
pure checks. Agentic Loop does not decide how your agents work, what order they
do things in, or when to ask you. It gives them a shared way to write down what
happened and a way to check whether a task got what it declared it needed.

## What it costs

- One directory, `.agenticloop/`, and one config file, `agenticloop.json`.
- Generated host directories for the hosts you pick, tracked in your repository.
- No mandatory step before an authorized task starts. No mandatory bookkeeping
  commit.

If adopting it makes your agents spend time on the toolkit instead of your
product, it is not earning its place. That failure mode is why 0.5.0 exists.

## Install

```sh
npx agenticloop setup --host codex
```

`--host` is repeatable and takes `codex`, `claude-code`, or `opencode`. The
choice is recorded in `agenticloop.json`, so later runs need no flags.

Commit everything it writes except `.agenticloop/local/`. Generated files carry
no absolute paths, so a colleague who clones the repository gets a working
installation without running anything.

Pin the version in your `package.json` if you want reproducible generation.

## Fitting it to an existing project

**Your working policy is prose.** Put it in `.agenticloop/project.md` in plain
language. The toolkit does not parse it.

**Declare requirements only where you mean them.** A task with no `requirements`
block is normal. Start with `checks: [test]` on work that has tests, and add
`independent_review: true` only where a second pair of eyes genuinely matters.
Every requirement you declare is one the task must satisfy before it can be
marked done.

**Name your checks after your commands.** If your test command is `npm test`,
call the check `test`. The name is yours; the toolkit only matches strings.

**Keep your own task tracker if you have one.** Agentic Loop is files only in
0.5.0 — there is no GitHub backend or projection. Your agents can use GitHub
through their host's normal tools; the toolkit simply has no opinion about it.

## Upgrading the toolkit

```sh
npx agenticloop update
```

Regenerates files whose digest still matches `.agenticloop/generated.json`.
Anything you edited is reported and skipped; pass `--force-generated <path>` to
overwrite it deliberately. Your records are never touched.

## Removing it

```sh
npx agenticloop remove
```

Deletes the generated files it still owns and leaves `project.md`, `tasks/`, and
`decisions/` in place. Your records are ordinary Markdown and remain readable
without the toolkit installed — that is the point of the format.

## Coming from 0.4.x

There is no migration. `setup` and `update` refuse a 0.4.x layout and print the
manual steps: remove the old generated files, keep your records, run `setup`.

Your old task records will not satisfy the 0.5.0 format and are not rewritten
for you. They stay where they are, readable. Port the ones you still care about
by hand — in practice that means adding `schema: 1` and moving what you want
checked into a `requirements` block.

Commands you may be looking for are gone rather than renamed: activation,
dispatch, handoff, readiness, review, audit, closeout, worktree, improvement,
guidance, hydrate, and the GitHub family. There are no aliases and no deprecated
forms. See [cli.md](cli.md) for the thirteen that remain.

## What you should not expect

Agentic Loop does not prove who wrote a record. An `actor` is a string an agent
typed. The toolkit compares strings and tells you they matched or did not; it
reports every such fact as asserted. If you need authenticated identity, you
need something else, and no setting here will give it to you.
