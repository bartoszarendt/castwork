---
name: blocked-state
description: Use when work hits a wall it cannot clear on its own — a missing credential, an outage, a contradictory requirement, a decision only the user can make — and the pause needs to be durable enough for someone else to resume.
metadata:
  area: failure-handling
  side_effects: writes-files
  credentials: none
  runs_scripts: none
---

# Blocked state

Fail loudly and durably. A blocked task is not a failed task; it is a paused
task with enough written down that someone can pick it up.

## The two statuses

- **`blocked`** — something outside the work is in the way: a credential you do
  not have, a service that is down, a dependency that does not exist yet, a
  decision the user has to make.
- **`needs_context`** — the work itself is under-specified: the requirement
  contradicts itself, the acceptance criteria do not say what to do in a case
  that matters, two documents disagree.

Both are ordinary status values. Neither is a failure state and neither locks
anything: the record stays readable and editable.

A failed check, blocking verdict, or stopped workflow does not itself mean no
authorized next step remains. Record genuine external blockers promptly; consider
permitted diagnosis or independent work while execution is blocked, and honor
explicit stops. A workflow's termination returns the problem to the agent running
it, like a role's return; it does not decide that all work must end.

## What to write

Set the status and record the details under `## Blockers and decisions`:

```markdown
## Blockers and decisions

**Blocked 2026-03-04 — missing staging credentials.**
`npm run e2e` needs `STAGING_API_KEY`, which is not in the environment and not
in the repository's documented setup. Tried: the local `.env`, the CI variable
list, `docs/setup.md`. Unblocks when someone provides the key or points at where
it is meant to come from.
```

Say four things: what you were doing, what stopped you, what you already tried,
and what would unblock it. The last one is the point — a blocker without an exit
is just a complaint.

For the user, give the verified state, the obstacle and its cause or remaining
uncertainty, what can proceed independently, and only decisions they own. Give a
recommended answer for each decision and concrete approval wording with scope,
cost, stop conditions and what proceeds after approval where those matter.
Prepare what existing authority permits before asking; a clear external blocker
needs no extra investigation merely to complete a checklist. Keep temporary
proposals in the task body; use a separate decision record only when the choice
outlives the task, and distinguish a proposal from an accepted owner decision.

## Pausing

A pause the user asks for is recorded the same way, so the next session can
resume from the record rather than from a transcript. Before stopping:

- say where the work stands under `## Blockers and decisions`: what is done,
  what is half done, and what was about to happen next;
- claim no check that did not finish as passed; an interrupted run is not
  evidence;
- if the candidate is a `tree:<sha>` snapshot, check with `task lint` whether
  the working tree still matches it, and say so if it does not;
- tear down what you started, such as a server or a container; if something
  must keep running, say what and why.

The status stays as it is unless the work is actually blocked or waiting for
context. When a coordinator started you, it sets every other status; working
alone, you set it yourself.

## Do not

- **Do not silently retry.** Repeating a failing approach and hoping is how an
  hour disappears. When another attempt would only repeat what already failed,
  that is a stall: write it down and pursue diagnosis within existing authority.
  A category such as environmental, flaky, known, or busy, or an owner's
  disposition, establishes no mechanism. Reuse a documented diagnosis when its
  evidence applies here; otherwise investigate a cause that progress depends on,
  using the thinker when deeper investigation or another perspective would help.
  Diagnosis using information and resources already authorized for the task
  needs no further approval. A proposal grants no authority to implement it:
  fixes, access, spending, and additional runs keep their existing boundaries.
  Honor explicit owner budgets; do not invent a retry count as the reason to stop.
- **Do not guess past a real ambiguity.** If the answer changes what you build,
  that is `needs_context`, not a coin flip.
- **Do not mark it done.** If the task declares requirements, `task set status
  done` will refuse anyway — but the record is the real point, not the refusal.
- **Do not delete the evidence of what failed.** A recorded `fail` for a check
  is useful to the next person.

## Resuming

Read the blocker entry first. If the condition cleared, say so in a new entry
rather than deleting the old one — the history of what blocked this work is
often the most useful thing in the record.
