# Host adapters

An adapter is a thin projection of the canonical roles, skills, and entry
command into the layout one host expects. A host is a template directory, not
special machinery.

## Supported hosts

| Host | Generated into |
|---|---|
| `codex` | `.codex/agents/` (TOML) and `.agents/skills/agenticloop/` |
| `claude-code` | `.claude/agents/`, `.claude/commands/`, `.claude/skills/agenticloop/` |
| `opencode` | `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/agenticloop/` |

Copilot and Cursor adapters were removed in 0.5.0.

## What generation does

`setup` and `update` read the canonical sources at the toolkit root:

```
agents/      the four role presets
skills/      reusable procedures
commands/    the start entry command
config.json  role descriptions, per-host settings
```

and write the host's own files, substituting only what is host-specific:
placement, file naming, and the host's frontmatter conventions. Each host is a
descriptor in `src/adapters/<host>.json` listing where each kind of file goes
and in which format; the generator itself knows nothing about any host.

Generated files contain:

- no absolute paths, so the repository stays portable across machines;
- no workflow infrastructure, capability declarations, or activation slots;
- nothing a host cannot act on.

If you find generated output asking an agent to prove something about itself,
that is a bug. The toolkit reports what was recorded; it does not authenticate.

## Ownership

Every generated file is listed in `.agenticloop/generated.json` with its digest.
That manifest is tracked alongside the files it describes.

- `update` regenerates a file only when its current digest matches the manifest.
  A file you edited is reported and skipped, unless you name it with
  `--force-generated`.
- A file that is not in the manifest is never written over. If generation would
  collide with a file you own, the collision is reported and your file is
  preserved.
- `remove` deletes only manifest entries whose digest still matches, and never
  touches `project.md`, `tasks/`, or `decisions/`.

This is the whole ownership model. There is no certificate, no layout version
negotiation, and no repair path.

## Machine configuration

`agenticloop.json` at the target root holds which hosts to generate for and any
per-role model bindings:

```json
{
  "hosts": ["codex", "claude-code"],
  "models": {
    "engineer": "claude-opus-5",
    "auditor": "claude-sonnet-5"
  }
}
```

Defaults come from the installed package, so there is nothing to point at and
no file to inherit from. What is in this file overrides them.

A model binding is a plain string passed to the host. It is optional runtime
configuration and never role identity: binding a model grants no authority and
changes no assessment's meaning.

Machine configuration lives here and nowhere else. `.agenticloop/project.md` is
prose.

## Adding a host

Add a descriptor at `src/adapters/<host>.json` listing its files, and add the
host to `config.json` and to `HOSTS` in `src/layout.js`. Nothing else in the toolkit should need to know the
host exists. If adding a host requires changing the checks, the record format,
or the CLI, the abstraction has leaked — fix that instead.

## Verifying output

```sh
npx agenticloop validate
```

checks skills, config, links, and generated adapter output. Read the generated
files too: they are prose an agent will follow, and prose is not covered by a
digest check.
