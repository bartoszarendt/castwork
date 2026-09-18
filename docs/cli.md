# CLI

Thirteen command paths. Installation, diagnostics, and minimal record
operations. A dedicated command exists only where it does something materially
better than editing a record by hand.

| Command path | What it does |
|---|---|
| `setup` | Install for the selected hosts: create `.agenticloop/`, write `agenticloop.json` and the generated host files, and record them in `generated.json`. Refuses a 0.4.x layout. |
| `update` | Regenerate owned files whose digest still matches the manifest; report and skip modified ones unless `--force-generated` names them. |
| `remove` | Delete only manifest entries whose digest still matches. Never touches `project.md`, `tasks/`, or `decisions/`. |
| `doctor` | Read-only diagnosis of the installation and what to do next. |
| `validate` | Check skills, config, links, and generated adapter output. |
| `task new <title>` | Create a task record from the template with the next id. |
| `task list` | List task records with their ids, titles, and statuses. |
| `task show <id> [--json]` | Print one record. `--json` adds the three check outputs. |
| `task lint [<id>] [--json]` | Print structural validity, reference availability, and requirement evaluation. Never writes. Exits non-zero on a structural error, or on `status: done` with a requirement not satisfied. |
| `task set <id> <field> <value>` | One safe frontmatter write. `status done` refuses when a declared requirement is not satisfied; every other value is unrestricted. |
| `decision new <title>` | Create a decision record from the template. |
| `version` | Print the version. |
| `help` | Print the command list. |

Nothing else. There is no activation, activation store, host-trust,
event-logging, handoff, readiness, dispatch, return, review, audit, closeout,
worktree, improvement, GitHub, guidance, generate, configure, hydrate, or init
command — and no aliases or deprecated forms for the ones that are gone.

## Exit behavior

`task lint` exits non-zero when the record is structurally invalid, or when it
claims `status: done` while a declared requirement is `not_satisfied` or
`unknown`. An `unavailable` reference alone is not a failure: the reference may
resolve in another checkout.

Everything else exits zero unless it could not do what it was asked.

## The one refusal

`task set <id> status done` declines, and writes nothing, when the record's
requirement evaluation is not all `satisfied`. That is validation on one value,
not an authorization or transition gate.

Every other field, and every direct edit of the Markdown, is unrestricted.
Failed checks, rejecting assessments, and blocked states are always recordable.

## Editing by hand

Records are ordinary Markdown. Editing one in your editor is a first-class way
to use this toolkit, and `task show --json` agrees with what you wrote. The
commands above exist because they are more convenient than an edit, not because
the file is otherwise off-limits.
