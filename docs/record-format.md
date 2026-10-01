# Record format

The task record is the product. Everything else — the roles, the skills, the
adapters, the CLI — exists to help agents write one and read one.

A record is ordinary Markdown, editable directly. Structured data lives in the
YAML frontmatter; the body is prose.

## Where records live

```
.agenticloop/
  project.md        prose: setup facts, working policy, pointers
  tasks/            one Markdown record per task
  decisions/        one Markdown file per durable decision
  generated.json    tracked ownership manifest for generated files
  local/            gitignored machine-specific state, such as a pause handoff
agenticloop.json    project configuration: hosts, per-host role settings,
                    role routes
```

Nothing else is written under `.agenticloop/`. Project configuration lives in
`agenticloop.json` and nowhere else; `project.md` owns prose only.

## The four concepts

One record carries all four. They are concepts, not files or subsystems.

| Concept | Meaning |
|---|---|
| **Work** | the requested outcome, scope, out of scope, acceptance criteria, and declared requirements |
| **Candidate** | the specific artifact being assessed, referenced by commit or equivalent, with its recorded producers |
| **Evidence** | a check result or observation, with its source and the candidate it concerns |
| **Assessment** | an actor's findings and verdict about the work and a candidate |

## Frontmatter

**Required:** `schema` (integer, initially `1`), `id`, `title`, `status`.

**Optional:** `depends_on` (list of ids), `allowed_paths` (list of globs),
`requirements` (map), `candidates`, `evidence`, `assessments` (lists of entries).

Unrecognized fields are permitted and reported as informational. They are never
an error — a project may carry its own fields, and a later version of the format
may recognize them. The one exception is a requirement kind (`checks`,
`independent_review`, `assessment_roles`) written at the top level instead of
under `requirements:`: that is a structural error, `requirement.misplaced`,
because a requirement written there would otherwise stop counting in silence.

Every machine field and multiword enum value is snake_case.

### YAML subset

The frontmatter parser reads a deliberately small part of YAML.

**Accepted:** block mappings and block sequences, flow sequences `[a, b]` and
flow mappings `{ k: v }`, single and double quoted strings, integers, booleans,
`null`, `#` comments, and block scalars — `|` literal and `>` folded, with
chomping `-` (strip), none (clip), or `+` (keep). A block scalar is how a long
`findings` or `note` is written:

```yaml
findings: >-
  The retry loop has no bound. Everything else checked out, including the
  error path this change adds.
```

Inside a flow collection a colon separates a key from its value only when a
space follows it, as in YAML: `checks: [test:api, lint:api]` is two check
names.

**Refused:** anchors and aliases, tags, multiple documents in one frontmatter,
and explicit indentation indicators (`|2`, `>1-`). Each refusal names the line.

A record that needs more YAML than this is a record the checks cannot reason
about, which is why the subset is small rather than growing to meet whatever a
writer tried.

### Status

Status describes progress. **There is no transition graph.** Any status may
follow any other, and no status grants a permission.

`draft`, `agent_ready`, `in_progress`, `in_review`, `needs_revision`, `blocked`,
`needs_context`, `done`, `cancelled`

### Candidate entry

| Field | Required | Meaning |
|---|---|---|
| `ref` | yes | a commit or equivalent reference |
| `producers` | no | list of actor strings that produced it |
| `note` | no | free text |

A `ref` is one of three kinds, and they differ in what can be checked later:

1. **A resolvable commit**, when the project's policy permits the agent to
   make one. It is `available` wherever the commit exists.
2. **A snapshot, `tree:<sha>`**, for work that may not be committed yet.
   `npx --no agenticloop snapshot`, run from the project root, prints one: a
   git tree object holding the working tree under the project root, which is
   normally the whole repository, minus ignored files, `.agenticloop/tasks/`,
   and `.agenticloop/local/`, with the repository's own line-ending rules
   applied. It needs no commit and moves no ref. It is `available` while the
   tree object exists in this clone: it exists only in the clone where it was
   taken, and since nothing refers to it, `git gc` may prune it once it is
   older than `gc.pruneExpire` (two weeks by default). For the current
   candidate, lint also reports whether the working tree still matches the
   snapshot, or in how many paths it differs; in a sparse checkout it reports
   that as not checked, and changes inside a submodule's own working tree do
   not count. When a later candidate is a commit with the same tree, lint says
   so.
