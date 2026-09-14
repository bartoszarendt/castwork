import { REFUSAL_CLASSES } from '../../src/refusal-classes.js';

const F6_BINDINGS = Object.freeze([
  ['review_prepare.workspace', 'review-prepare-workspace'],
  ['review_prepare.packet', 'review-prepare-packet'],
  ['review_prepare.preflight_failed', 'review-prepare-preflight-failure'],
  ['review_prepare.independent_review_policy', 'review-prepare-policy'],
  ['ready.preflight', 'github-ready-preflight'],
  ['ready.review_audit', 'github-ready-review-audit'],
  ['ready.task_identity', 'github-ready-task-identity'],
  ['ready.cross_gate_identity', 'github-ready-cross-gate'],
  ['review_audit.task_contract', 'review-audit-task-contract'],
  ['review_audit.failure', 'review-audit-provenance'],
  ['preflight.review_checkpoint', 'preflight-review-checkpoint'],
  ['preflight.review_history_invalid', 'preflight-review-history'],
  ['preflight.revision_resolution', 'preflight-revision-resolution'],
  ['review.entry.fixup_invalid', 'review-entry-fixup'],
  ['review.entry.persistence_conflict', 'review-entry-persistence-conflict'],
]);

function bindings(entries, definitions = REFUSAL_CLASSES) {
  return Object.freeze(entries.map(([code, probeId]) => Object.freeze({
    code,
    probeId,
    factOwner: definitions[code].factOwner,
  })));
}

export const f6DiagnosticProofBindingsFor = (definitions = REFUSAL_CLASSES) =>
  bindings(F6_BINDINGS, definitions);
export const F6_DIAGNOSTIC_PROOF_BINDINGS = f6DiagnosticProofBindingsFor();
export const F7_DIAGNOSTIC_PROOF_BINDINGS = bindings([
  ['worktree.clean_gate.failed', 'dispatch-clean-worktree'],
  ['projection.state.unexplained', 'projection-unexplained-drift'],
]);
export const F8_DIAGNOSTIC_PROOF_BINDINGS = bindings([
  ['projection.fact.contradiction', 'projection-authoritative-contradiction'],
]);
