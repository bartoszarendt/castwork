/**
 * What every persisted evidence class is for, and who is allowed to see it.
 *
 * Two requirements meet here. The platform-safety work asked for a storage taxonomy, because Agentic
 * Loop wrote generated state under `.agenticloop/` and then rejected it at the
 * clean gate - a class confusion, not a bug in either component. And the
 * remediation's governing principle asks the harder question of every field:
 *
 * > Rich internal state must produce a simpler external workflow. Every
 * > persisted field must have at least one named consumer and support a
 * > decision, invariant, recovery operation, audit claim, coordination
 * > boundary, or bounded analysis. Otherwise it must be derived, transient, or
 * > removed.
 *
 * A record kept because it might be useful later is a record nobody maintains
 * and everybody has to reason about. So each class below names its producer,
 * its consumer, the decision it changes, whether it could be derived instead,
 * how long it must survive, which storage class it belongs to, and the bounded
 * projection each role receives.
 *
 * The last field is the one that does work at runtime. An Engineer does not
 * need activation internals, audit records, or closeout state to implement a
 * bounded change; handing them over enlarges the context it must reason about
 * and the surface it might act on, for no implementation benefit. `visibleTo`
 * is that boundary, stated per class rather than per call site.
 *
 * This inventory is checked against the source's own storage roots, so it
 * cannot quietly go stale while the code grows a new class.
 */

/**
 * Storage classes.
 *
 * The clean-gate rule is the reason the taxonomy exists: a command must not
 * write ordinary output into a class its next required gate rejects.
 */
export const STORAGE_CLASSES = Object.freeze({
  transient_scratch: Object.freeze({
    id: 'transient_scratch',
    location: '.agenticloop/tmp/',
    committed: false,
    cleanGate: 'excluded',
    retention: 'until the operation that wrote it completes; safe to delete at any time',
    rule: 'Ordinary command output that no later gate consumes. Excluded from the clean gate at every boundary, so it can never self-block the next step.',
  }),
  operator_owned_authenticated_state: Object.freeze({
    id: 'operator_owned_authenticated_state',
    location: '~/.agenticloop/operator-activation/ (outside every target repository)',
    committed: false,
    cleanGate: 'not_applicable',
    retention: 'for the life of the operator key; superseded material is preserved, never deleted',
    rule: 'Operator confirmation keys, external revocation tombstones, and migration receipts. Never inside a target repository, so repository content can never decide whether operator authority exists.',
  }),
  durable_project_evidence: Object.freeze({
    id: 'durable_project_evidence',
    location: '.agenticloop/** (committed)',
    committed: true,
    cleanGate: 'fails_closed_until_committed',
    retention: 'for the life of the project history; append-only where the class says so',
    rule: 'Evidence a later gate reads to make a decision. It must be committed by its owning role before the gate that consumes it runs; uncommitted durable evidence fails closed rather than being auto-staged.',
  }),
  material_transient_transaction_state: Object.freeze({
    id: 'material_transient_transaction_state',
    location: '.agenticloop/handoffs/role-start-transactions/',
    committed: false,
    cleanGate: 'fails_closed_until_resolved',
    retention: 'until its transaction reaches one consistent outcome: committed post-state or restored pre-state',
    rule: 'Authenticated recovery intent for an in-flight transaction. It is not permanent evidence or disposable scratch: an unresolved, unknown, or invalid intent must block the transition until the exact retry resolves it or refuses it without mutation.',
  }),
  machine_local_operator_state: Object.freeze({
    id: 'machine_local_operator_state',
    location: 'ignored .agenticloop/ operator-state directories in the target repository',
    committed: false,
    cleanGate: 'permitted_untracked',
    retention: 'only while the signed record is current or its bounded consumer can still use it',
    rule: 'Short-lived, machine-local operator records authenticated when consumed. They are ignored and permitted untracked at the dispatch clean gate because committing expiring signed records adds no authority.',
  }),
  product_task_carrier_state: Object.freeze({
    id: 'product_task_carrier_state',
    location: '.agenticloop/tasks/ and the product tree',
    committed: true,
    cleanGate: 'scope_relevant',
    retention: 'for the life of the project history',
    rule: 'The task contract and the product itself. Changes here are material by definition and invalidate bound evidence.',
  }),
});

const ROLES = Object.freeze(['orchestrator', 'maintainer', 'engineer', 'auditor']);

function entry(value) {
  return Object.freeze(value);
}

