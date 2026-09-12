/** Shared read-only lifecycle fact/verdict projection boundary. */

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Preserve an evaluator result without interpreting it as a transition grant.
 * Evaluators, not this presentation seam, own facts, owners, codes, and verdicts.
 */
export function createReadOnlyLifecycleProjection({ task, actions }) {
  if (!plainObject(task)) throw new TypeError('read-only lifecycle projection requires a task fact object');
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new TypeError('read-only lifecycle projection requires one or more action projections');
  }
  for (const action of actions) {
    if (!plainObject(action) || typeof action.verdict !== 'string') {
      throw new TypeError('read-only lifecycle action must preserve the shared fact/verdict shape');
    }
  }
  return Object.freeze({
    derived: true,
    persisted: false,
    authority: 'none',
    task: Object.freeze({ ...task }),
    actions: Object.freeze([...actions]),
  });
}
