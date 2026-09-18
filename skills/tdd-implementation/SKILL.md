---
name: tdd-implementation
description: Use when implementing a change that has a testable acceptance criterion. Write the failing test first, then the smallest change that passes it.
metadata:
  area: engineering-discipline
  side_effects: writes-files
  credentials: none
  runs_scripts: optional
---

# TDD implementation

## The loop

1. **Write the test first.** One acceptance criterion, one test. Give it the
   name of the behavior, not the function.
2. **Watch it fail.** A test you never saw fail proves nothing. If it passes
   immediately, either the behavior already exists or the test is wrong — find
   out which before continuing.
3. **Write the smallest change that passes it.** Not the general version. Not
   the one that also handles the case nobody asked for.
4. **Run the whole suite**, not just your test.
5. **Clean up** with the tests passing, then run them again.

## What to test

Test the behavior in the acceptance criteria. Then test the edges that would
embarrass you: the empty input, the second call, the error path, the boundary.

Do not test the implementation's shape. A test that breaks when you rename a
private function is a test that will be deleted in six months.

## When TDD does not fit

Some work has no testable criterion: a spike, a rename, a formatting pass, a
change you cannot observe from outside. Say so rather than writing a ceremonial
test that asserts nothing. Record the check you *did* run as evidence.

## Recording it

The task record declares the check by name under `requirements.checks`; you
record what it did:

```yaml
evidence:
  - { check: test, candidate: <commit>, result: pass, command: "npm test", exit_code: 0 }
```

Record a `fail` when it fails. The later entry for the same check and candidate
is the one that counts.
