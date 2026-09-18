# Codex setup

## Install

From the root of your repository:

```sh
npx agenticloop setup
```

Select `codex` when asked, or set it directly:

```json
{ "hosts": ["codex"] }
```

in `agenticloop.json`, then run `npx agenticloop update`.

## What is generated

```
.codex/agents/<role>.toml               the four role presets
.agents/skills/agenticloop/SKILL.md     the entry procedure and an index
.agents/skills/agenticloop/references/  one file per reusable procedure
```

All of it is tracked in your repository and contains no absolute paths. The
files are listed in `.agenticloop/generated.json`; edit one and `update` will
report and skip it rather than overwrite your change.

## Using it

Open Codex in the repository and use the `agenticloop` skill. It reads
`.agenticloop/project.md`, your working policy, and the open tasks, then hands
off. There is nothing to activate and no command to run first.

To work as a particular role, point Codex at that role's file under
`.codex/agents/`. Role files are TOML, carrying the role's name, description,
an optional model, and its instructions. A role is a responsibility and boundary preset; loading it
grants no authority and starts no sequence.

## Model bindings

Optional, in `agenticloop.json`:

```json
{
  "hosts": ["codex"],
  "models": { "engineer": "claude-opus-5" }
}
```

A binding is a plain string passed to the host. It is runtime configuration, not
role identity.

## Recording work

Codex edits `.agenticloop/tasks/*.md` directly — they are ordinary Markdown.
Use the CLI where it does something better than an edit:

```sh
npx agenticloop task lint T-001
npx agenticloop task set T-001 status done
```

## Troubleshooting

`npx agenticloop doctor` reports the installation state read-only, and
`npx agenticloop validate` checks the generated output. If Codex does not see
the roles, confirm `.codex/` is present and that `agenticloop.json` lists
`codex` in `hosts`.
