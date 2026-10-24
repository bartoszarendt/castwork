# Project

Prose only. Machine configuration lives in `castwork.json` at the repository
root, not here.

## What this project is

One or two sentences: what it does and who uses it.

## Working policy

Your project's working policy, in plain language. Agents read it. The toolkit
does not compile it into rules.

Keep it short. Evolve it from what recurs here and from constraints you already
know; replacing or removing a stale sentence is better than adding another.

> For example: work in small commits; anything touching billing or auth gets an
> independent review before it is marked done, by a verifier applying a
> security skill where the host has one; ask before adding a dependency; prefer
> removing a concept over adding one.

Say when agents may commit, such as "commit each task once it is accepted",
and separately when they may push, such as "push only when I ask": a rule for
commits grants none for pushing. Say too what must reach you before it happens
beyond your usual calls, such as spending, production data, or contacting
customers. Agents decide the rest and tell you what they decided.

## Checks

Name the commands your checks refer to, so an agent recording evidence uses the
right check names.

- `test` — `npm test`
- `lint` — `npm run lint`

## Setup facts

Anything an agent needs to know to start working here: how to run the app, where
the interesting code is, what is generated, what is off-limits.

Every role reads this file, so keep each fact to a line. When one needs more,
put the detail in a document and point to it, saying what it holds and when to
read it. Facts about one machine, such as local paths, ports, or wrappers, go
in `.castwork/local/setup.md`, which stays on that machine.

## Documents

Pointers to the project's own plan, spec, design, or architecture documents.
The coordinator reads them to report where the project is and to propose what
comes next, so say which one says what comes next.
