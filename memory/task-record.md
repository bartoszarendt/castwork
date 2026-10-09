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

## Current state

<!-- What holds now: current candidate, unresolved issues, restrictions with
     decision ids and source line pointers, and the next step. Rewrite in place,
     about fifteen lines. The coordinator writes it from the roles' reports
     when roles are coordinated; otherwise the agent working alone writes it.
     This is recorded prose, grants nothing, and yields to cited decisions
     and the user's current instructions. -->

## Blockers and decisions

Record what blocked the work and what was decided, as it happens.
