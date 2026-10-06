# Downstream adoption

How to adopt Castwork in a project that has its own way of working, and what
you are committing to.

> **Status:** 0.9.0 is current.

## What you are adopting

A record format, four role presets, reusable skills, host adapters, and a few
pure checks. Castwork does not decide how your agents work, what order they
do things in, or when to ask you. It gives them a shared way to write down what
happened and a way to check whether a task got what it declared it needed. The
one exception is the entry command run without a request: it proposes a next
step from your records and plan and asks before starting it.

## What it costs

- One directory, `.castwork/`, and one config file, `castwork.json`.
- Generated host directories for the hosts you pick, tracked in your repository.
- No mandatory step before an authorized task starts. No mandatory bookkeeping
  commit.

If adopting it makes your agents spend time on the toolkit instead of your
product, it is not earning its place. Castwork was rebuilt to avoid that failure; see
[background.md](background.md).

## Install

Castwork is not published to npm; install it from GitHub as a development
dependency of the repository you want to work in, then run `setup` with the
copy you installed. Add `#<commit>` to the dependency to pin one commit.

```sh
npm install --save-dev github:bartoszarendt/castwork
npx castwork setup --host codex
```

`--host` is repeatable and takes `codex`, `claude`, or `opencode`. The
choice is recorded in `castwork.json`, so later runs need no flags.

Commit everything it writes except `.castwork/local/`. Generated files carry
no absolute paths, so a colleague who clones the repository gets a working
installation without running anything.

Pin a commit in your `package.json` (`github:bartoszarendt/castwork#<commit>`)
if you want reproducible generation.

## Fitting it to an existing project

**Your working policy is prose.** Put it in `.castwork/project.md` in plain
language. The toolkit does not parse it. Keep it short and let it evolve from
what recurs: when a task stalls for a reason likely to come back, the thinker
proposes an edit in the task record, and you decide whether it goes in.
Replacing or removing a stale sentence is better than adding another.

**Point to your plan.** If the project has a plan, spec, or roadmap, list it
under `## Documents` in `project.md` and say which one says what comes next.
The coordinator reads it to report where the work is and to propose the next
step. `setup` and `update` never rewrite `project.md`, so a project set up
before this section existed has to add it by hand.

**Declare requirements only where you mean them.** A task with no `requirements`
block is normal. Start with `checks: [test]` on work that has tests, and add
`independent_review: true` only where a second pair of eyes genuinely matters.
Every requirement you declare is one the task must satisfy before it can be
marked done.

**Name your checks after your commands.** If your test command is `npm test`,
call the check `test`. The name is yours; the toolkit only matches strings.

**Keep your own task tracker if you have one.** Castwork keeps its records in
files only. Your agents can use GitHub issues and pull requests through their
host's normal tools; Castwork neither reads nor writes them.

## Upgrading the toolkit

Generated files are tracked, so adopting a new version of Castwork is a
small change to your repository, like a lockfile bump. There is no way to adopt
it without one, and no command that reloads a host session that is already
running.

`update` regenerates from the copy of Castwork you run and never installs
or upgrades the package itself. Upgrade the package first — or, to adopt a
local checkout, run `node <checkout>/bin/castwork.js` in place of
`npx castwork`.

**Check which copy runs.** `npx --no castwork` runs the copy installed in
this repository, and that copy decides what every command means. Before you
rely on a read-only flag such as `update --check`, run
`npx --no castwork version`, which prints that copy's version number, and
`npx --no castwork doctor`, which prints its version and location and the
version and `source_digest` of the copy that last wrote the generated files.
Since 0.6.0 an unknown flag is refused before anything is written, but an older
copy may read `update --check` as `update` and write.

**What a pinned install means.** A version or commit pinned in `package.json`
is the copy every agent session runs, whatever the presets upstream now say.
Updating the toolkit means moving that pin (and the lockfile), then running
`update` with the new copy. A copy older than the one that wrote the
generated files refuses to write over them.

**A clean upgrade.**

```sh
npx castwork update --check   # what would change; writes nothing
npx castwork update           # apply it; refuses before writing on a conflict
```

`update` lists every path it wrote, `.castwork/generated.json` included.
Review them and commit them together, with the package or lockfile upgrade that
caused them, apart from task work. If `update`
refuses, it names each generated file you edited, or file of yours standing
where one is generated: restore or move it, or pass `--force-generated <path>`
to replace it. Your records are never touched. Neither is `project.md`: when a
release adds a section to the scaffold, the changelog says so and you add it by
hand.

**Upgrading in the middle of work.** `update` writes only generated files and
`.castwork/generated.json`, so it can run in a working tree that holds
unfinished work. Commit exactly the paths it listed, then close the host
session and start
a new one with the entry command and the task id (`/castwork T-012`, or
`$castwork T-012` in Codex). The session you close keeps the old
instructions for as long as it runs; the task record carries the work across,
which is what it is for. A resumed session still has the old instructions in
its history, so run the entry command again at once if you resume instead.

**Changing models.** A model you prefer, or the one your account can reach, is
a personal choice: leave model and effort or variant settings unset in
`castwork.json` and set them in the host's own configuration. New sessions
pick it up, and the repository never changes. A model the project means to pin
for a role goes under `role_settings.<host>.<role>` in `castwork.json`: run
`update`, commit both, and start a new session. See
[host-adapters.md](host-adapters.md) for the settings each host accepts.

## Removing it

```sh
npx castwork remove
```

Deletes the generated files it still owns and leaves `project.md`, `tasks/`, and
`decisions/` in place. Your records are ordinary Markdown and remain readable
without the toolkit installed — that is the point of the format.

## What you should not expect

Castwork does not prove who wrote a record. An `actor` is a string an agent
typed. The toolkit compares strings and tells you they matched or did not; it
reports every such fact as asserted. If you need authenticated identity, you
need something else, and no setting here will give it to you.
