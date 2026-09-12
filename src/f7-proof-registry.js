/** Stable bindings for F7 material-boundary probes. Implementations execute
 * production paths in the test helper; this registry is not proof by itself. */
export const F7_EXECUTABLE_PROOF_REGISTRY = Object.freeze([
  { code: 'worktree.clean_gate.failed', probeId: 'dispatch-clean-worktree', factOwner: 'dispatch_workspace' },
  { code: 'projection.state.unexplained', probeId: 'projection-unexplained-drift', factOwner: 'projection_provenance' },
]);
