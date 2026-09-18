/**
 * Where things live. Two sibling directories differing only by a leading dot:
 * `agenticloop/` is toolkit-owned and read-only, `.agenticloop/` belongs to the
 * target project.
 */

import path from 'node:path';

export const LAYOUT_VERSION = 4;

/** Toolkit-owned, installed into the target. */
export const TOOLKIT_DIRECTORY = 'agenticloop';

/** Target-owned records and state. */
export const STATE_DIRECTORY = '.agenticloop';

/** Machine configuration, at the target root and nowhere else. */
export const CONFIG_FILE = 'agenticloop.json';

/** The tracked ownership manifest. */
export const GENERATED_MANIFEST = `${STATE_DIRECTORY}/generated.json`;

/** Gitignored machine-specific state. */
export const LOCAL_DIRECTORY = `${STATE_DIRECTORY}/local`;

export const TASKS_DIRECTORY = `${STATE_DIRECTORY}/tasks`;
export const DECISIONS_DIRECTORY = `${STATE_DIRECTORY}/decisions`;
export const PROJECT_FILE = `${STATE_DIRECTORY}/project.md`;

/** Never deleted by `remove`. */
export const USER_OWNED = Object.freeze([PROJECT_FILE, TASKS_DIRECTORY, DECISIONS_DIRECTORY]);

/** Directory names a 0.4.x installation leaves behind. */
export const LEGACY_STATE_DIRECTORIES = Object.freeze([
  'activation',
  'activations',
  'audits',
  'checks',
  'handoffs',
  'improvements',
  'logs',
  'operator-activation',
  'returns',
  'reviews',
  'summaries',
  'task-contract-history',
  'worktrees',
]);

/** @param {string} root @param {string} relative */
export function resolve(root, relative) {
  return path.join(root, relative);
}

export const HOSTS = Object.freeze(['codex', 'claude-code', 'opencode']);