3. **A name that can move**, such as `HEAD`, a branch, or a label like
   `worktree-T005`. It is allowed and is not malformed. A branch or `HEAD`
   resolves, and is reported `available`, because it names some commit today; a
   label that names nothing is `unavailable`. Either way it names whatever it
   points at when someone looks, not what was assessed, so nobody can
   reconstruct the candidate later. When the current candidate is such a name,
   lint notes `candidate.moving_ref`: record the commit id or take a snapshot
   instead. Only a hex object id of 7 to 64 digits, or `tree:` followed by one,
   is not noted.

Evidence belongs to the bytes it ran on. Take the snapshot after the last
change and before the final evidence. After changing the candidate, take a new
snapshot and record it as a new candidate: the old evidence stays with the old
one. Never commit without project or user authorization, and never relabel
evidence from one candidate as evidence for another.

A verifier inspects a snapshot with plain git, never the current working tree.
To extract the whole candidate, run both commands with `GIT_INDEX_FILE` set to
a temporary file: without it, `read-tree` overwrites the repository's real
index. The path must be absolute, since git resolves a relative
`GIT_INDEX_FILE` against the top of the working tree.

```sh
git diff <base> <sha>                 # what the candidate changes
git show <sha>:<path>                 # one file as the candidate has it
# the whole candidate; <tmp> is an absolute path outside the repository:
mkdir -p <tmp>/tree
GIT_INDEX_FILE=<tmp>/index git read-tree <sha>
GIT_INDEX_FILE=<tmp>/index git --work-tree=<tmp>/tree checkout-index -a
```

`<base>` is the commit `snapshot` printed. A snapshot exists only in the clone
that took it: another clone reports it `unavailable`. It can be reviewed in
that clone, including by an agent CLI working in the same checkout. For a
reviewer anywhere else, use a commit the project authorizes, or send the base
commit and `git diff <base> <sha>`: the reviewer applies the diff to a clean
checkout of the base and runs `snapshot`, and identical content gives the
identical `tree:` sha, which proves they hold the candidate. A snapshot is not
a general way to hand work between hosts or clones.

### Evidence entry

| Field | Required | Meaning |
|---|---|---|
| `check` | yes | the check name |
| `candidate` | yes | a `ref` from `candidates` |
| `result` | yes | `pass` or `fail` |
| `command` | no | what was run |
| `exit_code` | no | its exit code |
| `actor`, `host`, `model`, `at` | no | optional attributes; record them when anyone might compare this work with work done elsewhere |
| `output` | no | a short string, or a repository-root-relative path to a linked file |

### Assessment entry

| Field | Required | Meaning |
|---|---|---|
| `candidate` | yes | a `ref` from `candidates` |
| `role` | yes | the canonical responsibility: one of `coordinator`, `thinker`, `worker`, `verifier`. A specialist is an `actor` under one of these, not a fifth role. |
| `verdict` | yes | `accept`, `reject`, or `needs_revision` |
| `actor`, `host`, `model`, `at` | no | optional attributes; record them when anyone might compare this work with work done elsewhere |
| `findings` | no | a short string, a repository-root-relative path, or a body heading anchor |

These optional attributes are asserted metadata:

- `host` is the host id that performed the work: `claude`, `codex`, or
  `opencode`, never the machine's name. The role presets use the same id after
  the `@` in an actor string, such as `worker@claude`. The three ids are how to
  record it, not an enum: any non-empty value is accepted, so a record written
  with a machine's name stays valid.
- `model` is the exact model identifier that host reported; it is not normalized
  across hosts.
- `at` is an RFC 3339 timestamp when one is useful. It is informational only:
  timestamps never decide ordering, freshness, validity, or completion.

