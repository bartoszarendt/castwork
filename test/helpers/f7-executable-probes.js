/** Real, synthetic F7 refusal probes. Each callable reaches its named public
 * production path and returns that path's actual result/diagnostics. */
import { evaluateDispatchCleanState } from '../../src/repository-state.js';
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
  'dispatch-clean-worktree': async () => {
    const result = evaluateDispatchCleanState({
      runGit: args => ({ status: 0, stdout: args[0] === 'diff' && args[1] === '--cached' ? 'src/unclaimed.js\n' : '' }),
      scopePatterns: ['src/**'],
    });
    return { diagnostics: result.findings };
  },
  'projection-unexplained-drift': async () => {
    const observations = projectionCoverage();
    const index = observations.findIndex(item => item.factId === 'audit_state');
    observations[index] = createProjectionObservation({
      ...observations[index], stateProvenance: 'unexplained_drift',
    });
    return reconcileProjections({ backend: 'github', observations }).result;
  },
});

export const F7_EXECUTABLE_PROBE_IDS = Object.freeze(Object.keys(PROBES));

export async function runF7ExecutableProbe(probeId) {
  const probe = PROBES[probeId];
  if (!probe) throw new Error(`unknown F7 executable probe '${probeId}'`);
  const result = await probe();
  return { probeId, result, diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : [] };
}
