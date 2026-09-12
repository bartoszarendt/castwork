import { REFUSAL_CLASSES } from './refusal-classes.js';

/**
 * Stable bindings for F6 material-boundary probes. Probe implementations live
 * in the test helper and execute real production paths; this registry contains
 * no source, test-title, or function-name evidence.
 */
const F6_PROBE_BINDINGS = Object.freeze([
  { code: 'review_prepare.workspace', probeId: 'review-prepare-workspace' },
  { code: 'review_prepare.packet', probeId: 'review-prepare-packet' },
  { code: 'review_prepare.preflight_failed', probeId: 'review-prepare-preflight-failure' },
  { code: 'review_prepare.independent_review_policy', probeId: 'review-prepare-policy' },
  { code: 'ready.preflight', probeId: 'github-ready-preflight' },
  { code: 'ready.review_audit', probeId: 'github-ready-review-audit' },
  { code: 'ready.task_identity', probeId: 'github-ready-task-identity' },
  { code: 'ready.cross_gate_identity', probeId: 'github-ready-cross-gate' },
  { code: 'review_audit.task_contract', probeId: 'review-audit-task-contract' },
  { code: 'review_audit.failure', probeId: 'review-audit-provenance' },
  { code: 'preflight.review_checkpoint', probeId: 'preflight-review-checkpoint' },
  { code: 'preflight.review_history_invalid', probeId: 'preflight-review-history' },
  { code: 'preflight.revision_resolution', probeId: 'preflight-revision-resolution' },
  { code: 'review.entry.fixup_invalid', probeId: 'review-entry-fixup' },
  { code: 'review.entry.persistence_conflict', probeId: 'review-entry-persistence-conflict' },
]);

// Probe IDs select test adapters only. The catalog remains the sole owner of
// each code's fact owner and refusal classification.
export function f6ExecutableProofRegistryFor(definitions = REFUSAL_CLASSES) {
  return Object.freeze(F6_PROBE_BINDINGS.map(({ code, probeId }) =>
    Object.freeze({ code, probeId, factOwner: definitions[code].factOwner })
  ));
}

export const F6_EXECUTABLE_PROOF_REGISTRY = f6ExecutableProofRegistryFor();
