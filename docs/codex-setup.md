# Codex setup

## Install

From the root of your repository:

```sh
npx agenticloop setup --host codex
```

`setup` does not prompt; name the host on the command line, or set it:

```json
{ "hosts": ["codex"] }
```

in `agenticloop.json`, then run `npx agenticloop update`.

## What is generated

```
.codex/agents/<role>.toml                     the four role presets
.agents/skills/agenticloop/SKILL.md           the entry procedure and an index
.agents/skills/agenticloop/agents/openai.yaml the invocation policy
.agents/skills/agenticloop/references/        one file per reusable procedure
```

All of it is tracked in your repository and contains no absolute paths. The
files are listed in `.agenticloop/generated.json`; edit one and `update` writes
nothing until you restore it or name it with `--force-generated`, so your change
is never overwritten, and a conflict never leaves some files updated and others
not.

## Using it

Open Codex in the repository and invoke the skill by name:

```
$agenticloop
```

It instructs the session to act as the `coordinator`, read the role presets
under `.codex/agents/`, read `.agenticloop/project.md`, your working policy, the
documents it points to, and the open tasks, then continue the requested work,
delegating when useful. Without a request, it proposes the next step from the
open tasks and those documents and asks before starting it. There is nothing to
activate and no command to run first.

Codex will not start this on its own. The generated
`.agents/skills/agenticloop/agents/openai.yaml` sets

```yaml
policy:
  allow_implicit_invocation: false
```

so the skill is never matched implicitly against whatever you happened to ask
for. Explicit invocation — `$agenticloop`, or picking it from `/skills` — keeps
working. Agentic Loop is a way to record work, not a mode a session should fall
into.

To work as a particular role, point Codex at that role's file under
`.codex/agents/`. Role files are TOML, carrying the role's name, description,
an optional model, and its instructions. A role is a responsibility and boundary preset; loading it
grants no authority and starts no sequence.

## Model bindings and reasoning effort

Optional, in `agenticloop.json`:

```json
{
  "hosts": ["codex"],
  "role_settings": {
    "codex": {
      "worker": { "model": "gpt-5.4" },
      "verifier": { "reasoning_effort": "xhigh" }
    }
  }
}
```

Codex accepts `model` and `reasoning_effort`, which it spells
`model_reasoning_effort` in the generated `.codex/agents/<role>.toml`. Codex
documents `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`, and a value set
in an agent file takes precedence over the surrounding configuration.

Agentic Loop passes the value through without interpreting it, so a vocabulary
Codex adds later works here on the day Codex adds it — and a value Codex does
not accept fails there, not here. A binding is runtime configuration, not role
identity.

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
