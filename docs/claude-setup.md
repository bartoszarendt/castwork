# Claude Code setup

## Install

From the root of your repository:

```sh
npx agenticloop setup --host claude
```

`setup` does not prompt; name the host on the command line, or set it in `agenticloop.json`:

```json
{ "hosts": ["claude"] }
```

then run `npx agenticloop update`.

## What is generated

```
.claude/agents/<role>.md                the four role presets, as subagents
.claude/commands/agenticloop.md         the entry command
.claude/skills/agenticloop/SKILL.md     an index of the procedures
.claude/skills/agenticloop/references/  one file per reusable procedure
```

All of it is tracked and contains no absolute paths. The files are listed in
`.agenticloop/generated.json`; edit one and `update` reports and skips it rather
than overwriting your change.

## Using it

In the repository, run:

```
/agenticloop
```

It reads `.agenticloop/project.md`, your working policy, and the open tasks,
then hands off. Nothing needs to be activated first, and the command takes an
optional task id or description as ordinary context.

The four roles are available as subagents. Invoking one is a choice, not a
required sequence — there is no delegation prerequisite and no order the toolkit
enforces.

## Permissions

`config.json` sets `permission_mode: acceptEdits` for the `maintainer` and
`engineer` roles by default, since both are expected to write files. It is
emitted into the generated file as the host's own `permissionMode` key.
Permissions are the host's mechanism; Agentic Loop only passes them through.

## Model bindings

Optional, in `agenticloop.json`:

```json
{
  "hosts": ["claude"],
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
session, for example `maintainer@claude`. Independence is judged by
comparing that string against the candidate's producers.

## Troubleshooting

`npx agenticloop doctor` reports the installation state read-only, and
`npx agenticloop validate` checks the generated output. If the command does not
appear, confirm `.claude/commands/agenticloop.md` exists and that
`agenticloop.json` lists `claude` in `hosts`.
