# OpenCode setup

## Install

From the root of your repository, install Castwork from GitHub, then run `setup`:

```sh
npm install --save-dev github:bartoszarendt/castwork
npx castwork setup --host opencode
```

`setup` does not prompt; name the host on the command line, or set it in `castwork.json`:

```json
{ "hosts": ["opencode"] }
```

then run `npx castwork update`.

The same `opencode` host and generated files support OpenCode v1 and v2.
V2 reads this shared agent, command, and skill format through its compatibility
layer; converting generated files to native v2 fields would break v1 support.
After upgrading Castwork, run `npx castwork update` and start a new host session.

## What is generated

```
.opencode/agents/<role>.md              the four role presets
.opencode/commands/castwork.md       the entry command
.opencode/skills/castwork/SKILL.md   an index of the procedures
.opencode/skills/castwork/references/  one file per reusable procedure
```

All of it is tracked and contains no absolute paths. The files are listed in
`.castwork/generated.json`; edit one and `update` writes nothing until you
restore it or name it with `--force-generated`, so your change is never
overwritten, and a conflict never leaves some files updated and others not. A
file of yours
standing where one would be generated refuses `setup` and `update` the same
way.

## Using it

Open OpenCode in the repository and run the start command. It instructs the
session to act as the `coordinator`, read the role presets under
`.opencode/agents/`, read `.castwork/project.md`, your working policy, the
documents it points to, and the open tasks, then continue the requested work,
delegating when useful. Without a request, it proposes the next step from the
open tasks and those documents and asks before starting it. That
is prompt-level instruction; OpenCode's own agent selection stays on whatever
agent is active, unless you switch to `coordinator` with Tab. There is nothing
to activate first.

The four roles are available as agents. The generated `thinker`, `worker`, and
`verifier` set `mode: all`, so they can run directly or as subagents in either
version. Without it, v1 defaults custom agents to `all`, while v2 defaults them
to `primary` and refuses to launch them as subagents. Delegating to a role is a
choice, not a required sequence.

The generated `SKILL.md` is described by when to use Castwork rather than
by what to do, so OpenCode has a reason not to reach for it during unrelated
work. Its frontmatter also sets `disable-model-invocation: true`, which v2
reads to hide it from the model's available skills while keeping explicit
invocation available. V1 ignores that flag, so the description remains its
session-level guidance. The generated `thinker`, `worker`,
and `verifier` agents deny themselves the skill instead, with
`permission: { skill: { castwork: deny } }` in their frontmatter: it is the
coordinator's entry command, and each role file links the procedures it uses
under `## Procedures`.

## Model bindings, reasoning effort, and variants

Optional, in `castwork.json`:

```json
{
  "hosts": ["opencode"],
  "role_settings": {
    "opencode": {
      "worker": { "model": "openai/gpt-5.6", "variant": "high" },
      "verifier": { "model": "openai/gpt-5.6", "variant": "high" }
    }
  }
}
```

OpenCode accepts `model` and `variant`.

For both versions, write `model` as `provider/model` and `variant` as a
separate setting. `variant` selects a named bundle defined on that model,
which may set reasoning effort, verbosity, or other provider options. Choose
one the provider supports. An inline `provider/model#high` is refused with a
hint to separate the settings: v1 reads it as a literal model id, and v2's
legacy agent parser can drop the binding. A `variant` without a `model` is
refused too: v2 drops a variant whose agent names no model, and a variant name
means something only for the model that defines it.

The former `reasoning_effort` setting is refused. Remove it and choose a
supported variant with an explicit model. Both versions support variants;
Castwork does not translate effort into a variant, since they need not mean
the same thing. Direct provider options in v2's per-agent `request.body` are
not sent to the model by the runner in the builds checked, so adding a nested
request field would not provide the missing behavior.

Local probes on v1 `1.18.34`, v2 preview `0.0.0-beta-19271`, and v2 `2.0.22`
confirmed role loading, command and skill discovery, and outgoing request
settings using a local mock endpoint. The former direct effort option sent
`high` in v1 but `medium` in both v2 builds;
selecting the `high` model variant sent `high` in v2. These probes do not establish
a complete delegated workflow. See OpenCode's
[migration guide](https://opencode.ai/v2/docs/migrate-v1/),
[agent request limitation](https://opencode.ai/v2/docs/agents/#request), and
[skill invocation settings](https://opencode.ai/v2/docs/skills/#frontmatter).

A binding is runtime configuration, not role identity.

## Recording work

OpenCode edits `.castwork/tasks/*.md` directly — they are ordinary Markdown.
Use the CLI where it does something better than an edit:

```sh
npx castwork task lint T-001
npx castwork task set T-001 status done
```

## Troubleshooting

`npx --no castwork doctor` reports the installation state read-only, and
`npx --no castwork validate` checks the generated output. If OpenCode does
not see the roles, confirm `.opencode/` is present and that `castwork.json`
lists `opencode` in `hosts`.

When a session does not behave as the presets say:

- **Start a new session** after every `update`, and after installing a skill.
  OpenCode reads agent and skill files when it starts, so a running session
  keeps what it read, and a hand edit to a generated file changes nothing in
  it. Sessions started before global skills were installed never saw them.
- **Check the copy that runs.** `npx --no castwork version` prints the
  version number of the package this repository runs, and
  `npx --no castwork doctor` prints its version and location and which build
  wrote the generated files. A pinned older version generates older presets
  whatever the toolkit now says.
- **Check the generated role files** under `.opencode/agents/` contain the text
  you expect, such as the `## Procedures` section and the `permission` block,
  and that `npx --no castwork update --check` reports them current.
- **Check the skills OpenCode exposes** to the session and to each agent. A role
  can only pick a skill its host lists.
- Castwork needs no `subagent_depth` above 1: a role started by another
  agent starts no agents of its own.
