# Skill anatomy

A skill is an ordinary reusable procedure. Loading one grants no authority and
activates nothing. No skill may require a prior command or a particular state.

## Layout

```
skills/<name>/SKILL.md
```

With YAML frontmatter and a Markdown body:

```markdown
---
name: verification-evidence
description: Use when recording what a check actually did — after running tests, a linter, a build, or a manual inspection. Covers candidates, evidence entries, and the difference between what was observed and what was claimed.
metadata:
  area: evidence
  side_effects: writes-files
  credentials: none
  runs_scripts: optional
---

# Verification evidence

...
```

## Fields

| Field | Meaning |
|---|---|
| `name` | must match the directory name |
| `description` | when to use it, written so a host can match it to a situation |
| `metadata.area` | rough grouping, for humans |
| `metadata.side_effects` | `none`, `writes-files`, or what it touches |
| `metadata.credentials` | `none`, or what it needs |
| `metadata.runs_scripts` | `none`, `optional`, or `required` |

`validate` checks that these are present and that `name` matches the directory.

## Writing one

- **Describe practice, not process.** A skill that only exists to drive a
  sequence of commands is not a skill.
- **Assume nothing has happened yet.** No skill may require activation, a prior
  command, or a particular task status.
- **Name the record format, not commands.** If the procedure records something,
  say which part of the task record it goes in — a candidate, an evidence entry,
  an assessment — and let the agent write it however it likes.
- **Grant nothing.** A skill cannot confer a role, permission, or authority.
  That boundary is what keeps skills portable across hosts.
- **Keep it short.** An agent reads this while doing something else.

## What belongs in the bundle

A bundled skill primarily teaches how to use Castwork's records, roles, or
checks. Mentioning an evidence entry does not qualify generic domain
guidance: a procedure that would read the same in a repository that had never
heard of Castwork belongs to your project or your host, not here. The
bundle is `task-record-contract`, `verification-evidence`, `assessment`,
`decision-capture`, and `blocked-state`.

This is a rule for whoever adds a skill, not a check. Nothing enforces it
mechanically, and `validate` will happily accept a skill that ignores it.

## Project and host skills

Agents may use your project's own skills, skills installed for the user, and
the host's built-in skills directly, alongside these. Castwork does not
wrap, register, or arbitrate them, and there is no skill graph or marketplace.

The host decides which skills an agent can see, and hosts differ: in one
repository a Codex worker may have a skill a Claude Code verifier does not. The
role presets ask each role, the coordinator included, to use a skill when it
fits the step it is on, and to look again when the work changes. That is a
skill its host exposes, or one the user or the working policy points to by
path; an agent does not search other hosts' directories for skills or install
one. When delegating, the coordinator names a skill that fits, with what it is
for, the same way it names a source document. To make a choice deliberate for
this repository, say it in the working policy in `.castwork/project.md`, for
example that authentication changes get a verifier applying a security skill.

A skill named to a role but missing from its host is reported. The role carries
on with what does not depend on it and leaves the rest open: a worker records
`needs_context` with what is missing, and a verifier leaves the affected point
unassessed. A missing skill neither blocks everything nor excuses skipping what
the work needs.

A skill supplies practice, not permission. The deliverable goes where the task
asks for it, and the record names it as the candidate. What a skill produces
about the work goes where the record conventions say, not where the skill would
otherwise put it: a plan in the task record body, a durable decision under
`.castwork/decisions/`, evidence and a verdict in the record. It does not
widen a role's boundaries: a verifier using a review skill still fixes nothing.
Skills are not record fields; the `actor` string says who did the work, and the
findings can say what they brought to it.
