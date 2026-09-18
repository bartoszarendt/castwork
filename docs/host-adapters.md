# Host adapters

An adapter is a thin projection of the canonical roles, skills, and entry
command into the layout one host expects. A host is a template directory, not
special machinery.

## Supported hosts

| Host | Generated into |
|---|---|
| `codex` | `.codex/agents/` (TOML) and `.agents/skills/agenticloop/` |
| `claude` | `.claude/agents/`, `.claude/commands/`, `.claude/skills/agenticloop/` |
| `opencode` | `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/agenticloop/` |

Copilot and Cursor adapters were removed in 0.5.0.

## What generation does

`setup` and `update` read the canonical sources at the toolkit root:

```
agents/      the four role presets
skills/      reusable procedures
commands/    the start entry command
config.json  per-host role settings: permission mode
```

and write the host's own files, substituting only what is host-specific:
placement, file naming, and the host's frontmatter conventions. A role's id,
description, and body come from its file under `agents/`; `config.json`
contributes only the per-host settings. Each host is a
descriptor in `src/adapters/<host>.json` listing where each kind of file goes
and in which format; the generator itself knows nothing about any host.

Generated files contain:

- no absolute paths, so the repository stays portable across machines;
- no workflow infrastructure, capability declarations, or activation slots;
- nothing a host cannot act on.

If you find generated output asking an agent to prove something about itself,
that is a bug. The toolkit reports what was recorded; it does not authenticate.

## Ownership

Every generated file is listed in `.agenticloop/generated.json` with its digest.
That manifest is tracked alongside the files it describes.

- `update` regenerates a file only when its current digest matches the manifest.
  A file you edited is reported and skipped, unless you name it with
  `--force-generated`.
- A file that is not in the manifest is never written over. If generation would
  collide with a file you own, the collision is reported and your file is
  preserved.
- `remove` deletes only manifest entries whose digest still matches, and never
  touches `project.md`, `tasks/`, or `decisions/`.

This is the whole ownership model. There is no certificate, no layout version
negotiation, and no repair path.

## Machine configuration

`agenticloop.json` at the target root holds which hosts to generate for, any
per-role model bindings, and any per-host role settings:

```json
{
  "hosts": ["codex", "claude"],
  "models": {
    "engineer": "claude-opus-5",
    "auditor": "claude-sonnet-5"
  },
  "role_settings": {
    "claude": { "auditor": { "reasoning_effort": "xhigh" } },
    "codex": { "auditor": { "model": "gpt-5.4", "reasoning_effort": "high" } }
  }
}
```

Defaults come from the installed package, so there is nothing to point at and
no file to inherit from. Least specific first: the package's defaults, then
`models`, then `role_settings`.

`models` is the shorthand for the single-host case. It applies one string to
every selected host, and model namespaces do not overlap — `claude-opus-5`,
`gpt-5.4` and `openai/gpt-5.6` each name a model to a different host — so it is
refused when more than one host is selected, with a pointer to `role_settings`.
That map is per host, which is what a mixed-host project needs: reasoning
effort is spelled differently in each too.

A setting's value is a string, passed to the host as written, or `null` to
leave it unset — which is how a shipped default such as `permission_mode` is
cleared. An object, a list, a number, a boolean, or an empty string is refused
rather than stringified into a generated file.

Each host declares which settings it accepts, in its adapter's
`role_frontmatter` map:

| Setting | codex | claude | opencode |
|---|---|---|---|
| `model` | `model` | `model` | `model` |
| `permission_mode` | — | `permissionMode` | — |
| `reasoning_effort` | `model_reasoning_effort` | `effort` | `reasoningEffort` |
| `variant` | — | — | `variant` |

A setting a host does not declare is refused with a hint listing what it does
accept, rather than written into a file the host will ignore.

Values are passed through and never interpreted. Agentic Loop does not know
which efforts a host accepts, does not translate one host's vocabulary into
another's, and does not treat two hosts' `high` as the same thing. A value the
host rejects fails there, not here.

A mapping is only ever right for the host version it was written against:
these are Claude Code's and Codex's current agent keys and OpenCode 1.x's.

A binding is optional runtime configuration and never role identity: binding a
model grants no authority and changes no assessment's meaning.

Machine configuration lives here and nowhere else. `.agenticloop/project.md` is
prose.

## Adding a host

Add a descriptor at `src/adapters/<host>.json` whose `id` is the host's own
command name, listing its files; add that id to `HOSTS` in `src/layout.js`, and
add an `adapters.<id>.role_settings` entry to `config.json` if the host needs
per-role defaults. Settings the host accepts go in its `role_frontmatter` map,
which maps the name `agenticloop.json` uses to the key the host reads. Nothing
else in the toolkit should need to know the host exists. If adding a host requires changing the checks, the record format,
or the CLI, the abstraction has leaked — fix that instead.

## Verifying output

```sh
npx agenticloop validate
```

checks skills, config, links, and generated adapter output. Read the generated
files too: they are prose an agent will follow, and prose is not covered by a
digest check.
