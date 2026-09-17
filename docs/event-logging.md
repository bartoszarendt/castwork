# Event Logging

Agentic Loop can record compact JSONL workflow-gate events for local audit and
summary generation. Event logging is **disabled by default**.

## Enabling

Interactive setup offers a numbered disabled/enabled choice. For automated
setup on an already confirmed project, use:

```text
npx agenticloop setup --adapter <host> --yes --event-logging enabled
```

You can also enable it directly in `.agenticloop/project.md`:

```yaml
event_logging: enabled
```

`event_logging_command` can stay blank; agents test `npx agenticloop --help`
once when logging is enabled.

## Commands

```text
npx agenticloop event-logging <event> [options]      Append/validate/audit/report workflow-gate events
```

Writes require `--task` and `--summary`. `validate`, `audit`, and `report`
inspect existing logs without writing.

## What events contain

Event logs are local JSONL files under `.agenticloop/logs/`. They should
contain short workflow-gate summaries only – never raw prompts, raw assistant
messages, token streams, terminal dumps, secrets, or host telemetry.

When logging is enabled, a successful protected `task prepare-dispatch`
invocation that writes its packet also records one compact action observation.
The observation binds the attempted action to the exact semantic evaluation
the command consumed. Read-only `status`, `explain`, and `measure` calls do not
record action attempts.

These logs are optional, machine-local observations rather than lifecycle
authority. A logging failure never blocks the protected action, and log files
do not make the repository dirty for dispatch purposes. Missing observations
remain missing and reduce only the coverage of measurements that depend on
them.

## Relationship to completion summaries

Per-task completion summaries are always written inline into
`.agenticloop/tasks/<TASK-ID>.md` (the `## Scope Completed` section),
regardless of whether event logging is enabled. There is no separate
`.agenticloop/summaries/` directory; closeout is a verify-and-mark gate that
confirms those inline summaries and posts a status marker.
