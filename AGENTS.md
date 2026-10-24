# Castwork repository instructions

This is the Castwork toolkit itself: shared task records and roles for agent
work. It provides Markdown task records carrying work, candidates,
evidence, and assessments, four role presets, reusable skills, thin host
adapters, and a few pure checks. Agents choose the workflow. Hosts execute it.

**Status:** version 0.9.14 is current.

## Layout

| Path | Contents |
|---|---|
| `src/` | the CLI, the record parser, and the pure checks |
| `bin/` | the `castwork` entry point |
| `agents/` | the four canonical role presets |
| `skills/` | reusable procedures, one directory per skill |
| `commands/` | the canonical `start` entry command |
| `src/adapters/` | per-host templates for Codex, Claude Code, OpenCode, and Pi |
| `memory/` | record templates |
| `tests/` | unit tests |
| `docs/` | public documentation |

Canonical sources live at the repository root. Host directories are generated
projections; never edit generated output by hand and never add a parallel
authoritative copy for one host.

## Rules

- **One spelling per concept.** snake_case for every machine field and enum
  value. kebab-case for CLI command names.
- **Records are ordinary Markdown.** Structured data goes in YAML frontmatter;
  the body is prose. A record stays readable and editable in every state.
- **Checks are pure.** They take a parsed record plus an optional observation
  map and perform no I/O. The CLI gathers observations; the checks never do.
- **No lifecycle.** Do not add a transition graph, state machine, mandatory role
  sequence, delegation prerequisite, retry budget, or authorization gate.
- **No substitute subsystem.** Nothing removed may return under "semantic",
  "history", "policy", "evaluator", or "lane" terminology. If you find yourself
  adding a registry, store, transition table, signature, freshness rule, or
  repair path, stop and remove it.
- **No authentication.** Castwork reports what was recorded and who asserted
  it. It never claims to prove who recorded it.
- **Candidate references, not HEAD.** Evidence and assessments bind to the
  explicit candidate reference an agent recorded.
- **Generated files carry no absolute paths** and are tracked in the target
  repository. Machine-specific state belongs in the gitignored
  `.castwork/local/`.
- **Configuration lives in `castwork.json`** at the target root, and it
  describes the repository rather than the machine: `hosts` are the hosts the
  project supports, and role settings, role routes and role levels are its deliberate
  choices. `project.md` is prose; `.castwork/local/` is machine-local state.
  The one exception is `.castwork/local/castwork.json`, gitignored with that
  state, which chooses one machine's models and reasoning, the model-choice
  keys of `role_settings` and of levels `castwork.json` declares, and its
  `role_routes` among the hosts `castwork.json` lists, and nothing else. It is the user's: `update` and `remove` never write or delete it. It
  never changes the tracked manifest, and its output is never committed.
- **Four roles, and they do not vary by project.** A specialist is an `actor`
  under a canonical role, carrying a skill, chosen by prose policy. Do not add a
  role registry or derive roles from policy.
- **Generated skills are invoked, not inferred.** The entry command's
  `skill_description` says when to use Castwork and when not to, and a host
  that documents a way to refuse implicit invocation gets it from its adapter.

## Before changing the product

1. Read `CASTWORK.md` for the vocabulary and `docs/record-format.md` for the
   record contract.
2. Read the role preset or skill you are changing, and keep it independently
   usable: no skill may require activation or a prior command.
3. Add a concept only when a real consumer needs it. A new requirement kind,
   status value, host, or command must name that consumer.

## Verification

- `npm test` runs the unit suite.
- `npx castwork validate` checks skills, config, links, and generated adapter
  output.
- `npm run typecheck` runs the TypeScript checker over the JSDoc types.
- `claude plugin validate . --strict`, where Claude Code is installed, checks
  the plugin and marketplace manifests: run it when `.claude-plugin/` changes
  and before a release.

Run the suite before reporting a change complete. Prefer removing a concept over
adding one.

For an owner-authorized release from `main`, bump the version in `package.json`
and add a user-facing `CHANGELOG.md` entry. Before publishing, run `npm pack`,
install the tarball in a disposable repository, and verify `setup`, `update`,
and `remove`. Breaking changes get a major-or-minor bump and state in the
changelog that there is no migration path; Castwork does not ship compatibility
shims, aliases, or deprecated commands.

## Boundaries

- Do not merge to `main`, tag, release, or publish without explicit owner
  authorization.
- Branch `feat/phase-36-followup` and commit `63cd512` are pinned by downstream
  projects; never delete them.
- Never commit secrets, local runtime state, `.castwork/local/`, or the
  `.docs` symlink.
