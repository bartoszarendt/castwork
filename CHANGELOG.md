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
lists the known ids. Likewise, move any `models` map to
`role_settings.<host>.<role>.model`. There is no alias: 0.5.0 is the first
release, so there is nothing to stay compatible with.

**Added**

- Generated skills are invoked, not inferred. The entry command carries a
  `skill_description` — separate from its command `description`, with no
  fallback between them — that says when to use Agentic Loop and when not to.
  Codex additionally gets `.agents/skills/agenticloop/agents/openai.yaml` with
  `policy.allow_implicit_invocation: false`, and Claude Code gets
  `disable-model-invocation: true` in its skill index. Explicit invocation
  (`$agenticloop`, `/agenticloop`) is unaffected. Adapters can now declare a
  `literal` file and `skill_frontmatter`, so this stayed a descriptor change.
- A documented record format with a `schema` field, a nine-value status
  vocabulary, and three requirement kinds: `checks`, `independent_review`, and
  `assessment_roles`.
- Block scalars in record frontmatter: `|` and `>` with strip, clip, and keep
  chomping, so a long `findings` or `note` no longer makes the record
  unparseable. Folding preserves the breaks around more-indented content, and
  malformed mapping or tab indentation is refused rather than reinterpreted.
- Pure checks, exported from the package, reporting three separate outputs:
  structural validity, reference availability, and requirement evaluation. Each
  supporting fact is reported as `checked` or `asserted`.
- `.agenticloop/generated.json`, a tracked ownership manifest. `update` skips a
  modified generated file unless `--force-generated` names it, and `remove`
  deletes only entries whose digest still matches.

**Changed**

- 13 command paths, down from 110.
- The examples now show the optional `host`, `model`, and `at` attributes on an
  evidence entry and an assessment, and `docs/record-format.md` states the YAML
  subset the frontmatter parser accepts and refuses.
- YAML anchors, aliases and tags are refused explicitly; they are never read as
  literal strings with a different meaning from a full YAML parser.
- `independent_review` and `assessment_roles` are distinguished where they are
  declared: the first asks for an accept from anyone who is not a recorded
  producer, the second for an accept from a specific role.
- Configuration lives only in `agenticloop.json` at the target root, and it
  describes the repository rather than the machine: `hosts` are the hosts the
  project supports, not the one a contributor happens to run, and role settings
  are the project's deliberate choices. Omit a setting to let the host's own
  configuration decide it. `project.md` is prose, including the project's
  working policy, and `.agenticloop/local/` is machine-local state rather than
  a configuration layer.
- `setup --host` adds a host to the recorded set instead of replacing it.
  Previously `setup --host claude` in a repository already generating for Codex
  left `hosts` as `["claude"]`, and the ownership pass then deleted the Codex
  projections it still owned. Dropping a host is now a deliberate edit to
  `agenticloop.json` followed by `update`.
- The four roles are responsibilities and do not vary by project. A specialist
  is an `actor` under a canonical role, carrying a skill, chosen by the prose
  policy — not a fifth role and not something the toolkit derives.
- Per-host `role_settings` in `agenticloop.json`. Each host's adapter declares
  which settings it accepts and what it calls them: reasoning effort is
  `effort` for Claude Code, `model_reasoning_effort` for Codex, and
  `reasoningEffort` for OpenCode, which also takes a `variant`. A setting's
  value is a string passed to the host as written, or `null` to leave it unset.
  A setting a host cannot express, and a value it could not carry, are each
  refused with a hint rather than written into a file the host ignores or
  stringified into nonsense.
- A model binding is one of those settings, written at
  `role_settings.<host>.<role>.model`. There is no separate `models` map: a
  model id is host-specific, so one string per role could not serve two hosts
  at once. A leftover `models` key is refused with the setting that replaces
  it.
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
