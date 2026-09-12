/**
 * Static disposition catalog for diagnostic facts.  Classification describes
 * the assurance boundary; it deliberately does not change evaluator or
 * presentation behavior.
 */
const policy = (category, repairKind, escalationKind, description) => Object.freeze({ category, repairKind, escalationKind, description });

// Repair metadata is attached to the catalog rows below; repair-policy.js only
// projects the resulting definitions for legacy consumers.
export const REFUSAL_DISPOSITIONS = Object.freeze([
  'retained_hard_refusal',
  'material_human_decision',
  'agent_repairable_product_condition',
  'single_action_mechanical_repair',
  'advisory_diagnostic',
  'migration_recompute',
  'removal',
  'pending_classification',
]);

const PENDING_CLASSIFICATION = 'pending_classification';

/** Families whose complete catalog rows have passed the classification ratchet. */
export const ACCEPTED_REFUSAL_FAMILIES = Object.freeze(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);

/**
 * Every accepted code has one named live evaluation surface. Entries can name
 * more than one surface where a public command forwards the same fact. This is
 * deliberately data, rather than a source-text search, so a moved or removed
 * producer makes the ratchet fail.
 */
const PRODUCER_INVENTORY_ROWS = [
  ['src/activation-grant.js', [
    'activation.grant.malformed', 'activation.grant.revoked',
    'activation.grant.repository_mismatch', 'activation.grant.out_of_scope', 'activation.binding.malformed',
    'activation.binding.unauthenticated', 'activation.binding.mismatch',
    'activation.binding.task_mismatch', 'activation.binding.repository_mismatch', 'activation.binding.stale_contract',
    'activation.binding.decomposition_missing', 'activation.binding.decomposition_invalid', 'activation.binding.decomposition_changed',
  ]],
  ['src/activation-cli.js', ['activation.grant.unauthenticated', 'activation.identity.migration_required', 'activation.identity.conflict']],
  ['src/activation-resolution.js', ['activation.capture.missing', 'activation.assurance.insufficient', 'activation.policy.invalid']],
  ['src/dispatch-eligibility.js', [
    'activation.capture.malformed', 'activation.capture.mismatch', 'activation.capture.expired', 'activation.capture.unsupported',
    'task.contract.malformed', 'contract.baseline.invalid', 'readiness.base_inventory.missing', 'evidence.malformed',
    'dependency.unresolved', 'dispatch.packet.invalid', 'dispatch.packet.stale', 'capability.declaration.invalid',
    'capability.action.denied', 'parallel_scan.decomposition.invalid', 'return.assurance.insufficient',
    'worktree.clean_gate.failed',
  ]],
  ['src/task-cli.js', [
    'activation.capture.missing', 'activation.capture.malformed', 'activation.capture.mismatch', 'activation.capture.unsupported',
    'task.evidence.not_in_progress', 'task.evidence.provenance_mismatch', 'task.evidence.atomic_write',
    'task.evidence.final_validation', 'task.role_start.check_evidence_missing', 'task.role_start.check_evidence_mismatch',
    'handoff.refresh.plan.malformed', 'handoff.refresh.plan.unsupported', 'return.lane.implementation_absent',
    'handoff.evidence.malformed', 'handoff.evidence.unauthenticated',
    'review.entry.fixup_invalid', 'review.entry.matrix_stale',
    'review.entry.persistence_conflict', 'review.entry.persistence_carrier_changed',
    'review.entry.persistence_write_changed', 'review.entry.persistence_refetch_changed',
    'check.aggregate.git_probe_failed', 'activation.grant.revoked',
    'task.lifecycle.not_dispatchable', 'dispatch.packet.conserved',
    'verification.context.malformed',
  ]],
  ['src/required-checks.js', ['required_check.explain_forbidden']],
  ['src/task-readiness.js', [
    'scope.declaration.missing', 'scope.declaration.duplicate', 'scope.declaration.invalid', 'scope.intended_creation.missing',
    'scope.intended_creation.uncovered', 'scope.intent.invalid', 'generated.path.invalid', 'scope.glob.unmatched',
    'scope.deviation.missing', 'scope.deviation.malformed',
  ]],
  ['src/github-task-body.js', [
    'task.contract.absent', 'contract.record_marker.mutable_body', 'task.body.identity', 'task.body.invalid',
    'task.body.attribution', 'task.body.base_inventory.missing',
  ]],
  ['src/github-ready.js', ['task.body.bom', 'task.body.collapsed_newlines', 'task.body.utf8']],
  ['src/audit-cli.js', ['task.record.structure', 'audit.already_exists']],
  ['src/github-preflight.js', [
    'contract.baseline.missing', 'preflight.attribution', 'preflight.review_checkpoint', 'preflight.review_history_invalid', 'preflight.revision_resolution',
  ]],
  ['src/cli.js', ['contract.baseline.stale', 'evidence.changed', 'task.evidence.lineage', 'task.evidence.contract_drift', 'task.evidence.product_head']],
  ['src/handoff-preflight.js', [
    'evidence.missing', 'task.evidence.lineage.stale', 'task.record.identity_mismatch', 'dependency.evidence.stale',
    'capability.resolution.failed', 'return.assurance.ambiguous',
  ]],
  ['src/execution-evidence.js', [
    'evidence.stale', 'execution_evidence.malformed_input', 'execution_evidence.stale_version',
    'execution_evidence.binding_mismatch', 'execution_evidence.lineage_mismatch',
  ]],
  ['src/closeout-cli.js', ['evidence.negative']],
  ['src/public-output-policy.js', ['evidence.negative']],
  ['src/task-carrier-guard.js', ['task.carrier.armed']],
  ['src/dispatch-envelope.js', [
    'verification.context.missing', 'verification.context.malformed', 'verification.context.stale',
    'host.boundary.unsupported', 'parallel_scan.record.invalid', 'return.assurance.session_reported',
  ]],
  ['src/repository-state.js', ['task.mutation.unresolved', 'worktree.clean_gate.failed']],
  ['src/execution-attempt.js', [
    'dispatch.attempt.budget_exhausted', 'dispatch.packet.conserved', 'dispatch.attempt.history_rewritten',
    'attempt_return_unbound', 'attempt_return_ambiguous', 'attempt_return_conflict', 'attempt_terminal_conflict',
  ]],
  ['src/role-session-policy.js', ['role_result.tooling_failure_repeated', 'role_result.schema.invalid']],
  ['src/closeout-waiver.js', ['compatibility.waiver_scope_retired']],
  ['src/dispatchability.js', ['task.lifecycle.not_dispatchable']],
  ['src/host-role-capabilities.js', ['capability.enforcement.degraded']],
  ['src/parallel-scan.js', ['parallel_scan.inventory.incomplete', 'parallel_scan.evidence.stale']],
  ['src/handoff-recognition.js', [
    'handoff.transition.unsupported', 'handoff.expectation.malformed', 'handoff.evidence.missing',
    'handoff.evidence.malformed', 'handoff.evidence.freshness_expired', 'handoff.evidence.schema_retired',
    'handoff.evidence.revalidation_failed', 'handoff.evidence.ambiguous_return', 'handoff.evidence.replayed',
    'handoff.evidence.mismatched', 'handoff.evidence.unsupported', 'handoff.evidence.unauthenticated',
  ]],
  ['src/tooling-failure.js', [
    'tooling_failure_input_invalid', 'tooling_failure_evidence_conflict', 'tooling_failure_write_failed',
    'tooling_failure_admission_conflict',
  ]],
  ['src/readiness-candidates.js', ['readiness.candidate.stage_failure', 'readiness.candidate.internal_failure']],
  ['src/blocked-result-authority.js', [
    'role_return.invalid', 'blocked_result.owner_mismatch', 'blocked_result.redelegation_required',
    'blocked_result.redelegation_stale', 'blocked_result.redelegation_invalid', 'blocked_result.redelegation_untrusted',
    'human_disposition.required', 'human_disposition.stale', 'human_disposition.invalid', 'human_disposition.untrusted',
  ]],
  ['src/commit-range.js', ['role_return.stale']],
  ['src/host-handoff.js', ['role_return.receipt_stale', 'role_return.producer_mismatch']],
  ['src/commit-attribution.js', ['attribution.work_unit', 'attribution.trailer', 'attribution.role']],
  ['src/closeout.js', ['closeout.marker.stale']],
  ['src/github-review-prepare.js', [
    'review_prepare.workspace', 'review_prepare.stale_head', 'review_prepare.packet',
    'review_prepare.preflight_failed', 'review_prepare.independent_review_policy',
    'review_prepare.head_unavailable', 'review_prepare.head_malformed', 'review_prepare.head_refetch_failed',
  ]],
  ['src/github-ready.js', ['ready.preflight', 'ready.review_audit', 'ready.task_identity', 'ready.cross_gate_identity']],
  ['src/github-review-audit.js', ['review_audit.task_contract', 'review_audit.failure']],
  ['src/projection-reconciliation.js', ['state.host_local', 'projection.state.unexplained']],
  ['src/task-readiness.js', ['readiness.mode.invalid']],
  ['src/github-preflight.js', [
    'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
    'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
    'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
    'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
  ]],
  ['src/pr-body.js', ['pr_body.structural', 'preflight.task_policy']],
  ['src/preparation-input.js', ['pr_body.input']],
  ['src/cli.js', ['pr_body.input']],
  ['src/pr-body-context.js', ['pr_body.snapshot']],
  ['src/cli.js', ['pr_body.deprecation', 'pr_body.local_file', 'pr_body.input_format', 'cli.operational']],
  ['src/cli-main.js', ['cli.usage', 'cli.unexpected']],
  ['src/cli-io.js', ['cli.usage']],
  ['src/github-task-body.js', ['cli.usage']],
  ['src/closeout-cli.js', ['cli.operational']],
  ['src/diagnostic-presentation.js', ['cli.unexpected']],
  ['src/projection-reconciliation.js', [
    'projection.observation.invalid', 'projection.carrier.not_applicable',
    'projection.evidence.superseded', 'projection.fact.contradiction',
    'projection.authority.untyped',
  ]],
];

// A code can be emitted by several independent evaluator modules. Keep rows
// module-first for reviewability, then merge them; Object.fromEntries silently
// overwrote earlier producer bindings for duplicate codes.
const SUPPLEMENTAL_PRODUCER_INVENTORY_ROWS = [
  ['src/finish-candidate.js', ['role_return.invalid']],
  ['src/fs-mutation-kernel.js', ['verification.context.malformed']],
  ['src/activation-grant.js', ['activation.grant.unauthenticated']],
  ['src/activation-identity-migration.js', ['activation.identity.conflict']],
  ['src/activation-resolution.js', ['activation.capture.missing', 'activation.grant.revoked', 'activation.grant.unauthenticated']],
  ['src/activation-trust.js', ['activation.identity.migration_required']],
  ['src/commit-range.js', ['role_return.invalid']],
  ['src/dispatch-eligibility.js', [
    'activation.assurance.insufficient', 'activation.binding.mismatch', 'activation.binding.stale_contract',
    'activation.capture.expired', 'activation.capture.malformed', 'activation.capture.mismatch',
    'activation.capture.missing', 'activation.capture.unsupported',
    'activation.grant.malformed', 'activation.grant.revoked', 'activation.grant.unauthenticated',
    'role_return.invalid', 'role_return.stale',
  ]],
  ['src/dispatch-envelope.js', [
    'blocked_result.owner_mismatch', 'capability.action.denied', 'capability.declaration.invalid',
    'dispatch.packet.stale', 'human_disposition.invalid', 'parallel_scan.decomposition.invalid',
    'return.assurance.insufficient', 'role_return.invalid',
  ]],
  ['src/exceptional-verification.js', ['role_return.invalid']],
  ['src/github-preflight.js', ['contract.baseline.invalid']],
  ['src/github-task-body.js', [
    'contract.baseline.invalid', 'contract.baseline.missing', 'evidence.negative',
    'task.contract.malformed', 'verification.context.malformed', 'verification.context.missing',
  ]],
  ['src/github-task-identity.js', ['task.body.identity']],
  ['src/handoff-consumption.js', ['handoff.evidence.malformed']],
  ['src/handoff-preflight.js', ['return.assurance.insufficient']],
  ['src/lifecycle-plan.js', ['evidence.negative']],
  ['src/parallel-scan.js', ['parallel_scan.decomposition.invalid', 'parallel_scan.record.invalid']],
  ['src/projection-reconciliation.js', ['evidence.missing']],
  ['src/public-error.js', [
    'contract.baseline.stale', 'evidence.negative', 'host.boundary.unsupported',
    'verification.context.malformed', 'verification.context.missing', 'verification.context.stale',
  ]],
  ['src/repository-state.js', ['evidence.changed', 'evidence.malformed', 'evidence.missing']],
  ['src/result-envelope.js', ['task.body.bom', 'task.body.collapsed_newlines', 'task.body.utf8', 'task.record.structure']],
  ['src/task-cli.js', ['dispatch.packet.stale', 'task.evidence.contract_drift', 'task.evidence.lineage', 'task.evidence.lineage.stale', 'task.record.identity_mismatch']],
  ['src/task-fact-readers.js', ['task.evidence.product_head']],
  ['src/task-contract-baseline.js', ['contract.baseline.invalid', 'contract.baseline.missing', 'contract.baseline.stale']],
  ['src/task-readiness.js', ['dependency.unresolved', 'readiness.base_inventory.missing', 'task.contract.absent', 'task.contract.malformed', 'task.record.structure']],
  ['src/task-record-root.js', ['task.body.bom', 'task.body.collapsed_newlines', 'task.body.utf8']],
  ['src/work-unit-lease.js', ['activation.binding.mismatch']],
];

function producerInventory(rows) {
  const inventory = new Map();
  for (const [surface, codes] of rows) {
    for (const code of codes) {
      const surfaces = inventory.get(code) ?? [];
      if (!surfaces.includes(surface)) surfaces.push(surface);
      inventory.set(code, surfaces);
    }
  }
  return Object.freeze(Object.fromEntries([...inventory].map(([code, surfaces]) => [code, Object.freeze(surfaces)])));
}

const ACCEPTED_PRODUCER_INVENTORY = producerInventory([
  ...PRODUCER_INVENTORY_ROWS,
  ...SUPPLEMENTAL_PRODUCER_INVENTORY_ROWS,
]);

/**
 * Dynamic code selection is declared per module as `{ codes }`: a frozen array
 * names every statically knowable accepted-family code. When a module has an
 * unresolved selection too, `codes: 'external'` is the explicit ratchet marker
 * and `knownCodes` preserves its other statically knowable codes. The marker is
 * never a reason to silently discard the unresolved emitter.
 */
