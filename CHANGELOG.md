# Changelog

## 0.5.0

Breaking reset. There is no migration path from 0.4.x and no compatibility mode,
alias, or deprecated command. Existing records under `.agenticloop/tasks/` and
`.agenticloop/decisions/` are left untouched; `setup` refuses a 0.4.x layout and
prints the manual steps.

Agentic Loop is now a small, portable vocabulary for agent work: Markdown task
records carrying work, candidates, evidence, and assessments; four role presets;
reusable skills; thin adapters for Codex, Claude Code, and OpenCode; and a few
pure checks. Agents choose the workflow. Hosts execute it.

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

Agentic Loop reports what was recorded and who asserted it. It does not prove
who wrote a record.

---

Release history for 0.4.7 and earlier is in Git history, last present at commit
`2d8cd99`.
