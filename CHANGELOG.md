# Changelog

## 0.5.0

Breaking reset. There is no migration path from 0.4.x and no compatibility mode,
alias, or deprecated command. Existing records under `.agenticloop/tasks/` and
`.agenticloop/decisions/` are left untouched; `setup` refuses a 0.4.x layout and
prints the manual steps.

Agentic Loop is now a small, portable vocabulary for agent work: Markdown task
records carrying work, candidates, evidence, and assessments; four role presets;
five reusable skills; thin adapters for three hosts; and a few pure checks.
Agents choose the workflow. Hosts execute it.

The host ids are `codex`, `claude`, and `opencode` — each host's own command
name. The bundled skills are `task-record-contract`, `verification-evidence`,
`assessment`, `decision-capture`, and `blocked-state`.

If a pre-release build wrote `claude-code` into your `agenticloop.json`, change
that value to `claude` before running `setup` or `update`. Both read the file
before applying `--host`, so an unknown host id is refused first and the error
lists the known ids. There is no alias: 0.5.0 is the first release, so there is
nothing to stay compatible with.

**Added**

- A documented record format with a `schema` field, a nine-value status
  vocabulary, and three requirement kinds: `checks`, `independent_review`, and
  `assessment_roles`.
- Pure checks, exported from the package, reporting three separate outputs:
  structural validity, reference availability, and requirement evaluation. Each
  supporting fact is reported as `checked` or `asserted`.
- `.agenticloop/generated.json`, a tracked ownership manifest. `update` skips a
  modified generated file unless `--force-generated` names it, and `remove`
  deletes only entries whose digest still matches.

**Changed**

- 13 command paths, down from 110.
- Machine configuration lives only in `agenticloop.json` at the target root.
  `project.md` is prose, including the project's working policy.
- Evidence and assessments bind to an explicit candidate reference an agent
  records, never to the repository's moving HEAD.
- Roles are concise responsibility and boundary presets with no mandatory
  delegation sequence. The four ids are unchanged.
- snake_case for every machine field and enum value; kebab-case for command
  names.
- `config.json` carries per-host role settings and nothing else. Role ids,
  descriptions and bodies come from `agents/*.md`, and every bundled skill is
  projected to every selected host.

**Removed**

Activation and the activation store, grants, revocation, host trust, receipts
and signatures, hardened mode, event logging, dispatch packets, handoff
preflight, readiness, prepare and verify return, execution attempts, repair and
remediation protocols, the transition contract and refusal catalogue, the
semantic evaluator, audit records, certificates, gates, overrides and waivers,
closeout, workflow evidence commits, parallel scan and lane state, worktree
guards, the GitHub backend and its projection, improvement capture, guidance
blocks, hydrate, setup certificates, layout migration, retry and review budgets,
and the Copilot and Cursor adapters.

Also removed: the shipped root `manifest.json` and `agenticloop.template.json`,
neither of which 0.5.0 installs or reads; the unread `config.json` keys,
including the role-to-skill lists; and four generic skills — `ponytail`,
`frontend-design-quality`, `tdd-implementation`, and `debugging-before-fixes` —
whose content is engineering practice rather than how to use these records.

Agentic Loop reports what was recorded and who asserted it. It does not prove
who wrote a record.

---

Release history for 0.4.7 and earlier is in Git history, last present at commit
`2d8cd99`.
