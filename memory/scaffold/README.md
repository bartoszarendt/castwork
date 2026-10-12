# `.castwork/` — your project's records

This directory belongs to your project, not to the toolkit. `setup` creates it
and never overwrites what is in it.

```text
.castwork/
  project.md       prose: what this project is, its working policy, setup facts
  tasks/           one Markdown record per task, e.g. tasks/T-001.md
  decisions/       one Markdown file per durable decision
  findings/        what is written about the work: findings, notes, logs
  generated.json   tracked ownership manifest for generated files
  local/           gitignored machine-specific state: setup.md for facts
                   about this machine, a pause handoff
```

Nothing else is written here. Every Markdown file under `tasks/` is read as a
task record, so supporting files, such as findings or logs, go in `findings/`.

The toolkit's own sources (roles, skills, the entry command) are not copied
into your repository. `setup` projects them into each selected host's own
directories and lists every generated file in `generated.json`.

Machine configuration — which hosts to generate for, per-role model bindings —
lives in `castwork.json` at the repository root. `project.md` is prose.

Records are ordinary Markdown and remain readable and editable without the
toolkit installed. See [docs/record-format.md](../../docs/record-format.md).

Commit everything here except `local/`.
