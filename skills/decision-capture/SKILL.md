---
name: decision-capture
description: Use when a choice is made that future work should not silently reverse — an architecture, a dependency, a convention, a deliberate tradeoff. Covers what is worth recording and where it goes.
metadata:
  area: records
  side_effects: writes-files
  credentials: none
  runs_scripts: none
---

# Decision capture

The reason for a choice evaporates faster than the choice. Record the reason.

## What is worth recording

A decision is durable when reversing it later would be expensive or when someone
would otherwise reasonably do the opposite:

- an architecture or a boundary between components;
- a dependency added, or deliberately not added;
- a convention the codebase will be held to;
- a tradeoff taken knowingly — the slower approach for the clearer one, the
  duplicated code over the wrong abstraction;
- a requirement deliberately not met.

Not worth recording: anything the code already says plainly, and anything that
only mattered for one task.

## Where it goes

**Inside the task, under `## Blockers and decisions`**, when it explains this
task and stops mattering afterwards.

**In `.agenticloop/decisions/`**, when it outlives the task.
`npx --no agenticloop decision new "<title>"` writes the template, numbering the
record for you:

```markdown
---
schema: 1
id: D-001
title: Store money as integer minor units
date: 2026-03-04
status: accepted
---

## Decision
## Context
## Alternatives considered
## Consequences
## Revisit if
```

## Writing one well

**Context** is what made the decision necessary. Someone reading in a year needs
to know what the pressure was, or the decision looks arbitrary.

**Alternatives considered** is the part that earns the file. Name what you did
not choose and why. A decision record with no alternatives is a note.

**Consequences** says what this commits the project to and what it rules out.

**Revisit if** names the observation that would reopen it. This is what stops a
decision record from becoming a rule nobody may question — every decision is
allowed an expiry condition.

## Changing a decision

Do not quietly contradict one. Write a new record that supersedes it, or change
the old one's status and say what replaced it. A project whose decisions drift
without record is a project that will make the same mistake twice.
