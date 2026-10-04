# Claude Code setup

## Install

From the root of your repository, install Castwork from GitHub, then run `setup`:

```sh
npm install --save-dev github:bartoszarendt/castwork
npx castwork setup --host claude
```

`setup` does not prompt; name the host on the command line, or set it in `castwork.json`:

```json
{ "hosts": ["claude"] }
```

then run `npx castwork update`.

The host id is `claude`. If a pre-release build left `claude-code` in your
`castwork.json`, edit it to `claude` first: `setup` and `update` both read
the file before applying `--host`, so an unknown id is refused before anything
is written, with the known ids listed in the error.

## What is generated

```
.claude/agents/<role>.md                the four role presets, as subagents
.claude/commands/castwork.md         the entry command
.claude/skills/castwork/SKILL.md     an index of the procedures
.claude/skills/castwork/references/  one file per reusable procedure
```

All of it is tracked and contains no absolute paths. The files are listed in
`.castwork/generated.json`; edit one and `update` writes nothing until you
restore it or name it with `--force-generated`. Your change is never
overwritten, and a conflict never leaves some files updated and others not.

## Using it

In the repository, run:

```
/castwork
```

The command instructs the session to act as the `coordinator`, read the role
presets under `.claude/agents/`, read `.castwork/project.md`, your working
policy, the documents it points to, and the open tasks, then continue the
requested work, delegating when useful. Without a request, it proposes the next
step from the open tasks and those documents and asks before starting it. Nothing needs to be activated first, and the command takes an optional
task id or description as ordinary context.

The generated skill index carries `disable-model-invocation: true`, so Claude
never loads Castwork on its own initiative: you invoke it, by running
`/castwork` or by asking for it.

The four roles are available as subagents. Delegating to one is a choice, not a
required sequence — there is no delegation prerequisite and no order the
toolkit enforces.

## Permissions

`permission_mode` is `acceptEdits` for the `thinker` and `worker` roles by
default, since both are expected to write files: the thinker writes task
records, the worker the result. It is emitted into the
generated file as the host's own `permissionMode` key. Override it per role
under `role_settings` below, or set it to `null` to leave the key out entirely.

That configures what is written into the subagent file; what Claude Code then
does with it is the host's call. A parent session running in `acceptEdits`,
`bypassPermissions`, or an auto mode may not narrow to a subagent's stricter
value. Permissions are the host's mechanism; Castwork only passes them
through.

## Model bindings and reasoning effort

Optional, in `castwork.json`:

```json
{
  "hosts": ["claude"],
  "role_settings": {
    "claude": {
      "worker": { "model": "claude-opus-5" },
      "verifier": { "model": "claude-sonnet-5", "effort": "xhigh" }
    }
  }
}
```

Claude Code accepts `model`, `permission_mode`, and its native `effort` setting,
emitted unchanged in subagent frontmatter. Claude Code documents
`low`, `medium`, `high`, `xhigh`, and `max`.

Effort is not extended thinking: Claude Code subagents inherit the main
conversation's thinking configuration and have no per-subagent setting for it.

Castwork passes the value through without interpreting it, so a vocabulary
Claude Code adds later works here on the day it adds it. A binding is runtime
configuration, not role identity, and it never changes what an assessment
means.

## Recording work

Claude Code edits `.castwork/tasks/*.md` directly — they are ordinary
Markdown. Use the CLI where it does something better than an edit:

```sh
npx castwork task lint T-001
npx castwork task set T-001 status done
```

When recording an assessment, write an `actor` string that identifies the
session, for example `verifier@claude`. Independence is judged by
comparing that string against the candidate's producers.

## Troubleshooting

`npx castwork doctor` reports the installation state read-only, and
`npx castwork validate` checks the generated output. If the command does not
appear, confirm `.claude/commands/castwork.md` exists and that
`castwork.json` lists `claude` in `hosts`.
