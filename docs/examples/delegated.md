---
schema: 1
id: T-011
title: Charge the correct currency on renewal
status: done
requirements:
  checks: [test, lint]
  independent_review: true
  assessment_roles: [maintainer]
candidates:
  - ref: 8c1d004
    producers: [engineer@claude-code]
evidence:
  - { check: test, candidate: 8c1d004, result: pass, command: "npm test", exit_code: 0 }
  - { check: lint, candidate: 8c1d004, result: pass, command: "npm run lint", exit_code: 0 }
assessments:
  - { candidate: 8c1d004, role: maintainer, actor: maintainer@codex, verdict: accept, findings: "Currency resolved from the subscription, not the request locale. Agreed." }
---

## Intent

Renewals charged in the request locale's currency rather than the currency the
subscription was created in.

## Scope

`src/billing/renew.js` and its tests.

## Out of scope

Historical corrections for renewals already charged.

## Acceptance criteria

- A subscription created in EUR renews in EUR regardless of request locale.
- An unknown currency fails loudly rather than defaulting.

## Blockers and decisions

Decided to fail loudly on an unknown currency rather than fall back to USD; a
silent fallback is how this bug reached production.
