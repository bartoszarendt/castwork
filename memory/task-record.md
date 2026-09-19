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
#   assessment_roles: [maintainer]
# depends_on: [T-000]
# allowed_paths: ["src/**", "test/**"]
# candidates:
#   - ref: <commit>
#     producers: [engineer@host]
# evidence:
#   - check: test
#     candidate: <commit>
#     result: pass
#     command: "npm test"
#     exit_code: 0
#     # host, model and at are optional; record them when anyone might compare
#     # this work with work done elsewhere.
#     host: <host>
#     model: <model>
#     at: "<timestamp>"
# assessments:
#   - { candidate: <commit>, role: maintainer, actor: maintainer@host, verdict: accept }
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
