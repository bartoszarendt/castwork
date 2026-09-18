# CLI

Thirteen command paths. Installation, diagnostics, and minimal record
operations. A dedicated command exists only where it does something materially
better than editing a record by hand.

| Command path | What it does |
|---|---|
| `setup` | Install for the selected hosts: create `.agenticloop/`, write `agenticloop.json` and the generated host files, and record them in `generated.json`. Refuses a 0.4.x layout. |
| `update` | Regenerate owned files whose digest still matches the manifest; report and skip modified ones unless `--force-generated` names them. |
| `remove` | Delete only manifest entries whose digest still matches. Never touches `project.md`, `tasks/`, or `decisions/`. |
| `doctor` | Read-only diagnosis of the installation and what to do next. Exits non-zero only on an error-level finding. |
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
which is repeatable, or list them under `hosts` in `agenticloop.json`. It
records what you named, so later `setup` and `update` runs need no flag. With
no hosts named and none recorded, `setup` refuses rather than guessing.

`agenticloop.json` is the only machine configuration. It holds `hosts` and
optional per-role `models`, and nothing inherits from anywhere: defaults come
from the installed package.

`update` regenerates from the hosts already recorded. It never changes which
hosts you use — that is what `setup --host` is for — and it never writes over a
generated file you edited unless `--force-generated` names it.

## Health

`doctor` distinguishes three levels and only the first affects its exit status:

- **error** — the installation cannot work as configured: a 0.4.x layout, a
  missing `.agenticloop/`, or a generated manifest whose `layout_version` this
  version does not speak. `doctor` exits 1.
- **warn** — something is worth doing but nothing is broken: no hosts recorded
  yet, no generated manifest, or a generated file missing from disk. `doctor`
  exits 0.
- **info** — a generated file you edited locally, which `update` will skip.
  `doctor` exits 0.

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