export const DYNAMIC_DIAGNOSTIC_PRODUCERS = Object.freeze({
  'src/blocked-result-authority.js': Object.freeze({ codes: Object.freeze([
    'role_return.invalid', 'blocked_result.owner_mismatch',
    'blocked_result.redelegation_required', 'blocked_result.redelegation_untrusted',
    'blocked_result.redelegation_stale', 'blocked_result.redelegation_invalid',
    'human_disposition.required', 'human_disposition.untrusted',
    'human_disposition.stale', 'human_disposition.invalid',
  ]) }),
  'src/cli-main.js': Object.freeze({ codes: 'external' }),
  'src/cli.js': Object.freeze({ codes: 'external', knownCodes: Object.freeze(['pr_body.input']) }),
  'src/commit-attribution.js': Object.freeze({ codes: Object.freeze([
    'attribution.trailer', 'attribution.role',
  ]) }),
  'src/commit-range.js': Object.freeze({ codes: 'external' }),
  'src/dispatch-eligibility.js': Object.freeze({
    codes: 'external',
    knownCodes: Object.freeze([
    'activation.capture.missing', 'activation.capture.malformed',
    'activation.capture.mismatch', 'activation.capture.unsupported',
    'dispatch.packet.invalid', 'dispatch.packet.stale',
    'role_return.invalid', 'role_return.stale', 'evidence.malformed',
    'task.contract.malformed', 'contract.baseline.invalid',
    'activation.assurance.insufficient', 'dependency.unresolved',
    'parallel_scan.decomposition.invalid', 'worktree.clean_gate.failed',
    'capability.declaration.invalid', 'return.assurance.insufficient',
    ]),
  }),
  'src/dispatch-envelope.js': Object.freeze({ codes: 'external', knownCodes: Object.freeze(['role_return.invalid']) }),
  'src/github-task-body.js': Object.freeze({
    codes: 'external',
    knownCodes: Object.freeze([
      'contract.record_marker.mutable_body', 'task.contract.malformed', 'task.contract.absent',
      'task.body.invalid', 'task.body.identity', 'contract.baseline.missing',
      'task.body.base_inventory.missing', 'task.body.attribution',
    ]),
  }),
  'src/github-preflight.js': Object.freeze({
    codes: 'external',
    knownCodes: Object.freeze([
      'preflight.attribution', 'preflight.review_checkpoint', 'preflight.review_history_invalid', 'preflight.revision_resolution',
      'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
      'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
      'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
      'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
    ]),
  }),
  'src/github-review-audit.js': Object.freeze({ codes: Object.freeze([
    'review_audit.task_contract', 'review_audit.failure',
  ]) }),
  'src/handoff-recognition.js': Object.freeze({ codes: Object.freeze([
    'handoff.evidence.mismatched', 'handoff.evidence.malformed', 'handoff.evidence.freshness_expired',
    'handoff.expectation.malformed', 'handoff.evidence.missing', 'handoff.evidence.schema_retired',
    'handoff.evidence.unsupported', 'handoff.evidence.replayed', 'handoff.evidence.unauthenticated',
    'handoff.evidence.revalidation_failed', 'handoff.transition.unsupported', 'handoff.evidence.ambiguous_return',
  ]) }),
  'src/parallel-scan.js': Object.freeze({ codes: Object.freeze([
    'parallel_scan.evidence.stale', 'parallel_scan.record.invalid', 'parallel_scan.inventory.incomplete',
    'parallel_scan.decomposition.invalid',
  ]) }),
  'src/pr-body.js': Object.freeze({ codes: Object.freeze([
    'pr_body.structural', 'preflight.task_policy',
  ]) }),
  'src/projection-reconciliation.js': Object.freeze({ codes: Object.freeze([
    'evidence.missing', 'state.host_local', 'projection.state.unexplained',
    'projection.observation.invalid', 'projection.carrier.not_applicable',
    'projection.evidence.superseded', 'projection.fact.contradiction',
    'projection.authority.untyped',
  ]) }),
  'src/public-error.js': Object.freeze({ codes: 'external' }),
  'src/public-result.js': Object.freeze({ codes: 'external' }),
  'src/closeout-cli.js': Object.freeze({ codes: 'external', knownCodes: Object.freeze(['cli.operational']) }),
  'src/task-cli.js': Object.freeze({ codes: Object.freeze([
    'activation.capture.missing', 'activation.capture.malformed',
    'activation.capture.mismatch', 'activation.capture.unsupported',
  ]) }),
  'src/task-readiness.js': Object.freeze({ codes: Object.freeze([
    'scope.declaration.invalid', 'scope.declaration.duplicate', 'task.contract.malformed', 'task.contract.absent',
    'scope.declaration.missing', 'generated.path.invalid', 'scope.intent.invalid', 'scope.intended_creation.uncovered',
    'readiness.base_inventory.missing', 'scope.glob.unmatched', 'scope.intended_creation.missing',
    'scope.deviation.malformed', 'scope.deviation.missing', 'dependency.unresolved',
    'readiness.mode.invalid',
  ]) }),
  'src/task-record-root.js': Object.freeze({ codes: Object.freeze([
    'task.body.utf8', 'task.body.bom', 'task.body.collapsed_newlines',
  ]) }),
});

// Producers emit a stable diagnostic code. Consumers only evaluate an input or
// derived fact used by that diagnostic and intentionally need not contain its
// literal; they are existence-checked rather than treated as fake emitters.
const CONSUMER_INVENTORY = Object.freeze({
  'attribution.work_unit': Object.freeze([
    'src/committed-source.js', 'src/readiness-apply.js',
  ]),
  'attribution.trailer': Object.freeze([
    'src/cli.js', 'src/commit-range.js', 'src/committed-source.js',
    'src/handoff-evidence-refresh.js', 'src/readiness-apply.js',
    'src/review-entry-receipt.js', 'src/task-cli.js',
  ]),
  'attribution.role': Object.freeze([
    'src/cli.js', 'src/commit-range.js', 'src/committed-source.js',
    'src/handoff-evidence-refresh.js', 'src/readiness-apply.js',
    'src/review-entry-receipt.js', 'src/task-cli.js',
  ]),
  'preflight.attribution': Object.freeze([
    'src/cli.js', 'src/github-ready.js', 'src/github-review-prepare.js',
  ]),
  'closeout.marker.stale': Object.freeze(['src/closeout-cli.js']),
  'review_prepare.workspace': Object.freeze(['src/cli.js']),
  'review_prepare.stale_head': Object.freeze(['src/cli.js']),
  'review_prepare.preflight_failed': Object.freeze(['src/cli.js']),
  'review_prepare.independent_review_policy': Object.freeze(['src/cli.js']),
  'review_prepare.head_unavailable': Object.freeze(['src/cli.js']),
  'review_prepare.head_malformed': Object.freeze(['src/cli.js']),
  'review_prepare.head_refetch_failed': Object.freeze(['src/cli.js']),
  'review_prepare.packet': Object.freeze(['src/cli.js']),
  'ready.preflight': Object.freeze(['src/cli.js']),
  'ready.review_audit': Object.freeze(['src/cli.js']),
  'ready.task_identity': Object.freeze(['src/cli.js']),
  'ready.cross_gate_identity': Object.freeze(['src/cli.js']),
  'review_audit.task_contract': Object.freeze(['src/cli.js', 'src/github-ready.js']),
  'review_audit.failure': Object.freeze(['src/cli.js', 'src/github-ready.js']),
  'preflight.review_checkpoint': Object.freeze([
    'src/cli.js', 'src/github-ready.js', 'src/github-review-prepare.js',
  ]),
  'preflight.review_history_invalid': Object.freeze([
    'src/cli.js', 'src/github-ready.js', 'src/github-review-prepare.js',
  ]),
  'preflight.revision_resolution': Object.freeze([
    'src/cli.js', 'src/github-ready.js', 'src/github-review-prepare.js',
  ]),
  'readiness.mode.invalid': Object.freeze([
    'src/cli.js', 'src/github-preflight.js', 'src/github-task-body.js',
    'src/handoff-preflight.js', 'src/parallel-scan.js', 'src/readiness-candidates.js',
    'src/task-cli.js',
  ]),
  ...Object.fromEntries([
    'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
    'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
    'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
    'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
  ].map(code => [code, Object.freeze([
    'src/cli.js', 'src/github-ready.js', 'src/github-review-prepare.js',
  ])])),
  'pr_body.structural': Object.freeze(['src/cli.js']),
  'pr_body.input': Object.freeze(['src/cli.js']),
  'pr_body.snapshot': Object.freeze(['src/cli.js']),
  'compatibility.waiver_scope_retired': Object.freeze(['src/closeout-cli.js']),
  'worktree.clean_gate.failed': Object.freeze(['src/dispatch-eligibility.js']),
  'handoff.evidence.freshness_expired': Object.freeze([
    'src/return-verification.js', 'src/return-use-freshness.js',
  ]),
  'handoff.evidence.revalidation_failed': Object.freeze([
    'src/return-verification.js', 'src/files-return-evidence.js',
  ]),
  'handoff.evidence.ambiguous_return': Object.freeze(['src/return-verification.js']),
});

const EVALUATION_SURFACES = Object.freeze({
  'attribution.work_unit': Object.freeze(['src/commit-attribution.js']),
  'attribution.trailer': Object.freeze(['src/commit-attribution.js']),
  'attribution.role': Object.freeze(['src/commit-attribution.js']),
  'preflight.attribution': Object.freeze(['src/github-preflight.js']),
  'closeout.marker.stale': Object.freeze(['src/closeout.js']),
  'review_prepare.workspace': Object.freeze(['src/github-review-prepare.js']),
  'review_prepare.stale_head': Object.freeze(['src/github-review-prepare.js']),
  'review_prepare.preflight_failed': Object.freeze(['src/github-review-prepare.js']),
  'review_prepare.independent_review_policy': Object.freeze(['src/github-review-prepare.js', 'src/task-cli.js']),
  'review_prepare.head_unavailable': Object.freeze(['src/github-review-prepare.js']),
  'review_prepare.head_malformed': Object.freeze(['src/github-review-prepare.js']),
  'review_prepare.head_refetch_failed': Object.freeze(['src/github-review-prepare.js']),
  'review_prepare.packet': Object.freeze(['src/github-review-prepare.js']),
  'ready.preflight': Object.freeze(['src/github-ready.js']),
  'ready.review_audit': Object.freeze(['src/github-ready.js']),
  'ready.task_identity': Object.freeze(['src/github-ready.js']),
  'ready.cross_gate_identity': Object.freeze(['src/github-ready.js']),
  'review_audit.task_contract': Object.freeze(['src/github-review-audit.js']),
  'review_audit.failure': Object.freeze(['src/github-review-audit.js']),
  'preflight.review_checkpoint': Object.freeze(['src/github-preflight.js']),
  'preflight.review_history_invalid': Object.freeze(['src/github-preflight.js']),
  'preflight.revision_resolution': Object.freeze(['src/github-preflight.js']),
  'compatibility.waiver_scope_retired': Object.freeze(['src/closeout-waiver.js']),
  'check.aggregate.git_probe_failed': Object.freeze(['src/task-cli.js']),
  'worktree.clean_gate.failed': Object.freeze(['src/dispatch-eligibility.js', 'src/repository-state.js']),
  'state.host_local': Object.freeze(['src/projection-reconciliation.js']),
  'projection.state.unexplained': Object.freeze(['src/projection-reconciliation.js']),
  'audit.already_exists': Object.freeze(['src/audit-cli.js']),
  'review.entry.fixup_invalid': Object.freeze(['src/task-cli.js']),
  'review.entry.matrix_stale': Object.freeze(['src/task-cli.js']),
  'review.entry.persistence_conflict': Object.freeze(['src/task-cli.js']),
  'review.entry.persistence_carrier_changed': Object.freeze(['src/task-cli.js']),
  'review.entry.persistence_write_changed': Object.freeze(['src/task-cli.js']),
  'review.entry.persistence_refetch_changed': Object.freeze(['src/task-cli.js']),
  'readiness.mode.invalid': Object.freeze(['src/task-readiness.js']),
  ...Object.fromEntries([
    'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
    'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
    'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
    'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
  ].map(code => [code, Object.freeze(
    code === 'preflight.task_policy'
      ? ['src/github-preflight.js', 'src/pr-body.js']
      : ['src/github-preflight.js'],
  )])),
  'pr_body.structural': Object.freeze(['src/pr-body.js']),
  'pr_body.input': Object.freeze(['src/preparation-input.js', 'src/cli.js']),
  'pr_body.snapshot': Object.freeze(['src/pr-body-context.js']),
  'pr_body.deprecation': Object.freeze(['src/cli.js']),
  'pr_body.local_file': Object.freeze(['src/cli.js']),
  'pr_body.input_format': Object.freeze(['src/cli.js']),
  'cli.usage': Object.freeze(['src/cli-main.js', 'src/cli-io.js', 'src/github-task-body.js']),
  'cli.operational': Object.freeze(['src/cli.js', 'src/closeout-cli.js']),
  'cli.unexpected': Object.freeze(['src/cli-main.js', 'src/diagnostic-presentation.js']),
  'projection.observation.invalid': Object.freeze(['src/projection-reconciliation.js']),
  'projection.carrier.not_applicable': Object.freeze(['src/projection-reconciliation.js']),
  'projection.evidence.superseded': Object.freeze(['src/projection-reconciliation.js']),
  'projection.fact.contradiction': Object.freeze(['src/projection-reconciliation.js']),
  'projection.authority.untyped': Object.freeze(['src/projection-reconciliation.js']),
});

