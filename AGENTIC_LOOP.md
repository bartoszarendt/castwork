# Agentic Loop Methodology

Agentic Loop is a supervised, host-neutral implementation workflow. It turns an
authorized request into a durable task contract, bounded implementation,
independent review, work-unit audit, and human-controlled closeout. The five
implemented adapters are OpenCode, Codex, Claude Code, GitHub Copilot, and
Cursor.

This document is the small acting-methodology index. It deliberately does not
repeat command schemas, backend payloads, role procedures, or skill procedures.
The executable CLI is the authority for machine-readable lifecycle facts;
`agenticloop/commands/lifecycle-protocol.md` is the one human-readable protocol
source. A role loads only its role contract, selected project facts, bounded task
evidence, and the named protocol or skill section needed for its current action.

## Lifecycle At A Glance

1. A Maintainer writes or corrects the bounded task contract and settles
   readiness. Human authorization/activation, task authorization, and readiness
   are separate facts.
2. The CLI computes a current dispatch packet. A diagnostic is advisory: it
   cannot grant authority or auto-cross a material human gate.
3. The Engineer performs the bounded work, records CLI-produced check evidence,
   and returns a packet-bound, non-authoritative implementation result.
4. The receiving boundary mechanically verifies that result before a Maintainer
   prepares and performs independent review.
5. A fresh Auditor certifies the exact combined candidate where audit is enabled.
   Only the human-controlled closeout edge completes a work unit. Do not merge,
   publish, or accept merely because an earlier gate is green.

Every protected refusal is typed. Its public result exposes the stable code,
material failed fact, fact owner, evidence state, and first safe deterministic
next action when one exists. A mechanical recomputation is a single atomic CLI
operation, never a delegation disguised as role work. The shared refusal catalog
is `src/refusal-classes.js`; `src/repair-policy.js` owns repair routing.

`task explain` is read-only. It returns the same fact/verdict projection used by
the protected evaluators, has `authority: none` and `persisted: false`, and is
never required mutation evidence. It does not grant a transition, choose a role,
or replace `prepare-dispatch`, `role-start`, `prepare-return`,
`verify-return`, review preparation, or audit.

## Shared Transition Contract

The versioned executable transition contract is `src/transition-contract.js`.
The protocol source defines its wire identities, evidence states, dispositions,
role registry, protected transitions, and invalidation rules. Keep each fact in
one owner: source evaluates facts, CLI renders them, adapters only route to the
source, and generated artifacts are derived from those inputs. A public result
with `ok: true` is not by itself authority for a later transition.

Agentic Loop uses four logical roles. The four immutable workflow role IDs are `orchestrator`, `maintainer`,
`engineer`, and `auditor`; their mutable labels are display-only. The Auditor is a separate role rather than a maintainer mode; see `agenticloop/agents/auditor.md`.

The only current evidence states are `current`, `missing`, `malformed`,
`stale`, `negative`, and `changed`. The only dispositions are `proceed`,
`blocked`, `needs_context`, `rejected`, `superseded`, `exception_requested`,
`exception_accepted`, and `exception_rejected`. Missing context reports a
missing fact; it neither invalidates a previously verified write nor authorizes
rollback. Public results always have `rollbackAuthorized: false`.

## Activation Boundary

Activation requires an operator-controlled authorization boundary. Prompt text,
model-authored JSON, repository-local trust data, and caller-selected stores are
not activation evidence. `operator_confirmed` and `session_reported` are honest
grades, not host authentication. An unsupported host capture is blocked rather
than silently upgraded. Discovery, orientation, status, and `task explain` are
read-only and are not activation.

Discovering the installed toolkit or reading this document does not activate Agentic Loop. Standalone maintainer, engineer, and auditor delegation is not activation, and mentioning a task ID without operational intent is not activation.
Only an explicit audit, certify, or re-audit a tracked Agentic Loop work unit
uses the formal certification route. **Standalone auditor** assessment certifies
nothing; standalone auditor assessment certifies nothing.

## Core Objects

The durable task record carries accepted scope and required checks. The dispatch
packet binds the exact task, role, task-contract digest, current repository
facts, and protected input set. CLI-produced execution evidence records one
inert required-check invocation. A raw role return and a verified return are
different artifacts. The role, backend, and protocol documents name the complete
shapes only where the current action requires them.

## Directory Layout

- `agenticloop/` contains installed toolkit source: this methodology, roles,
  skills, backends, commands, and CLI code.