/**
 * Every persisted evidence class, with the seven fields the exit gate requires.
 *
 * `derivable` answers "could this be recomputed from a stronger canonical
 * source?". Where the answer is yes, the class must justify persisting anyway -
 * and two of them below do not, which is recorded rather than hidden.
 */
export const EVIDENCE_INVENTORY = Object.freeze({
  project_map: entry({
    root: '.agenticloop/project.md',
    producer: 'initialization and authorized project configuration updates',
    consumer: 'configuration resolution, readiness, lifecycle, and closeout',
    decision: 'which backend, task layout, budgets, grouping, and project rules govern the target',
    derivable: false,
    retention: 'project history; the active project configuration remains the target-owned workflow baseline',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze([...ROLES]),
  }),
  task_record: entry({
    root: '.agenticloop/tasks',
    producer: 'maintainer',
    consumer: 'every gate; the task contract is the root authority',
    decision: 'what work is authorized, in what scope, against which acceptance criteria',
    derivable: false,
    retention: 'project history',
    storageClass: 'product_task_carrier_state',
    visibleTo: Object.freeze([...ROLES]),
  }),
  task_contract_history: entry({
    root: '.agenticloop/task-contract-history',
    producer: 'maintainer',
    consumer: 'handoff preflight, packet preparation, closeout',
    decision: 'whether the current contract descends from a trusted baseline; a broken chain blocks dispatch',
    derivable: false,
    retention: 'project history, append-only; deletion is itself a violation',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  decision_record: entry({
    root: '.agenticloop/decisions',
    producer: 'maintainer or authorized decision owner',
    consumer: 'decision references, implementation boundaries, review, and audit',
    decision: 'which recorded architecture, quality, or process disposition remains applicable',
    derivable: false,
    retention: 'project history; supersession is recorded rather than erasing the prior decision',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'engineer', 'auditor']),
  }),
  audit_certificate: entry({
    root: '.agenticloop/audits',
    producer: 'auditor',
    consumer: 'work-unit closeout, remediation routing, and later audit review',
    decision: 'whether a work unit is certified, needs remediation, or needs a human decision against its exact baseline',
    derivable: false,
    retention: 'project history with append-only Auditor report history',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  auditor_return_receipt: entry({
    artifactKind: 'agenticloop.auditor-return-receipt',
    root: '.agenticloop/audits',
    producer: 'protected host adapter',
    consumer: 'audit-record receipt replay validation',
    decision: 'whether a protected Auditor return receipt has already been consumed by the audit history',
    derivable: false,
    retention: 'project history as part of the append-only Auditor report history',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  improvement_proposal: entry({
    root: '.agenticloop/improvements',
    producer: 'workflow roles through the improvement proposal path',
    consumer: 'maintainer improvement triage and closeout follow-up routing',
    decision: 'whether an observed workflow failure becomes an accepted, rejected, superseded, or implemented improvement',
    derivable: false,
    retention: 'project history; proposals remain evidence even when rejected or superseded',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  workflow_event_log: entry({
    root: '.agenticloop/logs',
    producer: 'enabled workflow event emitters',
    consumer: 'event-log validation, status reporting, audit, and closeout',
    decision: 'whether required workflow gates were observed and whether their event history is internally consistent',
    derivable: false,
    retention: 'project history when event logging is enabled',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  check_execution_evidence: entry({
    root: '.agenticloop/checks',
    producer: 'check-evidence-update executing the packet-bound required check',
    consumer: 'required-check aggregation, review preparation, audit, and closeout',
    decision: 'whether a required check actually ran for its exact packet-bound command and produced inspectable evidence',
    derivable: false,
    retention: 'project history; superseded execution artifacts remain available to explain later attempts',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'engineer', 'auditor']),
  }),
  check_evidence_supersession: entry({
    artifactKind: 'agenticloop.required-check-evidence-supersession',
    root: '.agenticloop/checks',
    producer: 'check-evidence-init replacing an existing packet-bound check scaffold',
    consumer: 'check-evidence-init supersession-history validation',
    decision: 'which prior check-evidence scaffold was deliberately superseded under named Maintainer or human authority',
    derivable: false,
    retention: 'project history under the exact task check-evidence history directory',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'engineer', 'auditor']),
  }),
  lifecycle_receipt: entry({
    root: '.agenticloop/lifecycle-receipt.json',
    producer: 'agenticloop init, setup, and update lifecycle mutations',
    consumer: 'the next authoritative readiness edge',
    decision: 'whether the previous lifecycle mutation completed with the state the next readiness gate expects',
    derivable: false,
    retention: 'current durable prior-gate receipt, replaced only by the next lifecycle mutation',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  host_role_capability: entry({
    root: '.agenticloop/host-role-capabilities',
    producer: 'adapter generation',
    consumer: 'host handoff and generated host-role capability validation',
    decision: 'which host-observed role capabilities a generated adapter declaration may assert for the target',
    derivable: false,
    retention: 'until regenerated for the installed adapter configuration; the committed declaration binds the generated host artifact',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  decomposition: entry({
    root: '.agenticloop/decompositions',
    producer: 'maintainer',
    consumer: 'handoff preflight, packet preparation, activation work-unit derivation',
    decision: 'which tasks form the ready set, and whether this task may be dispatched from it',
    derivable: false,
    retention: 'until superseded by a regenerated scan; prior scans need not be kept',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  activation_grant: entry({
    artifactKind: 'agenticloop.activation-grant',
    root: '.agenticloop/activations',
    aliases: Object.freeze(['activation_grant_record']),
    producer: 'operator (interactive CLI) or a protected host boundary',
    consumer: 'packet preparation, role start, closeout',
    decision: 'whether the operator authorized this exact task, and until when',
    derivable: false,
    retention: 'until expiry plus the life of any attempt it authorized, because closeout evaluates it at the consumption instant',
    storageClass: 'machine_local_operator_state',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  task_activation_binding: entry({
    artifactKind: 'agenticloop.task-activation-binding',
    root: '.agenticloop/activations',
    producer: 'activation record store',
    consumer: 'packet preparation and role start',
    decision: 'which active grant authorizes an exact task/backend binding',
    derivable: false,
    retention: 'until its grant expires or is superseded by a newer activation',
    storageClass: 'machine_local_operator_state',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  activation_revocation: entry({
    artifactKind: 'agenticloop.activation-revocation',
    root: '.agenticloop/activations',
    producer: 'activation revocation command',
    consumer: 'activation resolution, packet preparation, role start, and closeout',
    decision: 'whether an otherwise valid activation grant is revoked',
    derivable: false,
    retention: 'for the life of the revoked grant and every attempt it could have authorized',
    storageClass: 'machine_local_operator_state',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  dispatch_consumption: entry({
    root: '.agenticloop/handoffs/dispatch',
    producer: 'role start',
    consumer: 'carrier lineage, return verification, packet conservation, measurement',
    decision: 'which execution attempt is live, and what product base it started from',
    derivable: false,
    retention: 'project history; it is the only record of when an attempt began',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'engineer']),
  }),
  role_start_recovery_intent: entry({
    root: '.agenticloop/handoffs/role-start-transactions',
    producer: 'role start mutation kernel',
    consumer: 'the next role-start invocation for the exact packet',
    decision: 'whether an interrupted role start must restore its pre-images or may retain its committed post-state',
    derivable: false,
    retention: 'only until the transaction reaches its exclusive consumption-record commit point or recovery restores the pre-state',
    storageClass: 'material_transient_transaction_state',
    visibleTo: Object.freeze(['engineer']),
  }),
  carrier_mutation_receipt: entry({
    artifactKind: 'agenticloop.task-mutation-receipt',
    root: '.agenticloop/handoffs/task-mutations',
    producer: 'engineer',
    consumer: 'carrier lineage, return verification, packet conservation',
    decision: 'whether the carrier edits during an attempt form one unbroken chain',
    derivable: false,
    retention: 'project history; a gap in the chain is unrecoverable',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'engineer']),
  }),
  execution_attempt_abandonment: entry({
    artifactKind: 'agenticloop.execution-attempt-abandonment',
    root: '.agenticloop/handoffs/attempts',
    producer: 'operator, through an explicit command',
    consumer: 'packet conservation, measurement',
    decision: 'whether a new packet may be minted while a prior attempt holds recorded work',
    derivable: false,
    retention: 'project history; it explains why an attempt has no return',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  tooling_failure_observation: entry({
    artifactKind: 'agenticloop.tooling-failure-observation',
    root: '.agenticloop/handoffs/attempts',
    producer: 'recordToolingFailure after a failed operation passes its retry-safety admission',
    consumer: 'recordToolingFailure and evaluateToolingFailureRetry when they read the matching task, attempt, operation, and signature cohort',
    decision: 'whether another identical tooling operation remains safe to retry, or must refuse after the bounded retry history',
    derivable: false,
    retention: 'project history; the append-only cohort explains why a tooling retry was admitted or refused for an attempt',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  return_verification: entry({
    artifactKind: 'agenticloop.return-verification',
    root: '.agenticloop/returns/verifications',
    producer: 'return verification',
    consumer: 'review entry, closeout',
    decision: 'whether an authenticated return may enter review',
    derivable: false,
    retention: 'until review entry or closeout consumes the exact authenticated return verification',
    storageClass: 'machine_local_operator_state',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  historical_adoption: entry({
    artifactKind: 'agenticloop.historical-adoption',
    root: '.agenticloop/adoptions',
    producer: 'operator, through an explicit command',
    consumer: 'status projection; closeout once it consumes adoptions',
    decision: 'whether work predating the lifecycle has a truthful terminal state, and at what assurance',
    derivable: false,
    retention: 'project history; it is the sole record of which evidence classes were absent',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  commit_adoption: entry({
    root: '.agenticloop/adoptions/commits',
    producer: 'task adopt-commit under the existing bounded attempt',
    consumer: 'files-return-evidence and dispatch-envelope validate malformed display records only; commit-range independently derives attribution, and no consumer uses the claim for permission, origin, or certification',
    decision: 'whether a non_authenticated_claim commit range is displayable while required checks, review, audit, and closeout are renewed',
    derivable: false,
    retention: 'project history; retains the bounded non-authenticated claim and its required recertification context',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  handoff_derived_evidence: entry({
    artifactKind: 'agenticloop.handoff-derived-evidence',
    root: '.agenticloop/handoffs/derived-evidence',
    producer: 'refresh-handoff-evidence',
    consumer: 'handoff preflight, as a cached observation only',
    // Honest accounting, and the one entry that does not fully earn its place.
    // It changes no gate outcome - it carries `authority: derived_only` - so
    // by the governing principle it was a candidate for becoming transient.
    //
    // The candidate is resolved, and the answer is *retained and bound* rather
    // than dropped. What made the field record harmful was not that it existed
    // but that it was a last-write slot holding a negative disposition -
    // `readiness.disposition: "blocked"`, a dependency recorded as unresolved -
    // derived from inputs the same refresh was replacing, and that later
    // attempts never rewrote. The refresh no longer persists a verdict about
    // inputs it is renewing, and the receipt names the dispatch invocation it
    // describes, so it cannot be read as current evidence for another attempt.
    // Dropping the class outright would rewrite the refresh plan's
    // compare-before-write contract - a transactional, security-relevant
    // surface - for a record that is now truthful, which is the wrong trade.
    decision: 'none that is authoritative; it only spares preflight from recomputing observations it could derive itself',
    derivable: true,
    derivabilityNote: 'recomputable from the task record, decomposition, and Git state; kept as a bounded cache with no authority',
    reviewDisposition: 'resolved: retained, bound to the dispatch invocation it describes, and never carrying a disposition derived from inputs the same refresh replaces',
    retention: 'until the next refresh; safe to delete, at the cost of recomputation',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  human_scope_selection: entry({
    root: '.agenticloop/scope',
    producer: 'human scope-selection capture',
    consumer: 'terminal scope resolution, audit scope derivation, and closeout',
    decision: 'which explicitly selected task set or work unit a terminal action may cover',
    derivable: false,
    retention: 'until the selection is stale, superseded, or its covered terminal action is resolved',
    storageClass: 'durable_project_evidence',
    visibleTo: Object.freeze(['orchestrator', 'maintainer', 'auditor']),
  }),
  closeout_waiver: entry({
    artifactKind: 'agenticloop.legacy-unactivated-waiver',
    root: '.agenticloop/closeout-waivers',
    producer: 'operator, through an interactive confirmation',
    consumer: 'closeout',
    decision: 'whether a named absent-evidence dimension is excused for one work unit',
    derivable: false,
    retention: 'one hour; the record is deliberately short-lived so it cannot become standing policy',
    storageClass: 'machine_local_operator_state',
    visibleTo: Object.freeze(['orchestrator', 'maintainer']),
  }),
  scratch: entry({
    root: '.agenticloop/tmp',
    producer: 'any command',
    consumer: 'the command that wrote it, within one invocation',
    decision: 'none; it exists so ordinary output has somewhere to go that no gate reads',
    derivable: true,
    derivabilityNote: 'by definition; nothing downstream depends on it',
    retention: 'none guaranteed',
    storageClass: 'transient_scratch',
    visibleTo: Object.freeze([...ROLES]),
  }),
  operator_activation_key: entry({
    artifactKind: 'agenticloop.operator-activation-key',
    root: '~/.agenticloop/operator-activation',
    producer: 'operator provisioning',
    consumer: 'activation signing and verification',
    decision: 'whether operator-confirmed evidence can be produced or trusted at all',
    derivable: false,
    retention: 'life of the key; superseded spellings preserved for migration',
    storageClass: 'operator_owned_authenticated_state',
    visibleTo: Object.freeze([]),
    visibilityNote: 'no workflow role receives this class; it is operator-only material outside every repository',
  }),
  external_activation_revocation: entry({
    artifactKind: 'agenticloop.activation-revocation',
    root: '~/.agenticloop/operator-activation',
    producer: 'activation revocation command',
    consumer: 'activation resolution, packet preparation, role start, and closeout',
    decision: 'whether an otherwise valid activation grant is revoked',
    derivable: false,
    retention: 'for the life of the revoked grant and every attempt it could have authorized',
    storageClass: 'operator_owned_authenticated_state',
    visibleTo: Object.freeze([]),
    visibilityNote: 'no workflow role receives this operator-only deny tombstone outside every repository',
  }),
  operator_activation_identity_migration: entry({
    artifactKind: 'agenticloop.operator-activation-identity-migration',
    root: '~/.agenticloop/operator-activation',
    producer: 'operator activation identity migration',
    consumer: 'activation identity migration status',
    decision: 'whether a legacy operator activation key was copied to the current repository identity',
    derivable: false,
    retention: 'for the life of the migrated operator activation key, preserving the source identity and migration time',
    storageClass: 'operator_owned_authenticated_state',
    visibleTo: Object.freeze([]),
    visibilityNote: 'no workflow role receives this operator-only receipt outside every repository',
  }),
});

const REQUIRED_FIELDS = Object.freeze([
  'root', 'producer', 'consumer', 'decision', 'derivable', 'retention', 'storageClass', 'visibleTo',
]);

/**
 * Check the inventory against its own contract.
 *
 * Every class must carry all seven fields, name a real storage class, list only
 * real roles, and - where it says it is derivable - justify why it is persisted
 * anyway. A class that is derivable with no justification is exactly the "kept
 * because it might be useful" case the principle rejects.
 */
export function validateEvidenceInventory(inventory = EVIDENCE_INVENTORY) {
  const errors = [];
  for (const [name, item] of Object.entries(inventory)) {
    for (const field of REQUIRED_FIELDS) {
      if (item[field] === undefined || item[field] === null || item[field] === '') {
        errors.push(`${name}: missing required field '${field}'`);
      }
    }
    if (!Object.hasOwn(STORAGE_CLASSES, item.storageClass ?? '')) {
      errors.push(`${name}: unknown storage class '${item.storageClass}'`);
    }
    if (!Array.isArray(item.visibleTo)) {
      errors.push(`${name}: visibleTo must be an array of workflow roles`);
    } else {
      for (const role of item.visibleTo) {
        if (!ROLES.includes(role)) errors.push(`${name}: visibleTo names unknown role '${role}'`);
      }
      if (item.visibleTo.length === 0 && !item.visibilityNote) {
        errors.push(`${name}: a class visible to no role must state why`);
      }
    }
    if (item.derivable === true && !item.derivabilityNote) {
      errors.push(`${name}: a derivable class must justify why it is persisted anyway`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The bounded set of evidence classes one role may receive.
 *
 * Used to keep activation, audit, and closeout internals out of an Engineer's
 * context: implementing a bounded change needs the contract, the packet
 * lineage, and its own receipts - not the authority machinery around them.
 */
export function evidenceVisibleToRole(roleId, inventory = EVIDENCE_INVENTORY) {
  if (!ROLES.includes(roleId)) throw new TypeError(`unknown workflow role '${String(roleId)}'`);
  return Object.freeze(
    Object.entries(inventory)
      .filter(([, item]) => item.visibleTo.includes(roleId))
      .map(([name]) => name)
      .sort()
  );
}

/** Every workflow role this inventory is expressed over. */
export const INVENTORY_ROLES = Object.freeze([...ROLES]);
