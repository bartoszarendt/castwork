---
schema: 1
id: T-010
title: Trim whitespace from parsed names
status: done
requirements:
  checks: [test]
candidates:
  - ref: 3f9ab21
    producers: [engineer@codex]
evidence:
  - check: test
    candidate: 3f9ab21
    result: pass
    command: "npm test"
    exit_code: 0
    host: codex
    model: gpt-5.6
    at: "2026-09-18T09:12:44Z"
---

## Intent

`parseName` should not return leading or trailing whitespace.

## Scope

`src/parse-name.js` and its unit test.

## Out of scope

Any other normalization, including case folding.

## Acceptance criteria

- `parseName("  Ada  ")` returns `"Ada"`.
- `parseName("")` still returns `""`.
