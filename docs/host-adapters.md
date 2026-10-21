# Host adapters

An adapter is a thin projection of the canonical roles, skills, and entry
command into the layout one host expects. A host is a template directory, not
special machinery.

## Supported hosts

| Host | Generated into |
|---|---|
| `codex` | `.codex/agents/` (TOML) and `.agents/skills/castwork/`, including its `agents/openai.yaml` invocation policy |
| `claude` | `.claude/agents/` and `.claude/skills/castwork/`, whose `SKILL.md` is the `/castwork` entry |
| `opencode` | `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/castwork/` |
| `pi` | `.pi/agents/`, `.pi/prompts/castwork.md`, `.pi/skills/castwork/references/` (no skill index) |

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
(see [Role routes](#role-routes)), and with any [role levels](#role-levels).
After its routes, a generated entry command
carries the coordinator role's text, one heading level down, so a coordinator
started from it has its role without a separate read; the Claude Code plugin
installs `commands/start.md` as written and reads the role file instead. The
one substitution in a
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
- no step an agent must complete before it can start work;
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
`policy.allow_implicit_invocation` to `false`. Codex and Claude Code also get
`disable-model-invocation: true` in the skill index frontmatter, through the
adapter's `skill_frontmatter` map. Explicit invocation — `$castwork` in
Codex, `/castwork` in Claude Code — is unaffected. OpenCode v2 also reads
`disable-model-invocation: true`; v1 ignores it and uses the description as
session-level guidance. Its agents can refuse a skill in both versions: the adapter's
`delegated_role_frontmatter` gives the generated `thinker`, `worker`, and
`verifier` `permission: { skill: { castwork: deny } }`, which hides the entry
skill from them. The coordinator keeps it. The same block sets `mode: all`,
preserving direct and delegated use across v1's `all` and v2's `primary` defaults.

Pi uses a prompt template, not a skill index. It also discovers Codex's
`.agents/skills/` when both hosts are generated, so Codex's skill frontmatter
marker keeps that entry out of Pi's system prompt. The existing Codex policy
file remains, and Codex 0.160.1 accepts the marker.

## Host differences

| | OpenCode | Claude Code | Codex |
|---|---|---|---|
| A subagent starts with | its task prompt | its task prompt | a fork of its parent's conversation |
| Nesting | `subagent_depth` defaults to 1, so a subagent cannot start one | by default a subagent can start subagents of its own, up to three layers below the main conversation; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes that (1 turns nesting off), and a subagent without `Agent` in its tools cannot start one | the runtime tells a spawned agent it may spawn its own; no depth limit is documented, only a cap on concurrent agents |
| Implicit entry-skill invocation | v2 reads `disable-model-invocation: true`; v1 uses the description; delegated roles also deny `permission.skill` in both | refused by `disable-model-invocation: true` | refused by `allow_implicit_invocation: false` |

Castwork's design wants fresh context, since the task record is the
handoff, and one level of delegation: a role started by another agent starts
no agents, since what it delegated would be invisible to the agent that started
it and recorded under the wrong actor. The hosts differ in what they allow, so
this is preset guidance, not a host setting, and it holds on every host. On
Codex a role starts with the conversation it was forked from, so every preset
says the record is authoritative and an inherited conversation is background.
No role needs deeper nesting, so OpenCode's `subagent_depth` can stay at 1.

Pi has no built-in subagents or `--agent` option. The `/castwork` session is the
coordinator; do not start it as a child. Castwork expects the `pi-subagents`
extension, which the operator installs and narrows as described in
[Pi setup](pi-setup.md#install-pi-subagents): without its skills, prompt
templates, builtin agents, and default tool guideline. The thinker,
worker, and verifier carry `systemPromptMode: append`,
`inheritProjectContext: true`, `inheritGlobalContext: true`, and
`inheritSkills: true`; the coordinator carries none of those keys. The upstream
example is a minimal alternative and requires `agentScope: "project"` or
`"both"`. See [Pi setup](pi-setup.md) for trust, write limits, and what has not
yet been checked in live sessions.

On any host, a small task may warrant switching to worker rather than
delegating. Where no subagent or delegation capability can start an agent, the
coordinator may take any role; a coordinator started by another agent does not
qualify. Announce the change, follow its preset, and record its actor.
Taking a role or changing actor names creates no independence: a session that
produced a candidate never accepts it under any actor. A declared
`independent_review` needs a separate accepting reviewer.

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
  touches `project.md`, `tasks/`, `decisions/`, `findings/`, or `reviews/`.

This is the whole ownership model. There is no certificate, no layout version
negotiation, and no repair path.

## Portable project host-generation configuration

`castwork.json` at the target root holds which hosts to generate for, any
per-host role settings, any [role routes](#role-routes), and any
[role levels](#role-levels). It describes the
repository, not the machine it is checked out on: `hosts` names the hosts the
project supports, and every `role_settings` value and `role_routes` entry is a
choice the project made on purpose. Everything it
contains ends up in tracked generated files, which is what makes a clone work
without running anything.

```json
{
  "hosts": ["codex", "claude"],
  "role_settings": {
    "claude": { "worker": { "model": "claude-opus-5" }, "verifier": { "effort": "xhigh" } },
    "codex": { "verifier": { "model": "gpt-5.4", "model_reasoning_effort": "high" } }
  }
}
```

Defaults come from the installed package, so there is nothing to point at and
no file to inherit from. The package's defaults first, then `role_settings`.

Settings are per host because model namespaces do not overlap: `claude-opus-5`,
`gpt-5.4` and `openai/gpt-5.6` each name a model to a different host, and
effort uses each host's own setting name. OpenCode selects a model variant
instead. A model binding is one of these settings and has no map of its own.
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

| Setting | codex | claude | opencode | pi |
|---|---|---|---|---|
| `model` | `model` | `model` | `model` | `model` |
| `permission_mode` | — | `permissionMode` | — | — |
| `model_reasoning_effort` | `model_reasoning_effort` | — | — | — |
| `effort` | — | `effort` | — | — |
| `variant` | — | — | `variant` | — |

Pi accepts only `model`, including an unchanged `provider/id:high` thinking
suffix. There is no Castwork `thinking` setting. Routes to Pi list only this
model setting, not the inheritance keys.

A setting a host does not declare is refused with a hint listing what it does
accept, rather than written into a file the host will ignore.

Values are passed through and never interpreted. Castwork does not know
which efforts a host accepts, does not translate one host's vocabulary into
another's, and does not treat two hosts' `high` as the same thing. A value the
host rejects fails there, not here.

A mapping is only ever right for the host versions that read it. OpenCode uses
the shared v1 agent format, which v2 translates on load. Write its model and
variant as separate settings; inline `model#variant` is refused, and so is a
`variant` without a `model`. A variant is a
provider-defined bundle, not a universal effort level. See
[OpenCode setup](opencode-setup.md).

The former unified `reasoning_effort` setting is no longer accepted. Rename it
to `model_reasoning_effort` for Codex or `effort` for Claude Code. For OpenCode,
remove it and choose a supported `variant` with an explicit `model`; do not
assume a same-named variant has the same effect. For Pi, remove it and put
thinking in the `model` suffix, such as `provider/id:high`. There are no aliases or
automatic conversions. Update the configuration before running `update`, then
start a new host session.

A binding is optional runtime configuration and never role identity: binding a
model grants no authority and changes no assessment's meaning.

Omitting a setting is the way to say "whatever this host is already configured
to do". A personal preference — the model your account can reach, the effort
you like — does not belong here, because a value written here is generated
into tracked files for everyone. Pin one only when the repository means it,
and put your own in [`.castwork/local/castwork.json`](#this-machines-models-and-routes).

The project's configuration lives here and nowhere else.
`.castwork/project.md` is prose, and `.castwork/local/` is gitignored working
space for machine-local state. The one file there that changes generation is
`.castwork/local/castwork.json`, for a single machine, and it chooses models
and routes only.

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
    "codex": { "worker": { "model": "gpt-5.4", "model_reasoning_effort": "high" } }
  }
}
```

- The routable roles are `thinker`, `worker`, and `verifier`. The coordinator is
  the session that routes, and it runs wherever Castwork was invoked.
- A route is a host id, and it must be one of the hosts this repository
  generates for, because the delegate reads the role file generated for that
  host. A route to a host that is not generated is refused before anything is
  written; `setup --host` adds it.
- One machine can route a role, or drop a route, in
  [`.castwork/local/castwork.json`](#this-machines-models-and-routes) without
  changing the project's.
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
settings to pass: every setting the route's host declares, under its names —
`model`, `model_reasoning_effort` (Codex), `effort` (Claude Code), or `variant`
(OpenCode) — except `permission_mode`, because the delegation capability
chooses the run's permissions from what the role has to write. The same routes close the
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
model binding is its standing choice of model; a route in
`.castwork/local/castwork.json` is that machine's. It authorizes nothing else:
commits, other providers, and wider permissions stay where they were.
Availability is never configured or recorded; it is found out each time.
The actor string records where the role actually ran — `worker@codex`, or
`worker@claude` when it ran in the routing host instead — so records need no
field for routing.

## Role levels

A role's `role_settings` binding serves every assignment, so a typo fix and a
migration get the same worker, and a rename and a security change the same
verifier. `role_levels` gives the `thinker`, `worker`, or `verifier` a variant
for `simple` or `complex` assignments beside the role itself, which is
`standard`:

```json
{
  "hosts": ["claude", "codex"],
  "role_settings": {
    "codex": { "worker": { "model": "<balanced>", "model_reasoning_effort": "medium" } }
  },
  "role_levels": {
    "codex": {
      "worker": {
        "simple":  { "model": "<fast>",   "model_reasoning_effort": "low" },
        "complex": { "model": "<strong>", "model_reasoning_effort": "high" }
      }
    },
    "claude": {
      "verifier": { "complex": { "model": "<strong>", "effort": "xhigh" } }
    }
  }
}
```

- **A level describes the assignment, not a ranking of models.** Levels are
  not comparable across roles or hosts. Configure only the ones you want; a
  role without levels runs as it always has.
- **A level is a complete setting set.** It names its `model`, and the effort or
  variant chosen for that model beside it, under the host's own setting names,
  validated against the adapter's `role_frontmatter` like `role_settings`.
  Nothing of the role's own model settings is carried into it. A setting the
  level leaves out is filled by the host, which can pair the level's model with
  an effort chosen for another: Codex, for one, resolves an effort an agent file
  omits from the spawn, its defaults, or the parent session. `validate` warns
  when a level omits an effort setting its host declares.
- **Permissions stay with the role.** `permission_mode` in a level is refused;
  the variant takes it from the role's `role_settings`.
- **Refused:** a `standard` entry (that is `role_settings`), a `coordinator`
  entry, an unknown level, role, host or setting, a level without `model`, and
  any value that is neither a string nor `null`. `null` leaves a setting out,
  as in `role_settings`, so the host fills it. Levels for a host that is known
  but not generated are checked and left unapplied, as role settings are.

Generation writes each level as a variant role file beside the role, named
`<role>_<level>`, such as `.claude/agents/worker_complex.md` or
`.codex/agents/worker_complex.toml`. The variant has the role's body and one
line under its title: the level it runs at, that it records `level` on its
entries, and that its actor names its role or the specialist name it was
given, never the variant's name. Where a role has levels, its own file carries
the same line for `standard`. Actor rules are otherwise unchanged: parallel
reviewers keep their own actors, and a level neither creates nor removes
independence. Variants are owned like every generated file, so `update`
removes one whose level is no longer configured.

The entry command lists the host's levels under `### Levels on this host`,
after its routes, and the generated coordinator closes with the same list and
the path of the entry file. A route lists, for each level its host configures
for the routed role, the variant's role file and the settings to pass. Where no
levels exist, no variants or level lists are generated; the procedure itself
is part of every entry command.

Which level an assignment gets is guidance in the entry command's `## Levels`
section and the thinker's planning:

- The thinker's plan names a level per role for the steps it plans, with a
  reason: what a wrong result would cost, uncertainty, novelty, breadth, and
  earlier failed attempts, never file count alone.
- Without a plan the coordinator may choose `complex` on its own when the
  difficulty is evident, never `simple`, which comes only from a plan or the
  user. A coordinator often runs on the cheapest model in the session: a wrong
  `complex` costs money, a wrong `simple` risks the result.
- The verifier's level follows how hard the candidate is to verify and what a
  wrong acceptance would cost, not the worker's level.
- A level is raised only with a stated reason grounded in the observed
  difficulty or a recorded diagnosis. Nothing escalates on its own.
- A level the user names comes first. A preferred level with no variant runs
  the role itself, and the coordinator says so; a level or model the user or
  the record requires is left `needs_context` instead.

Levels need generated project agents. A Claude Code plugin installed without
`setup` loads its four canonical agents as written, which carry no project
settings, so it runs the roles at their own settings.

A level changes which model runs, and nothing else: requirements, statuses,
candidate binding, independence and authorization are as they were. The level
an agent ran at is recorded as an optional entry attribute; see
[record-format.md](record-format.md).

## This machine's models and routes

`.castwork/local/castwork.json`, gitignored with the rest of `.castwork/local/`,
chooses the models this machine's roles run on, and which of the project's
hosts runs them, without changing the project's configuration. It is yours:
`update` and `remove` never write or delete it.

To run the thinker in Claude Code from this machine, with `claude` among the
`hosts` in `castwork.json`, this is the whole file:

```json
{ "role_routes": { "thinker": "claude" } }
```

Every key is optional. A model for that route, or for any role, goes in
`role_settings` under the host that runs it, and a level `castwork.json`
already declares can take another model in `role_levels`:

```json
{
  "role_settings": {
    "claude": { "thinker": { "model": "opus", "effort": "high" } },
    "pi": { "verifier": { "model": "provider/id:high" } }
  },
  "role_levels": {
    "codex": { "worker": { "complex": { "model_reasoning_effort": "xhigh" } } }
  }
}
```

- It holds `role_settings`, `role_routes`, and `role_levels` and nothing else.
  Hosts and permissions stay the project's; `hosts` and `permission_mode` are
  refused.
- A route here replaces the project's route for that role, and `null` drops
  it, so the role runs in the host that routes it. The project need not route
  anything first, but the route's host must be one `castwork.json` lists in
  `hosts`: a host is generated files every clone carries, so it is the
  project's to add. A local route changes only what the routing host's entry
  command and coordinator say; it adds no file. Its settings are the route
  host's `role_settings` and levels, from this file or the project's.
- Dropping a route does not undo work that itself requires the other host, as
  a task record or the working policy says: that work is still left open, as
  [Role routes](#role-routes) describes.
- Each value is set over the project's, key by key, and is checked the same
  way `castwork.json` is. `null` clears a setting, so the host's own
  configuration decides it: the way to drop a model the project pins that your
  account cannot reach.
- A level must already be declared in `castwork.json`: the local file changes
  its settings, and a level keeps its model. A new level is a variant file
  every clone carries, so it is the project's to add.
- A routed role takes its settings from the local file too, and they reach
  the routing host's coordinator and entry command as well as the role file.

`update` writes this machine's models and routes into the generated files, but
`.castwork/generated.json` keeps the project's digests, so the tracked
manifest is the same on every machine. `.castwork/local/generated.json`
records what this machine wrote, so `update`, `remove`, and `doctor` still
treat those files as generated. `update` and `doctor` list them.

Applying, switching, or dropping your models or routes needs no shared commit: the
manifest stays as it is, so it is `update`, then a new host session. Delete
`.castwork/local/castwork.json` and run `update` to go back to the project's
models and routes.
Whether anything is left to commit is judged against the last commit, so
`update` still says so when the project's output changed in the meantime.

Where the project gitignores its host folders, that is all, and Git sees
nothing. Where generated files are tracked, a file carrying your models reads
as modified, and `update` and `doctor` mark it to be left out of commits. A
clone that receives one in a commit sees it as a generated file modified
locally, which is how the mistake is found. Before pulling a change to such a
file, restore it (`git checkout -- <path>`), pull, and run `update` again.

Leaving the file out is not enough when the project's output for it changes
too, such as a new permission in `castwork.json` or a castwork upgrade: the
committed manifest would name the new output, and a clone holding the old one
would refuse to update. `update` and `doctor` name such a file. Commit the
project's version instead:

1. `update --shared` writes the project's output alone, as if there were no
   `.castwork/local/castwork.json`.
2. Commit the result as usual.
3. `update` puts your models back.

`update --shared` never reads `.castwork/local/castwork.json`, so it works
even when that file no longer fits the project, such as an override of a
level the project dropped. When the project adopts the model your file set, the role file on disk
already holds the project's output but the last commit holds the old one:
`update` and `doctor` name it to commit with the manifest.

`doctor` also asks Git whether `.castwork/local/castwork.json` is ignored and
untracked, so a `.gitignore` that no longer covers `.castwork/local/`, or a
file committed before it was ignored, is reported.

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
the toolkit should need to know the host exists.

A `command` entry with `format: "command"` may declare `arguments`: a non-empty
string containing the host's argument placeholder. Generation then carries
`argument-hint` from `commands/start.md` into frontmatter and appends a closing
`## Argument` section with that string, written literally. Pi declares
`${ARGUMENTS:-none}`. Without this field, command output is unchanged; Claude
Code and OpenCode keep their native argument appending. Invalid declarations
are refused. With it, any other dollar sign in the generated command is refused,
naming its canonical source or `castwork.json role_settings.<host>.<role>.<key>`.
`setup` and `update` generate against the real project configuration before
writing anything; `validate` reports the same refusal even without a manifest.
This prevents a route model such as `custom-$1` from being expanded as user
input by the host. The placeholder is adapter data, not syntax the generator
interprets.

If adding a host requires
changing the checks, the record format, or the CLI, the abstraction has leaked
— fix that instead.

## Verifying output

```sh
npx castwork validate
```

checks skills, config, links, and generated adapter output. Read the generated
files too: they are prose an agent will follow, and prose is not covered by a
digest check.
