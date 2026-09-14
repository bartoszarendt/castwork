# Lifecycle Protocol

This is the single human-readable lifecycle protocol. `AGENTIC_LOOP.md` is the
small acting-methodology index; role files describe role boundaries; skills own
procedures; adapters route to those sources. The CLI modules below are the
machine authority. This protocol explains their shared lifecycle without making
prose a mutation input.

## Facts, Verdicts, And Refusals

Protected evaluators return a shared fact/verdict shape: ordered facts identify
the canonical fact, observed state, fact owner, policy code when applicable, and
evidence; a verdict is `legal`, `illegal`, or `unknown`; reasons identify failed
or unavailable material facts; prerequisites name required protected inputs.
`src/result-envelope.js` renders public validation results from that shape.

Every refusal has a stable code from `src/refusal-classes.js`, a material fact,
a fact owner, and a safe deterministic `nextAction` when repair is mechanical.
`src/repair-policy.js` owns routing. A diagnostic does not grant authority. It
cannot move a task, consume a packet, accept review, certify audit, or cross a
human gate. Mechanical recomputation is performed atomically by the protected
CLI command, not delegated to a role.

`task explain` is read-only. The derived, non-persisted output grants no
authority and cannot itself serve as evidence. `unknown` describes availability,
not legality. Public syntax, actions, backends, and exit behavior are owned by
CLI help and the CLI reference and enforced by the task-explain implementation.

## Canonical Lifecycle

1. **Contract and readiness.** The Maintainer owns durable task scope and
   required checks. The CLI validates the trusted task-contract baseline and
   readiness against current facts. A broad activation scope does not authorize
   a task and readiness does not create activation.
2. **Authorization and dispatch.** `task prepare-dispatch` derives a packet from
   current task, activation, readiness, repository, backend, role capability,
   and task-specific evidence. It is a read-only prediction. The packet is stale
   whenever a protected input changes.
3. **Atomic role start.** For files, `task role-start <id> --packet <path>`
   revalidates and consumes the exact packet, records the in-progress carrier
   transition, and initializes the scratch check aggregate in one transaction.
   No post-start packet recomputation authorizes work. GitHub uses its guarded
   backend-equivalent transition.
4. **Implementation evidence.** The Engineer modifies only accepted scope,
   runs the required checks, and uses CLI-produced execution evidence. On files,
   guarded `task evidence` mutations append allowed implementation evidence
   without changing protected task-contract fields.
5. **Return and review.** `task prepare-return` derives a raw role return from
   the consumed packet, current carrier, exact artifact, and check evidence.
   `task verify-return` is the protected receiving boundary. Only a current
   verified return may enter review preparation; a raw return is not review
   evidence or completion.
6. **Review, audit, closeout.** The Maintainer independently reviews the exact
   artifact. A fresh Auditor assesses the exact frozen candidate when enabled.
   Human-controlled closeout consumes the current evidence; no prior green,
   diagnostic, comment, label, or status auto-crosses the gate.

## Gate Ownership And Dispatched Contract

A failed protected gate routes work to its declared owner; it never
transfers mutation authority. Before dispatch, the Maintainer records accepted
scope, boundaries, paths, creations, criteria, checks, review requirements, and
locked decisions. That durable contract binds work; diagnostics, inferred branch
state, and later prose cannot widen it.

## Attempt And Review Budgets

`attempt_budget` and `review_budget` resolve task, project
default, then `5`. They bound attempts and
`needs_revision` rounds. A bound stops and routes work; it never waives scope,
evidence, verification, review, or human checkpoints. The Review Round
Checkpoint binds one artifact; it cannot accept, merge, or replay authority.

## Authorized Work Units And Human Checkpoints

Authorization covers the selected work unit's routine lifecycle from its current
authorized task through review and audit preparation. Do not request a separate
human prompt for each in-scope transition, commit, push, task-record update, or
protected lifecycle route.

Pause for a concrete human decision only before leaving the authorized work unit;
merging, releasing, irreversibly publishing, or destructively cleaning up;
changing a locked process, architecture, backend, or product decision; or using
a backend exception. A blocked or unresolved agent condition routes through
blocked-state rather than creating a checkpoint.

## Evidence States And Dispositions

The closed evidence states are `current`, `missing`, `malformed`, `stale`,
`negative`, and `changed`. The closed dispositions are `proceed`, `blocked`,
`needs_context`, `rejected`, `superseded`, `exception_requested`,
`exception_accepted`, and `exception_rejected`. `missing` maps to
`needs_context`; malformed to `rejected`; stale or changed to `superseded`; and
negative to `blocked`. A failed result never uses `proceed`.

`ok: true` confirms a valid routing result, not a later transition. Public
results have `rollbackAuthorized: false`. A verifier lacking context reports a
missing fact and does not invalidate prior verified work or authorize rollback.
The only successful non-terminal disposition is `exception_requested`; it grants
no implementation, task mutation, review, acceptance, audit, or closeout edge.

## Identity And Authority

The immutable workflow role IDs are `orchestrator`, `maintainer`, `engineer`,
and `auditor`. Labels are display-only. Canonical source modules own transition
schemas, digest rules, facts, and invalidators: `src/transition-contract.js`,
`src/dispatch-envelope.js`, `src/handoff-recognition.js`,
`src/execution-evidence.js`, and `src/audit-record.js`.

`agenticloop.role-preparation`, schema version `8`, has digest prefix
`sha256:agenticloop.role-preparation.v8:<64-lowercase-hex>`. Its historical
assurance-unbound and scan-unbound schemas are versions `5` and `4`; baseline
and legacy schemas are versions `2` and `3`. `agenticloop.role-return`, schema version `5`, has digest prefix
`sha256:agenticloop.role-return.v5:<64-lowercase-hex>`. `agenticloop.decomposition-provenance`, schema version `2`; `agenticloop.decomposition-binding`, schema version `1`.

Activation assurance and return assurance are independent. `host_signed` and
`operator_confirmed` describe activation; `host_receipt` and `session_reported`
describe observed return provenance. A packet digest is integrity, not
authentication. Model-created content, comments, labels, commit trailers, and
diagnostics never repair missing authority.

## Loading Rule

Load this file only for the lifecycle section required by the current action.
For example, an Engineer role-start action reads Canonical Lifecycle step 3 and
the relevant backend/role instructions; a reviewer reads step 5 and the review
skill. Do not preload the entire protocol, all backend docs, or all roles.
