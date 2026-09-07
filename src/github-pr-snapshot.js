/**
 * Completeness checks for PR lists returned by `gh pr view --json`.
 *
 * gh 2.46.0 requests the `files` and `commits` GraphQL connections with
 * `first: 100`, without returning a total count or page information. A list at
 * that limit is therefore ambiguous: it may be complete, or it may omit a
 * product path or commit. Newer gh versions may expose different fields, but
 * this command cannot assume they make the legacy list complete.
 */

export const GH_PR_VIEW_CONNECTION_LIMIT = 100;

const ENUMERATED_FIELDS = Object.freeze(['files', 'commits']);

/**
 * Determine whether a `gh pr view --json files,commits` response proves that
 * both enumerated connections are complete. The result is deliberately small
 * and serializable so every certification boundary can render its own typed
 * diagnostic without treating an incomplete snapshot as data.
 *
 * @param {any} prData
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function githubPrSnapshotCompleteness(prData) {
  /** @type {string[]} */
  const errors = [];
  for (const field of ENUMERATED_FIELDS) {
    const inventory = prData?.[field];
    if (!Array.isArray(inventory)) {
      errors.push(`GitHub PR ${field} inventory is unavailable; cannot establish completeness`);
    } else if (inventory.length >= GH_PR_VIEW_CONNECTION_LIMIT) {
      errors.push(
        `GitHub PR ${field} inventory has ${inventory.length} entries, at or beyond the unpaginated gh pr view limit ` +
        `(${GH_PR_VIEW_CONNECTION_LIMIT}); cannot establish completeness`
      );
    }
  }
  return { ok: errors.length === 0, errors };
}
