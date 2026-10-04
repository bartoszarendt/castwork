# Host adapters

An adapter is a thin projection of the canonical roles, skills, and entry
command into the layout one host expects. A host is a template directory, not
special machinery.

## Supported hosts

| Host | Generated into |
|---|---|
| `codex` | `.codex/agents/` (TOML) and `.agents/skills/castwork/`, including its `agents/openai.yaml` invocation policy |
| `claude` | `.claude/agents/`, `.claude/commands/`, `.claude/skills/castwork/` |
| `opencode` | `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/castwork/` |

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
`config.json` contributes only the per-host settings, and the entry command
and the coordinator close with the routes `role_routes` sets from that host
(see [Role routes](#role-routes)). The one substitution in a
role's body is `<host>`, which becomes the adapter's `id`, so a generated role
records `worker@claude` rather than leaving an agent to guess what a host is.
A canonical role ends with one line naming the procedure skills it uses, such
as ``Procedure skills: `assessment`, `verification-evidence`.``. The Claude
Code plugin installs the canonical file as written, so that line is how a
plugin role finds its procedures, which the plugin exposes as its own skills
(`castwork:assessment`). Generation replaces the line with a closing
`## Procedures` section linking each one at the path this host's adapter
generates it to, so a generated role names them once and reaches them without
loading the entry skill. Each host is a descriptor in
`src/adapters/<host>.json` listing where each kind of file goes and in which
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
deciding whether to load Castwork on its own — so it names when to use
Castwork and when not to. There is no fallback between them: an imperative
written for a command the user invoked reads, as a skill description, like an
invitation to start orchestrating work nobody asked about.

Where a host documents a way to say "this skill is invoked, not inferred", its
adapter declares it. Codex gets a `literal` file at
`.agents/skills/castwork/agents/openai.yaml` setting
`policy.allow_implicit_invocation` to `false`. Claude Code gets
`disable-model-invocation: true` in the skill index frontmatter, through the
adapter's `skill_frontmatter` map. Explicit invocation — `$castwork` in
Codex, `/castwork` in Claude Code — is unaffected. OpenCode 1.x documents no
such key for the skill itself, so for a session the description is the only
lever. Its agents can refuse a skill, though: the adapter's
`delegated_role_frontmatter` gives the generated `thinker`, `worker`, and
`verifier` `permission: { skill: { castwork: deny } }`, which hides the entry
skill from them. The coordinator keeps it.

## Host differences

| | OpenCode | Claude Code | Codex |
|---|---|---|---|
| A subagent starts with | its task prompt | its task prompt | a fork of its parent's conversation |
| Nesting | `subagent_depth` defaults to 1, so a subagent cannot start one | by default a subagent can start subagents of its own, up to three layers below the main conversation; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes that (1 turns nesting off), and a subagent without `Agent` in its tools cannot start one | the runtime tells a spawned agent it may spawn its own; no depth limit is documented, only a cap on concurrent agents |
| Implicit entry-skill invocation | refused for the delegated roles by a per-agent `permission.skill` deny; otherwise the description | refused by `disable-model-invocation: true` | refused by `allow_implicit_invocation: false` |

Castwork's design wants fresh context, since the task record is the
handoff, and one level of delegation: a role started by another agent starts
no agents, since what it delegated would be invisible to the agent that started
it and recorded under the wrong actor. The hosts differ in what they allow, so
this is preset guidance, not a host setting, and it holds on every host. On
Codex a role starts with the conversation it was forked from, so every preset
says the record is authoritative and an inherited conversation is background.
No role needs deeper nesting, so OpenCode's `subagent_depth` can stay at 1.

## Ownership

Every generated file is listed in `.castwork/generated.json` with its digest.
That manifest is tracked alongside the files it describes.

- `update` regenerates a file only when its current digest matches the manifest.
  A file you edited makes the whole update write nothing, unless you name it
  with `--force-generated`, so a conflict never leaves some files updated and
  others not.
- A file that is not in the manifest is never written over unless you name it.
  If generation would collide with a file you own, the collision is reported,
  nothing is written, and your file is preserved. A file that already holds
  exactly what would be generated is adopted instead.
- `remove` deletes only manifest entries whose digest still matches, and never
  touches `project.md`, `tasks/`, or `decisions/`.

This is the whole ownership model. There is no certificate, no layout version
negotiation, and no repair path.

## Portable project host-generation configuration

`castwork.json` at the target root holds which hosts to generate for, any
per-host role settings, and any [role routes](#role-routes). It describes the
repository, not the machine it is checked out on: `hosts` names the hosts the
project supports, and every `role_settings` value and `role_routes` entry is a
choice the project made on purpose. Everything it
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
Settings are for the `thinker`, `worker`, and `verifier`; a `coordinator`
entry is refused.

A binding is fixed configuration: it changes only when someone edits
`castwork.json`. It is the project's alternative to the per-turn model
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

Values are passed through and never interpreted. Castwork does not know
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

Configuration lives here and nowhere else. `.castwork/project.md` is prose,
and `.castwork/local/` is reserved for machine-local state: it is gitignored
working space, not a second configuration layer that overrides this file.

## Role routes

A role normally runs as a subagent of the host the coordinator works in.
`role_routes` says the project prefers another host for a role: the
coordinator, working in Claude Code, can have the worker run in the Codex CLI as
a separate process, and have that result verified back in Claude Code.

```json
{
  "hosts": ["claude", "codex"],
  "role_routes": {
    "worker": "codex",
    "verifier": "claude"
  },
  "role_settings": {
    "codex": { "worker": { "model": "gpt-5.4", "reasoning_effort": "high" } }
  }
}
```

- The routable roles are `thinker`, `worker`, and `verifier`. The coordinator is
  the session that routes, and it runs wherever Castwork was invoked.
- A route is a host id, and it must be one of the hosts this repository
  generates for, because the delegate reads the role file generated for that
  host. A route to a host that is not generated is refused before anything is
  written; `setup --host` adds it.
- A route has no fallback to configure. When its host cannot run the role, the
  role runs in the host doing the routing, and the coordinator says so. When
  running in the other host is the point, such as a review by a different model
  family, say so in the task record or the working policy: that work is then
  left open instead, as `needs_context` or an unassessed point.
- A routed role's model and reasoning are its settings under the route's host:
  `role_settings.codex.worker` above. They are optional; without them the
  delegate runs with its CLI's own configuration. A `model` on the route itself
  is refused, because a model id belongs to one host and the route names which.
- A route to the host doing the routing is no route: the Codex coordinator in
  the example starts its own `worker` subagent as usual.

Generation writes the routes into each host's entry command, under
`### Routes from this host`, with the role file the delegate reads first, the
actor it records (`<role>@<route host>`), and the
settings to pass: `model`, `reasoning_effort`, and `variant`. Permission
settings are not listed, because the delegation capability chooses the run's
permissions from what the role has to write. The same routes close the
generated coordinator role, with the path of the entry file that holds the
procedure, so a coordinator started directly as the host's agent sees them too.
The other role files are unchanged. The entry command's `## Role routes`
section tells the coordinator the rest:

- **Detection by description.** The coordinator starts a routed role through a
  delegation capability its host exposes, or one the working policy points to
  by path: a skill, command, subagent, or tool whose description says it runs a
  bounded task in a separate agent CLI process. It is matched by what it does,
  never by its name, provider, or where it is installed, and never searched for
  or installed. One with a vague description cannot be recognized; that is the
  limit of matching by description, and a shared metadata key would make it a
  registry.
- **Back to this host only when nothing can have changed.** The role runs in
  the routing host when no capability fits, the target CLI is missing or not
  ready, or a run failed without being able to change a file. A writing run
  that failed partway is reconciled or taken to the user first, never covered
  by a second writer. A delegate that finished with a wrong result is rework,
  not a failed route.
- **The user and the work decide over the route.** A host the user names
  overrides it, and if that host is unavailable the coordinator asks rather
  than running the role here. Work that itself requires the other host is left
  open.

A route is the project's standing request for that separate process, like a
model binding is its standing choice of model. It authorizes nothing else:
commits, other providers, and wider permissions stay where they were.
Availability is never configured or recorded; it is found out each time.
The actor string records where the role actually ran — `worker@codex`, or
`worker@claude` when it ran in the routing host instead — so records need no
field for routing.

## Adding a host

Add a descriptor at `src/adapters/<host>.json` whose `id` is the host's own
command name, listing its files — `role`, `skill`, `command`, `index`, or a
`literal` file whose `content` the descriptor carries; add that id to `HOSTS`
in `src/layout.js`, and add an `adapters.<id>.role_settings` entry to
`config.json` if the host needs per-role defaults. Settings the host accepts go
in its `role_frontmatter` map, which maps the name `castwork.json` uses to
the key the host reads. If the host documents a way to refuse implicit
invocation, put it in `skill_frontmatter` or a `literal` file; frontmatter the
roles a coordinator starts need, such as a permission, goes in
`delegated_role_frontmatter`, a nested map of strings and booleans. Nothing else in
the toolkit should need to know the host exists. If adding a host requires
changing the checks, the record format, or the CLI, the abstraction has leaked
— fix that instead.

## Verifying output

```sh
npx castwork validate
```

checks skills, config, links, and generated adapter output. Read the generated
files too: they are prose an agent will follow, and prose is not covered by a
digest check.
