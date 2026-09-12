/**
 * Stable bindings for F6 material-boundary probes. Probe implementations live
 * in the test helper and execute real production paths; this registry contains
 * no source, test-title, or function-name evidence.
 */
export const F6_EXECUTABLE_PROOF_REGISTRY = Object.freeze([
  { code: 'review_prepare.workspace', probeId: 'review-prepare-workspace', factOwner: 'review_workspace' },
  { code: 'review_prepare.packet', probeId: 'review-prepare-packet', factOwner: 'review_entry_packet' },
  { code: 'review_prepare.preflight_failed', probeId: 'review-prepare-preflight-failure', factOwner: 'candidate_evidence' },
  { code: 'review_prepare.independent_review_policy', probeId: 'review-prepare-policy', factOwner: 'review_policy' },
  { code: 'ready.preflight', probeId: 'github-ready-preflight', factOwner: 'candidate_evidence' },
  { code: 'ready.review_audit', probeId: 'github-ready-review-audit', factOwner: 'review_provenance' },
  { code: 'ready.task_identity', probeId: 'github-ready-task-identity', factOwner: 'task_identity' },
  { code: 'ready.cross_gate_identity', probeId: 'github-ready-cross-gate', factOwner: 'candidate_certification' },
  { code: 'review_audit.task_contract', probeId: 'review-audit-task-contract', factOwner: 'review_contract' },
  { code: 'review_audit.failure', probeId: 'review-audit-provenance', factOwner: 'review_provenance' },
  { code: 'preflight.review_checkpoint', probeId: 'preflight-review-checkpoint', factOwner: 'review_authority' },
  { code: 'preflight.review_history_invalid', probeId: 'preflight-review-history', factOwner: 'review_history' },
  { code: 'preflight.revision_resolution', probeId: 'preflight-revision-resolution', factOwner: 'review_findings' },
  { code: 'review.entry.fixup_invalid', probeId: 'review-entry-fixup', factOwner: 'review_fixup' },
  { code: 'review.entry.persistence_conflict', probeId: 'review-entry-persistence-conflict', factOwner: 'review_entry_receipt' },
]);
