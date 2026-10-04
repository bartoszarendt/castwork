/**
 * Where things live.
 *
 * `.castwork/` belongs to the target project. There is no sibling
 * `castwork/`: the toolkit's own sources are not copied into a target, they
 * are projected into each selected host's directories, and what was written is
 * recorded in `generated.json`.
 */

export const LAYOUT_VERSION = 4;

/** Target-owned records and state. */
export const STATE_DIRECTORY = '.castwork';

/** Project configuration, at the target root and nowhere else. */
export const CONFIG_FILE = 'castwork.json';

/** The tracked ownership manifest. */
export const GENERATED_MANIFEST = `${STATE_DIRECTORY}/generated.json`;

/** Gitignored machine-specific state. */
export const LOCAL_DIRECTORY = `${STATE_DIRECTORY}/local`;

export const TASKS_DIRECTORY = `${STATE_DIRECTORY}/tasks`;
export const DECISIONS_DIRECTORY = `${STATE_DIRECTORY}/decisions`;
export const PROJECT_FILE = `${STATE_DIRECTORY}/project.md`;

/** Never deleted by `remove`. */
export const USER_OWNED = Object.freeze([PROJECT_FILE, TASKS_DIRECTORY, DECISIONS_DIRECTORY]);

/**
 * Supported host ids.
 *
 * Each is the host's own command name — `codex`, `claude`, `opencode` — which
 * is what a user types and the one spelling per concept the project keeps.
 */
export const HOSTS = Object.freeze(['codex', 'claude', 'opencode']);