Record them when the record needs to remain self-contained or comparable
without host-local telemetry. A host may retain the same facts elsewhere, but
that state is not part of the portable record.

### Actor

A non-empty string the agent writes, for example `worker@claude`, or a
specialist's name such as `security-reviewer@codex`. The toolkit compares
strings and reports them as **asserted**. It has no way to verify that the
actor named is the actor that wrote the entry, and it never claims to.

Two reviewers of one candidate never share an actor. The checks keep the last
assessment per candidate and actor, so a second reviewer, such as a second
verifier lens, writing under the same string replaces the first one's verdict:
a `needs_revision` from one lens followed by an `accept` from another would
read as a changed mind. An actor that does change its own verdict is reported:
a satisfied requirement then carries the fact that it recorded a blocking
verdict earlier.

A blank identity is not somebody. `producers: [""]` does not make a reviewer
independent of nobody: it leaves `independent_review` `unknown`, and the blank
entry is reported as a structural error. The same holds for a blank `actor`.

### Linked paths

A linked path in `output` or `findings` is **relative to the repository root**,
so `logs/lint.txt` means the same thing wherever the record lives. A path that
is absolute or climbs out with `..` is not treated as a link and is never
resolved: doing so would let a record ask whether an arbitrary file exists on
whatever machine runs the checks, which is not evidence about the work.

## Body

**Recognized headings:** Intent, Scope, Out of scope, Acceptance criteria,
Blockers and decisions.

Any additional heading is permitted and raises no diagnostic. A duplicate
recognized heading is a structural error.

## Requirements

A task declares explicit, mechanically checkable requirements. The checks
evaluate recorded facts against them. Nothing else is imposed, and a task with
no `requirements` block is normal.

An undeclared requirement is never introduced. A declared one cannot be dropped
by an assessment in order to obtain a satisfied result.

**A requirement means a favorable outcome was obtained, not that an assessment
was performed.** Presence-only requirements are not defined; none has a
consumer.

| Requirement | Satisfied when | Unknown when |
|---|---|---|
| `checks: [name, ...]` | every named check has an effective `pass` evidence entry for the current candidate | never; absent evidence is `not_satisfied` with reason `evidence.missing` |
| `independent_review: true` | at least one effective assessment of the current candidate has verdict `accept` and an `actor` not listed in the candidate's `producers` | the candidate has no `producers`, or every accepting assessment lacks `actor` |
| `assessment_roles: [role, ...]` | for each role, the effective assessment of the current candidate by that role has verdict `accept` | never; absent assessment is `not_satisfied` with reason `assessment.missing` |

`independent_review` and `assessment_roles` ask for different things.
`independent_review` asks for an accept from anyone who is not a recorded
producer; `assessment_roles` asks for an accept from a specific role. Declare
the second when a specific role's verdict is what you need — "the verifier, not
whoever was free" is `assessment_roles: [verifier]`, and saying it in the record
is better than saying it in an instruction.

An effective `reject` or `needs_revision` from a relevant actor or role leaves
the requirement `not_satisfied` until a later effective assessment changes it.
When several actors are relevant, one blocking verdict is enough: an accept
from one and a reject from another is `not_satisfied` with reason
`assessment.rejected`, and only a later effective assessment by the rejecting
actor can clear it.

A new requirement kind needs a real consumer before it is added.

### Independence

Independence is evaluated against the recorded `producers` of the current
candidate, **not against role names**. The same actor string appearing as
producer and reviewer is not independent regardless of the roles it claimed.
Missing identity on either side is `unknown`, and a blank one counts as missing.

**Together, `independent_review` and `assessment_roles` do not guarantee an
independent verifier.** The two are evaluated separately. A producer that
records `role: verifier` with `accept` satisfies `assessment_roles: [verifier]`,
and a different actor that records `role: thinker` with `accept` satisfies
`independent_review`: both report `satisfied`, and `done` is allowed. Roles are
claims, and independence is compared by actor. The role presets direct verdicts
to the verifier and tell a producer that its own acceptance is never
independent, but that is guidance, not a check. When it matters that the
verifier itself was independent, read who recorded the accepting assessments.
This is a known limitation, kept deliberately: changing it would change what
the requirements mean.

