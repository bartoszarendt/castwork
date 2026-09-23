# Host adapters

An adapter is a thin projection of the canonical roles, skills, and entry
command into the layout one host expects. A host is a template directory, not
special machinery.

## Supported hosts

| Host | Generated into |
|---|---|
| `codex` | `.codex/agents/` (TOML) and `.agents/skills/agenticloop/`, including its `agents/openai.yaml` invocation policy |
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
placement, file naming, the host's frontmatter conventions, and any literal
file the host reads as configuration rather than prose.

A role's id, description, and body come from its file under `agents/`;
`config.json` contributes only the per-host settings. Each host is a descriptor
in `src/adapters/<host>.json` listing where each kind of file goes and in which
format; the generator itself knows nothing about any host.

Generated files contain:

- no absolute paths, so the repository stays portable across machines;
- no workflow infrastructure, capability declarations, or activation slots;
- nothing a host cannot act on.

If you find generated output asking an agent to prove something about itself,
that is a bug. The toolkit reports what was recorded; it does not authenticate.

## Invoked, not inferred

The entry command carries two descriptions. `description` is projected into a
command file, which runs because the user asked for it by name.
`skill_description` is projected into the skill index, which a host reads when
deciding whether to load Agentic Loop on its own — so it names when to use
Agentic Loop and when not to. There is no fallback between them: an imperative
written for a command the user invoked reads, as a skill description, like an
invitation to start orchestrating work nobody asked about.

Where a host documents a way to say "this skill is invoked, not inferred", its
adapter declares it. Codex gets a `literal` file at
`.agents/skills/agenticloop/agents/openai.yaml` setting
`policy.allow_implicit_invocation` to `false`. Claude Code gets
`disable-model-invocation: true` in the skill index frontmatter, through the
adapter's `skill_frontmatter` map. Explicit invocation — `$agenticloop` in
Codex, `/agenticloop` in Claude Code — is unaffected. OpenCode 1.x documents no
such key, so there the description is the only lever there is.

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

## Portable project host-generation configuration

`agenticloop.json` at the target root holds which hosts to generate for and any
per-host role settings. It describes the repository, not the machine it is
checked out on: `hosts` names the hosts the project supports, and every
`role_settings` value is a choice the project made on purpose. Everything it
contains ends up in tracked generated files, which is what makes a clone work
without running anything.

```json
{
  "hosts": ["codex", "claude"],
  "role_settings": {
    "claude": { "worker": { "model": "claude-opus-5" }, "verifier": { "reasoning_effort": "xhigh" } },
    "codex": { "verifier": { "model": "gpt-5.4", "reasoning_effort": "high" } }
  }
}
```

Defaults come from the installed package, so there is nothing to point at and
no file to inherit from. The package's defaults first, then `role_settings`.

Settings are per host because model namespaces do not overlap: `claude-opus-5`,
`gpt-5.4` and `openai/gpt-5.6` each name a model to a different host, and
reasoning effort is spelled differently in each too. A model binding is one of
these settings and has no map of its own.

A binding is fixed configuration: it changes only when someone edits
`agenticloop.json`. It is the project's alternative to the per-turn model
selection in the TRINITY paper, not an equivalent of it; see
[background.md](background.md).

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

Omitting a setting is the way to say "whatever this host is already configured
to do". A personal preference — the model your account can reach, the effort
you like — normally belongs in your host's own configuration, not here, because
a value written here is generated into tracked files for everyone. Pin one only
when the repository means it.

Configuration lives here and nowhere else. `.agenticloop/project.md` is prose,
and `.agenticloop/local/` is reserved for machine-local state: it is gitignored
working space, not a second configuration layer that overrides this file.

## Adding a host

Add a descriptor at `src/adapters/<host>.json` whose `id` is the host's own
command name, listing its files — `role`, `skill`, `command`, `index`, or a
`literal` file whose `content` the descriptor carries; add that id to `HOSTS`
in `src/layout.js`, and add an `adapters.<id>.role_settings` entry to
`config.json` if the host needs per-role defaults. Settings the host accepts go
in its `role_frontmatter` map, which maps the name `agenticloop.json` uses to
the key the host reads. If the host documents a way to refuse implicit
invocation, put it in `skill_frontmatter` or a `literal` file. Nothing else in
the toolkit should need to know the host exists. If adding a host requires
changing the checks, the record format, or the CLI, the abstraction has leaked
— fix that instead.

## Verifying output

```sh
npx agenticloop validate
```

checks skills, config, links, and generated adapter output. Read the generated
files too: they are prose an agent will follow, and prose is not covered by a
digest check.
