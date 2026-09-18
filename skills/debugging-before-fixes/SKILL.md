---
name: debugging-before-fixes
description: Use when something is broken and the cause is not yet known — a failing test, an error in production, behavior that contradicts the code. Find the cause before changing anything.
metadata:
  area: engineering-discipline
  side_effects: writes-files
  credentials: none
  runs_scripts: optional
---

# Debugging before fixes

A fix applied to a cause you have not found is a guess. Guesses that happen to
work are worse than guesses that fail, because they stay.

## Order

1. **Reproduce it.** Reliably, and preferably as a failing test. If you cannot
   reproduce it, everything after this is speculation — say so.
2. **Read the actual error.** The whole message, the whole stack, the line it
   names. Not the part that looks familiar.
3. **Form one hypothesis** that explains *all* the symptoms, including the ones
   that do not fit your first instinct.
4. **Test the hypothesis** — a log line, a breakpoint, a narrowed input. Confirm
   or discard it before writing the fix.
5. **Fix the cause.** Then check whether the same cause has other effects you
   have not noticed.

## Signals you are guessing

- You are changing more than one thing at a time to see what helps.
- You cannot explain why the change works.
- The fix is a retry, a delay, a broadened `catch`, or a widened type.
- You have made the same class of attempt twice.

When you notice any of these, stop. The assumption you have not questioned is
usually the one about what the code does, not what it should do.

## When you are stuck

Two honest attempts that failed for reasons you understand is information. Write
it down: what you tried, what you observed, what it rules out. Then either take
a different approach or record `status: blocked` or `needs_context` with that
history under `## Blockers and decisions`.

Delete the debug scaffolding before you record a candidate.