## Selection rules

Document order is the only ordering the checks use. There is no supersession
protocol, timestamp comparison, or freshness rule.

- The **current candidate** is the last entry in the `candidates` list.
- For a named check and a candidate, the **last evidence entry in document
  order** with that check and candidate is the effective result. A later `fail`
  overrides an earlier `pass`.
- For assessments, the **last entry in document order per (candidate, actor)**
  is the effective assessment for that actor. When `actor` is absent, per
  (candidate, role).
- Entries that reference a candidate other than the current one are **ignored**
  by requirement evaluation and never invalidate anything.

Adding a new candidate therefore makes prior evidence and assessments
inapplicable, with no diagnostic raised against them.

## Checked versus asserted

Every supporting fact carries its trust:

- **checked** — the CLI observed it locally, or the check compared two recorded
  values.
- **asserted** — an agent wrote it.

A checked comparison between two asserted values does not upgrade the values.
Equality of two actor strings is checked; the identities behind those strings
remain asserted.

This distinction is the honest limit of the format. Agentic Loop interprets what
was recorded. It does not prove who recorded it.

## The three outputs

The checks produce three results and **never merge them**:

**1. Structural validity.** Unparseable frontmatter, unknown status value,
unknown requirement kind, a requirement kind at the top level, missing required entry field, duplicate task id,
duplicate recognized heading, or a recognized structured list that is not a
list. Unrecognized frontmatter fields are informational, not errors. Additional
prose headings raise no diagnostic.

**2. Reference availability.** For each candidate reference and linked file:
`available`, `unavailable`, or `not_checked`. **Unavailable is not malformed** —
the reference may resolve in another checkout. Nothing is fetched from a remote.

**3. Requirement evaluation.** For each declared requirement: `satisfied`,
`not_satisfied`, or `unknown`, with a reason code and, for each supporting fact,
its trust.

### Observations

The CLI may gather local observations and pass them to the checks: whether a
candidate reference resolves in the local repository (a commit, or the tree
object a `tree:<sha>` snapshot names), whether the working tree still matches
the current candidate when that is a snapshot, and whether a linked evidence or
assessment file exists in the current checkout. Gathering writes nothing into
`.git`: references are looked up with one read-only `git cat-file` per run, and
the working tree is compared through a temporary index outside the repository.
Gathering is optional and local only, and never looks outside the checkout: a
linked path whose real destination lies elsewhere is not looked at, and is
reported `not_checked` rather than `unavailable`. The same holds for a
candidate reference when the root is not a git repository. `unavailable` means
the checks looked and the reference was not there; about a file the record does
not own they say nothing.

**A pure check never performs I/O.** The pure functions take the parsed record
plus an optional observation map, and are exported from the package so an
independent consumer uses the same interface.

## Command behavior

- **`task lint`** prints all three outputs. It exits non-zero when any
  structural error exists, or when the record claims `status: done` while any
  declared requirement is `not_satisfied` or `unknown`. **It never writes.**
  It prints the current candidate's availability in full and summarises the
  earlier ones in one line (`N earlier candidates, M unavailable`); `--json`
  keeps every reference.
- **`task list`** marks a record that is not `done` or `cancelled`, is
  structurally valid, and declares at least one requirement, all satisfied, as
  `ready to close`: `task set <id> status done` would accept it. A record that
  declares none is never marked, although `task set` accepts it: nothing it
  declares says the work is finished. Under `--json` each row carries `requirements_satisfied`, from
  requirement evaluation alone: `true`, `false`, or `null` when the record
  declares none. Structural validity stays a separate output, which `task lint`
  and `task show --json` report.
- **`task show`** loads any record it can parse, in every state, and reports the
  same three outputs under `--json`.
- **`task set <id> status done`** refuses, without writing, when that record's
  structure is invalid or its requirement evaluation is not all `satisfied`.

