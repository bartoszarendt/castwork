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
    producers: [worker@claude]
    host: claude
    model: claude-opus-5
    at: "2026-09-18T12:30:00Z"
```

`ref` is a commit when you may make one. When the work may not be committed
yet, take a snapshot instead: `npx --no castwork snapshot` prints a
`tree:<sha>` reference to exactly what is in the working tree (ignored files,
task records, and `.castwork/local/` left out), and you record that:

```yaml
candidates:
  - ref: tree:4697b75db8a9dbc2c4186c61d299e0069ce1388c
    producers: [worker@claude]
    host: claude
    model: claude-opus-5
    at: "2026-09-18T12:30:00Z"
```

Do not invent a digest of your own, and do not record a name such as `HEAD`, a
branch, or a worktree label: it keeps moving, so nobody can tell later what was
assessed, and lint notes it as `candidate.moving_ref`. If the CLI is not
available, say so and record the candidate as a label anyway; never invent a
reference.

A snapshot exists only in the clone that took it: it can be reviewed there,
including by an agent CLI working in the same checkout, but not from another
clone. For a reviewer elsewhere, use a commit the project authorizes, or send
the base commit and `git diff --binary --no-textconv <base> <sha>`; the reviewer applies it to a clean
checkout of the base and runs `snapshot`, and identical content gives the
identical `tree:` sha.

Evidence belongs to the bytes it ran on. Take the snapshot after your last
change and before your final evidence. If you change anything afterwards, take
a new snapshot, record it as a new candidate, and run the evidence again for
it. `task lint` says whether the working tree still matches the current
snapshot.

`producers` is who made it — the actor strings that later decide whether a
review was independent. Optional candidate `host`, `model`, and `at` are
asserted: use the host id and exact reported model; `at` means recorded at.
Omit an unknown model, never write `unknown`; omit mixed-producer host/model
attributes rather than picking one. These attributes never decide outcomes.

## Then the evidence

```yaml
evidence:
  - check: test
    candidate: 007c7f8
    result: pass
    command: "npm test"
    exit_code: 0
    host: claude
    model: claude-opus-5
    at: "2026-09-18T12:34:56Z"
  - { check: lint, candidate: 007c7f8, result: fail, command: "npm run lint", exit_code: 1, output: "logs/lint.txt" }
```

- `check` matches the name the task declared under `requirements.checks`.
- `candidate` is the `ref` you just recorded.
- `result` is `pass` or `fail`.
- `command`, `exit_code`, `output`, `actor`, `host`, `model`, `at` are optional.
  Record them when they help someone reproduce what you did.

`npx --no castwork task add <id> evidence check=test candidate=007c7f8 result=pass
command="npm test" exit_code=0 at=now` writes the same entry, and
`task add <id> candidate ref=... producers=...` the candidate. It takes only
these fields, refuses a `candidate` that is not a recorded `ref`, and fills in
nothing you did not give: `at=now` is the CLI's clock when it records.

Record `host`, the exact host-reported `model`, and an RFC 3339 `at` timestamp
when the record must remain self-contained or comparable without host-local
telemetry. They are asserted, informational metadata; document order still
decides which entry is effective.

`output` may be a short string, or a path to a file relative to the repository
root. A path that climbs out of the checkout with `..` is ignored rather than
reported.

Do not retain routine successful output. The entry's command, exit code and a
short observed result are normally enough. When long output materially supports
a failure, reproduction, or review finding, put it in a linked file named under
`output` rather than pasting a transcript into the record. Link only where it
lasts, not ignored scratch. A tracked supporting file outside `.castwork/tasks/`
is part of the next snapshot: write it before taking that snapshot, or not at all.
Without such a place, write it short.

A routine successful probe is a sentence in the body, or nothing. An observation
supporting acceptance or a finding stays a candidate-bound evidence entry, under
its own name when undeclared. After a costly step, write a short observation:
what was seen, what it means, what is next; not a new narrative section per run.

## Rules that matter

- **Record what you ran.** An `exit_code` you did not observe is worse than no
  evidence at all. If you did not run it, there is no evidence entry.
  Resolve a declared check to the project's actual invocation: working directory,
  paths, flags and selection. Run that invocation within existing authority; a
  narrower or modified command is a different check and leaves the declared one
  unmet. If the invocation is unclear or cannot be run, name that gap.
- **Record failures.** A `fail` is information. The later entry for the same
  check and candidate wins, so a `fail` after a `pass` correctly says the check
  is now failing.
- **Re-record after a new candidate.** Evidence for an earlier candidate is
  simply not applied to a new one. Nothing is invalidated and no diagnostic is
  raised — but the new candidate has no evidence until you record some.
- **A manual check is still evidence.** Name what you inspected and what you
  concluded. Do not invent an exit code for it.
- **One command per entry.** `exit_code` belongs to a single command you ran
  and saw, never to prose or a chain of commands.
- **Name the check honestly.** A subset of a declared check, such as some of
  the tests, goes under its own name, never under the declared check's name.
  `task lint` reports on the record, so it is not evidence about the candidate.
- **Compare when attribution matters.** Reuse applicable baseline or batch
  evidence, or make a proportionate comparison within existing authority, using
  comparable commands, inputs and conditions. Matching baseline failures may
  establish non-introduction; they do not establish the cause. Do not require a
  fresh baseline run for every check or silently spend another run allowance.
- **Names, not secrets.** Record an environment variable's name, never its
  value: records are repository files, and the repository's own checks read
  them.
- **Say which clock.** `at` is in UTC with `Z`, or carries an explicit offset.
  A local time labelled `Z` is wrong by the offset.

## What the toolkit does with it

`task lint` reports each declared requirement as `satisfied`, `not_satisfied`,
or `unknown`, and marks each supporting fact **checked** (it observed it) or
**asserted** (you wrote it). Almost everything you record is asserted. That is
the honest state of affairs, and the report says so rather than pretending
otherwise.