const METADATA_OVERRIDES = Object.freeze({
  'attribution.work_unit': Object.freeze({
    semanticInvalidators: 'the final contiguous Work-Unit, Tasks, and Agent trailers exactly match the requested work unit, canonical task set, and role',
    proof: 'test/attribution-refusal-family.test.js: work-unit-mismatch-is-refused proves a mismatched work-unit trailer cannot certify shared Maintainer work',
  }),
  'attribution.trailer': Object.freeze({
    semanticInvalidators: 'the final contiguous Task and Agent trailers exactly bind the current task and expected role',
    proof: 'test/attribution-refusal-family.test.js: task-trailer-mismatch-is-refused proves a stale task trailer cannot claim product lineage',
  }),
  'attribution.role': Object.freeze({
    semanticInvalidators: 'the requested role is lowercase and resolves in the canonical workflow-role registry',
    proof: 'test/attribution-refusal-family.test.js: code-disjointness-separates-requested-role-validity-from-final-agent-trailer proves invalid or non-lowercase requested roles cannot claim canonical commit attribution',
  }),
  'preflight.attribution': Object.freeze({
    semanticInvalidators: 'the final live PR body role trailer and current-head final Task/Agent trailers agree with the strict linked task identity',
    proof: 'test/attribution-refusal-family.test.js: github-role-conflict-is-refused proves a conflicting GitHub attribution claim cannot enter review',
  }),
  'audit.already_exists': Object.freeze({
    semanticInvalidators: 'the existing audit record is selected or rebaselined for the requested candidate and covered tasks',
    proof: 'test/audit-cli.test.js: refuses-a-duplicate-work-unit proves an existing work-unit audit is selected or deliberately rebaselined rather than duplicated',
  }),
  'closeout.marker.stale': Object.freeze({
    semanticInvalidators: 'a newly evaluated closeout packet reconstructs the marker against the exact current task, audit, and candidate state',
    proof: 'test/closeout-record.test.js: records-a-complete-marker-and-verifies-it-after-the-packet-is-deleted proves a stale marker is not current and requires a fresh closeout packet',
  }),
  'review_prepare.workspace': Object.freeze({
    semanticInvalidators: 'the supplied review workspace resolves to the exact current review artifact before packet emission or dispatch',
    proof: 'test/review-preparation-contract.test.js: rejects-a-workspace-that-does-not-match-the-review-head proves a different workspace cannot enter review',
  }),
  'review_prepare.stale_head': Object.freeze({
    semanticInvalidators: 'the final PR refetch and every receipt binding agree on one exact current head',
    proof: 'test/review-preparation-contract.test.js: refuses-a-packet-after-the-pr-head-changes proves a stale review packet cannot dispatch',
  }),
  'review_prepare.preflight_failed': Object.freeze({
    semanticInvalidators: 'fresh preflight succeeds for the exact refetched review candidate',
    proof: 'test/review-preparation-contract.test.js: fresh-preflight-failure-is-not-reported-as-head-drift proves a failed final preflight cannot be recomputed away as head drift',
  }),
  'review_prepare.independent_review_policy': Object.freeze({
    semanticInvalidators: 'the refetched task independently parses one valid independent-review policy',
    proof: 'test/review-preparation-contract.test.js: invalid-independent-review-policy-has-its-own-review-prepare-code proves policy failure does not inherit stale-head repair',
  }),
  'review_prepare.packet': Object.freeze({
    semanticInvalidators: 'the review packet has the closed canonical shape, intact receipt digest, and mutually consistent exact-head bindings',
    proof: 'test/review-authority-adversarial.test.js: rejects-a-fabricated-partial-receipt-that-only-echoes-head-task-and-contract proves a fabricated packet cannot dispatch review',
  }),
  'ready.preflight': Object.freeze({
    semanticInvalidators: 'the current PR evidence preflight succeeds for the exact candidate before merge readiness is certified',
    proof: 'test/github-ready.test.js: fails-when-the-preflight-fails-while-the-review-passes proves failed evidence preflight blocks readiness',
  }),
  'ready.review_audit': Object.freeze({
    semanticInvalidators: 'a current independently authored review audit succeeds for the exact candidate before merge readiness is certified',
    proof: 'test/github-ready.test.js: fails-when-the-review-fails-while-the-preflight-passes proves stale review provenance blocks readiness',
  }),
  'ready.task_identity': Object.freeze({
    semanticInvalidators: 'the linked issue is the unique carrier for its materialized task identity across the repository inventory',
    proof: 'test/github-ready.test.js: rejects-a-nonunique-linked-task-identity proves ambiguous task identity cannot certify readiness',
  }),
  'ready.cross_gate_identity': Object.freeze({
    semanticInvalidators: 'preflight and review audit resolve the same linked issue and exact current PR head',
    proof: 'test/github-ready.test.js: rejects-mismatched-linked-issue-or-pr-head proves disagreeing certification gates cannot certify readiness',
  }),
  'review_audit.task_contract': Object.freeze({
    semanticInvalidators: 'the linked task contract has one non-conflicting independent-review requirement before review provenance is accepted',
    proof: 'test/github-review-audit.test.js: enforces-independent-review-from-the-linked-task-issue proves a conflicting or unmet task review policy cannot accept a review',
  }),
  'review_audit.failure': Object.freeze({
    semanticInvalidators: 'one authenticated current-head review outcome has valid provenance, mode, artifact, and any required independent-human reference',
    proof: 'test/github-review-audit.test.js: rejects-older-head-missing-mode-missing-artifact-and-unsupported-markers proves invalid review evidence cannot be accepted',
  }),
  'preflight.review_checkpoint': Object.freeze({
    semanticInvalidators: 'a durable authorized human review checkpoint is recorded for the exact required review round',
    proof: 'test/github-preflight.test.js and F6 executable probe preflight-review-checkpoint prove that a missing or consumed valid checkpoint requires fresh human authority',
  }),
  'preflight.review_history_invalid': Object.freeze({
    semanticInvalidators: 'raw review carriers and any supplied normalized history agree and parse as one canonical ordered history',
    proof: 'test/github-preflight.test.js: fabricated-review-history-has-integrity-code-not-human-checkpoint proves malformed or fabricated history cannot inherit checkpoint authority repair',
  }),
  'preflight.revision_resolution': Object.freeze({
    semanticInvalidators: 'every latest required finding has one canonical resolution entry bound to the current artifact',
    proof: 'test/review-provenance.test.js: rejects-rereview-without-a-resolution-for-every-prior-finding proves unresolved findings cannot enter rereview',
  }),
  'review.entry.fixup_invalid': Object.freeze({
    semanticInvalidators: 'each Maintainer Review Fixup episode has the canonical durable shape and coherent resulting artifact before review entry',
    proof: 'test/task-cli.test.js: rejects-an-invalid-maintainer-review-fixup-before-review-entry proves malformed fixup disclosure cannot prepare entry',
  }),
  'review.entry.matrix_stale': Object.freeze({
    semanticInvalidators: 'the finding-resolution matrix is regenerated against the bound current product artifact and unchanged protected contract',
    proof: 'test/task-cli.test.js: rejects-a-stale-finding-resolution-matrix-before-review-entry proves stale resolution state cannot be reused',
  }),
  'review.entry.persistence_conflict': Object.freeze({
    semanticInvalidators: 'no existing review-entry receipt conflicts with the recognized verified return',
    proof: 'test/task-cli.test.js: conflicting-review-entry-persistence-is-refused proves a conflicting persisted receipt remains blocked',
  }),
  'review.entry.persistence_carrier_changed': Object.freeze({
    semanticInvalidators: 'a fresh review-entry evaluation binds the current carrier immediately before persistence',
    proof: 'test/task-cli.test.js: review-entry-carrier-race-is-superseded proves carrier drift requests recomputation rather than conflict repair',
  }),
  'review.entry.persistence_write_changed': Object.freeze({
    semanticInvalidators: 'a new guarded persistence attempt establishes one current atomic write',
    proof: 'test/task-cli.test.js: review-entry-write-failure-is-superseded proves an unproven write is recomputed rather than treated as a conflicting receipt',
  }),
  'review.entry.persistence_refetch_changed': Object.freeze({
    semanticInvalidators: 'a fresh review-entry evaluation refetches exact intended carrier and receipt bytes',
    proof: 'test/task-cli.test.js: review-entry-refetch-drift-is-superseded proves changed final bytes request recomputation',
  }),
  'compatibility.waiver_scope_retired': Object.freeze({
    semanticInvalidators: 'an authentic historical two-scope waiver is projected as activation-only while canonical dispatch consumption and verified-return evidence remain mandatory',
    proof: 'test/closeout-waiver.test.js: verifies-an-authentic-historical-two-scope-record-but-projects-activation-only-behavior proves the retired return scope is ignored rather than granted authority',
  }),
  'check.aggregate.git_probe_failed': Object.freeze({
    semanticInvalidators: 'Git conclusively reports whether the mutable check aggregate is tracked before the local aggregate can be used',
    proof: 'test/task-cli.test.js: fails-closed-with-an-actionable-typed-diagnostic-when-aggregate-tracking-cannot-be-probed proves an unknown aggregate tracking state cannot be used',
  }),
  'worktree.clean_gate.failed': Object.freeze({
    semanticInvalidators: 'the exact dispatch worktree has no staged, unstaged, relevant untracked, or relevant ignored state and its clean-state binding equals the canonical identity',
    proof: 'test/dispatch-hardening.test.js: blocks-staged-unstaged-untracked-in-scope-and-shared-state-changes proves pre-existing or unclaimed workspace state cannot enter a dispatch',
  }),
  'state.host_local': Object.freeze({
    semanticInvalidators: 'recorded host-local provenance remains an advisory observation and confers no lifecycle authority',
    proof: 'test/projection-reconciliation.test.js: classifies-provenanced-host-local-state-without-blocking proves recorded host-local state is surfaced without inventing a refusal',
  }),
  'projection.state.unexplained': Object.freeze({
    semanticInvalidators: 'every current authority-sensitive projection state has canonical workflow, product, or recorded host-local provenance rather than unexplained drift',
    proof: 'test/projection-reconciliation.test.js: blocks-authority-sensitive-conclusions-on-unexplained-drift proves unexplained current drift cannot certify an authority-sensitive conclusion',
  }),
  'projection.fact.contradiction': Object.freeze({
    semanticInvalidators: 'one current typed canonical carrier value is established for every authority-sensitive projection fact',
    proof: 'F8 executable probe projection-authoritative-contradiction invokes reconcileProjections with conflicting current typed audit-state carriers and observes only projection.fact.contradiction',
  }),
  'execution_evidence.stale_version': Object.freeze({
    semanticInvalidators: 'a current-schema recomputation supersedes the retired representation',
    proof: 'disposition: migration-recompute; a current-schema execution-evidence recomputation is required before this retired representation can be used.',
  }),
  'dispatch.packet.invalid': Object.freeze({
    semanticInvalidators: 'post-transition state changed',
    proof: 'disposition: transition-recompute; the atomic start/resume transition replaces mutable packet projections before reevaluation.',
  }),
  'handoff.evidence.malformed': Object.freeze({
    semanticInvalidators: 'post-transition state changed',
    proof: 'disposition: transition-recompute; the atomic start/resume transition reevaluates the prepared-packet projection rather than preserving this liveness refusal.',
  }),
  'handoff.evidence.freshness_expired': Object.freeze({
    semanticInvalidators: 'a declared handoff freshness bound is exceeded: return verifiedAt age or prepared-dispatch decomposition observedAt age',
    proof: 'disposition: freshness-recompute; finish and certification invalidation recompute the expired verified-return receipt or prepared-dispatch decomposition observation without changing bound evidence.',
  }),
  'handoff.evidence.schema_retired': Object.freeze({
    semanticInvalidators: 'a current schema representation supersedes the retired packet projection',
    proof: 'disposition: migration-recompute; the legacy packet must be regenerated and validated under the current schema before role-start recognition.',
  }),
  'handoff.evidence.revalidation_failed': Object.freeze({
    semanticInvalidators: 'current external verification succeeds for the exact stored return',
    proof: 'disposition: no-nonexecution-proof; a failed external revalidation remains blocking until current external verification succeeds for the exact stored return.',
  }),
  'handoff.evidence.ambiguous_return': Object.freeze({
    semanticInvalidators: 'one current stored return verification is selected',
    proof: 'disposition: no-nonexecution-proof; competing current return records remain blocking until one current stored verification is selected.',
  }),
});

function defaultSemanticInvalidators(refusalClass, rationale) {
  if (refusalClass === 'migration_recompute') return 'current derivation, schema, or source state supersedes this projection';
  if (refusalClass === 'single_action_mechanical_repair') return 'the exact malformed or absent representation is repaired';
  if (refusalClass === 'advisory_diagnostic') return 'none; this observation does not authorize a refusal';
  if (refusalClass === PENDING_CLASSIFICATION) return 'pending completing-slice evaluation';
  return `none; ${rationale} remains material until replaced by authenticated current evidence`;
}

function defaultProof(code, family, refusalClass, rationale, producers) {
  if (refusalClass === PENDING_CLASSIFICATION) return `pending_wu_b2:${family}`;
  if (producers.length === 0) return `historical_no_live_producer:${code}; catalog compatibility only`;
  return `${rationale}; ${refusalClass} is emitted at ${producers.join(', ') || 'historical catalog compatibility'}`;
}

function classified(code, family, refusalClass, factOwner, rationale, repairClass, repairPolicy) {
  const producers = ACCEPTED_PRODUCER_INVENTORY[code] ?? [];
  const consumers = CONSUMER_INVENTORY[code] ?? [];
  const evaluationSurfaces = EVALUATION_SURFACES[code] ?? [];
  const override = METADATA_OVERRIDES[code] ?? {};
  return Object.freeze({
    code, family, refusalClass, factOwner, rationale, repairClass,
    // Consumers use this combined definition rather than coordinating a
    // classification row with an independent policy projection.
    repairPolicy,
    producers: producers.length > 0 ? producers : null,
    ...(consumers.length > 0 ? { consumers } : {}),
    ...(evaluationSurfaces.length > 0 ? { evaluationSurfaces } : {}),
    // These descriptions are projections of the row, not evidence. Do not call
    // generated prose "proof": independent evidence is an executable probe or
    // a precise non-execution disposition.
    derivedNarrative: Object.freeze({
      semanticInvalidator: override.semanticInvalidators ?? defaultSemanticInvalidators(refusalClass, rationale),
      description: defaultProof(code, family, refusalClass, rationale, producers),
    }),
    ...(override.proof ? { semanticEvidence: override.proof } : {}),
  });
}

