# `.castwork/` — your project's records

This directory belongs to your project, not to the toolkit. `setup` creates it
and never overwrites what is in it.

```text
.castwork/
  project.md       prose: what this project is, its working policy, setup facts
  tasks/           one Markdown record per task, e.g. tasks/T-001.md
  decisions/       one Markdown file per durable decision
  generated.json   tracked ownership manifest for generated files
  local/           gitignored machine-specific state
```

Nothing else is written here.

The toolkit's own sources (roles, skills, the entry command) are not copied
into your repository. `setup` projects them into each selected host's own
directories and lists every generated file in `generated.json`.

Machine configuration — which hosts to generate for, per-role model bindings —
lives in `castwork.json` at the repository root. `project.md` is prose.

Records are ordinary Markdown and remain readable and editable without the
toolkit installed. See [docs/record-format.md](../../docs/record-format.md).

Commit everything here except `local/`.