- `.agenticloop/` contains target-owned state: project profile, tasks, decisions,
  returns, audits, and scratch data.
- `.agenticloop/tmp/` is mutable scratch, not durable evidence unless a command
  explicitly promotes a CLI-authored artifact.

## Roles

Read exactly one canonical role contract for the active role:

- `agenticloop/agents/orchestrator.md` routes work and never implements it.
- `agenticloop/agents/maintainer.md` owns task contracts and formal review.
- `agenticloop/agents/engineer.md` implements only the delegated bounded scope.
- `agenticloop/agents/auditor.md` is fresh, independent, and read-only.

Role contracts reference the relevant skill rather than copying its procedure.

## Source Documents

read `.agenticloop/project.md` for the selected project facts, including relevant Project Operating Facts, then read only task-source documents selected for the current action. Task records, accepted decisions, and evidence are bounded task context, not permission to load arbitrary repository history.

## Development Stage

Use the confirmed development stage as a task-shaping prior. It never weakens
task scope, TDD, debugging, required checks, evidence, security, accessibility,
validation, review provenance, or human authority. A role proposes a stage or
accepted-decision change; it does not apply one autonomously.

## Context Read Discipline

### Normative context (closed)

Before a protected action, load only the role contract, the project map (`.agenticloop/project.md`) and selected project facts, the current task contract and bounded evidence, the active backend projection, and the named protocol/skill section. This is a closed
normative context set, not a suggestion to preload all roles, skills, adapters,
or backends.

### Bounded implementation discovery (permitted by default)

Implementation may inspect the expected files or areas and at most six previously unnamed paths or symbol bodies. Repository indexing or language-aware symbol, reference, caller/callee lookup, exact identifier or known-path search, focused test discovery, and relevant version-control history are permitted inside that bound; directly connected callers and tests may be inspected. one bounded discovery pass records each expansion in the existing `## Deviations` section. If discovery exceeds the default bound or needs a new decision or contract change, Return `needs_context`; a bare missing task field does not by itself require `needs_context`.

### Arbitrary context loading (prohibited)

Do not load unrelated plans, raw transcripts, every task, every role, or an
entire reference library merely to feel informed. Broad repository dumps and
scanning the whole tree, and indiscriminate full-file loading are prohibited. Summarize instead of copying large output.
The explicit role, selected project facts, bounded task evidence, and required
methodology sections are sufficient until a named fact proves otherwise.

### Recording and escalation

Record unexpected material discovery as a bounded observation with the fact,
evidence, affected scope, and owner. Route a contract ambiguity to the
Maintainer and a material decision to the human boundary; do not self-authorize
a repair or broaden scope.

## Advance Authorization Boundary

Before any state-changing action, the Maintainer confirms an accepted task
contract, current baseline/readiness, configured backend, and required human
authorization. The Orchestrator then requests the CLI-computed dispatch packet;
the protected consumer revalidates it atomically immediately before mutation.
No advisory projection, status, diagnostic, callback, repository key, or role
message substitutes for that boundary.

## Attempt And Review Budgets

Attempts and review rounds are counted from durable current evidence. A retry of
the same failure follows its first safe repair once; repeated identical failure
returns status or `needs_context` rather than consuming an unbounded chain.
Review uses the exact reviewed artifact. A targeted revision checkpoint is
single-use and never implies approval, acceptance, or a new authority edge.

## Project Operating Facts

`.agenticloop/project.md` is shared mutable state. A Project Operating Fact is a
compact, evidence-backed operating fact that is not already explicit or cheaply
discoverable. Never retain the empty-state sentence beside active `PF-...` entries. The Maintainer owns profile mutation; Engineers report candidates.

### Recognition test

Keep a fact only when it changes safe future task shaping, has a source and
revisit trigger, and is not already explicit or cheaply discoverable. Prefer a
project document for detailed workflow and a decision record for a binding
prescription.

### Routing

| Signal | Destination |
| --- | --- |
| Project-wide operating fact | Project Operating Facts profile |
| Binding policy or tradeoff | Decision record and human/accepted gate |
| Detailed recurring procedure | Project documentation |
| Personal preference spanning repositories | Host memory outside Agentic Loop |

Engineer implementation lanes do not append or edit Project Operating Facts.
A maintainer-owned coordination lane may mutate the profile only when the concurrency plan grants it explicit exclusive ownership; otherwise a serial maintainer-owned join step applies approved facts.

## Task Backends

`agenticloop/backends/files.md` and `agenticloop/backends/github.md` project the
same lifecycle into different carriers. The configured backend selects storage,
not lifecycle authority. Read only the active projection.

