# Pi setup

## Install and trust

From your repository root:

```sh
npm install --save-dev github:bartoszarendt/castwork
npx castwork setup --host pi
```

`setup` does not prompt. You can instead record `{ "hosts": ["pi"] }` in
`castwork.json` and run `npx castwork update`. Naming Pi later adds it without
removing other hosts.

Start Pi in the repository, review the generated files, and run `/trust` once
to allow project resources to load. Then use `/castwork`. Pi 1.0.4 protects
project prompts, skills and extensions with project trust; an untrusted project
does not expose this prompt template. For a disposable automated check,
`--approve` trusts the project for that invocation, without changing global
instructions. Trust controls loading, not tool access or confinement.

## Install pi-subagents

Pi has no built-in subagents. For the coordinator to start the thinker, worker
and verifier, install **pi-subagents** yourself; Castwork does not
install it. Without it, the session takes each role itself and cannot
independently review its own work (see [Delegation inside Pi](#delegation-inside-pi)).

```sh
pi install npm:pi-subagents
```

Then narrow what it loads. In `~/.pi/agent/settings.json`, add `skills` and
`prompts` to the pi-subagents entry `pi install` added, and add `subagents`:

```json
{
  "packages": [
    { "source": "npm:pi-subagents", "skills": [], "prompts": [] }
  ],
  "subagents": { "disableBuiltins": true }
}
```

In `~/.pi/agent/extensions/subagent/config.json`:

```json
{ "toolDescriptionMode": "compact" }
```

Restart Pi. The extension and its `subagent` tool still load. These settings
remove what competes with Castwork:

- its `pi-subagents` skill, which tells the session to work directly unless
  delegation was requested, and which the generated roles would also see
  through `inheritSkills: true`;
- its `council-mode` skill and prompt templates such as `/review-loop` and
  `/parallel-review`, workflows that leave no task record or verifier evidence;
- its builtin agents, such as `reviewer`, `oracle` and `scout`, which the
  coordinator would otherwise start in place of Castwork's verifier and thinker;
- the tool guideline, added when `toolDescriptionMode` is unset, that says not
  to invoke subagents unless the operator asked.

These are global Pi settings and apply in every project.

## What is generated

```text
.pi/agents/coordinator.md
.pi/agents/thinker.md
.pi/agents/worker.md
.pi/agents/verifier.md
.pi/prompts/castwork.md
.pi/skills/castwork/references/<skill>.md
```

There is no Pi `SKILL.md` index, extension, runner, or `settings.json`. Roles
link their procedures by repository-relative path. Commit the generated files:
they contain no absolute paths, and `.castwork/generated.json` records which
files Castwork owns. Edit canonical settings in `castwork.json`
and run `update`, not a generated role. A locally edited projection blocks the
whole update unless explicitly named with `--force-generated`; `remove` keeps
edited files, task records and project prose.

When Codex is generated too, Pi discovers its `.agents/skills/castwork/` entry.
The Codex skill has `disable-model-invocation: true`, which Pi reads, so Pi
does not advertise it to the model. No second Pi skill index is generated. Pi
can still invoke that entry as `/skill:castwork`, but it is written for Codex:
its role files and route list are Codex's, not Pi's. In Pi, use `/castwork`.

## The coordinator and arguments

The coordinator is the session in which you invoke `/castwork`. It reads
`.pi/agents/coordinator.md`; do not start it as a subagent. Pi has no `--agent`
option for starting a standalone session as a named role.

```text
/castwork
/castwork T-004
/castwork add rate limiting
```

Bare invocation orients and proposes a next step before starting. A task id or
request supplies the work to continue, without asking for it again. The prompt
ends with an `## Argument` section containing `${ARGUMENTS:-none}`; Pi expands
it to the parsed argument, or to `none` for a bare `/castwork`, before the
model receives it.

Arguments are parsed text, not the exact typed characters. Pi 1.0.4 splits them
shell-style and joins them with single spaces: quotes are removed, repeated
spaces and line breaks outside quotes collapse, and an unmatched apostrophe in
`don't change auth` yields `dont change auth`. Use `"don't change auth"` to keep
the apostrophe. A literal `$1` supplied as user input is retained: inserted
values are not expanded again. Setup, update and validate refuse any other
dollar sign in the generated prompt, identifying its canonical source or route
setting. This prevents a route model such as `custom-$1` from becoming task
input. Other hosts keep their existing argument handling.

## Delegation inside Pi

`pi-subagents` discovers `.pi/agents/` by default (`agentScope: both`); project
roles win name collisions, and with builtins disabled none remain to collide
with. Restart Pi after installing or refreshing resources. The generated thinker,
worker and verifier opt into:

```yaml
systemPromptMode: append
inheritProjectContext: true
inheritGlobalContext: true
inheritSkills: true
```

These keys request Pi's normal prompt plus the role, repository instructions,
operator global instructions and the skill catalog. They are not Castwork
settings, permissions or record fields. The coordinator has none of these keys.

The upstream `examples/extensions/subagent/` bundled with Pi is a smaller
alternative. Follow its README to load the extension deliberately. It discovers
project roles only with `agentScope: "project"` or `"both"`; interactive runs
ask before using project agents unless the project is trusted. Its source
appends the role to a fresh Pi process with ordinary context and skills and
ignores the extra inheritance keys. Neither extension is shipped by Castwork.
The presets require one level of delegation; do not rely on an extension to
prevent deeper nesting for you.

Without an extension or another delegation capability that can start an agent,
the coordinator may take the needed role itself: announce the change, read and
follow that preset, and record its actor, such as `worker@pi`. A coordinator
started by another agent does not count as unable to delegate; it says which
roles should act next instead. The small-task switch to worker remains available
on every host even with delegation. Taking another role never creates
independence: a session that produced a candidate never accepts it under any
actor. Routes still need a delegation capability to launch a separate process;
a configured route alone cannot start anything.

A task declaring `independent_review` stays unmet until a separate reviewer
accepts it. Without delegation, start a separate Pi session yourself, invoke
`/castwork` with the task id, and ask it to verify: that session did not
produce the candidate, so it can take the verifier role and assess the exact
recorded candidate. Alternatively, route the verifier to another host with
`role_routes`, which needs a delegation capability to start it. A route to Pi
from a Pi session is omitted, because it would start no separate process.

## Model and thinking

Pi supports only `model` in Castwork role settings:

```json
{
  "hosts": ["pi"],
  "role_settings": {
    "pi": { "verifier": { "model": "provider/id:high" } }
  }
}
```

Use a provider/model your account can access. The complete string, including
the thinking suffix, passes through unchanged into the role and a route to Pi.
There is no Castwork `thinking` setting. Retired `reasoning_effort` is refused
with a hint to put thinking in the model suffix. Omit model to use host defaults;
coordinator settings are refused because it is the invoking session.

## Routes and the write boundary

A route from Claude Code or Codex to Pi lists `.pi/agents/<role>.md`, the actor
`<role>@pi` and only the optional model. A separate Pi CLI process does not apply
role frontmatter itself: pass the role through `--append-system-prompt <file>`
or an explicit read-first brief and pass the model with `--model`, including the
suffix. Repeat the role instruction, model and tool restrictions on resume.
A routed role needs no project-resource discovery, so keep `--no-approve` and
read its procedure references by path. Use the delegation capability's own
readiness, monitoring and result-review procedure.

Pi has no sandbox or permission modes. Its built-in tools, shell commands and
extensions run with the user's permissions; a tool allowlist is not filesystem
confinement. Prefer Pi routes for a verifier or thinker. A verifier changes
nothing in the candidate and writes only its assessment/evidence record and
linked findings; compare the candidate before and after. For a routed worker,
take a snapshot first, allow one writer at a time, inspect its edits and reconcile
partial failure before another writer. Use a container or VM when confinement
is required. Never claim a brief or worktree enforces that boundary.

## Support limits

Checked against Pi 1.0.4, pi-subagents 0.76.1 and Codex 0.160.1. Delegation
inside Pi, the upstream example, role-taking without an extension, and routed
Pi roles have not yet been exercised in live sessions. See
[host adapters](host-adapters.md) for the shared contracts.
