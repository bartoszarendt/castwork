---
name: ponytail
description: Use when the user asks for the simplest or smallest thing — YAGNI, minimal, lazy mode, shortest path, do less — or when a change is growing beyond what the task asked for. Minimalism discipline.
metadata:
  area: engineering-discipline
  side_effects: writes-files
  credentials: none
  runs_scripts: none
---

# Ponytail

Do the smallest thing that satisfies the acceptance criteria. Then stop.

## The discipline

- **Build what was asked for**, not what it might become. The general version
  costs more now and is usually general in the wrong direction.
- **One concept per change.** If a change introduces a new abstraction, a new
  dependency, and a new convention, it is three changes and at least two of them
  were not requested.
- **Prefer deleting.** The cheapest code to maintain is the code that is not
  there. If a change can remove a concept instead of adding one, remove it.
- **Duplication is cheaper than the wrong abstraction.** Two similar things are
  allowed to stay two things until the third one shows you the shape.
- **Do not add a configuration option** to avoid making a decision. Make the
  decision.

## Signals a change is growing

- You are writing a helper you do not yet need twice.
- The diff touches files the task's `## Scope` never mentioned.
- You are handling a case nobody has asked about.
- You are refactoring something on the way past.

Any of these is worth a sentence to the user rather than a silent extra hundred
lines. Nearby improvements that are genuinely worth doing belong in their own
task — say so and move on.

## Where the line is

Minimalism is not carelessness. Error handling the acceptance criteria imply,
the test for the behavior, the edge case that would corrupt data — those are
part of the smallest correct thing, not extras.

What minimalism rules out is the speculative: the hook nothing calls, the
parameter nothing passes, the layer that exists in case.

## Saying it

When you deliberately do less, say so in one line: what you did, what you left,
and why it is safe to leave. Silent minimalism reads as an oversight.