const F1 = [
  classified('activation.capture.missing', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-absent', 'obtain authenticated capture', policy('activation', 'repair_evidence', 'none', 'Parser-owned activation capture is required before task authoring.')),
  classified('activation.capture.malformed', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-integrity', 'regenerate capture', policy('activation', 'repair_evidence', 'none', 'Activation capture is malformed or contradicts its adapter capability.')),
  classified('activation.capture.mismatch', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-integrity', 'obtain matching capture', policy('activation', 'repair_evidence', 'none', 'The operator and parser-normalized activation digests do not match.')),
  classified('activation.capture.expired', 'F1', 'migration_recompute', 'activation_authority', 'derived-freshness', 'recompute current authorization', policy('activation', 'repair_evidence', 'none', 'The task-bound activation capture has expired.')),
  classified('activation.capture.unsupported', 'F1', 'advisory_diagnostic', 'host_boundary', 'unsupported-observation', 'select supported boundary', policy('activation', 'repair_evidence', 'none', 'The selected adapter cannot produce a proven parser-owned activation artifact.')),
  classified('activation.grant.malformed', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-integrity', 'repair grant encoding', policy('activation', 'repair_evidence', 'none', 'An activation grant or task activation binding is malformed.')),
  classified('activation.grant.unauthenticated', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-absent', 'obtain authenticated grant', policy('activation', 'repair_evidence', 'human_authority_review', 'An activation grant is unsigned or does not verify against the external operator or pinned host key.')),
  classified('activation.grant.revoked', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-revoked', 'obtain new authorization', policy('activation', 'repair_evidence', 'none', 'The activation grant was revoked, or a revocation record for this target is unreadable.')),
  classified('activation.grant.repository_mismatch', 'F1', 'retained_hard_refusal', 'activation_authority', 'repository-mismatch', 'use authorized repository', policy('activation', 'repair_evidence', 'none', 'The activation grant was issued for a different target repository.')),
  classified('activation.grant.out_of_scope', 'F1', 'material_human_decision', 'activation_authority', 'scope-not-authorized', 'obtain scope authorization', policy('activation', 'repair_evidence', 'none', 'The activation grant scope does not authorize this task.')),
  classified('activation.binding.malformed', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-integrity', 'repair binding encoding', policy('activation', 'repair_evidence', 'none', 'The task activation binding is malformed.')),
  classified('activation.binding.unauthenticated', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-absent', 'obtain authenticated binding', policy('activation', 'repair_evidence', 'human_authority_review', 'The task activation binding is unsigned or does not verify against the external operator or pinned host key.')),
  classified('activation.binding.mismatch', 'F1', 'retained_hard_refusal', 'activation_authority', 'authorization-integrity', 'rebind current authorization', policy('activation', 'repair_evidence', 'none', 'The task activation binding contradicts its grant, assurance, or derivation.')),
  classified('activation.binding.task_mismatch', 'F1', 'retained_hard_refusal', 'activation_authority', 'task-mismatch', 'use authorized task', policy('activation', 'repair_evidence', 'none', 'The task activation binding authorizes a different task, backend, or carrier.')),
  classified('activation.binding.repository_mismatch', 'F1', 'retained_hard_refusal', 'activation_authority', 'repository-mismatch', 'use authorized repository', policy('activation', 'repair_evidence', 'none', 'The task activation binding was issued for a different target repository.')),
  classified('activation.binding.stale_contract', 'F1', 'retained_hard_refusal', 'protected_contract', 'protected-contract-changed', 'obtain renewed authorization', policy('activation', 'repair_evidence', 'none', 'The task contract changed after activation; the binding no longer covers the current contract.')),
  classified('activation.binding.decomposition_missing', 'F1', 'single_action_mechanical_repair', 'decomposition_record', 'derived-record-missing', 'recompute decomposition binding', policy('activation', 'repair_evidence', 'contract_reconciliation', 'A decomposition-derived activation binding requires current committed decomposition evidence.')),
  classified('activation.binding.decomposition_invalid', 'F1', 'single_action_mechanical_repair', 'decomposition_record', 'derived-record-invalid', 'recompute decomposition binding', policy('activation', 'repair_evidence', 'contract_reconciliation', 'The committed decomposition evidence cannot derive this task activation binding.')),
  classified('activation.binding.decomposition_changed', 'F1', 'migration_recompute', 'decomposition_record', 'derived-record-changed', 'recompute decomposition binding', policy('activation', 'repair_evidence', 'none', 'The committed decomposition changed after activation; derived bindings are superseded.')),
  classified('activation.assurance.insufficient', 'F1', 'material_human_decision', 'activation_authority', 'assurance-not-authorized', 'obtain authorized assurance', policy('activation', 'repair_evidence', 'human_authority_review', 'Activation assurance is below the effective minimum required by the current mode.')),
  classified('activation.identity.migration_required', 'F1', 'migration_recompute', 'activation_identity', 'identity-version-migration', 'migrate identity', policy('activation', 'repair_evidence', 'human_authority_review', 'Operator activation material exists under a superseded repository identity and must be migrated before new activation authority is created.')),
  classified('activation.identity.conflict', 'F1', 'material_human_decision', 'activation_authority', 'authority-conflict', 'select authority', policy('activation', 'repair_evidence', 'human_authority_review', 'Several operator activation keys claim this repository; the operator must choose which identity survives.')),
  classified('activation.policy.invalid', 'F1', 'single_action_mechanical_repair', 'activation_policy', 'policy-unavailable', 'repair activation policy', policy('activation', 'repair_evidence', 'none', 'The effective activation policy is unavailable or invalid.')),
];

const F2 = [
  classified('task.contract.malformed', 'F2', 'retained_hard_refusal', 'protected_contract', 'protected-contract-invalid', 'repair contract', policy('task_contract', 'repair_task_contract', 'contract_reconciliation', 'Task frontmatter is malformed.')),
  classified('task.contract.absent', 'F2', 'retained_hard_refusal', 'protected_contract', 'authorization-intent-absent', 'create contract', policy('task_contract', 'create_task_contract', 'contract_reconciliation', 'Task frontmatter is required.')),
  classified('scope.declaration.missing', 'F2', 'material_human_decision', 'protected_contract', 'scope-not-authorized', 'declare scope', policy('path_intent', 'declare_scope', 'contract_reconciliation', 'Task scope declaration is missing.')),
  classified('scope.declaration.duplicate', 'F2', 'material_human_decision', 'protected_contract', 'scope-ambiguous', 'deduplicate scope', policy('path_intent', 'deduplicate_scope', 'contract_reconciliation', 'Task scope declaration contains a duplicate path.')),
  classified('scope.declaration.invalid', 'F2', 'material_human_decision', 'protected_contract', 'scope-ambiguous', 'repair scope', policy('path_intent', 'repair_scope_declaration', 'contract_reconciliation', 'Task scope declaration is invalid.')),
  classified('scope.existing_path.missing', 'F2', 'removal', 'protected_contract', 'historical-path-inventory-check', 'remove compatibility row when consumers migrate', policy('path_intent', 'classify_existing_path', 'contract_reconciliation', 'An allowed existing path is missing from the authoritative base-tree inventory.')),
  classified('scope.intended_creation.missing', 'F2', 'material_human_decision', 'protected_contract', 'scope-not-authorized', 'declare creation', policy('path_intent', 'declare_intended_creation', 'contract_reconciliation', 'An allowed path absent from the base tree is not declared as an intended creation.')),
  classified('scope.intended_creation.uncovered', 'F2', 'material_human_decision', 'protected_contract', 'scope-not-authorized', 'cover creation', policy('path_intent', 'cover_intended_creation', 'contract_reconciliation', 'An intended creation is not covered by task scope.')),
  classified('scope.intent.invalid', 'F2', 'material_human_decision', 'protected_contract', 'scope-ambiguous', 'repair path intent', policy('path_intent', 'repair_path_intent', 'contract_reconciliation', 'Task path intent is invalid.')),
  classified('generated.path.invalid', 'F2', 'material_human_decision', 'protected_contract', 'scope-ambiguous', 'repair generated-path intent', policy('generated_paths', 'repair_generated_path_declaration', 'contract_reconciliation', 'Generated-path declaration is invalid.')),
  classified('scope.glob.unmatched', 'F2', 'material_human_decision', 'protected_contract', 'scope-ambiguous', 'confirm scope glob', policy('path_intent', 'confirm_scope_glob', 'contract_reconciliation', 'A scope glob matches no paths in the authoritative base-tree inventory.')),
  classified('scope.deviation.missing', 'F2', 'material_human_decision', 'protected_contract', 'scope-not-authorized', 'declare deviation', policy('scope_deviations', 'declare_exact_deviation', 'contract_reconciliation', 'Changed path is not authorized by task scope or a declared deviation.')),
  classified('scope.deviation.malformed', 'F2', 'material_human_decision', 'protected_contract', 'scope-ambiguous', 'repair deviation', policy('scope_deviations', 'repair_deviation', 'contract_reconciliation', 'A scope deviation declaration is malformed or stale.')),
  classified('contract.baseline.missing', 'F2', 'single_action_mechanical_repair', 'protected_contract', 'baseline-record-missing', 'establish baseline', policy('task_contract', 'establish_baseline', 'contract_reconciliation', 'Task-contract baseline is missing.')),
  classified('contract.baseline.invalid', 'F2', 'retained_hard_refusal', 'protected_contract', 'protected-contract-invalid', 'repair baseline', policy('task_contract', 'repair_baseline_record', 'human_authority_review', 'Task-contract baseline or correction record is invalid.')),
  classified('contract.baseline.stale', 'F2', 'retained_hard_refusal', 'protected_contract', 'protected-contract-changed', 'reconcile contract', policy('task_contract', 'authorize_contract_correction', 'contract_reconciliation', 'Current task contract differs from the trusted baseline chain.')),
  classified('contract.record_marker.mutable_body', 'F2', 'single_action_mechanical_repair', 'protected_contract', 'mutable-projection-marker', 'remove marker', policy('task_contract', 'remove_mutable_record_marker', 'contract_reconciliation', 'A task-contract RECORD marker is present in mutable task text.')),
  classified('task.body.bom', 'F2', 'migration_recompute', 'task_record', 'record-normalization', 'sanitize record', policy('task_contract', 'preserve_and_sanitize_body', 'record_recovery', 'Task body begins with a UTF-8 BOM.')),
  classified('task.body.collapsed_newlines', 'F2', 'migration_recompute', 'task_record', 'record-normalization', 'sanitize record', policy('task_contract', 'preserve_and_sanitize_body', 'record_recovery', 'Task body has collapsed line boundaries and is not a canonical Markdown record.')),
  classified('task.body.utf8', 'F2', 'retained_hard_refusal', 'task_record', 'record-integrity', 'repair encoding', policy('task_contract', 'preserve_and_sanitize_body', 'record_recovery', 'Task record is not valid UTF-8.')),
  classified('task.record.structure', 'F2', 'migration_recompute', 'task_record', 'record-normalization', 'repair record', policy('task_contract', 'repair_task_record', 'record_recovery', 'Canonical record structure is malformed or duplicated.')),
  classified('task.body.identity', 'F2', 'retained_hard_refusal', 'protected_contract', 'task-mismatch', 'repair task identity', policy('task_contract', 'repair_task_identity', 'contract_reconciliation', 'GitHub task record identity is invalid.')),
  classified('task.body.invalid', 'F2', 'retained_hard_refusal', 'protected_contract', 'protected-contract-invalid', 'repair task record', policy('task_contract', 'repair_task_record', 'contract_reconciliation', 'GitHub task record is invalid.')),
  classified('task.body.attribution', 'F2', 'retained_hard_refusal', 'protected_contract', 'attribution-invalid', 'repair task attribution', policy('task_contract', 'repair_task_attribution', 'contract_reconciliation', 'GitHub task record attribution is invalid.')),
  classified('task.body.base_inventory.missing', 'F2', 'single_action_mechanical_repair', 'base_inventory', 'derived-record-missing', 'supply inventory', policy('path_intent', 'supply_base_inventory', 'contract_reconciliation', 'An authoritative base-tree path inventory is required.')),
  classified('readiness.base_inventory.missing', 'F2', 'single_action_mechanical_repair', 'base_inventory', 'derived-record-missing', 'supply inventory', policy('path_intent', 'supply_base_inventory', 'contract_reconciliation', 'An authoritative base-tree path inventory is required.')),
  classified('evidence.missing', 'F2', 'single_action_mechanical_repair', 'evidence_record', 'evidence-missing', 'supply evidence', policy('evidence', 'repair_evidence', 'none', 'Required evidence was not supplied.')),
  classified('evidence.malformed', 'F2', 'single_action_mechanical_repair', 'evidence_record', 'evidence-malformed', 'repair evidence', policy('evidence', 'repair_evidence', 'none', 'Supplied evidence is malformed.')),
  classified('evidence.stale', 'F2', 'migration_recompute', 'evidence_record', 'derived-freshness', 'recompute evidence', policy('evidence', 'repair_evidence', 'none', 'Supplied evidence is stale.')),
  // This shared negative-evidence guard covers both failed required checks and
  // closeout packet-output violations. It does not assert that a check ran
  // when the closeout command rejects an unsafe output path.
  classified('evidence.negative', 'F2', 'retained_hard_refusal', 'evidence_guard', 'negative-evidence-or-output-guard', 'repair failed condition', policy('evidence', 'repair_evidence', 'none', 'Supplied evidence shows the required condition is false.')),
  classified('required_check.explain_forbidden', 'F2', 'single_action_mechanical_repair', 'required_check', 'diagnostic-output-not-evidence', 'replace explain with a real required check', policy('checks', 'repair_required_checks', 'contract_reconciliation', 'A required check attempts to consume read-only task explain diagnostic output.')),
  classified('evidence.changed', 'F2', 'migration_recompute', 'evidence_record', 'derived-record-changed', 'recompute evidence', policy('evidence', 'repair_evidence', 'none', 'Evidence changed after preparation or verification.')),
  classified('task.evidence.not_in_progress', 'F2', 'retained_hard_refusal', 'attempt_state', 'lifecycle-state-invalid', 'use current lifecycle state', policy('evidence', 'repair_evidence', 'none', 'The task is not in a lifecycle state that permits this role-owned evidence mutation.')),
  classified('task.evidence.lineage', 'F2', 'retained_hard_refusal', 'attempt_lineage', 'lineage-ambiguous', 'resolve lineage', policy('evidence', 'repair_evidence', 'none', 'The task carrier does not have one current recognized dispatch lineage.')),
  classified('task.evidence.lineage.stale', 'F2', 'migration_recompute', 'attempt_lineage', 'derived-record-changed', 'recompute lineage', policy('evidence', 'repair_live_carrier_lineage', 'none', 'The current task carrier differs from the live Engineer attempt lineage terminal.')),
  classified('task.carrier.armed', 'F2', 'retained_hard_refusal', 'attempt_lineage', 'concurrent-mutation-safety', 'complete or explicitly resolve attempt', policy('evidence', 'repair_live_carrier_lineage', 'none', 'A live Engineer attempt freezes unrelated task-carrier mutations.')),
  classified('task.evidence.provenance_mismatch', 'F2', 'retained_hard_refusal', 'attempt_lineage', 'attribution-invalid', 'supply bound evidence', policy('evidence', 'repair_evidence', 'none', 'Structured task evidence does not bind the dispatched role, invocation, contract, and attempt.')),
  classified('task.evidence.contract_drift', 'F2', 'retained_hard_refusal', 'protected_contract', 'protected-contract-changed', 'reconcile contract', policy('task_contract', 'repair_task_contract', 'contract_reconciliation', 'The proposed evidence mutation changes protected task-contract content or is not canonical.')),
  classified('task.evidence.atomic_write', 'F2', 'advisory_diagnostic', 'workflow_projection', 'atomic-write-unproven', 'retry atomic write', policy('evidence', 'repair_evidence', 'record_recovery', 'The evidence carrier and receipt could not be committed atomically.')),
  classified('task.evidence.final_validation', 'F2', 'retained_hard_refusal', 'attempt_lineage', 'lineage-unproven', 'verify current lineage', policy('evidence', 'repair_evidence', 'record_recovery', 'Persisted evidence did not refetch as one canonical current carrier lineage.')),
  classified('verification.context.missing', 'F2', 'single_action_mechanical_repair', 'verification_context', 'evidence-missing', 'supply context', policy('evidence', 'repair_evidence', 'none', 'Verification context was not supplied; committed state was not evaluated.')),
  classified('verification.context.malformed', 'F2', 'single_action_mechanical_repair', 'verification_context', 'evidence-malformed', 'repair context', policy('evidence', 'repair_evidence', 'none', 'Supplied verification context is malformed; committed state was not evaluated.')),
  classified('verification.context.stale', 'F2', 'migration_recompute', 'verification_context', 'derived-freshness', 'recompute context', policy('evidence', 'repair_evidence', 'none', 'Supplied verification context is stale; committed state was not evaluated.')),
  classified('host.boundary.unsupported', 'F2', 'advisory_diagnostic', 'host_boundary', 'unsupported-observation', 'select supported boundary', policy('evidence', 'repair_evidence', 'none', 'The host boundary cannot support the declared capability; committed state was not evaluated.')),
  classified('task.record.identity_mismatch', 'F2', 'retained_hard_refusal', 'protected_contract', 'task-mismatch', 'repair record identity', policy('task_contract', 'repair_task_identity', 'contract_reconciliation', 'The requested task identity differs from the materialized record identity.')),
  classified('task.evidence.product_head', 'F2', 'retained_hard_refusal', 'product_lineage', 'candidate-head-mismatch', 'use current product head', policy('evidence', 'repair_evidence', 'none', 'Implementation artifact evidence does not name the exact current product head.')),
  classified('execution_evidence.malformed_input', 'F2', 'single_action_mechanical_repair', 'execution_evidence', 'evidence-malformed', 'repair execution evidence', policy('evidence', 'repair_evidence', 'none', 'Execution evidence has malformed structural input.')),
  classified('execution_evidence.stale_version', 'F2', 'migration_recompute', 'execution_evidence', 'retired-schema-currency', 'recompute execution evidence', policy('evidence', 'repair_evidence', 'none', 'Execution evidence uses a retired schema version and must be recomputed.')),
  classified('execution_evidence.binding_mismatch', 'F2', 'retained_hard_refusal', 'execution_evidence', 'evidence-binding-mismatch', 'rerun exact check', policy('evidence', 'repair_evidence', 'none', 'Execution evidence does not bind the expected task or check identity.')),
  classified('execution_evidence.lineage_mismatch', 'F2', 'retained_hard_refusal', 'attempt_lineage', 'lineage-ambiguous', 'recompute execution evidence', policy('evidence', 'repair_live_carrier_lineage', 'none', 'Execution evidence does not bind the current carrier or repository lineage.')),
];

const F3 = [
  classified('dependency.unresolved', 'F3', 'retained_hard_refusal', 'dependency_state', 'dependency-unsatisfied', 'resolve dependency', policy('dependencies', 'resolve_dependency', 'dependency_escalation', 'A declared dependency is unresolved.')),
  classified('dependency.evidence.stale', 'F3', 'migration_recompute', 'dependency_state', 'derived-freshness', 'recompute dependency state', policy('dependencies', 'regenerate_decomposition', 'contract_reconciliation', 'The dependency snapshot has aged past its freshness window.')),
  classified('dispatch.attempt.budget_exhausted', 'F3', 'material_human_decision', 'task_policy', 'attempt-policy-limit', 'change task policy', policy('dispatch', 'repair_task_policy', 'human_authority_review', 'The task has recorded as many execution attempts as its attempt_budget allows.')),
  classified('role_result.tooling_failure_repeated', 'F3', 'advisory_diagnostic', 'tooling_observation', 'no-progress-observation', 'diagnose tooling', policy('role_result', 'repair_evidence', 'none', 'The same contract-bound tooling failure repeated without progress.')),
  classified('role_result.schema.invalid', 'F3', 'single_action_mechanical_repair', 'role_result', 'result-schema-invalid', 'regenerate role result', policy('evidence', 'repair_evidence', 'none', 'The role result does not satisfy its required schema.')),
  classified('task.role_start.check_evidence_missing', 'F3', 'single_action_mechanical_repair', 'dispatch_packet', 'derived-record-missing', 'initialize check evidence', policy('dispatch', 'repair_evidence', 'none', 'The role-start check-evidence scaffold is missing.')),
  classified('task.role_start.check_evidence_mismatch', 'F3', 'migration_recompute', 'dispatch_packet', 'derived-record-changed', 'recompute check evidence', policy('dispatch', 'repair_evidence', 'none', 'The role-start check-evidence scaffold does not match the dispatch packet.')),
  classified('task.lifecycle.not_dispatchable', 'F3', 'retained_hard_refusal', 'attempt_state', 'lifecycle-state-invalid', 'use dispatchable state', policy('task_contract', 'repair_task_record', 'contract_reconciliation', 'The task lifecycle status cannot begin an execution attempt.')),
  // Recovery of an unresolved write is evaluated on the same dispatch path that
  // later consumes its state; keep its acceptance proof with that transition.
  classified('task.mutation.unresolved', 'F3', 'retained_hard_refusal', 'workflow_projection', 'mutation-state-unproven', 'resolve mutation state', policy('task_contract', 'repair_task_record', 'record_recovery', 'A task mutation may have committed and its exact final state could not be proven.')),
  classified('dispatch.packet.invalid', 'F3', 'single_action_mechanical_repair', 'dispatch_packet', 'packet-malformed', 'regenerate packet', policy('dispatch', 'repair_evidence', 'none', 'Dispatch packet evidence is malformed or incomplete.')),
  classified('dispatch.packet.stale', 'F3', 'migration_recompute', 'dispatch_packet', 'derived-freshness', 'recompute packet', policy('dispatch', 'repair_evidence', 'none', 'Dispatch packet evidence is stale or changed.')),
  classified('dispatch.packet.conserved', 'F3', 'material_human_decision', 'attempt_lineage', 'attempt-conservation', 'complete or abandon attempt', policy('dispatch', 'complete_or_abandon_attempt', 'human_authority_disposition', 'A live execution attempt has recorded work and its consumed packet cannot be replaced.')),
  classified('dispatch.attempt.history_rewritten', 'F3', 'retained_hard_refusal', 'attempt_lineage', 'attribution-invalid', 'repair attribution', policy('dispatch', 'repair_task_attribution', 'human_authority_review', 'Durable history in a recorded execution attempt range was rewritten or replaced.')),
  classified('capability.declaration.invalid', 'F3', 'single_action_mechanical_repair', 'host_capability', 'capability-declaration-invalid', 'repair declaration', policy('role_capability', 'repair_evidence', 'none', 'The host-role capability declaration is missing, malformed, contradictory, or incomplete.')),
  classified('capability.enforcement.degraded', 'F3', 'advisory_diagnostic', 'host_capability', 'enforcement-observation', 'use authoritative boundary', policy('role_capability', 'repair_evidence', 'none', 'The host cannot enforce this role action natively; the declared authoritative detection boundary must evaluate it.')),
  classified('capability.action.denied', 'F3', 'retained_hard_refusal', 'role_capability', 'role-not-authorized', 'use authorized role', policy('role_capability', 'repair_evidence', 'none', 'The assigned role is not authorized for the requested workflow action.')),
  classified('capability.resolution.failed', 'F3', 'advisory_diagnostic', 'host_capability', 'resolution-unavailable', 'resolve capability', policy('role_capability', 'repair_evidence', 'none', 'Host-role capability resolution failed.')),
  classified('parallel_scan.inventory.incomplete', 'F3', 'retained_hard_refusal', 'parallel_ownership', 'parallel-inventory-incomplete', 'complete inventory', policy('parallel_scan', 'regenerate_decomposition', 'contract_reconciliation', 'The bounded work-unit task inventory is incomplete and cannot support a complete ready-set conclusion.')),
  classified('parallel_scan.record.invalid', 'F3', 'single_action_mechanical_repair', 'parallel_ownership', 'derived-record-invalid', 'regenerate scan', policy('parallel_scan', 'regenerate_decomposition', 'none', 'The parallel-scan record is malformed, mis-digested, or does not account for its inventory.')),
  classified('parallel_scan.evidence.stale', 'F3', 'migration_recompute', 'parallel_ownership', 'derived-freshness', 'recompute scan', policy('parallel_scan', 'regenerate_decomposition', 'none', 'The parallel-scan observation is outside its declared freshness policy.')),
  classified('parallel_scan.decomposition.invalid', 'F3', 'retained_hard_refusal', 'parallel_ownership', 'parallel-ownership-unproven', 'repair decomposition', policy('parallel_scan', 'regenerate_decomposition', 'contract_reconciliation', 'The decomposition source, attribution, or completeness declaration is invalid.')),
  classified('handoff.transition.unsupported', 'F3', 'advisory_diagnostic', 'handoff_boundary', 'unsupported-transition', 'use supported transition', policy('handoff', 'repair_evidence', 'none', 'The requested transition is not a protected lifecycle transition this seam recognizes.')),
  classified('handoff.expectation.malformed', 'F3', 'single_action_mechanical_repair', 'handoff_boundary', 'expectation-malformed', 'repair expectation', policy('handoff', 'repair_evidence', 'none', 'The supplied handoff expectation is malformed or does not bind a task and role.')),
  classified('handoff.evidence.missing', 'F3', 'single_action_mechanical_repair', 'handoff_boundary', 'evidence-missing', 'supply handoff evidence', policy('handoff', 'repair_evidence', 'none', 'The canonical prepared dispatch or verified return required by this transition was not supplied.')),
  classified('handoff.evidence.malformed', 'F3', 'single_action_mechanical_repair', 'handoff_boundary', 'evidence-malformed', 'repair handoff evidence', policy('handoff', 'repair_evidence', 'none', 'Supplied handoff evidence is malformed or is not the canonical record kind.')),
  classified('handoff.evidence.replayed', 'F3', 'retained_hard_refusal', 'handoff_boundary', 'replay-defense', 'use fresh packet', policy('handoff', 'repair_evidence', 'none', 'The prepared dispatch was already consumed; an authoritative role start requires a fresh packet.')),
  classified('handoff.evidence.mismatched', 'F3', 'retained_hard_refusal', 'handoff_boundary', 'handoff-binding-mismatch', 'supply matching evidence', policy('handoff', 'repair_evidence', 'none', 'Supplied handoff evidence binds a different task, role, packet, artifact, or worktree.')),
  classified('handoff.evidence.unsupported', 'F3', 'advisory_diagnostic', 'handoff_boundary', 'unsupported-observation', 'use supported evidence', policy('handoff', 'repair_evidence', 'none', 'Supplied handoff evidence declares a schema or assurance grade this boundary cannot evaluate.')),
  classified('handoff.evidence.unauthenticated', 'F3', 'retained_hard_refusal', 'handoff_boundary', 'authorization-absent', 'supply authenticated evidence', policy('handoff', 'repair_evidence', 'human_authority_review', 'Handoff evidence is session-reported or below the required assurance minimum and cannot authorize a protected transition.')),
  classified('handoff.refresh.plan.malformed', 'F3', 'single_action_mechanical_repair', 'handoff_boundary', 'refresh-plan-invalid', 'repair refresh plan', policy('handoff', 'repair_evidence', 'none', 'Handoff evidence refresh plan is malformed or does not match the expected task binding.')),
  classified('handoff.refresh.plan.unsupported', 'F3', 'advisory_diagnostic', 'handoff_boundary', 'unsupported-observation', 'use supported backend', policy('handoff', 'repair_evidence', 'none', 'Derived-evidence refresh plans apply only to the files backend; the selected backend has no local derived-evidence surface to refresh.')),
  classified('tooling_failure_input_invalid', 'F3', 'single_action_mechanical_repair', 'tooling_observation', 'observation-input-invalid', 'repair tooling observation', policy('tooling_failure', 'repair_evidence', 'none', 'Tooling-failure observation input is invalid.')),
  classified('tooling_failure_evidence_conflict', 'F3', 'migration_recompute', 'tooling_observation', 'derived-record-changed', 'recompute tooling observation', policy('tooling_failure', 'repair_evidence', 'none', 'Tooling-failure observation evidence conflicts with current history.')),
  classified('tooling_failure_write_failed', 'F3', 'advisory_diagnostic', 'tooling_observation', 'atomic-write-unproven', 'retry observation write', policy('tooling_failure', 'repair_evidence', 'record_recovery', 'Tooling-failure observation could not be recorded atomically.')),
  classified('tooling_failure_admission_conflict', 'F3', 'migration_recompute', 'tooling_observation', 'concurrent-observation-change', 'recompute retry admission', policy('tooling_failure', 'repair_evidence', 'none', 'Tooling-failure retry admission changed concurrently.')),
];

const F4 = [
  classified('readiness.candidate.stage_failure', 'F4', 'advisory_diagnostic', 'candidate_builder', 'candidate-stage-observation', 'inspect stage diagnostic', policy('evidence', 'repair_evidence', 'record_recovery', 'A readiness candidate stage reported a blocking failure.')),
  classified('readiness.candidate.internal_failure', 'F4', 'advisory_diagnostic', 'candidate_builder', 'candidate-stage-observation', 'inspect stage diagnostic', policy('evidence', 'repair_evidence', 'record_recovery', 'A readiness candidate stage failed without reporting a diagnostic cause.')),
  classified('return.assurance.insufficient', 'F4', 'material_human_decision', 'return_assurance', 'assurance-not-authorized', 'obtain authorized assurance', policy('role_return', 'repair_evidence', 'human_authority_review', 'Return assurance is below the effective minimum required by the current mode.')),
  classified('return.assurance.ambiguous', 'F4', 'single_action_mechanical_repair', 'return_adapter', 'adapter-selection-required', 'select adapter', policy('role_return', 'select_return_adapter', 'none', 'Multiple return adapters are available; select one with --return-adapter.')),
  // This reports reduced assurance but does not itself refuse a transition.
  classified('return.assurance.session_reported', 'F4', 'advisory_diagnostic', 'return_assurance', 'producer-not-authenticated-warning', 'supply authenticated return', policy('role_return', 'repair_evidence', 'none', 'The role return is session-reported: its producing role identity is not host-authenticated.')),
  classified('return.lane.implementation_absent', 'F4', 'retained_hard_refusal', 'product_lineage', 'product-lineage-unreachable', 'reapply implementation', policy('role_return', 'repair_evidence', 'none', 'The return lane does not contain the task implementation artifact.')),
  classified('handoff.evidence.freshness_expired', 'F4', 'migration_recompute', 'handoff_boundary', 'return-receipt-age', 'recompute return receipt', policy('handoff', 'repair_evidence', 'none', 'Supplied handoff evidence is outside its declared freshness policy.')),
  classified('handoff.evidence.schema_retired', 'F4', 'migration_recompute', 'handoff_boundary', 'prepared-dispatch-schema-retired', 'regenerate prepared dispatch', policy('handoff', 'repair_evidence', 'none', 'Prepared dispatch uses a retired schema and must be regenerated.')),
  classified('handoff.evidence.revalidation_failed', 'F4', 'retained_hard_refusal', 'handoff_boundary', 'external-return-revalidation-failed', 'revalidate exact return', policy('handoff', 'repair_evidence', 'none', 'Verified return evidence no longer passes current external revalidation.')),
  classified('handoff.evidence.ambiguous_return', 'F4', 'retained_hard_refusal', 'return_identity', 'stored-return-selection-ambiguous', 'resolve return selection', policy('handoff', 'repair_evidence', 'none', 'Stored return verification selection did not yield one current record.')),
  classified('role_return.invalid', 'F4', 'retained_hard_refusal', 'return_identity', 'return-integrity', 'regenerate return', policy('role_return', 'repair_evidence', 'none', 'Role-return evidence is malformed or lacks trusted provenance.')),
  classified('role_return.stale', 'F4', 'migration_recompute', 'return_identity', 'derived-freshness', 'recompute return', policy('role_return', 'repair_evidence', 'none', 'Role-return evidence no longer matches current repository facts.')),
  classified('role_return.receipt_stale', 'F4', 'migration_recompute', 'return_identity', 'receipt-schema-migration', 'reissue receipt', policy('role_return', 'repair_evidence', 'none', 'The authenticated host receipt uses a retired schema and must be reissued.')),
  classified('role_return.producer_mismatch', 'F4', 'retained_hard_refusal', 'return_identity', 'producer-mismatch', 'supply matching return', policy('role_return', 'repair_evidence', 'none', 'Authenticated producer evidence does not match the dispatched workflow role.')),
  classified('attempt_return_unbound', 'F4', 'retained_hard_refusal', 'return_identity', 'attempt-binding-missing', 'supply bound return', policy('role_return', 'repair_evidence', 'none', 'Return verification does not bind a recorded execution attempt.')),
  classified('attempt_return_ambiguous', 'F4', 'retained_hard_refusal', 'return_identity', 'attempt-binding-ambiguous', 'resolve return binding', policy('role_return', 'repair_evidence', 'none', 'Return verification binds more than one execution attempt.')),
  classified('attempt_return_conflict', 'F4', 'retained_hard_refusal', 'return_identity', 'candidate-certification-conflict', 'resolve return conflict', policy('role_return', 'repair_evidence', 'none', 'An execution attempt has more than one return verification.')),
  classified('attempt_terminal_conflict', 'F4', 'retained_hard_refusal', 'return_identity', 'candidate-certification-conflict', 'resolve terminal evidence', policy('role_return', 'repair_evidence', 'none', 'An execution attempt has conflicting terminal evidence.')),
  classified('blocked_result.owner_mismatch', 'F4', 'retained_hard_refusal', 'blocked_result_authority', 'ownership-mismatch', 'use producing owner', policy('role_return', 'repair_evidence', 'none', 'A blocked result remains owned by its producing workflow role.')),
  classified('blocked_result.redelegation_required', 'F4', 'retained_hard_refusal', 'blocked_result_authority', 'redelegation-authority-absent', 'supply redelegation', policy('role_return', 'repair_evidence', 'none', 'Changing a blocked result owner requires a current typed redelegation authority.')),
  classified('blocked_result.redelegation_stale', 'F4', 'migration_recompute', 'blocked_result_authority', 'derived-freshness', 'reissue redelegation', policy('role_return', 'repair_evidence', 'none', 'The blocked-result redelegation authority is stale.')),
  classified('blocked_result.redelegation_invalid', 'F4', 'single_action_mechanical_repair', 'blocked_result_authority', 'redelegation-invalid', 'repair redelegation', policy('role_return', 'repair_evidence', 'none', 'The blocked-result redelegation authority is malformed, mismatched, or unrelated.')),
  classified('blocked_result.redelegation_untrusted', 'F4', 'retained_hard_refusal', 'blocked_result_authority', 'authorization-absent', 'supply trusted redelegation', policy('role_return', 'repair_evidence', 'human_authority_review', 'The blocked-result redelegation is not signed by the exact current operator-pinned authority.')),
  classified('human_disposition.required', 'F4', 'material_human_decision', 'human_authority', 'human-decision-required', 'obtain disposition', policy('human_authority', 'repair_evidence', 'human_authority_review', 'A typed human disposition is required for this blocked-result recovery.')),
  classified('human_disposition.stale', 'F4', 'migration_recompute', 'human_authority', 'derived-freshness', 'reissue disposition', policy('human_authority', 'repair_evidence', 'human_authority_review', 'The supplied human disposition is stale.')),
  classified('human_disposition.invalid', 'F4', 'single_action_mechanical_repair', 'human_authority', 'disposition-invalid', 'repair disposition', policy('human_authority', 'repair_evidence', 'human_authority_review', 'The supplied human disposition is malformed, mismatched, or unrelated.')),
  classified('human_disposition.untrusted', 'F4', 'retained_hard_refusal', 'human_authority', 'authorization-absent', 'supply trusted disposition', policy('human_authority', 'repair_evidence', 'human_authority_review', 'The human disposition is not signed by the exact current operator-pinned human authority.')),
];

const F5 = [
  classified('attribution.work_unit', 'F5', 'retained_hard_refusal', 'product_lineage', 'work-unit-attribution-integrity', 'repair attribution trailer', policy('attribution', 'repair_attribution_trailer', 'none', 'A work-unit commit does not carry the exact reviewed work-unit and task-set attribution.')),
  classified('attribution.trailer', 'F5', 'retained_hard_refusal', 'product_lineage', 'commit-task-attribution-integrity', 'repair attribution trailer', policy('attribution', 'repair_attribution_trailer', 'none', 'Commit attribution trailer block is invalid.')),
  classified('attribution.role', 'F5', 'retained_hard_refusal', 'attribution_identity', 'requested-workflow-role-validity', 'repair requested role', policy('attribution', 'repair_attribution_trailer', 'none', 'The expected commit-attribution role is not a canonical lowercase workflow role.')),
  classified('preflight.attribution', 'F5', 'retained_hard_refusal', 'github_attribution', 'github-attribution-integrity', 'repair attribution', policy('attribution', 'repair_attribution', 'none', 'Commit attribution is invalid.')),
];

const F6 = [
  classified('audit.already_exists', 'F6', 'single_action_mechanical_repair', 'audit_record', 'duplicate-audit-record-prevention', 'select or rebaseline existing audit', policy('audit', 'repair_review_audit', 'none', 'An audit record already exists for this work unit.')),
  classified('closeout.marker.stale', 'F6', 'migration_recompute', 'closeout_marker', 'closeout-marker-currentness', 'recompute closeout packet', policy('evidence', 'repair_evidence', 'none', 'The closeout marker is stale relative to current bound state.')),
  classified('review_prepare.workspace', 'F6', 'retained_hard_refusal', 'review_workspace', 'exact-candidate-workspace-integrity', 'use exact review workspace', policy('workspace', 'repair_review_workspace', 'none', 'The review workspace does not match the exact review artifact.')),
  classified('review_prepare.stale_head', 'F6', 'migration_recompute', 'review_candidate', 'derived-review-preparation-currentness', 'regenerate review preparation', policy('stale_head', 'refresh_review_preparation', 'none', 'Review preparation is stale relative to the current PR head.')),
  classified('review_prepare.preflight_failed', 'F6', 'retained_hard_refusal', 'candidate_evidence', 'fresh-preflight-integrity', 'repair preflight evidence', policy('preflight', 'repair_preflight_gate', 'none', 'Fresh preflight evidence fails for the current review candidate.')),
  classified('review_prepare.independent_review_policy', 'F6', 'retained_hard_refusal', 'review_policy', 'independent-review-policy-integrity', 'repair review policy', policy('review_policy', 'repair_task_policy', 'contract_reconciliation', 'The independent-review policy is invalid for review dispatch.')),
  classified('review_prepare.head_unavailable', 'F6', 'migration_recompute', 'review_candidate', 'current-head-unavailable', 'restore current head and regenerate review preparation', policy('review_candidate', 'refresh_review_preparation', 'none', 'The current PR head is unavailable; review preparation freshness cannot be confirmed.')),
  classified('review_prepare.head_malformed', 'F6', 'migration_recompute', 'review_candidate', 'head-evidence-malformed', 'repair head evidence and regenerate review preparation', policy('review_candidate', 'refresh_review_preparation', 'none', 'Evaluated or current PR-head evidence is malformed; review preparation freshness cannot be confirmed.')),
  classified('review_prepare.head_refetch_failed', 'F6', 'migration_recompute', 'review_candidate', 'head-refetch-failed', 'restore head refetch and regenerate review preparation', policy('review_candidate', 'refresh_review_preparation', 'none', 'The current PR head could not be refetched; review preparation freshness cannot be confirmed.')),
  classified('review_prepare.packet', 'F6', 'retained_hard_refusal', 'review_entry_packet', 'review-entry-packet-integrity', 'regenerate canonical review packet', policy('review_packet', 'regenerate_review_packet', 'none', 'The review preparation packet is invalid.')),
  classified('ready.preflight', 'F6', 'retained_hard_refusal', 'candidate_evidence', 'exact-candidate-preflight-integrity', 'repair preflight evidence', policy('preflight', 'repair_preflight_gate', 'none', 'A preflight component gate failed.')),
  classified('ready.review_audit', 'F6', 'retained_hard_refusal', 'review_provenance', 'independent-review-audit-integrity', 'obtain current independent review', policy('review_audit', 'repair_review_audit', 'none', 'The review-audit component gate failed.')),
  classified('ready.task_identity', 'F6', 'retained_hard_refusal', 'task_identity', 'unique-task-carrier-integrity', 'repair task identity', policy('task_identity', 'repair_task_identity', 'none', 'Cross-carrier task identity is invalid.')),
  classified('ready.cross_gate_identity', 'F6', 'retained_hard_refusal', 'candidate_certification', 'cross-gate-exact-candidate-integrity', 'reconcile certification gates', policy('cross_gate_identity', 'reconcile_cross_gate_identity', 'none', 'Cross-gate task identity is inconsistent.')),
  classified('review_audit.task_contract', 'F6', 'retained_hard_refusal', 'review_contract', 'independent-review-contract-integrity', 'repair review contract', policy('task_contract', 'repair_task_record', 'contract_reconciliation', 'Task record is malformed for review audit.')),
  classified('review_audit.failure', 'F6', 'retained_hard_refusal', 'review_provenance', 'independent-review-provenance-integrity', 'obtain valid independent review', policy('review_audit', 'repair_review_audit', 'none', 'Review audit failed.')),
  classified('preflight.review_checkpoint', 'F6', 'material_human_decision', 'review_authority', 'review-round-authorization-unproven', 'record authorized review checkpoint', policy('review_checkpoint', 'repair_review_checkpoint', 'human_authority_review', 'A required human review checkpoint is absent for this review round.')),
  classified('preflight.review_history_invalid', 'F6', 'retained_hard_refusal', 'review_history', 'review-history-carrier-integrity', 'repair review history', policy('review_history', 'repair_review_checkpoint', 'contract_reconciliation', 'Review history or its checkpoint carrier is malformed, fabricated, or inconsistent.')),
  classified('preflight.revision_resolution', 'F6', 'retained_hard_refusal', 'review_findings', 'required-finding-resolution-integrity', 'repair revision resolution', policy('revision_resolution', 'repair_revision_resolution', 'none', 'Review resolution is invalid.')),
  // Retained while the public preflight categorizer needs this compatibility
  // label; it has no dedicated producer and is excluded from live-proof claims.
  classified('preflight.review_provenance', 'F6', 'removal', 'review_provenance', 'historical-preflight-category-without-live-emitter', 'remove compatibility row when the public categorizer migrates', policy('review_provenance', 'repair_review_provenance', 'none', 'Review provenance is invalid.')),
  classified('review.entry.fixup_invalid', 'F6', 'retained_hard_refusal', 'review_fixup', 'fixup-disclosure-integrity', 'repair maintainer review fixup', policy('review_entry', 'repair_review_checkpoint', 'none', 'Maintainer Review Fixup disclosure is invalid.')),
  classified('review.entry.matrix_stale', 'F6', 'migration_recompute', 'revision_resolution', 'derived-finding-resolution-currentness', 'regenerate finding-resolution matrix', policy('review_entry', 'repair_revision_resolution', 'none', 'Finding-resolution state is stale for review entry.')),
  classified('review.entry.persistence_conflict', 'F6', 'retained_hard_refusal', 'review_entry_receipt', 'review-entry-persistence-conflict', 'resolve review-entry conflict', policy('review_entry', 'repair_evidence', 'contract_reconciliation', 'An existing review-entry receipt conflicts with the recognized verified return.')),
  classified('review.entry.persistence_carrier_changed', 'F6', 'migration_recompute', 'review_entry_receipt', 'review-entry-carrier-currentness', 'regenerate review entry', policy('review_entry', 'repair_evidence', 'none', 'The carrier changed before the review-entry receipt could be persisted.')),
  classified('review.entry.persistence_write_changed', 'F6', 'migration_recompute', 'review_entry_receipt', 'review-entry-write-currentness', 'regenerate review entry', policy('review_entry', 'repair_evidence', 'none', 'Review-entry persistence could not establish a current atomic write.')),
  classified('review.entry.persistence_refetch_changed', 'F6', 'migration_recompute', 'review_entry_receipt', 'review-entry-refetch-currentness', 'regenerate review entry', policy('review_entry', 'repair_evidence', 'none', 'Persisted review-entry bytes changed before their final refetch.')),
];

const F7 = [
  classified('compatibility.waiver_scope_retired', 'F7', 'advisory_diagnostic', 'compatibility_waiver', 'retired-waiver-scope-observation', 'retain canonical evidence requirements', policy('compatibility', 'repair_evidence', 'none', 'A retired compatibility-waiver scope is ignored.')),
  classified('check.aggregate.git_probe_failed', 'F7', 'single_action_mechanical_repair', 'check_aggregate_tracking', 'aggregate-tracking-probe-unavailable', 'restore readable Git index and worktree', policy('workspace', 'repair_command_environment', 'none', 'Git could not determine whether mutable aggregate state is tracked.')),
  classified('worktree.clean_gate.failed', 'F7', 'retained_hard_refusal', 'dispatch_workspace', 'clean-dispatch-workspace-integrity', 'restore exact clean dispatch workspace', policy('workspace', 'repair_review_workspace', 'none', 'The clean-worktree gate failed.')),
  classified('state.host_local', 'F7', 'advisory_diagnostic', 'projection_provenance', 'recorded-host-local-state-observation', 'record canonical provenance', policy('workspace', 'repair_review_workspace', 'none', 'Host-local or preexisting state requires classification.')),
  classified('projection.state.unexplained', 'F7', 'retained_hard_refusal', 'projection_provenance', 'unexplained-authority-sensitive-drift', 'reconcile authoritative projection state', policy('workspace', 'repair_review_workspace', 'contract_reconciliation', 'Observed state is unclassified drift and blocks authority-sensitive conclusions.')),
];

const F8 = [
  // These labels project readiness and preflight facts. They do not create a
  // second lifecycle authority: the cited F1--F7 evaluator facts retain their
  // existing material classifications and guards.
  classified('readiness.mode.invalid', 'F8', 'advisory_diagnostic', 'readiness_mode', 'library-readiness-mode-validation', 'select readiness mode', policy('path_intent', 'select_readiness_mode', 'none', 'Readiness mode is invalid.')),
  classified('preflight.head_identity', 'F8', 'migration_recompute', 'candidate_identity', 'derived-preflight-head-currentness', 'refetch current PR head and rerun preflight', policy('head_identity', 'repair_artifact_identity', 'none', 'PR artifact identity does not match the declared head.')),
  classified('preflight.summary_shape', 'F8', 'single_action_mechanical_repair', 'completion_summary', 'completion-summary-rendering-invalid', 'repair PR completion summary', policy('summary_shape', 'repair_pr_summary', 'none', 'PR completion summary is incomplete or malformed.')),
  classified('preflight.scope_deviations', 'F8', 'advisory_diagnostic', 'scope_projection', 'preflight-scope-presentation', 'repair the cited canonical scope or deviation fact', policy('scope_deviations', 'declare_exact_deviation', 'contract_reconciliation', 'PR paths do not match the task scope.')),
  classified('preflight.task_contract', 'F8', 'advisory_diagnostic', 'task_contract_projection', 'preflight-contract-presentation', 'repair the cited canonical task-contract fact', policy('task_contract', 'repair_task_contract', 'contract_reconciliation', 'Task contract is invalid.')),
  classified('preflight.path_intent', 'F8', 'advisory_diagnostic', 'path_intent_projection', 'preflight-path-intent-presentation', 'repair the cited canonical path-intent fact', policy('path_intent', 'repair_path_intent', 'contract_reconciliation', 'Task path intent is invalid.')),
  classified('preflight.generated_paths', 'F8', 'advisory_diagnostic', 'generated_path_projection', 'preflight-generated-path-presentation', 'repair the cited canonical generated-path fact', policy('generated_paths', 'repair_generated_path_declaration', 'contract_reconciliation', 'Generated-path declaration is invalid.')),
  classified('preflight.dependencies', 'F8', 'advisory_diagnostic', 'dependency_projection', 'preflight-dependency-presentation', 'repair the cited canonical dependency fact', policy('dependencies', 'resolve_dependency', 'dependency_escalation', 'Task dependency is unresolved.')),
  classified('preflight.evidence', 'F8', 'advisory_diagnostic', 'evidence_projection', 'preflight-evidence-presentation', 'repair the cited canonical evidence fact', policy('evidence', 'repair_evidence', 'none', 'Required evidence is invalid.')),
  classified('preflight.checks', 'F8', 'advisory_diagnostic', 'required_check_projection', 'preflight-check-presentation', 'repair the cited canonical required-check fact', policy('checks', 'repair_check_evidence', 'none', 'Required check evidence is invalid.')),
  classified('preflight.checks.task_contract', 'F8', 'advisory_diagnostic', 'required_check_contract_projection', 'preflight-required-check-contract-presentation', 'repair the cited canonical required-check contract', policy('checks', 'repair_required_checks', 'contract_reconciliation', 'Task required-check declaration is invalid.')),
  classified('preflight.task_policy', 'F8', 'advisory_diagnostic', 'task_policy_projection', 'preflight-policy-presentation', 'repair the cited canonical task-policy fact', policy('task_policy', 'repair_task_policy', 'contract_reconciliation', 'Task policy is invalid.')),
  classified('preflight.other', 'F8', 'advisory_diagnostic', 'preflight_observation', 'unclassified-preflight-presentation', 'inspect and classify the underlying preflight fact', policy('other', 'repair_preflight_input', 'none', 'Preflight input is invalid.')),
  classified('pr_body.structural', 'F8', 'single_action_mechanical_repair', 'pr_body_rendering', 'PR-body-structural-rendering-invalid', 'repair PR body structure', policy('pr_body', 'repair_pr_body_structure', 'none', 'PR body structure is incomplete or malformed.')),
  classified('pr_body.input', 'F8', 'single_action_mechanical_repair', 'preparation_input', 'serialized-preparation-input-invalid', 'complete preparation input', policy('preparation_input', 'complete_pr_body_input', 'none', 'Serialized evaluation input is incomplete or malformed.')),
  classified('pr_body.snapshot', 'F8', 'migration_recompute', 'snapshot_context', 'offline-snapshot-projection-invalid', 'regenerate PR-body snapshot', policy('snapshot_context', 'regenerate_pr_body_snapshot', 'none', 'Offline PR-body snapshot context is invalid.')),
  classified('pr_body.deprecation', 'F8', 'advisory_diagnostic', 'command_deprecation', 'deprecated-command-presentation', 'use the current PR-body command', policy('deprecation', 'migrate_pr_body_command', 'none', 'A deprecated PR-body command form is in use.')),
  classified('pr_body.local_file', 'F8', 'single_action_mechanical_repair', 'local_pr_body_file', 'local-PR-body-file-unavailable', 'restore local PR-body file', policy('local_file', 'repair_local_pr_body_file', 'none', 'A local PR-body input or output file is unavailable.')),
  classified('pr_body.input_format', 'F8', 'single_action_mechanical_repair', 'pr_body_input_format', 'PR-body-input-format-invalid', 'repair PR-body input format', policy('input_format', 'repair_pr_body_input_format', 'none', 'PR-body input format is invalid.')),
  classified('cli.usage', 'F8', 'advisory_diagnostic', 'command_usage', 'public-command-usage-invalid', 'correct command usage', policy('usage', 'correct_command_usage', 'none', 'Command usage is invalid.')),
  classified('cli.operational', 'F8', 'advisory_diagnostic', 'command_environment', 'public-command-environment-unavailable', 'repair command environment', policy('operational_error', 'repair_command_environment', 'human_authority_review', 'A command dependency or execution environment is unavailable.')),
  classified('cli.unexpected', 'F8', 'advisory_diagnostic', 'command_observation', 'unexpected-public-command-observation', 'inspect public command failure', policy('operational_error', 'repair_evidence', 'human_authority_review', 'The public command failed unexpectedly.')),
  classified('projection.observation.invalid', 'F8', 'single_action_mechanical_repair', 'projection_observation', 'projection-observation-malformed', 'repair projection observation', policy('projection', 'repair_evidence', 'none', 'A backend projection observation is malformed or does not describe a canonical transition-contract fact.')),
  classified('projection.carrier.not_applicable', 'F8', 'single_action_mechanical_repair', 'projection_carrier', 'projection-carrier-not-applicable', 'select applicable projection carrier', policy('projection', 'repair_evidence', 'none', 'The observation claims a carrier the selected backend does not project.')),
  classified('projection.evidence.superseded', 'F8', 'migration_recompute', 'projection_evidence', 'projection-evidence-superseded', 'recompute projection evidence', policy('projection', 'repair_evidence', 'none', 'Projection evidence is stale or changed and is superseded rather than current.')),
  classified('projection.fact.contradiction', 'F8', 'retained_hard_refusal', 'projection_authority', 'current-authoritative-projection-contradiction', 'reconcile authoritative projection state', policy('projection', 'repair_evidence', 'contract_reconciliation', 'Two current authoritative carriers report contradictory values for one fact.')),
  classified('projection.authority.untyped', 'F8', 'advisory_diagnostic', 'projection_authority', 'untyped-projection-observation', 'record typed canonical authority', policy('projection', 'repair_evidence', 'none', 'An untyped carrier confers no lifecycle authority and is advisory only.')),
];

const catalog = [...F1, ...F2, ...F3, ...F4, ...F5, ...F6, ...F7, ...F8];
// The P36F-00B 199-row count is historical; this live catalog retains 197
// rows, including two compatibility-only internal rows with no public claim.
const EXPECTED_CATALOG_ROW_COUNT = 197;
const EXPECTED_CATALOG_FAMILY_COUNTS = Object.freeze({
  F1: 23,
  F2: 50,
  F3: 35,
  F4: 27,
  F5: 4,
  F6: 26,
  F7: 5,
  F8: 27,
});
/**
 * The one runtime diagnostic-definition view. Classifications, tallies, and
 * hard-boundary lists are projections of these rows. Completeness belongs to
 * validation, not production module initialization.
 */
export const DIAGNOSTIC_DEFINITIONS = Object.freeze(Object.fromEntries(catalog.map(entry => [entry.code, entry])));
export const REFUSAL_CLASSES = DIAGNOSTIC_DEFINITIONS;

/** Generate the legacy repair-policy view from diagnostic definitions. */
export function repairPolicyViewFor(definitions = DIAGNOSTIC_DEFINITIONS) {
  return Object.freeze(Object.fromEntries(Object.entries(definitions).map(([code, entry]) => [code, entry.repairPolicy])));
}

/** Generate the legacy repair-policy lookup without maintaining a second registry. */
/** Generated current classification totals; tests consume this rather than private matrix prose. */
export const REFUSAL_FAMILY_TALLY = Object.freeze(Object.fromEntries(
  [...new Set(catalog.map(entry => entry.family))].sort().map(family => {
    const rows = catalog.filter(entry => entry.family === family);
    return [family, Object.freeze({
      total: rows.length,
      pending: rows.filter(entry => entry.refusalClass === PENDING_CLASSIFICATION).length,
    })];
  }),
));

const NEGATIVE_PROOF_BY_CODE = Object.freeze({
  'activation.capture.missing': 'Material fact: no authenticated activation capture exists. scenario: activation-capture-missing-refuses-dispatch.',
  'activation.capture.malformed': 'Material fact: activation capture integrity is unproven. scenario: malformed-capture-cannot-authorize-dispatch.',
  'activation.capture.mismatch': 'Material fact: capture does not bind this activation. scenario: mismatched-capture-blocks-reuse.',
  'activation.grant.malformed': 'Material fact: grant encoding cannot prove operator intent. scenario: malformed-grant-rejects-activation.',
  'activation.grant.unauthenticated': 'Material fact: no authenticated grant attests the scope. scenario: unsigned-grant-never-authorizes.',
  'activation.grant.revoked': 'Material fact: prior operator authorization was withdrawn. scenario: revoked-grant-cannot-be-replayed.',
  'activation.grant.repository_mismatch': 'Material fact: grant names another repository. scenario: cross-repository-grant-is-refused.',
  'activation.grant.out_of_scope': 'Material fact: requested work lies outside confirmed scope. scenario: out-of-scope-task-needs-operator-decision.',
  'activation.binding.malformed': 'Material fact: activation binding integrity is unproven. scenario: malformed-binding-rejects-transition.',
  'activation.binding.unauthenticated': 'Material fact: binding lacks authenticated authority. scenario: unsigned-binding-cannot-start-role.',
  'activation.binding.mismatch': 'Material fact: binding does not match current authorized scope. scenario: scope-expansion-binding-is-refused.',
  'activation.binding.task_mismatch': 'Material fact: binding names a different task. scenario: task-mismatch-binding-blocks-start.',
  'activation.binding.repository_mismatch': 'Material fact: binding names a different repository. scenario: repository-mismatch-binding-blocks-start.',
  'activation.binding.stale_contract': 'Material fact: protected task contract changed after binding. scenario: changed-contract-needs-renewed-authorization.',
  'activation.assurance.insufficient': 'Material fact: requested assurance exceeds the operator-approved grade. scenario: insufficient-assurance-needs-human-decision.',
  'activation.identity.conflict': 'Material fact: authority identities conflict. scenario: conflicting-authorities-require-selection.',
  'task.contract.malformed': 'Material fact: protected task contract cannot be parsed exactly. scenario: malformed-contract-cannot-dispatch.',
  'task.contract.absent': 'Material fact: no task contract declares intent. scenario: absent-contract-blocks-work.',
  'scope.declaration.missing': 'Material fact: task scope was never declared. scenario: missing-scope-needs-human-declaration.',
  'scope.declaration.duplicate': 'Material fact: competing scope declarations make intent ambiguous. scenario: duplicate-scope-needs-resolution.',
  'scope.declaration.invalid': 'Material fact: declared scope is ambiguous or invalid. scenario: invalid-scope-needs-human-repair.',
  'scope.intended_creation.missing': 'Material fact: creation intent is absent. scenario: undeclared-new-path-needs-approval.',
  'scope.intended_creation.uncovered': 'Material fact: a creation lies outside declared coverage. scenario: uncovered-creation-needs-approval.',
  'scope.intent.invalid': 'Material fact: path intent cannot delimit authorized work. scenario: invalid-path-intent-is-refused.',
  'generated.path.invalid': 'Material fact: generated-path intent is ambiguous. scenario: invalid-generated-path-needs-decision.',
  'scope.glob.unmatched': 'Material fact: scope glob cannot prove intended paths. scenario: unmatched-scope-glob-needs-confirmation.',
  'scope.deviation.missing': 'Material fact: an observed deviation lacks authorization. scenario: undeclared-deviation-blocks-transition.',
  'scope.deviation.malformed': 'Material fact: deviation record cannot prove its exception. scenario: malformed-deviation-needs-repair.',
  'contract.baseline.invalid': 'Material fact: contract baseline cannot prove protected history. scenario: invalid-baseline-blocks-reconciliation.',
  'contract.baseline.stale': 'Material fact: baseline no longer matches protected contract. scenario: stale-baseline-blocks-dispatch.',
  'task.body.utf8': 'Material fact: task body encoding is not trustworthy. scenario: invalid-utf8-task-body-is-refused.',
  'task.body.identity': 'Material fact: task record identity differs from its carrier. scenario: task-body-identity-mismatch-blocks-use.',
  'task.body.invalid': 'Material fact: task record integrity is unproven. scenario: invalid-task-body-cannot-authorize.',
  'task.body.attribution': 'Material fact: task attribution is invalid. scenario: invalid-attribution-blocks-protected-work.',
  'evidence.negative': 'Material fact: a required-evidence guard is negative: a required check failed or closeout rejected an unsafe packet-output path. scenario: negative-required-check-or-output-guard-remains-a-guard.',
  'task.evidence.not_in_progress': 'Material fact: evidence belongs to the wrong lifecycle state. scenario: non-progress-evidence-cannot-mutate.',
  'task.evidence.lineage': 'Material fact: carrier lineage is ambiguous. scenario: ambiguous-lineage-blocks-evidence-use.',
  'task.carrier.armed': 'Material fact: another protected mutation remains unresolved. scenario: armed-carrier-prevents-concurrent-write.',
  'task.evidence.provenance_mismatch': 'Material fact: evidence is not bound to this attempt. scenario: provenance-mismatch-blocks-carrier-update.',
  'task.evidence.contract_drift': 'Material fact: evidence predates a protected contract change. scenario: contract-drift-requires-reconciliation.',
  'task.evidence.final_validation': 'Material fact: final carrier lineage is unproven. scenario: final-validation-failure-blocks-return.',
  'task.record.identity_mismatch': 'Material fact: carrier and task identities disagree. scenario: record-identity-mismatch-is-refused.',
  'task.mutation.unresolved': 'Material fact: mutation outcome is unknown. scenario: unresolved-write-cannot-be-consumed.',
  'task.evidence.product_head': 'Material fact: declared product head is not the exact candidate. scenario: wrong-product-head-blocks-return.',
  'execution_evidence.binding_mismatch': 'Material fact: execution evidence binds another check or attempt. scenario: check-binding-mismatch-is-refused.',
  'execution_evidence.lineage_mismatch': 'Material fact: execution evidence lineage is ambiguous. scenario: execution-lineage-mismatch-blocks-return.',
  'dependency.unresolved': 'Material fact: prerequisite dependency is unsatisfied. scenario: unresolved-dependency-blocks-dispatch.',
  'dispatch.attempt.budget_exhausted': 'Material fact: task policy budget is exhausted. scenario: exhausted-attempt-budget-needs-human-decision.',
  'task.lifecycle.not_dispatchable': 'Material fact: task is not in a dispatchable lifecycle state. scenario: non-dispatchable-task-cannot-start.',
  'dispatch.packet.conserved': 'Material fact: another packet is still conserved. scenario: conserved-packet-needs-complete-or-abandon.',
  'dispatch.attempt.history_rewritten': 'Material fact: attempt history attribution changed. scenario: rewritten-attempt-history-is-refused.',
  'capability.action.denied': 'Material fact: assigned role lacks the requested capability. scenario: unauthorized-role-action-is-denied.',
  'parallel_scan.inventory.incomplete': 'Material fact: concurrent ownership inventory is incomplete. scenario: incomplete-parallel-scan-blocks-dispatch.',
  'parallel_scan.decomposition.invalid': 'Material fact: parallel decomposition cannot prove exclusive ownership. scenario: invalid-parallel-decomposition-is-refused.',
  'handoff.evidence.replayed': 'Material fact: prepared dispatch packet was already consumed. scenario: replayed-packet-cannot-start-role.',
  'handoff.evidence.mismatched': 'Material fact: handoff evidence binds different identities. scenario: mismatched-handoff-cannot-authorize-transition.',
  'handoff.evidence.unauthenticated': 'Material fact: handoff evidence lacks authenticated provenance. scenario: unauthenticated-handoff-is-refused.',
  'return.assurance.insufficient': 'Material fact: return assurance is below the authorized minimum. scenario: insufficient-return-assurance-needs-decision.',
  'return.lane.implementation_absent': 'Material fact: return lane lacks reachable implementation. scenario: absent-lane-artifact-blocks-return.',
  'handoff.evidence.revalidation_failed': 'Material fact: exact stored return fails current external verification. scenario: failed-return-revalidation-remains-refused.',
  'handoff.evidence.ambiguous_return': 'Material fact: current return selection is ambiguous. scenario: competing-return-records-cannot-authorize.',
  'role_return.invalid': 'Material fact: role return integrity or provenance is invalid. scenario: invalid-role-return-cannot-be-received.',
  'role_return.producer_mismatch': 'Material fact: authenticated producer differs from dispatched role. scenario: producer-mismatch-blocks-return.',
  'attempt_return_unbound': 'Material fact: return is not bound to an attempt. scenario: unbound-return-cannot-certify-candidate.',
  'attempt_return_ambiguous': 'Material fact: return binds multiple attempts. scenario: ambiguous-attempt-binding-is-refused.',
  'attempt_return_conflict': 'Material fact: one attempt has competing returns. scenario: conflicting-attempt-returns-block-certification.',
  'attempt_terminal_conflict': 'Material fact: terminal attempt evidence conflicts. scenario: terminal-conflict-blocks-certification.',
  'blocked_result.owner_mismatch': 'Material fact: blocked result owner differs from producer. scenario: owner-mismatch-cannot-resume.',
  'blocked_result.redelegation_required': 'Material fact: recovery lacks redelegation authority. scenario: missing-redelegation-blocks-recovery.',
  'blocked_result.redelegation_untrusted': 'Material fact: redelegation authority is untrusted. scenario: untrusted-redelegation-is-refused.',
  'human_disposition.required': 'Material fact: protected recovery requires a human decision. scenario: missing-human-disposition-blocks-recovery.',
  'human_disposition.untrusted': 'Material fact: human disposition provenance is untrusted. scenario: untrusted-human-disposition-is-refused.',
  'attribution.work_unit': 'Material fact: work-unit task-set attribution does not bind this shared artifact. scenario: work-unit-mismatch-is-refused; test/attribution-refusal-family.test.js.',
  'attribution.trailer': 'Material fact: final commit trailers do not bind this task. scenario: task-trailer-mismatch-is-refused; test/attribution-refusal-family.test.js.',
  'attribution.role': 'Material fact: the requested commit-attribution role is invalid or not lowercase. scenario: code-disjointness-separates-requested-role-validity-from-final-agent-trailer; test/attribution-refusal-family.test.js.',
  'preflight.attribution': 'Material fact: PR and head commit attribution claims conflict. scenario: github-role-conflict-is-refused; test/attribution-refusal-family.test.js.',
  'review_prepare.workspace': 'Material fact: review workspace does not resolve to the exact candidate head. scenario: mismatched-review-workspace-is-refused; test/review-preparation-contract.test.js.',
  'review_prepare.preflight_failed': 'Material fact: refetched candidate preflight fails. scenario: fresh-preflight-failure-is-not-reported-as-head-drift; test/review-preparation-contract.test.js.',
  'review_prepare.independent_review_policy': 'Material fact: refetched independent-review policy is invalid. scenario: invalid-independent-review-policy-has-its-own-review-prepare-code; test/review-preparation-contract.test.js.',
  'review_prepare.packet': 'Material fact: review packet shape or receipt bindings are not canonical. scenario: fabricated-review-packet-is-refused; test/review-authority-adversarial.test.js.',
  'ready.preflight': 'Material fact: exact-candidate preflight evidence fails. scenario: failed-preflight-blocks-github-ready; test/github-ready.test.js.',
  'ready.review_audit': 'Material fact: independent review audit is not current and valid for the candidate. scenario: stale-review-audit-blocks-github-ready; test/github-ready.test.js.',
  'ready.task_identity': 'Material fact: linked issue does not uniquely carry its task identity. scenario: nonunique-task-identity-blocks-github-ready; test/github-ready.test.js.',
  'ready.cross_gate_identity': 'Material fact: preflight and audit resolve different candidate identities. scenario: cross-gate-identity-mismatch-blocks-github-ready; test/github-ready.test.js.',
  'review_audit.task_contract': 'Material fact: linked task contract cannot establish its independent-review requirement. scenario: conflicting-independent-review-contract-is-refused; test/github-review-audit.test.js.',
  'review_audit.failure': 'Material fact: no authenticated valid current-head review outcome exists. scenario: invalid-review-marker-is-refused; test/github-review-audit.test.js.',
  'preflight.review_checkpoint': 'Material fact: no fresh valid checkpoint authorizes this review round. scenario: consumed-valid-checkpoint-requires-fresh-human-authority; F6 executable probe preflight-review-checkpoint.',
  'preflight.review_history_invalid': 'Material fact: review history or carrier is fabricated, inconsistent, or malformed. scenario: fabricated-review-history-has-integrity-code-not-human-checkpoint; test/github-preflight.test.js.',
  'preflight.revision_resolution': 'Material fact: prior required finding IDs lack canonical current-artifact resolution. scenario: unresolved-prior-findings-block-rereview; test/review-provenance.test.js.',
  'review.entry.fixup_invalid': 'Material fact: Maintainer Review Fixup disclosure is malformed. scenario: malformed-fixup-cannot-prepare-review-entry; test/task-cli.test.js.',
  'review.entry.persistence_conflict': 'Material fact: persisted review-entry receipt conflicts with the recognized verified return. scenario: conflicting-review-entry-persistence-is-refused; test/task-cli.test.js.',
  'worktree.clean_gate.failed': 'Material fact: the exact dispatch workspace is dirty, unreadable, or does not bind the canonical clean-state identity. scenario: dirty-workspace-cannot-enter-dispatch; F7 executable probe dispatch-clean-worktree.',
  'projection.state.unexplained': 'Material fact: a current authority-sensitive projection reports unexplained drift. scenario: unexplained-drift-cannot-certify-projection; F7 executable probe projection-unexplained-drift.',
  'projection.fact.contradiction': 'Material fact: current authoritative projection carriers disagree about one canonical fact. scenario: contradictory-authoritative-projections-cannot-certify; F8 executable probe projection-authoritative-contradiction.',
});

export const HARD_REFUSAL_ALLOWLIST = Object.freeze([
  ...catalog.filter(entry => ['retained_hard_refusal', 'material_human_decision'].includes(entry.refusalClass)).map(({ code }) => {
    const { factOwner, rationale, repairClass } = REFUSAL_CLASSES[code];
    return Object.freeze({
      code, factOwner, rationale, repairClass,
      negativeProof: NEGATIVE_PROOF_BY_CODE[code],
    });
  }),
]);

/** Codes preserved for historical compatibility but no longer emitted by runtime producers. */
export const HISTORICAL_PRODUCER_EXCEPTIONS = Object.freeze({
  'scope.existing_path.missing': 'internal compatibility evaluator has no supported public claim',
  'preflight.review_provenance': 'public preflight compatibility categorizer has no dedicated producer',
});

export function refusalClassFor(code) {
  const entry = REFUSAL_CLASSES[code];
  if (!entry) throw new Error(`diagnostic code lacks refusal classification: ${code}`);
  return entry;
}

/** Validate a catalog copy as well as the canonical frozen catalog. */
export function assertRefusalClassCatalog({
  policy = null,
  classifications = REFUSAL_CLASSES,
  allowlist = HARD_REFUSAL_ALLOWLIST,
} = {}) {
  const resolvedPolicy = policy ?? repairPolicyViewFor(classifications);
  const policyCodes = Object.keys(resolvedPolicy).sort();
  const classificationCodes = Object.keys(classifications).sort();
  if (classificationCodes.length !== EXPECTED_CATALOG_ROW_COUNT) {
    throw new Error(`refusal catalog row count changed: expected ${EXPECTED_CATALOG_ROW_COUNT}, received ${classificationCodes.length}`);
  }
  const familyCounts = Object.fromEntries(
    Object.entries(classifications).reduce((counts, [, entry]) => {
      counts.set(entry.family, (counts.get(entry.family) ?? 0) + 1);
      return counts;
    }, new Map()).entries(),
  );
  if (JSON.stringify(familyCounts) !== JSON.stringify(EXPECTED_CATALOG_FAMILY_COUNTS)) {
    throw new Error(`refusal catalog family counts changed: expected ${JSON.stringify(EXPECTED_CATALOG_FAMILY_COUNTS)}, received ${JSON.stringify(familyCounts)}`);
  }
  if (JSON.stringify(policyCodes) !== JSON.stringify(classificationCodes)) {
    throw new Error('registered diagnostic codes and refusal classifications differ');
  }
  const allowlisted = new Set();
  const negativeProofs = new Set();
  const executableProof = /(?:\btest\/[a-z0-9_./-]+\.test\.[cm]?js\b|\bF[5-8] executable probe\b)/i;
  const preciseDisposition = /^disposition: [a-z][a-z0-9-]*; \S.+/;
  for (const entry of allowlist) {
    if (!entry || typeof entry.code !== 'string' || !Object.hasOwn(resolvedPolicy, entry.code)) {
      throw new Error(`hard-refusal allowlist has no registered diagnostic: ${entry?.code ?? '<missing>'}`);
    }
    if (allowlisted.has(entry.code)) throw new Error(`hard-refusal allowlist has duplicate diagnostic: ${entry.code}`);
    if (!entry.factOwner || !entry.rationale || !entry.repairClass || !entry.negativeProof) {
      throw new Error(`hard-refusal allowlist lacks metadata: ${entry.code}`);
    }
    if (!/(?:scenario|fixture):\s*\S|\b[a-z0-9_-]+\.test\.[cm]?js\b/i.test(entry.negativeProof)) {
      throw new Error(`hard-refusal allowlist negative proof lacks an adversarial scenario: ${entry.code}`);
    }
    if (negativeProofs.has(entry.negativeProof)) {
      throw new Error(`hard-refusal allowlist has duplicate negative proof: ${entry.code}`);
    }
    negativeProofs.add(entry.negativeProof);
    allowlisted.add(entry.code);
  }
  for (const [code, entry] of Object.entries(classifications)) {
    if (!REFUSAL_DISPOSITIONS.includes(entry.refusalClass)) {
      throw new Error(`diagnostic has unknown refusal disposition: ${code}`);
    }
    if (!entry.repairPolicy || entry.repairPolicy !== resolvedPolicy[code]) {
      throw new Error(`diagnostic definition lacks its registered repair policy: ${code}`);
    }
    const accepted = ACCEPTED_REFUSAL_FAMILIES.includes(entry.family);
    if (accepted && entry.refusalClass === PENDING_CLASSIFICATION) {
      throw new Error(`accepted family has pending classification: ${code}`);
    }
    if (accepted && (!Array.isArray(entry.producers) && !HISTORICAL_PRODUCER_EXCEPTIONS[code])) {
      throw new Error(`accepted diagnostic lacks producers: ${code}`);
    }
    if (entry.consumers !== undefined && (!Array.isArray(entry.consumers) || entry.consumers.length === 0 ||
      entry.consumers.some(consumer => typeof consumer !== 'string' || !consumer))) {
      throw new Error(`diagnostic has invalid consumers: ${code}`);
    }
    if (!entry.derivedNarrative?.semanticInvalidator || !entry.derivedNarrative?.description) {
      throw new Error(`diagnostic lacks derived classification metadata: ${code}`);
    }
    if (entry.semanticEvidence !== undefined &&
      (typeof entry.semanticEvidence !== 'string' ||
       (!executableProof.test(entry.semanticEvidence) && !preciseDisposition.test(entry.semanticEvidence)))) {
      throw new Error(`diagnostic semantic evidence lacks an executable reference or precise disposition: ${code}`);
    }
    const hard = ['retained_hard_refusal', 'material_human_decision'].includes(entry.refusalClass);
    if (hard !== allowlisted.has(code)) {
      throw new Error(`hard-refusal allowlist is not exhaustive for diagnostic: ${code}`);
    }
  }
  return true;
}

/**
 * Execute whole-catalog checks explicitly.  Production imports deliberately
 * only construct projections so unrelated commands remain available while a
 * development catalog is being repaired.
 */
export function validateCatalog(entries = catalog, options = {}) {
  const byCode = new Map();
  for (const entry of entries) {
    if (byCode.has(entry.code)) throw new Error(`duplicate refusal classification: ${entry.code}`);
    byCode.set(entry.code, entry);
  }
  return assertRefusalClassCatalog({
    ...options,
    classifications: options.classifications ?? Object.fromEntries(byCode),
  });
}
