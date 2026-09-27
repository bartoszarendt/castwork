# CLI

Thirteen command paths. Installation, diagnostics, and minimal record
operations. A dedicated command exists only where it does something materially
better than editing a record by hand.

| Command path | What it does |
|---|---|
| `setup` | Install for the selected hosts: create `.agenticloop/`, write `agenticloop.json` and the generated host files, and record them in `generated.json`. A named host is added to the recorded set, never substituted for it. Refuses a 0.4.x layout. |
| `update` | Regenerate for the recorded hosts and report every path written, `.agenticloop/generated.json` included. Writes nothing while a generated file is modified locally or a file of yours stands where one is generated, unless `--force-generated` names it. `--check` lists what would change, writes nothing, and exits 1 unless the installation is current. |
| `remove` | Delete only manifest entries whose digest still matches. Never touches `project.md`, `tasks/`, or `decisions/`. |
| `doctor` | Read-only diagnosis of the installation and what to do next, including whether the generated files are current for the toolkit that ran it. Exits non-zero only on an error-level finding. |
| `validate` | Check skills, config, links, and generated adapter output. |
| `task new <title>` | Create a task record from the template with the next id. |
| `task list` | List task records with their ids, titles, and statuses. |
| `task show <id> [--json]` | Print one record. `--json` adds the three check outputs. |
| `task lint [<id>] [--json]` | Print structural validity, reference availability, and requirement evaluation. Never writes. Exits non-zero on a structural error, or on `status: done` with a requirement not satisfied. |
| `task set <id> <field> <value>` | One safe frontmatter write. `status done` refuses on a structural error, and when a declared requirement is not satisfied; every other value is unrestricted. |
| `decision new <title>` | Create a decision record from the template. |
| `version` | Print the version. |
| `help` | Print the command list. |

Nothing else. There is no activation, activation store, host-trust,
event-logging, handoff, readiness, dispatch, return, review, audit, closeout,
worktree, improvement, GitHub, guidance, generate, configure, hydrate, or init
command — and no aliases or deprecated forms for the ones that are gone.

## Installation and configuration

`setup` needs to know which hosts to generate for. Name them with `--host`,
which is repeatable, or list them under `hosts` in `agenticloop.json`. It adds
what you named to what was already recorded, so later `setup` and `update` runs
need no flag. With no hosts named and none recorded, `setup` refuses rather
than guessing.

Naming a host adds it; it never replaces the set. `setup --host claude` in a
repository that already generates for Codex leaves `hosts` as
`["codex", "claude"]` and leaves every Codex file where it is. Dropping a host
is deliberate: remove it from `hosts` in `agenticloop.json` and run `update`,
which deletes what it no longer generates and still owns.

`agenticloop.json` is the only configuration, and it is a property of the
repository rather than of your machine. It holds `hosts` — the hosts this
project supports, not the one you personally run — optional per-host
`role_settings`, and optional `role_routes`, which name another host a role
runs in and what to do when it cannot. Both are the project's deliberate
choices; see [host-adapters.md](host-adapters.md#role-routes). Nothing inherits
from anywhere: defaults come from the installed package. A setting a host
cannot express, and a value it could not carry, are each refused rather than
dropped in silence. Omit a setting to let the host's own configuration decide
it; `.agenticloop/local/` is reserved for machine-local state and is not a
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
`added`, or `removed`, `.agenticloop/generated.json` included, so the list is
exactly what to commit and `everything is up to date` means nothing was
touched. A file that already holds exactly what would be generated is adopted,
whoever wrote it.

The check guards against conflicts, not against a failing disk: the writes
themselves are not transactional. If one fails partway, some files are new and
the manifest is old; run `update` again, and it adopts the files already
written and finishes the rest.

`update --check` runs the same plan and writes nothing. It prints the toolkit
version and location it ran from, so you can tell an installed package from a
local checkout, and exits 1 unless the installation is current. The package
version alone cannot answer that: unreleased builds share it.

`update` regenerates from the copy of Agentic Loop you run. `npx --no
agenticloop update` uses the one installed in the repository; to adopt a local
checkout, run its `bin/agenticloop.js` with `node`. Neither installs or upgrades
the package itself.

Generated files are tracked, so adopting a new version is a change to the
repository: review what `update` listed and commit it together with whatever
caused it (an `agenticloop.json` edit, or a package or lockfile upgrade), apart
from task work. A host
session that is already running keeps the instructions and model settings it
started with; start a new one, then run the entry command again. Your records
carry the work across, so nothing is lost.


## Health

`doctor` distinguishes two levels and only the first affects its exit status:

- **error** — the installation cannot work as configured: a 0.4.x layout, a
  missing `.agenticloop/`, or a generated manifest whose `layout_version` this
  version does not speak. `doctor` exits 1.
- **warn** — something is worth doing but nothing is broken: no hosts recorded
  yet, no generated manifest, generated files that differ from what this
  toolkit generates, or a file that would make `update` write nothing. `doctor`
  exits 0.

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

Everything else exits zero unless it could not do what it was asked.

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
