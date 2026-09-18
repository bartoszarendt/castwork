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

Evidence says what happened to a specific candidate. It is not a summary and not
a promise.

## Record the candidate first

Evidence binds to an explicit reference, never to whatever the branch has become
since:

```yaml
candidates:
  - ref: 007c7f8
    producers: [engineer@claude-code]
```

`ref` is normally a commit. `producers` is who made it — the actor strings that
later decide whether a review was independent.

## Then the evidence

```yaml
evidence:
  - { check: test, candidate: 007c7f8, result: pass, command: "npm test", exit_code: 0 }
  - { check: lint, candidate: 007c7f8, result: fail, command: "npm run lint", exit_code: 1, output: "logs/lint.txt" }
```

- `check` matches the name the task declared under `requirements.checks`.
- `candidate` is the `ref` you just recorded.
- `result` is `pass` or `fail`.
- `command`, `exit_code`, `output`, `actor`, `host`, `model`, `at` are optional.
  Record them when they help someone reproduce what you did.

`output` may be a short string, or a path to a file relative to the repository
root. A path that climbs out of the checkout with `..` is ignored rather than
reported.

## Rules that matter

- **Record what you ran.** An `exit_code` you did not observe is worse than no
  evidence at all. If you did not run it, there is no evidence entry.
- **Record failures.** A `fail` is information. The later entry for the same
  check and candidate wins, so a `fail` after a `pass` correctly says the check
  is now failing.
- **Re-record after a new candidate.** Evidence for an earlier candidate is
  simply not applied to a new one. Nothing is invalidated and no diagnostic is
  raised — but the new candidate has no evidence until you record some.
- **A manual check is still evidence.** Name what you inspected and what you
  concluded. Do not invent an exit code for it.

## What the toolkit does with it

`task lint` reports each declared requirement as `satisfied`, `not_satisfied`,
or `unknown`, and marks each supporting fact **checked** (it observed it) or
**asserted** (you wrote it). Almost everything you record is asserted. That is
the honest state of affairs, and the report says so rather than pretending
otherwise.
