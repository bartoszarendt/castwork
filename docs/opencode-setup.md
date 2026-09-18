# OpenCode setup

> **Status:** 0.5.0. Behavior not yet implemented is marked *planned*.

## Install

From the root of your repository:

```sh
npx agenticloop setup
```

Select `opencode` when asked, or set it directly in `agenticloop.json`:

```json
{ "hosts": ["opencode"] }
```

then run `npx agenticloop update`.

## What is generated

```
.opencode/
  agent/       the four role presets
  skill/       reusable procedures
  command/     the start entry command
opencode.json  host configuration, if not already present
```

All of it is tracked and contains no absolute paths. The files are listed in
`.agenticloop/generated.json`; edit one and `update` reports and skips it rather
than overwriting your change. If `opencode.json` already exists and is yours,
the collision is reported and your file is preserved.

## Using it

Open OpenCode in the repository and run the start command. It reads
`.agenticloop/project.md`, your working policy, and the open tasks, then hands
off. There is nothing to activate first.

The four roles are available as agents. Invoking one is a choice, not a required
sequence.

## Model bindings

Optional, in `agenticloop.json`:

```json
{
  "hosts": ["opencode"],
  "models": { "engineer": "claude-opus-5" }
}
```

A binding is a plain string passed to the host. It is runtime configuration, not
role identity.

## Recording work

OpenCode edits `.agenticloop/tasks/*.md` directly — they are ordinary Markdown.
Use the CLI where it does something better than an edit:

```sh
npx agenticloop task lint T-001
npx agenticloop task set T-001 status done
```

## Troubleshooting

`npx agenticloop doctor` reports the installation state read-only, and
`npx agenticloop validate` checks the generated output. If OpenCode does not see
the roles, confirm `.opencode/` is present and that `agenticloop.json` lists
`opencode` in `hosts`.
