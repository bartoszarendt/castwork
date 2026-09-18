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
name: tdd-implementation
description: Use when implementing a scoped change that has a testable acceptance criterion. Write the failing test first, then the smallest change that passes it.
metadata:
  area: engineering-discipline
  side_effects: writes-files
  credentials: none
  runs_scripts: optional
---

# TDD implementation

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

## Project and host skills

Agents may use your project's own skills and the host's built-in skills
directly, alongside these. Agentic Loop does not wrap, register, or arbitrate
them, and there is no skill graph or marketplace.
