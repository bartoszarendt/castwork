# Record templates (read-only package source)

This directory holds the toolkit-owned record shapes. The live mutable store is
`.castwork/` in each target project.

```text
memory/
  scaffold/
    project.md          seeded once into .castwork/, never overwritten
    decisions/.gitkeep  directory marker (not copied into targets)
    tasks/.gitkeep      directory marker (not copied into targets)
  task-record.md        the shape `task new` writes
  decision-record.md    the shape `decision new` writes
```

The authoritative contract for these shapes is
[docs/record-format.md](../docs/record-format.md). A template is a convenience,
not a schema: records are ordinary Markdown and may be written by hand.
