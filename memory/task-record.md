---
schema: 1
id: T-001
title: Short task title
status: draft
# Declare only what you actually want checked. A task with no requirements
# block is normal.
# requirements:
#   checks: [test]
#   independent_review: true
#   assessment_roles: [verifier]
# depends_on: [T-000]
# allowed_paths: ["src/**", "tests/**"]
# candidates:
#   - ref: <commit or other reference>
#     producers: [worker@host]
# evidence:
#   - check: test
#     candidate: <commit>
#     result: pass
#     command: "npm test"
#     exit_code: 0
#     # Optional: use the exact host-reported model and an RFC 3339 timestamp
#     # when the record must stay self-contained without host-local telemetry.
#     # The host, here and after the @ in an actor string, is the agent host
#     # id (claude, codex or opencode), never the machine's name.
#     host: <host>
#     model: <model>
#     at: "<timestamp>"
# assessments:
#   - candidate: <commit>
#     role: verifier
#     actor: verifier@host
#     verdict: accept
#     host: <host>
#     model: <model>
#     at: "<timestamp>"
---

## Intent

State the outcome this task should produce.

## Scope

List the required changes.

## Out of scope

Name nearby work that must not be bundled in.

## Acceptance criteria

- One observable outcome per bullet.

## Blockers and decisions

Record what blocked the work and what was decided, as it happens.
