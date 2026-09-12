/** Real, synthetic F8 refusal probes. Each callable reaches its named public
 * production path and returns that path's actual result/diagnostics. */
import { createProjectionObservation, reconcileProjections } from '../../src/projection-reconciliation.js';
import { TRANSITION_FACTS } from '../../src/transition-contract.js';

const OBSERVED_AT = '2026-09-05T00:00:00.000Z';
const VALUES = Object.freeze({
  contract_readiness: { readiness: 'agent-ready', contractDigest: `sha256:v1:${'a'.repeat(64)}` },
  runtime_blocked_state: { blocked: false, transitionId: null, blockerRef: null },
  task_lifecycle_status: { status: 'in-progress', terminal: false },
  labels: { names: ['status:in-progress'] },
  comments: { recordType: 'agenticloop.review-checkpoint', artifactRef: 'commit:aaa' },
  review_readiness: { ready: false, reviewedArtifact: null },
  review_verdict: { verdict: 'pending', reviewedArtifact: null },
  audit_state: { auditId: null, certifiedArtifact: null },
  terminal_closeout: { closedOut: false, coveredTaskId: 'T-001', gateDigest: null },
});

function projectionCoverage() {
  return TRANSITION_FACTS.filter(fact => fact.carriers.github.applicable === true).map(fact => createProjectionObservation({
    factId: fact.factId,
    backend: 'github',
    carrier: { applicability: 'applicable', identity: `github-carrier:${fact.factId}` },
    value: VALUES[fact.factId],
    authority: { producer: { ...fact.producer }, persister: { ...fact.persister }, typedRecord: true, artifactBinding: 'T-001' },
    evidenceState: 'current', observedAt: OBSERVED_AT,
    invalidatedBy: ['task_record_digest'], stateProvenance: 'workflow_state',
  }));
}

const PROBES = Object.freeze({
  'projection-authoritative-contradiction': async () => {
    const observations = projectionCoverage();
    const original = observations.find(item => item.factId === 'audit_state');
    observations.push(createProjectionObservation({
      ...original,
      carrier: { ...original.carrier, identity: 'github-carrier:audit-state-conflict' },
      value: { auditId: 'conflicting-audit', certifiedArtifact: null },
    }));
    return reconcileProjections({ backend: 'github', observations }).result;
  },
});

export const F8_EXECUTABLE_PROBE_IDS = Object.freeze(Object.keys(PROBES));

export async function runF8ExecutableProbe(probeId) {
  const probe = PROBES[probeId];
  if (!probe) throw new Error(`unknown F8 executable probe '${probeId}'`);
  const result = await probe();
  return { probeId, result, diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : [] };
}
