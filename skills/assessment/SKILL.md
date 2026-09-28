---
name: assessment
description: Use when reviewing or auditing an implementation against its task record and recording a verdict, and when responding to a verdict you received. Covers the three lenses, independence, and what accept, reject, and needs_revision mean.
metadata:
  area: review
  side_effects: writes-files
  credentials: none
  runs_scripts: optional
---

# Assessment

An assessment is one actor's verdict about one candidate. It is recorded in the
task record and nowhere else.

```yaml
assessments:
  - candidate: 007c7f8
    role: verifier
    actor: verifier@codex
    verdict: accept
    host: codex
    model: gpt-5.6
    at: "2026-09-18T13:02:10Z"
    findings: "..."
```

`verdict` is `accept`, `reject`, or `needs_revision`. Record `host`, the exact
host-reported `model`, and an RFC 3339 `at` timestamp when the record must stay
self-contained or comparable without host-local telemetry. They are asserted,
informational metadata.

`findings` is a short quoted string, a linked file relative to the repository
root, or an anchor to a heading in the body. Long findings go under a heading,
where they can be read and revised, not inline in the frontmatter. Do not
reproduce tool transcripts or a full audit report in the record: say what you
found and link what you read.

## Three lenses, in order

1. **Does it do what the record asked?** Read `## Intent` and
   `## Acceptance criteria` first, then the change. Work that is good but not
   what was asked for is still not what was asked for.
2. **Is it correct?** Look for the failure the tests do not cover: the empty
   case, the second call, the error path, the concurrent one.
3. **Would this project want to maintain it?** Consistency with the surrounding
   code counts. So does the concept count — a change that adds a new idea
   should be paying for it.

## Read the candidate

Assess the candidate the record names, not the current branch. If the reference
does not resolve in your checkout, say so and assess nothing rather than
assessing something else.

A reference resolves when it is a commit that exists here, or a `tree:<sha>`
snapshot whose tree object exists here. A name such as `HEAD` or a branch is
not the candidate, even when it resolves: it names whatever it points at today.
Neither is a label such as a worktree name. Say so, and ask for the commit id
or a snapshot.

A snapshot is not the working tree. `task lint` says whether the working tree
still matches it; if it does not, the files in front of you are not the
candidate. Read its contents with plain git, or extract it into a scratch
directory outside the repository through a temporary index. Both extraction
commands run with `GIT_INDEX_FILE` set to that temporary file: without it,
`read-tree` overwrites the repository's real index. The path must be absolute,
since git resolves a relative `GIT_INDEX_FILE` against the top of the working
tree:

```sh
git diff <base> <sha>                 # what the candidate changes
git show <sha>:<path>                 # one file as the candidate has it
# <tmp> is an absolute path to a scratch directory outside the repository
mkdir -p <tmp>/tree
GIT_INDEX_FILE=<tmp>/index git read-tree <sha>
GIT_INDEX_FILE=<tmp>/index git --work-tree=<tmp>/tree checkout-index -a
```

A snapshot exists only in the clone that took it. Reviewing from another clone,
ask for a commit the project authorizes, or for the base commit and
`git diff <base> <sha>`: apply the diff to a clean checkout of the base and run
`npx --no agenticloop snapshot` there. Identical content gives the identical
`tree:` sha, which proves you hold the candidate.

Do not accept on the strength of a summary. If you did not read it, your verdict
is about the summary.

## Independence

`independent_review` compares your `actor` string against the candidate's
recorded `producers`. If you are among them, your `accept` does not satisfy it —
and recording a different `role` does not change that. Roles are presets;
independence is about who did the work.

`independent_review` asks for an accept from anyone who is not a recorded
producer; `assessment_roles` asks for an accept from a specific role. When a
particular role's verdict is what the work needs, the record should declare
`assessment_roles: [verifier]` rather than leave it to an instruction — and when
that role is unavailable, say so in the findings rather than quietly standing
in for it.

The two requirements are evaluated separately, so together they do not prove
that the verifier was independent: a producer's own `verifier` accept satisfies
`assessment_roles`, and anyone else's accept satisfies `independent_review`. If
you produced the candidate, do not record the verifier's verdict on it.

Write an actor string that identifies you honestly, for example
`verifier@codex`, or the specialist name you were started as, such as
`security-reviewer@codex`. Two reviewers of one candidate never share an actor:
the checks keep the last assessment per actor, so a second lens under the same
name replaces the first one's verdict. Never choose a name to avoid matching a
producer. The toolkit compares strings and reports them as asserted; it cannot
tell whether the string is true, and it never claims to.

## Verdicts

- **`accept`** — say what you checked and name what you did not, so the next
  reader knows the shape of your confidence.
- **`needs_revision`** — the work is close; name precisely what must change.
- **`reject`** — the approach is wrong; say what would be right.

`reject` and `needs_revision` are ordinary outcomes. Record them plainly. The
requirement stays unsatisfied until you record a later verdict, which is exactly
what should happen — and the record stays editable throughout.

## Being assessed

Read the findings before defending anything. Fix what is right, and say clearly
where you disagree and why rather than silently not doing it. Then record a new
candidate and fresh evidence — the old evidence belongs to the old candidate.

## Be specific

"The retry loop has no bound" is a finding. "Looks good" is not. One concrete
defect is worth more than a list of possible concerns.
