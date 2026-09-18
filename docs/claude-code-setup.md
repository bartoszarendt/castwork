# Claude Code setup

> **Status:** 0.5.0. Behavior not yet implemented is marked *planned*.

## Install

From the root of your repository:

```sh
npx agenticloop setup
```

Select `claude-code` when asked, or set it directly in `agenticloop.json`:

```json
{ "hosts": ["claude-code"] }
```

then run `npx agenticloop update`.

## What is generated

```
.claude-plugin/
  plugin.json        registers the agenticloop plugin
.claude/
  agents/            the four role presets, as subagents
  skills/            reusable procedures
  commands/          the /agenticloop:start entry command
```

All of it is tracked and contains no absolute paths. The files are listed in
`.agenticloop/generated.json`; edit one and `update` reports and skips it rather
than overwriting your change.

## Using it

In the repository, run:

```
/agenticloop:start
```

It reads `.agenticloop/project.md`, your working policy, and the open tasks,
then hands off. Nothing needs to be activated first, and the command takes an
optional task id or description as ordinary context.

The four roles are available as subagents. Invoking one is a choice, not a
required sequence — there is no delegation prerequisite and no order the toolkit
enforces.

## Permissions

`config.json` sets `acceptEdits` for the `maintainer` and `engineer` roles by
default, since both are expected to write files. Change it in `agenticloop.json`
under `role_settings` if your project wants something tighter. Permissions are
the host's mechanism; Agentic Loop only passes them through.

## Model bindings

Optional, in `agenticloop.json`:

```json
{
  "hosts": ["claude-code"],
  "models": { "engineer": "claude-opus-5", "auditor": "claude-sonnet-5" }
}
```

A binding is a plain string passed to the host. It is runtime configuration, not
role identity, and it never changes what an assessment means.

## Recording work

Claude Code edits `.agenticloop/tasks/*.md` directly — they are ordinary
Markdown. Use the CLI where it does something better than an edit:

```sh
npx agenticloop task lint T-001
npx agenticloop task set T-001 status done
```

When recording an assessment, write an `actor` string that identifies the
session, for example `maintainer@claude-code`. Independence is judged by
comparing that string against the candidate's producers.

## Troubleshooting

`npx agenticloop doctor` reports the installation state read-only, and
`npx agenticloop validate` checks the generated output. If the command does not
appear, confirm `.claude-plugin/plugin.json` exists and that `agenticloop.json`
lists `claude-code` in `hosts`.
