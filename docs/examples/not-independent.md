---
schema: 1
id: T-012
title: Retry the webhook delivery three times
status: in_review
requirements:
  checks: [test, lint]
  independent_review: true
  assessment_roles: [maintainer]
candidates:
  - ref: b70e55a
    producers: [engineer@claude-code]
evidence:
  - { check: test, candidate: b70e55a, result: pass, command: "npm test", exit_code: 0 }
  - { check: lint, candidate: b70e55a, result: pass, command: "npm run lint", exit_code: 0 }
assessments:
  - { candidate: b70e55a, role: maintainer, actor: engineer@claude-code, verdict: accept, findings: "Looks right to me." }
---

## Intent

A failed webhook delivery should be retried three times with backoff.

## Scope

`src/webhooks/deliver.js` and its tests.

## Acceptance criteria

- Three attempts, then the delivery is recorded as failed.
- Backoff is bounded.

## Design notes

Both checks pass and the maintainer assessment says `accept`, so `checks` and
`assessment_roles` are satisfied.

`independent_review` is **not** satisfied: the accepting actor
`engineer@claude-code` is listed in the candidate's `producers`. The actor
string is what independence is judged on, not the `role` field — claiming the
`maintainer` role does not make the same actor independent of its own work.

`task set T-012 status done` therefore refuses and writes nothing. The record
stays readable and editable, and the honest assessment stays recorded.
