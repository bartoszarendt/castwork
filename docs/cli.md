# CLI

Eighteen command paths. Installation, diagnostics, and minimal record
operations. A dedicated command exists only where it does something materially
better than editing a record by hand.

| Command path | What it does |
|---|---|
| `setup` | Install for the selected hosts: create `.castwork/`, write `castwork.json` and the generated host files, and record them in `generated.json`. A named host is added to the recorded set, never substituted for it. |
| `update` | Regenerate for the recorded hosts and report every path written, `.castwork/generated.json` included. Writes nothing while a generated file is modified locally or a file of yours stands where one is generated, unless `--force-generated` names it. `--check` lists what would change, writes nothing, and exits 1 unless the installation is current. |
| `remove` | Delete only manifest entries whose digest still matches. Never touches `project.md`, `tasks/`, or `decisions/`. |
| `doctor` | Read-only diagnosis of the installation and what to do next, including whether the generated files are current for the toolkit that ran it. Exits non-zero only on an error-level finding. |
| `validate` | Check skills, config, links, and generated adapter output. |
| `task new <title>` | Create a task record from the template with the next id. |
| `task list [--json]` | List task records with their ids, titles, and statuses. A record that is not `done` or `cancelled`, is structurally valid, and declares at least one requirement, all satisfied, is marked `ready to close`: `task set <id> status done` would accept it. A record that declares none is never marked, although `task set` accepts it. `--json` gives each row `requirements_satisfied`, from requirement evaluation alone (`null` when none are declared); structural validity is `task lint`'s to report. |
| `task show <id> [--json]` | Print the task file unchanged on stdout, naming its paired archive on stderr when present. `--json` gives merged frontmatter and the three check outputs. The id is required; without it, a usage error. |
| `task lint [<id>] [--json]` | Print structural validity, reference availability, and requirement evaluation. Never writes. Exits non-zero on a structural error, or on `status: done` with a requirement not satisfied. Prints the current candidate in full and earlier ones as one summary line. Text folds undeclared check names found only on earlier candidates and earlier lint-as-evidence notes; mixed names show their current entries. Every credential note remains visible. `--json` keeps every reference and note. Its diagnostic codes are listed in [record-format.md](record-format.md#lint-diagnostics). |
| `task archive [<id>] [--check] [--json]` | Explicitly move the entries for earlier candidates into `<record>.archive.md` beside the task; the body is never moved. No id selects records over 100 KB. Reports exact proposed list moves and bytes; `--check` writes nothing. Strict in-memory verification refuses any outcome or report-content difference, with a named reason and no writes; the selected record becoming uncommitted, and its size note, are the only exempt differences. Records are processed independently; exit 1 if any failed/refused, 2 for usage. JSON is exactly one document. |
| `task set <id> <field> <value>` | One safe frontmatter write of a top-level value. `status done` refuses on a structural error, and when a declared requirement is not satisfied; every other value is unrestricted. Refuses a field name that is not plain, a field holding a list or mapping, and any write that would change more than that field. |
| `task add <id> <kind> <key=value>...` | Append one `candidate`, `evidence`, or `assessment` entry to the record's own list, with only the fields the record format defines for it. An evidence or assessment `candidate` must be a recorded `ref`; nothing is filled in that was not given, except `at=now`. See [record-format.md](record-format.md#command-behavior). |
| `decision new <title>` | Create a decision record from the template. |
| `decision list [--json]` | List decision records with their ids, statuses, dates, and titles, superseded ones included. The status is printed as recorded: nothing is validated, and nothing decides which decision governs. A record whose frontmatter cannot be read is listed as `unreadable`, with the reason. `--json` gives each row `id`, `status`, `date`, `title`, `path`, and `error` (`null` when the frontmatter was read). Never writes. |
| `report [<id>] [--json]` | Read-only project account, or task/decision view selected by declared id. See [Report](#report). |
| `snapshot [--json]` | Name the working tree as a candidate reference, `tree:<sha>`, without committing: prints the reference, the base commit, and the paths that differ from it. The reference is the first line, so `snapshot | head -1` gives it alone. Runs from the project root, where `.castwork/` is, and refuses anywhere else, as the record commands do. Covers the working tree under the project root, which is normally the whole repository (where the project root is a subdirectory of a larger repository, the tree holds the base commit's files outside it), except ignored files, `.castwork/tasks/`, and `.castwork/local/`. Writes no record, and never touches the index, HEAD, refs, or working tree; the only thing it writes into `.git` is the tree's objects. A snapshot exists only in the clone that took it. See [record-format.md](record-format.md#candidate-entry). |
| `version` | Print the version number, and nothing else. `doctor` and `update --check` print where the running copy lives. |
| `help` | Print the command list. |

## Flags

Each command takes only the flags listed for it. `--debug` and `--help` are
accepted by every command.

| Command path | Flags |
|---|---|
| `setup` | `--host <name>` (repeatable), `--force-generated <path>` (repeatable), `--json` |
| `update` | `--check`, `--force-generated <path>` (repeatable), `--json` |
| `task archive` | `--check`, `--json` |
| `remove`, `doctor`, `validate`, `task list`, `task show`, `task lint`, `decision list`, `report`, `snapshot` | `--json` |
| `task new`, `task set`, `task add`, `decision new`, `version`, `help` | none |

An unknown flag, a flag the command does not take, a switch given a value
(`--check=yes`), a value-taking flag followed by another flag instead of a
value (`--host --json`), a single-dash option (`-c`), or an argument the
command has no place for (`update check`) is refused before anything is read
or written. A value that starts with a dash goes after `=`, as in
`--force-generated=-x`.
The error names what was refused and lists what the command accepts, and the
exit code is 2, so a script can tell it from `update --check` exiting 1
because the installation is behind. An older copy of the CLI accepted any
flag: `update --check` run by a copy without `--check` was a plain
`update`, and rewrote tracked files.

After a bare `--`, every token is an argument, not a flag: `task new -- "-x title"`
creates a task titled `-x title`. A refused token that starts with a dash says
so in its hint.

`help` lists each command with its flags. Through npx, run
`npx --no castwork help`, not `--help`: npm reads `--help` itself.

That is the whole command set. A dedicated command exists only where it does
something materially better than editing the record: archive performs verified
raw-text separation and staged paired writes, and `task add` writes a
correctly formed entry under the record's lock, so simultaneous writers do not
lose each other's entries. Adding a candidate, recording evidence, or writing an
assessment by hand remains equally valid; no command archives as a side effect.

## Report

```sh
npx --no castwork report
npx --no castwork report T-011
npx --no castwork report D-002 --json
```

| Command | Where it sits |
|---|---|
| `task list` | Find task ids, titles, statuses, readiness. |
| `report` | Understand recorded project state, rework, decisions and quality. |
| `report <id>` | Understand a task's rounds or a decision. |
| `task lint <id>` | Evaluate structure, references and declared requirements. |

There is no `task report` or extra report flag. Reports read records and local
Git only: one read-only log over `.castwork/`, no fetch, write, cache or index.
Every Git call uses `--no-optional-locks`. Output grants no permission.

Readable frontmatter counts, including invalid records and legacy values;
unreadable frontmatter is excluded and listed. Exit 0 means a report was
produced, not that its records are valid or its work accepted. Ids are keyed as
`task show` and `task lint` key them, so `id: [T-1]` and `id: T-1` are the same
id; raw values stay in frontmatter. Unknown or ambiguous selected ids and operational read failures exit 1; usage errors exit
2. Text keeps derivation preceding a read failure. Git observations are optional:
unavailable Git omits dates with an explanation and leaves exit 0.

JSON stdout is exactly one document, including on non-zero exits; human messages
go to stderr. `complete` means derivation coverage only; fully interpreted invalid
records and failing requirements do not make it false. `problems` gives codes,
applicable paths and messages. Project JSON includes every readable record's
frontmatter, body and derived entries. Selected JSON includes `selected` in full
and the corpus's identities and relations. Its totals, quality, problems and
mention frequencies still describe the corpus, not only the selected record.
Other records omit frontmatter, bodies, sections, task entries and Git details;
`recent` and `attention` are empty in selected views because those collections
are omitted, not because the corpus has no such events or records. Selected
text omissions remain in the full `selected` record; use project JSON for the
other records and project collections. Unknown results/verdicts stay as written, never become failure, missing
evidence or blocking verdicts; affected aggregates are named in problems and
coverage becomes incomplete. Only literal `pass`/`fail` and recognized verdict
strings count as recognized outcomes; arrays and mappings stay raw in JSON and
are displayed safely. Requirements remain exactly those of `task lint`, including
its existing comparisons for readable invalid values. Duplicate task files count
separately, but are structurally invalid and never ready to close.

### Counting and dates

All rework units are within a record file, not merged by shared ids or refs:

- Candidate entries are separate from distinct recorded refs.
- Blocking verdicts count every recorded `needs_revision` and `reject`.
- Declared-check fails count every recorded `fail`, reruns included.
- Outcome triples have a base of every file × distinct candidate ref × declared
  check, with effective `pass`, `fail`, no evidence, and unrecognized separately.
- Current triples in Attention use non-`done`, non-`cancelled` records; fail and
  missing evidence are separate. Other checks count distinct undeclared names
  and their effective results per ref, not runs.

Document order selects and presents entries within a task. Reference keys use
`recordValueText()`, the same interpretation as the checks: numeric and quoted
equivalents group together; readable array/mapping refs use the checks' existing
comparisons. Raw YAML values remain unchanged in frontmatter and entries. Missing
or unusable refs are diagnosed, not confused with a non-string type. Results for
a ref appear once under its last mapping entry; repeated current refs name their
earlier entries. Recent is grouped by the timestamp's own recorded calendar day, then
ordered by instant, with date-only entries last and marked. Malformed dates are
excluded and counted under Record quality. Git dates mean first/last commits
visible locally, never creation or closure; uncommitted changes are identified,
including when the project is nested below the Git root. Latest recorded timestamps
are compared by instant, not spelling, including all accepted fractional digits
rather than truncating comparisons to milliseconds. Date-only observations retain their precision
and are reported separately when timestamps coexist; no midnight is invented.

Task text targets about 60 lines at 100 columns, but current candidate details,
declared-check results, effective assessments, requirement results with reason
codes, and dependencies both ways are never cut to fit. History shows at most
five earlier assessed refs, mentions at most five each way, with omissions
counted. Optional candidate notes are excerpts with an explicit omission indication;
maximum-candidate ties show at most five records, naming the total and omitted count.
The current candidate is the last **mapping** returned by lint's
`currentCandidate()`. A trailing scalar is retained at its raw position and
explicitly diagnosed as malformed, not evaluated as current. A last mapping
with a missing ref stays current; it never falls back to an older valid ref.
Raw totals include malformed entries; current numbering and shown/omitted
counts use original array positions. When malformed entries occur, History
excludes only the evaluated entry, including any malformed tail in the omissions.
Affected counts retain incomplete-coverage diagnostics.

Task views add physical navigation: Contract pointers for Intent, Scope, Out of
scope, Acceptance criteria and Current state (or `absent`); Current state as
recorded prose, at most 25 source lines and 2,000 characters with an omission
count and source pointer (`empty` for only HTML comments and whitespace); and
the last five top-level `##` sections outside those headings, with line ranges
and the count of other sections. JSON retains the full Current state text.
The Archive line names the paired file and its entry/section counts; JSON
retains its full body. Archived entries count in all task totals, effective
results, requirements and completion checks. An invalid/unreadable archive or
orphan is a named problem and makes coverage incomplete. These blocks do not
cut any of D42's unbounded current facts or decide which instruction governs.

Named sections prefer the canonical `##` heading; absent that, the shallowest
matching heading wins, with document order breaking ties. Duplicate-heading
lint diagnostics are unchanged. Blockers and decisions is **recorded prose**:
section length and file:line pointer, first and last positional entries, each
at most two lines. Nested subsections count until the next same-or-higher
heading; headings inside HTML comments or code fences, or indented into a list
item, do not count.
A closing run of `#` needs whitespace before it, so `## Decision#` is not
`## Decision`. Paragraphs and list items are logical entries: children,
child headings and continuation lines stay with their parent, including
indented paragraphs separated by blank lines. Fences retain their
contents. JSON preserves whole entries before text excerpting.

Attention always retains every nonterminal blocked/needs_context record, plus
at most ten ordinary rows. This may explicitly overflow ten total records;
omissions count only ordinary rows left out. Current failures and unrecognized
outcomes still have display priority. Candidate-less drafts are summarized by
count; project JSON retains every Attention record. For retained statuses,
Blockers shows its first physical line, bounded and attributed, with a continuation
marker when the logical paragraph/item continues. Prose and display order never
change selection, authority or a requirement result.

Wrapped continuation lines are indented under their labels. A recorded scalar
whose indentation already occupies 100 columns is kept intact, possibly wider,
rather than truncated or allowed to stall wrapping. Current details remain full.
Assessment findings keep original anchors/paths visible and label them references.
A same-record heading anchor receives a bounded recorded-prose excerpt and source
pointer only when it resolves unambiguously from the loaded body; external or
unresolved references cause no file reads and remain references, not replacements
for the assessment.

Mentions match only declared ids with no adjacent letter, digit, hyphen or
underscore; they are descriptive, not dependencies. Outgoing text mentions prefer
decision ids explicitly cited in the displayed Blockers excerpts, then other
decisions, then other mentions, each in stable existing order. The five-item bound
and omission count remain; corpus membership/frequencies are unchanged. Occurrence
counts imply no applicability, authority or recency.

The pure `castwork/report` export derives this data from parsed records and an
optional Git observation; the CLI owns I/O. A report never replaces reading
Intent, Scope, Out of scope, Acceptance criteria and cited decisions, or assessing
the current candidate itself.

## Installation and configuration

`setup` needs to know which hosts to generate for. Name them with `--host`,
which is repeatable, or list them under `hosts` in `castwork.json`. It adds
what you named to what was already recorded, so later `setup` and `update` runs
need no flag. With no hosts named and none recorded, `setup` refuses rather
than guessing.

Naming a host adds it; it never replaces the set. `setup --host claude` in a
repository that already generates for Codex leaves `hosts` as
`["codex", "claude"]` and leaves every Codex file where it is. Dropping a host
is deliberate: remove it from `hosts` in `castwork.json` and run `update`,
which deletes what it no longer generates and still owns.

`castwork.json` is the only configuration, and it is a property of the
repository rather than of your machine. It holds `hosts` — the hosts this
project supports, not the one you personally run — optional per-host
`role_settings`, and optional `role_routes`, which name another host a role
runs in. Both are the project's deliberate
choices; see [host-adapters.md](host-adapters.md#role-routes). Nothing inherits
from anywhere: defaults come from the installed package. A setting a host
cannot express, and a value it could not carry, are each refused rather than
dropped in silence. Omit a setting to let the host's own configuration decide
it; `.castwork/local/` is reserved for machine-local state and is not a
second configuration layer.

`update` regenerates from the hosts already recorded. It never changes which
hosts you use — that is what `setup --host` is for — and it never writes over a
generated file you edited unless `--force-generated` names it.

## Updating

`update` plans every generated file before it writes any. If one of them is a
generated file you modified, or a file of yours at a generated path, it writes
nothing and names each one. Restore or move it, or name it with
`--force-generated <path>` to replace it with the generated version (or delete
it when it is no longer generated). The path may be spelled `./x` or with
backslashes; one that names nothing generated or recorded is refused. A
half-updated installation is worse than an old one: an agent reading it cannot
tell which half it has.

It writes only what differs and names every path it writes as `changed`,
`added`, or `removed`, `.castwork/generated.json` included, so the list is
exactly what to commit and `everything is up to date` means nothing was
touched. A file that already holds exactly what would be generated is adopted,
whoever wrote it.

The check guards against conflicts, not against a failing disk: the writes
themselves are not transactional. If one fails partway, some files are new and
the manifest is old; run `update` again, and it adopts the files already
written and finishes the rest.

`update --check` runs the same plan and writes nothing. It prints the toolkit
version, location, and `source_digest` it ran from, so you can tell an
installed package from a local checkout, and exits 1 unless the installation is
current.

## Generator identity

`.castwork/generated.json` records the `version` and the `source_digest`
of the copy that wrote it. The digest is a sha256, with line endings
normalised, over these files of the running copy, in this order: every
`agents/*.md`, `commands/start.md`, every `skills/<id>/SKILL.md`,
`config.json`, every `src/adapters/*.json`, and the modules that shape
generated output: `src/adapter-generation.js`, `src/config.js`,
`src/layout.js`, `src/record.js`, and `src/yaml.js`. Each file is hashed
with its repository-relative path. The version alone cannot tell builds apart:
unreleased builds share it.

- A manifest written by a **newer version** makes `setup` and `update` refuse
  and write nothing. The error names both versions and where the running copy
  lives; run the newer copy instead. `update --check` reports it as blocked.
- The **same version with a different digest**, or a manifest written before
  the field existed, is a warning in `doctor` and `update --check`, not a
  reason to call the installation behind. The next `update` records the
  running build, and lists `generated.json` as changed.

`update` regenerates from the copy of Castwork you run. `npx --no
castwork update` uses the one installed in the repository; to adopt a local
checkout, run its `bin/castwork.js` with `node`. Neither installs or upgrades
the package itself.

Generated files are tracked, so adopting a new version is a change to the
repository: review what `update` listed and commit it together with whatever
caused it (an `castwork.json` edit, or a package or lockfile upgrade), apart
from task work. A host
session that is already running keeps the instructions and model settings it
started with; start a new one, then run the entry command again. Your records
carry the work across, so nothing is lost.


## Health

`doctor` distinguishes two levels and only the first affects its exit status:

- **error** — the installation cannot work as configured: a missing
  `.castwork/`, or a generated manifest whose `layout_version` this version
  does not speak. `doctor` exits 1.
- **warn** — something is worth doing but nothing is broken: no hosts recorded
  yet, no generated manifest, generated files that differ from what this
  toolkit generates, or a file that would make `update` write nothing. `doctor`
  exits 0.

It prints the running copy (version, location, `source_digest`) and the
manifest's version and digest, and warns when they differ. It also warns when
a generated file was edited by hand, since `update` overwrites the edit only
when forced and a host reads the file only when a new session starts, and when
`.castwork/project.md` is missing or empty, or has sections still exactly as
`setup` wrote them or left empty; a file with headings of its own is not
compared.

It compares the installation with the same plan `update --check` prints, and
reports it as `current`, `behind` (safe to update), or `blocked` (`update`
would refuse until a file is restored, moved, or forced).

So a repository with records but no generated output is healthy, because the
records are the product and the generated files can be rebuilt with `update`.

## Exit behavior

`task lint` exits non-zero when the record is structurally invalid, or when it
claims `status: done` while a declared requirement is `not_satisfied` or
`unknown`. An `unavailable` reference alone is not a failure: the reference may
resolve in another checkout.

A usage error exits 2: an unknown command, an unknown or misplaced flag, a
switch given a value, a flag missing its value, a stray argument, or
`task show` without an id. It is
refused before anything is read or written. `update --check` exits 1 when the
installation is not current, and `doctor` and `validate` exit 1 on an
error-level finding. Everything else exits zero unless it could not do what it
was asked, which exits 1.

## The one refusal

`task set <id> status done` declines, and writes nothing, when the record has a
structural error, or when its requirement evaluation is not all `satisfied`.
The structural gate is the same one `task lint` applies, from the same parse, so
a record lint rejects cannot be written to `done` instead: a misspelt
requirement kind is a declared requirement no check can weigh, and dropping it
to reach `done` is exactly what this refusal is for. That is validation on one
value, not an authorization or transition gate.

Every other field, and every direct edit of the Markdown, is unrestricted.
Failed checks, rejecting assessments, and blocked states are always recordable.

## Editing by hand

Records are ordinary Markdown. Editing one in your editor is a first-class way
to use this toolkit, and `task show --json` agrees with what you wrote. The
commands above exist because they are more convenient than an edit, not because
the file is otherwise off-limits.