The exported `mayBeDone` check makes the same record-level completion decision
as the CLI. It returns `allowed`, the `structural` result, and `blocking`
requirements; structural errors are not converted into requirement results.

That refusal is write validation on one value — not an authorization or
transition gate. Every other `task set` value and every direct edit is
unrestricted. Failed checks, rejecting assessments, and blocked states are
always recordable, and every record stays readable and editable in every state.

### Lint diagnostics

Beyond the structural errors above, lint reports these. Only the first is an
error; the rest are informational and change no outcome.

| Code | Level | Meaning | What to do |
|---|---|---|---|
| `requirement.misplaced` | error | `checks`, `independent_review`, or `assessment_roles` is at the top level of the frontmatter | move it under `requirements:`; until then lint fails and `task set <id> status done` refuses |
| `entries.in_body` | info | an unlabeled or YAML fenced block in the body, a list item's included, has `candidates:`, `evidence:`, or `assessments:` among its top-level keys | move the entries into the frontmatter lists; the checks never read the body, so a record kept this way has no candidate, evidence, or assessment |
| `candidate.moving_ref` | info | the current candidate's `ref` is a name, such as `HEAD`, a branch, or `worktree-T005`, not a hex object id or `tree:` followed by one | record the commit id, or take a snapshot and record its `tree:<sha>`, as a new candidate |
| `evidence.undeclared_check` | info | evidence is recorded under a `check` that is not among `requirements.checks`; one note per such name, with how many entries use it | use the declared name only for a run of the whole declared check; a subset, such as some of the tests, goes under its own name and does not satisfy the declared one |
| `evidence.lint_as_evidence` | info | an evidence entry's command runs `agenticloop task lint` | lint reports on the record, not the candidate; record the project's own checks instead |
| `evidence.credential_like` | info | a command carries a URL with a literal password, or assigns a literal to a variable or option whose name has `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `API_KEY`, or `APIKEY` as a whole segment, quoted or not (`PASSWORD="x"`, `export API_KEY=...`, `$env:API_KEY=...`); a reference (`$NAME`, `${NAME}`, `%NAME%`), a number, a boolean, or `***` is not noted | record the variable's name (`$DATABASE_URL`), never its value; records are repository files, subject to the repository's own secret checks |
| `record.large` | info | the record is larger than 100 KB | move run logs and transcripts to linked files and keep the record to what was decided and observed |
| `field.unrecognized` | info | a frontmatter field the format does not define | nothing, if it is the project's own field |

## Canonical example

```markdown
---
schema: 1
id: T-001
title: Greet by name
status: in_review
requirements:
  checks: [test, lint]
  independent_review: true
candidates:
  - ref: 007c7f8
    producers: [worker@claude]
evidence:
  - check: test
    candidate: 007c7f8
    result: pass
    command: "npm test"
    exit_code: 0
    host: claude
    model: claude-opus-5
    at: "2026-09-18T12:34:56Z"
  - { check: lint, candidate: 007c7f8, result: pass }
assessments:
  - candidate: 007c7f8
    role: verifier
    actor: verifier@codex
    verdict: accept
    host: codex
    model: gpt-5.6
    at: "2026-09-18T13:02:10Z"
    findings: "none"
---

## Intent
...
## Scope
...
## Acceptance criteria
...
## Design notes
Any extra heading is fine.
```

## Worked examples

- [examples/solo.md](examples/solo.md) — checks only, one agent
- [examples/delegated.md](examples/delegated.md) — `independent_review` and
  `assessment_roles`, satisfied
- [examples/not-independent.md](examples/not-independent.md) — the reviewer is
  also a producer, so independence is `not_satisfied`

## Decision record

One Markdown file per durable decision under `.agenticloop/decisions/`. There is
a template and no schema beyond it. `decision new <title>` writes it, numbering
the record for you; the title is required, as it is for `task new`.
`decision list` reads each record's `id`, `status`, `date`, and `title` for
finding the ones that bear on the work; it checks nothing. A replaced decision
keeps its file with `status: superseded`, by convention.