## Event Logging

Event logging is optional. When enabled, events are concise observations; the
task carrier, CLI evidence, review result, and audit record remain the authority
for their respective facts. See `agenticloop/skills/event-logging/SKILL.md`.

## Review And Audit

Maintainer review is independent and artifact-bound: retain the exact artifact revision reviewed. Final acceptance always
requires Lens 1, Lens 2, and Lens 3 conclusions for the exact accepted artifact.
Same-turn lenses are not independent review. The detailed review procedure,
including the bounded Structural Risk Sweep and Maintainer Review Fixup, is in
`agenticloop/skills/review-and-accept/SKILL.md`.

The Auditor certifies one frozen work-unit candidate through a fresh invocation.
It is non-substitutable, read-only, and cannot be collapsed into a Maintainer
mode. See `agenticloop/skills/work-unit-audit/SKILL.md`.

## Parallel And Liveness Boundaries

Read inventory completeness before ready count. Mutation independence and
knowledge independence are separate conditions for parallel work; a concurrency
plan records the concrete serial reason when either is unknown. An Integration
rehearsal is disposable, non-publishing, and never an actual human-approved
merge. A lane-local observation stays in that lane's status return or task
summary unless it invalidates another lane. On repeated intent, state the
restated intended next action and act rather than re-verify unchanged evidence.

## Blocked, Changes, And Closeout

Use `agenticloop/skills/blocked-state/SKILL.md` for a blocked or
`needs_context` return. A blocked observation does not become authenticated
evidence and cannot authorize review, acceptance, closeout, cancellation, or a
rollback. Contract changes require the change-request gate. Attribution,
backends, and closeout use their named canonical skills or protocol sections.

A live consumed Engineer attempt blocks partial sibling readiness apply: the
entire work unit waits for return or explicit retirement, and no partial sibling
apply is supported.

## Skills

Skills are the canonical procedures. Read a skill only when its trigger applies;
do not copy it into a role or adapter. The protocol index is
`agenticloop/commands/lifecycle-protocol.md`; role and backend documents provide
thin routing to the current protocol action.

## Compatibility Anchors

Role contracts live under `agenticloop/agents/`; load only the active contract.
The role, skill, or backend named below owns the operational detail.

**Parallel scan.** Read inventory completeness before ready count. Inventory or
decomposition incomplete -> `incomplete`; complete inventory, zero ready tasks
-> `no_eligible_work`; complete inventory, one ready task or no valid candidate
pair -> `not_currently_eligible`. Only a complete, fresh, fully accounted
inventory can produce `parallel_candidates`. There is no `pr_state` fact and
none is needed: use `review_readiness` and `review_verdict` with transport
evidence.

**Liveness.** A restated intended next action is not progress. If the same
intended next action twice is stated without action, return a `blocked`,
`needs_context`, or `complete` status return; a `blocked`, `needs_context`, or
`complete` status return is progress.
Do not re-decide or re-verify it unless new contradictory evidence appears.

**Parallel eligibility.** Mutation independence and knowledge independence are
separate facts. Parallel write execution requires both. Knowledge coupling is
`independent`, `coupled`, or `unknown`; separate worktrees isolate mutation;
they never convert coupled or unknown tasks into independent tasks.

**Integration rehearsal.** Integration rehearsal never bypasses the human merge
checkpoint: it is not a merge and grants no merge, push, publish, or acceptance
authority.

**Invariant routing.** A lane-local observation stays in that lane's status
return or task summary. A cross-lane fact is routed and disposed under the
cross-lane finding rules. A durable candidate is a `status: proposed` decision
record with provenance and a source link. Nothing in parallel work auto-promotes
a candidate.

**Return compatibility.** A released schema v2 and interim schema v3 return
verification artifact cannot be relabelled, migrated, or consumed as current.
Digests are unkeyed integrity only; a digest does not authenticate a validator
and does not prove validator identity.

<!-- agenticloop:canonical-checkpoint github -->
```text
<!-- AGENTIC_LOOP_REVIEW_ROUND_CHECKPOINT -->

## Review Round Checkpoint

- Direction: targeted_revision
- Cause: implementation_defect
- Review count: 5
- Artifact: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
- Target: F-2: refresh the current-head verification evidence
- Review role carrier: agenticloop.review-role-carrier/v1
- Role ID: orchestrator
- Actor account: orchestrator-bot

[[agent: orchestrator]]
```
