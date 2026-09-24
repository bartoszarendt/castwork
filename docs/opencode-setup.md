# OpenCode setup

## Install

From the root of your repository:

```sh
npx agenticloop setup --host opencode
```

`setup` does not prompt; name the host on the command line, or set it in `agenticloop.json`:

```json
{ "hosts": ["opencode"] }
```

then run `npx agenticloop update`.

## What is generated

```
.opencode/agents/<role>.md              the four role presets
.opencode/commands/agenticloop.md       the entry command
.opencode/skills/agenticloop/SKILL.md   an index of the procedures
.opencode/skills/agenticloop/references/  one file per reusable procedure
```

All of it is tracked and contains no absolute paths. The files are listed in
`.agenticloop/generated.json`; edit one and `update` reports and skips it rather
than overwriting your change. A file that is not in the manifest is never
written over: a collision with a file you own is reported and your file kept.

## Using it

Open OpenCode in the repository and run the start command. It instructs the
session to act as the `coordinator`, read the role presets under
`.opencode/agents/`, read `.agenticloop/project.md`, your working policy, the
documents it points to, and the open tasks, then continue the requested work,
delegating when useful. Without a request, it proposes the next step from the
open tasks and those documents and asks before starting it. That
is prompt-level instruction; OpenCode's own agent selection stays on whatever
agent is active, unless you switch to `coordinator` with Tab. There is nothing
to activate first.

The four roles are available as agents. Delegating to one is a choice, not a
required sequence.

The generated `SKILL.md` is described by when to use Agentic Loop rather than
by what to do, so OpenCode has a reason not to reach for it during unrelated
work. OpenCode 1.x documents no key for refusing implicit invocation outright —
Codex and Claude Code do, and their adapters use it — so here the description is
the only lever.

## Model bindings, reasoning effort, and variants

Optional, in `agenticloop.json`:

```json
{
  "hosts": ["opencode"],
  "role_settings": {
    "opencode": {
      "worker": { "model": "openai/gpt-5.6" },
      "verifier": { "reasoning_effort": "high" },
      "thinker": { "variant": "high" }
    }
  }
}
```

OpenCode accepts `model`, `reasoning_effort`, and `variant`.

`reasoning_effort` is emitted as OpenCode's own `reasoningEffort` key, a
provider option passed straight through to the model. `variant` is emitted as
`variant`: a named bundle of options defined on the model, which often sets
reasoning effort but may also set verbosity or a reasoning summary. Use
`reasoning_effort` for the single option and `variant` for a bundle you have
defined or that ships with the provider. A model selector may also carry a
variant inline as `provider/model#high`.

These are the spellings OpenCode 1.x reads. Its v2 configuration schema keeps a
top-level `variant` but routes provider options such as `reasoningEffort`
through a nested `request` object, which this adapter cannot emit — it writes
flat scalar keys only. Moving to v2 will need more than a new key name here.

A binding is runtime configuration, not role identity.

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
