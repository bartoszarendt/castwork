# Agentic Loop repository instructions

This is the Agentic Loop toolkit itself. It provides a small, portable
vocabulary for agent work: Markdown task records carrying work, candidates,
evidence, and assessments, four role presets, reusable skills, thin host
adapters, and a few pure checks. Agents choose the workflow. Hosts execute it.

**Status:** version 0.5.0 is a breaking reset, implemented by Phase 38. Until
that work lands, parts of the documentation describe planned behavior and say
so.

## Layout

| Path | Contents |
|---|---|
| `src/` | the CLI, the record parser, and the pure checks |
| `bin/` | the `agenticloop` entry point |
| `agents/` | the four canonical role presets |
| `skills/` | reusable procedures, one directory per skill |
| `commands/` | the canonical `start` entry command |
| `src/adapters/` | per-host templates for Codex, Claude Code, and OpenCode |
| `memory/` | record templates |
| `test/` | unit tests |
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
- **No authentication.** Agentic Loop reports what was recorded and who asserted
  it. It never claims to prove who recorded it.
- **Candidate references, not HEAD.** Evidence and assessments bind to the
  explicit candidate reference an agent recorded.
- **Generated files carry no absolute paths** and are tracked in the target
  repository. Machine-specific state belongs in the gitignored
  `.agenticloop/local/`.
- **Machine configuration lives only in `agenticloop.json`** at the target root.
  `project.md` is prose.

## Before changing the product

1. Read `AGENTIC_LOOP.md` for the vocabulary and `docs/record-format.md` for the
   record contract.
2. Read the role preset or skill you are changing, and keep it independently
   usable: no skill may require activation or a prior command.
3. Add a concept only when a real consumer needs it. A new requirement kind,
   status value, host, or command must name that consumer.

## Verification

- `npm test` runs the unit suite.
- `npx agenticloop validate` checks skills, config, links, and generated adapter
  output.
- `npm run typecheck` runs the TypeScript checker over the JSDoc types.

Run the suite before reporting a change complete. Prefer removing a concept over
adding one.

## Boundaries

- Do not merge to `main`, tag, release, or publish without explicit owner
  authorization.
- Branch `feat/phase-36-followup` and commit `63cd512` are pinned by downstream
  projects; never delete them.
- Never commit secrets, local runtime state, `.agenticloop/local/`, or the
  `.docs` symlink.
