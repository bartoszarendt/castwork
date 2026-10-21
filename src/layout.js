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

/** This machine's choice of models and reasoning: configuration, kept with the machine's other state. */
export const LOCAL_CONFIG_FILE = `${LOCAL_DIRECTORY}/castwork.json`;

/** The digests of generated files this machine wrote from `.castwork/local/castwork.json`. */
export const LOCAL_MANIFEST = `${LOCAL_DIRECTORY}/generated.json`;

export const TASKS_DIRECTORY = `${STATE_DIRECTORY}/tasks`;
/** An archive pairs with the same basename's task; never a task itself. */
export const ARCHIVE_SUFFIX = '.archive.md';
export const DECISIONS_DIRECTORY = `${STATE_DIRECTORY}/decisions`;
/** Notes about the work and the files records link: never parsed, never the work itself. */
export const FINDINGS_DIRECTORY = `${STATE_DIRECTORY}/findings`;
/** Reviews of how work went, read when later work is planned: never parsed. */
export const REVIEWS_DIRECTORY = `${STATE_DIRECTORY}/reviews`;
/** What runs produce and no record needs to keep: machine-local, with the rest of `local/`. */
export const RUNS_DIRECTORY = `${LOCAL_DIRECTORY}/runs`;
export const PROJECT_FILE = `${STATE_DIRECTORY}/project.md`;

/** Never deleted by `remove`. */
export const USER_OWNED = Object.freeze([PROJECT_FILE, TASKS_DIRECTORY, DECISIONS_DIRECTORY, FINDINGS_DIRECTORY, REVIEWS_DIRECTORY]);

/**
 * Paths a snapshot leaves out: the records that describe it, the findings
 * they link to, which a verifier writes after the candidate exists, reviews of
 * how the work went, and machine-local state, run output included.
 */
export const SNAPSHOT_EXCLUDES = Object.freeze([TASKS_DIRECTORY, FINDINGS_DIRECTORY, REVIEWS_DIRECTORY, LOCAL_DIRECTORY]);

/**
 * Supported host ids.
 *
 * Each is the host's own command name — `codex`, `claude`, `opencode`, `pi` — which
 * is what a user types and the one spelling per concept the project keeps.
 */
export const HOSTS = Object.freeze(['codex', 'claude', 'opencode', 'pi']);
