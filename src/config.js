/**
 * Project configuration.
 *
 * It lives in `castwork.json` at the target root. `.castwork/project.md` owns
 * prose only. Everything `castwork.json` holds is generated into tracked
 * output, so it describes the repository and not the machine the repository
 * is checked out on. The one exception is `.castwork/local/castwork.json`,
 * gitignored with the rest of the machine's state, which changes which models
 * this machine's roles run on, and which host's CLI runs them, and nothing else.
 *
 * A role setting is a plain value passed to one host. This module decides
 * which settings a host accepts by asking that host's adapter, and never
 * interprets the values themselves: `high` means whatever the host says it
 * means, and a value this toolkit has never heard of reaches the host intact.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_FILE, HOSTS, LOCAL_CONFIG_FILE } from './layout.js';
import { PublicError } from './public-error.js';
import { installPath } from './generated.js';
import { LEVELS, PERMISSION_SETTINGS, toolkitRoot, readAdapter } from './adapter-generation.js';
import { ROLE_IDS } from './record.js';

/** Shipped defaults. */
export function defaults() {
  return JSON.parse(fs.readFileSync(path.join(toolkitRoot(), 'config.json'), 'utf8'));
}

/** The settings one host accepts, in the spelling `castwork.json` uses. */
export function settingsFor(host) {
  return Object.keys(/** @type {Record<string, string>} */ (readAdapter(host).role_frontmatter ?? {}));
}

/**
 * A setting's value, or a refusal.
 *
 * Values reach the host as written, so they have to be scalars a host file can
 * carry. An object or a list would otherwise be stringified into nonsense —
 * `[object Object]` — inside a generated file. `null` is the one way to say
 * "leave this unset", which is how a shipped default is cleared.
 *
 * @param {unknown} value
 * @param {string} where
 */
function settingValue(value, where) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new PublicError(`${where} must be a string`, {
      hint: 'A setting is passed to the host as written. Use null to leave it unset.',
    });
  }
  if (value === '') {
    throw new PublicError(`${where} is empty`, { hint: 'Use null to leave a setting unset.' });
  }
  return value;
}

/**
 * What to do instead of the retired unified `reasoning_effort`, per host. It
 * is refused like any other undeclared setting; this only makes the refusal
 * say where the setting went.
 */
const RETIRED_EFFORT = Object.freeze({
  pi: 'reasoning_effort was retired: remove it and write thinking as a model suffix, for example provider/id:high.',
  claude: 'reasoning_effort was retired: rename it to effort.',
  codex: 'reasoning_effort was retired: rename it to model_reasoning_effort.',
  opencode: 'reasoning_effort was retired: remove it, and choose a variant the model supports beside an explicit model. A variant is not an effort level.',
});

/**
 * The problem with one role's resolved OpenCode settings, or null.
 *
 * OpenCode v1 and v2 both read the shared agent format, but only as a separate
 * `model` and `variant`: v1 takes `provider/model#high` for a literal model id,
 * v2 drops it, and v2 drops a `variant` whose agent names no model. Both would
 * leave the role on settings nobody chose, without an error.
 *
 * @param {string} host
 * @param {Record<string, unknown>} settings shipped defaults merged with overrides
 * @returns {{key: string, problem: string, hint: string}|null}
 */
export function bindingProblem(host, settings) {
  if (host !== 'opencode') return null;
  const { model, variant } = settings;
  if (typeof model === 'string' && model.includes('#')) {
    return {
      key: 'model',
      problem: 'contains an inline variant',
      hint: 'Write model and variant as separate settings; the shared OpenCode agent format does not support model#variant.',
    };
  }
  if (typeof variant === 'string' && variant !== '' && (typeof model !== 'string' || model === '')) {
    return {
      key: 'variant',
      problem: 'is set without a model',
      hint: 'A variant belongs to a model: set model as provider/model beside it. OpenCode v2 drops a variant whose agent names no model.',
    };
  }
  return null;
}

/**
 * Read `role_settings`, refusing anything that would otherwise be ignored in
 * silence: an unknown host, an unknown role, a setting the named host has no
 * way to express, or a value that cannot survive the trip into a host file.
 * Settings for a host that is known but not selected are checked and then left
 * unapplied.
 *
 * `shared` is given when reading `.castwork/local/castwork.json`: its settings are
 * checked over the project's own, and it chooses models only, so a permission
 * stays the project's.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} [file] the file `raw` came from, as messages name it
 * @param {Record<string, Record<string, Record<string, unknown>>>|null} [shared] the project's own overrides
 * @returns {Record<string, Record<string, Record<string, unknown>>>}
 */
function readRoleSettings(raw, file = CONFIG_FILE, shared = null) {
  const declared = raw.role_settings;
  if (declared === undefined) return {};
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${file} role_settings must be a map of host to role to settings`);
  }

  /** @type {Record<string, Record<string, Record<string, unknown>>>} */
  const byHost = {};
  for (const [host, roles] of Object.entries(declared)) {
    if (!HOSTS.includes(host)) {
      throw new PublicError(`${file} role_settings names unknown host ${host}`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) {
      throw new PublicError(`${file} role_settings.${host} must be a map of role to settings`);
    }
    const accepted = settingsFor(host);
    const hostDefaults = defaults()?.adapters?.[host]?.role_settings ?? {};
    /** @type {Record<string, Record<string, unknown>>} */
    const byRole = {};
    for (const [role, settings] of Object.entries(roles)) {
      if (!ROLE_IDS.includes(role)) {
        throw new PublicError(`${file} role_settings.${host} names unknown role ${role}`, {
          hint: `Known roles: ${ROLE_IDS.join(', ')}.`,
        });
      }
      if (role === 'coordinator') {
        throw new PublicError(`${file} role_settings.${host} cannot configure the coordinator`, {
          hint: `The coordinator is the session you invoke Castwork in, which runs on the host's own settings. Remove role_settings.${host}.coordinator; settings apply to ${ROLE_IDS.filter((id) => id !== 'coordinator').join(', ')}.`,
        });
      }
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        throw new PublicError(`${file} role_settings.${host}.${role} must be a map of setting to value`);
      }
      /** @type {Record<string, unknown>} */
      const checked = {};
      for (const [key, value] of Object.entries(settings)) {
        if (shared !== null && PERMISSION_SETTINGS.includes(key)) {
          throw new PublicError(`${file} role_settings.${host}.${role}.${key}: ${file} chooses models only`, {
            hint: `A permission is the project's choice. Set it in ${CONFIG_FILE} role_settings.${host}.${role}.`,
          });
        }
        if (!accepted.includes(key)) {
          const retired = key === 'reasoning_effort' ? `${RETIRED_EFFORT[/** @type {keyof typeof RETIRED_EFFORT} */ (host)]} ` : '';
          throw new PublicError(`${file} role_settings.${host}.${role}.${key}: host ${host} has no setting ${key}`, {
            hint: `${retired}${host} accepts: ${accepted.join(', ')}.`,
          });
        }
        checked[key] = settingValue(value, `${file} role_settings.${host}.${role}.${key}`);
      }
      const binding = bindingProblem(host, { ...(hostDefaults[role] ?? {}), ...(shared?.[host]?.[role] ?? {}), ...checked });
      if (binding) {
        throw new PublicError(`${file} role_settings.${host}.${role}.${binding.key} ${binding.problem}`, {
          hint: `${binding.hint} Settings go under role_settings.${host}.${role}.`,
        });
      }
      byRole[role] = checked;
    }
    byHost[host] = byRole;
  }
  return byHost;
}

/** The roles a route can send to another host. The coordinator is the session that routes. */
export const ROUTABLE_ROLES = Object.freeze(ROLE_IDS.filter((role) => role !== 'coordinator'));

/**
 * Read `role_routes`: which host the project prefers each role to run in when
 * the coordinator works from another one. A route is only a host id. When that
 * host cannot run the role, the role runs in the host doing the routing, and
 * the entry command names the cases where it is left open instead; there is no
 * per-route fallback to configure.
 *
 * A route is a separate map rather than a role setting because it is not a
 * setting the target host reads: it is a choice the coordinator acts on. Model
 * and reasoning for the routed role stay in `role_settings` under the host the
 * route names. Whether the route's host is among the generated hosts is checked
 * when generating, against the host set being generated, so `setup --host` can
 * add the host a route already names.
 *
 * In `.castwork/local/castwork.json` a route may also be `null`, which drops the
 * project's route for that role, and it must name a host `castwork.json`
 * lists: a host is generated files every clone carries, so it is the
 * project's to add.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} [file] the file being read, for messages
 * @param {string[]|null} [hosts] the project's hosts, when reading the local file
 * @returns {Record<string, string|null>} role to host id, or null to drop a route
 */
function readRoleRoutes(raw, file = CONFIG_FILE, hosts = null) {
  const declared = raw.role_routes;
  if (declared === undefined) return {};
  const where = `${file} role_routes`;
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${where} must be a map of role to host`, {
      hint: 'For example: "role_routes": { "worker": "codex" }.',
    });
  }

  /** @type {Record<string, string|null>} */
  const routes = {};
  for (const [role, route] of Object.entries(declared)) {
    if (role === 'coordinator') {
      throw new PublicError(`${where} cannot route the coordinator`, {
        hint: `The coordinator is the session that routes the other roles. Routable roles: ${ROUTABLE_ROLES.join(', ')}.`,
      });
    }
    if (!ROLE_IDS.includes(role)) {
      throw new PublicError(`${where} names unknown role ${role}`, {
        hint: `Routable roles: ${ROUTABLE_ROLES.join(', ')}.`,
      });
    }
    if (route === null && hosts !== null) {
      routes[role] = null;
      continue;
    }
    if (typeof route !== 'string') {
      throw new PublicError(`${where}.${role} must be a host id`, {
        hint: `Write "${role}": "<host>"${hosts === null ? '' : ', or null to run it in the host that routes it'}. A route has no fallback: a role its host cannot run runs in the host that routes it. Model and reasoning go in role_settings.<host>.${role}.`,
      });
    }
    if (!HOSTS.includes(route)) {
      throw new PublicError(`${where}.${role} names unknown host ${route}`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
    if (hosts !== null && !hosts.includes(route)) {
      throw new PublicError(`${where}.${role} names ${route}, which ${CONFIG_FILE} does not list in hosts`, {
        hint: `A routed role reads the role file generated for its host, and a host is generated files every clone carries. Add it to the project with setup --host ${route}.`,
      });
    }
    routes[role] = route;
  }
  return routes;
}

/**
 * Read `role_levels`: per host and role, the complete model settings for a
 * `simple` or `complex` assignment. Each level becomes a variant of the role,
 * generated beside it, so the coordinator starts the one an assignment needs.
 *
 * It is a separate map rather than part of `role_settings`, which stays a
 * plain pass-through of strings into host frontmatter. A level is complete on
 * its own: it names its model, and nothing of the role's own model settings is
 * carried into it, so an effort chosen for one model never reaches another.
 * Levels for a host that is known but not selected are checked and then left
 * unapplied, as role settings are.
 *
 * `shared` is given when reading `.castwork/local/castwork.json`, which changes the
 * settings of a level the project declares and adds none: a level is a
 * variant file every clone carries. What it returns is then each named level
 * with the local settings over the project's, `null` clearing one.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} [file] the file `raw` came from, as messages name it
 * @param {Record<string, Record<string, Record<string, Record<string, unknown>>>>|null} [shared] the project's own levels
 * @returns {Record<string, Record<string, Record<string, Record<string, unknown>>>>} host, role, level, settings
 */
function readRoleLevels(raw, file = CONFIG_FILE, shared = null) {
  const declared = raw.role_levels;
  if (declared === undefined) return {};
  const where = `${file} role_levels`;
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${where} must be a map of host to role to level to settings`, {
      hint: 'For example: "role_levels": { "codex": { "worker": { "complex": { "model": "<model>" } } } }.',
    });
  }

  /** @type {Record<string, Record<string, Record<string, Record<string, unknown>>>>} */
  const byHost = {};
  for (const [host, roles] of Object.entries(declared)) {
    if (!HOSTS.includes(host)) {
      throw new PublicError(`${where} names unknown host ${host}`, { hint: `Known hosts: ${HOSTS.join(', ')}.` });
    }
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) {
      throw new PublicError(`${where}.${host} must be a map of role to levels`);
    }
    const accepted = settingsFor(host).filter((key) => !PERMISSION_SETTINGS.includes(key));
    /** @type {Record<string, Record<string, Record<string, unknown>>>} */
    const byRole = {};
    for (const [role, levels] of Object.entries(roles)) {
      if (role === 'coordinator') {
        throw new PublicError(`${where}.${host} cannot configure the coordinator`, {
          hint: `The coordinator is the session you invoke Castwork in. Levels apply to ${ROUTABLE_ROLES.join(', ')}.`,
        });
      }
      if (!ROLE_IDS.includes(role)) {
        throw new PublicError(`${where}.${host} names unknown role ${role}`, { hint: `Roles with levels: ${ROUTABLE_ROLES.join(', ')}.` });
      }
      if (typeof levels !== 'object' || levels === null || Array.isArray(levels)) {
        throw new PublicError(`${where}.${host}.${role} must be a map of level to settings`);
      }
      /** @type {Record<string, Record<string, unknown>>} */
      const byLevel = {};
      for (const [level, settings] of Object.entries(levels)) {
        const at = `${where}.${host}.${role}.${level}`;
        if (level === 'standard') {
          throw new PublicError(`${at}: standard is the role's own binding`, {
            hint: `Write it as role_settings.${host}.${role}. role_levels takes ${LEVELS.join(' and ')}.`,
          });
        }
        if (!LEVELS.includes(level)) {
          throw new PublicError(`${where}.${host}.${role} names unknown level ${level}`, { hint: `Levels: ${LEVELS.join(', ')}.` });
        }
        if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
          throw new PublicError(`${at} must be a map of setting to value`);
        }
        const base = shared === null ? {} : shared[host]?.[role]?.[level];
        if (base === undefined) {
          throw new PublicError(`${at}: ${CONFIG_FILE} declares no ${level} level for ${role} on ${host}`, {
            hint: `${file} changes the settings of a level ${CONFIG_FILE} declares. A new level is a variant file every clone carries: declare it in ${CONFIG_FILE} role_levels.${host}.${role}.`,
          });
        }
        /** @type {Record<string, unknown>} */
        const checked = { ...base };
        for (const [key, value] of Object.entries(settings)) {
          if (PERMISSION_SETTINGS.includes(key)) {
            throw new PublicError(`${at}.${key}: a level does not set permissions`, {
              hint: `The level's variant takes ${key} from role_settings.${host}.${role}; a level chooses only the model settings.`,
            });
          }
          if (!accepted.includes(key)) {
            throw new PublicError(`${at}.${key}: host ${host} has no setting ${key}`, { hint: `A level on ${host} accepts: ${accepted.join(', ')}.` });
          }
          const checkedValue = settingValue(value, `${at}.${key}`);
          if (checkedValue !== null) checked[key] = checkedValue;
          else delete checked[key];
        }
        if (typeof checked.model !== 'string') {
          throw new PublicError(`${at} sets no model`, {
            hint: shared === null
              ? 'A level is a complete setting set: name its model, and the effort or variant chosen for that model beside it.'
              : `A level is a complete setting set: ${file} may change its model but not clear it.`,
          });
        }
        const binding = bindingProblem(host, checked);
        if (binding) throw new PublicError(`${at}.${binding.key} ${binding.problem}`, { hint: binding.hint });
        byLevel[level] = checked;
      }
      byRole[role] = byLevel;
    }
    byHost[host] = byRole;
  }
  return byHost;
}

/**
 * The model settings a host declares that a level left out, other than an
 * OpenCode variant, which a model need not have. The host fills each from its
 * own configuration, which can pair the level's model with an effort chosen
 * for another; `validate` warns about it.
 *
 * @param {string} host
 * @param {Record<string, unknown>} settings one level's settings
 */
export function levelOmissions(host, settings) {
  return settingsFor(host)
    .filter((key) => key !== 'model' && key !== 'variant' && !PERMISSION_SETTINGS.includes(key))
    .filter((key) => settings[key] === undefined);
}

/**
 * `hosts` resolves settings for a host set other than the recorded one, so
 * `setup` can plan for a host it is about to add before it writes anything.
 *
 * `role_settings` and `role_levels` are the project's, from `castwork.json`.
 * `local` is null, or the same two with `.castwork/local/castwork.json` over them: what
 * this machine generates onto disk, while the tracked manifest keeps the
 * project's.
 *
 * `local: false` leaves `.castwork/local/castwork.json` unread, so the project's own
 * output can be generated whatever that file holds.
 *
 * @param {string} root
 * @param {{hosts?: string[], local?: boolean}} [options]
 * @returns {Config}
 */
export function readConfig(root, options = {}) {
  const shared = readSharedConfig(root, options);
  return { ...shared, local: options.local === false ? null : readLocalConfig(root, shared) };
}

/**
 * @typedef {Record<string, Record<string, Record<string, unknown>>>} RoleSettings host, role, settings
 * @typedef {Record<string, Record<string, Record<string, Record<string, unknown>>>>} RoleLevels host, role, level, settings
 * @typedef {{hosts: string[], role_settings: RoleSettings, role_routes: Record<string, string>, role_levels: RoleLevels, raw: Record<string, unknown>|null, overrides: RoleSettings}} SharedConfig
 * @typedef {SharedConfig & {local: {role_settings: RoleSettings, role_routes: Record<string, string>, role_levels: RoleLevels}|null}} Config
 */

/**
 * @param {string} root
 * @param {{hosts?: string[]}} options
 * @returns {SharedConfig}
 */
function readSharedConfig(root, options) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    const hosts = options.hosts ?? [];
    return { hosts, role_settings: shippedSettings(hosts, {}), role_routes: {}, role_levels: {}, raw: null, overrides: {} };
  }
  /** @type {Record<string, unknown>} */
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new PublicError(`${CONFIG_FILE} is not valid JSON: ${String(error)}`);
  }

  const recorded = Array.isArray(raw.hosts) ? raw.hosts.map(String) : [];
  for (const host of recorded) {
    if (!HOSTS.includes(host)) {
      throw new PublicError(`${CONFIG_FILE} lists unknown host ${host}`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
  }

  // 0.5.0 never shipped, so there is nothing to stay compatible with and no
  // second spelling to keep alive: a model binding is one of the settings a
  // host declares, written where every other setting is written.
  if (raw.models !== undefined) {
    throw new PublicError(`${CONFIG_FILE} no longer has a models map`, {
      hint: 'A model id is host-specific. Write it as role_settings.<host>.<role>.model.',
    });
  }
  const overrides = readRoleSettings(raw);
  const routes = /** @type {Record<string, string>} */ (readRoleRoutes(raw));
  const levels = readRoleLevels(raw);
  const hosts = options.hosts ?? recorded;
  return { hosts, role_settings: shippedSettings(hosts, overrides), role_routes: routes, role_levels: levels, raw, overrides };
}

/** What `.castwork/local/castwork.json` may hold. */
const LOCAL_KEYS = Object.freeze(['role_settings', 'role_routes', 'role_levels']);

/** The local keys as a sentence lists them. */
const LOCAL_KEY_LIST = `${LOCAL_KEYS.slice(0, -1).join(', ')} and ${LOCAL_KEYS.at(-1)}`;

/**
 * Read `.castwork/local/castwork.json`, the one machine's choice of models and
 * routes. It is gitignored and never committed: it changes the model settings
 * of roles and levels the project already has, and which of the project's
 * hosts runs a role, and nothing else, so it adds or removes no generated file
 * and the tracked manifest stays the same on every machine. A route changes
 * only what the routing host's entry command and coordinator say. Hosts,
 * permissions, and levels stay the project's, in `castwork.json`.
 *
 * @param {string} root
 * @param {SharedConfig} shared
 * @returns {Config['local']}
 */
function readLocalConfig(root, shared) {
  const file = path.join(root, LOCAL_CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new PublicError(`${LOCAL_CONFIG_FILE} is not valid JSON: ${String(error)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PublicError(`${LOCAL_CONFIG_FILE} must be an object`, { hint: `It holds ${LOCAL_KEY_LIST}.` });
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(record)) {
    if (!LOCAL_KEYS.includes(key)) {
      throw new PublicError(`${LOCAL_CONFIG_FILE} cannot set ${key}`, {
        hint: `It chooses models and routes on this machine only, through ${LOCAL_KEY_LIST}. Everything else is the project's, in ${CONFIG_FILE}.`,
      });
    }
  }

  const localSettings = readRoleSettings(record, LOCAL_CONFIG_FILE, shared.overrides);
  /** @type {RoleSettings} */
  const overrides = {};
  for (const host of new Set([...Object.keys(shared.overrides), ...Object.keys(localSettings)])) {
    overrides[host] = { ...(shared.overrides[host] ?? {}) };
    for (const [role, values] of Object.entries(localSettings[host] ?? {})) {
      overrides[host][role] = { ...(overrides[host][role] ?? {}), ...values };
    }
  }

  const localLevels = readRoleLevels(record, LOCAL_CONFIG_FILE, shared.role_levels);
  /** @type {RoleLevels} */
  const levels = {};
  for (const [host, roles] of Object.entries(shared.role_levels)) {
    levels[host] = {};
    for (const [role, byLevel] of Object.entries(roles)) {
      levels[host][role] = { ...byLevel, ...(localLevels[host]?.[role] ?? {}) };
    }
  }

  // A route is replaced whole, and null drops the project's, so the role runs
  // in whichever host routes it.
  /** @type {Record<string, string>} */
  const routes = { ...shared.role_routes };
  for (const [role, route] of Object.entries(readRoleRoutes(record, LOCAL_CONFIG_FILE, shared.hosts))) {
    if (route === null) delete routes[role];
    else routes[role] = route;
  }
  return { role_settings: shippedSettings(shared.hosts, overrides), role_routes: routes, role_levels: levels };
}

/**
 * Settings are resolved per host, because the same role rarely wants the same
 * string in two hosts: a model id that Claude Code accepts is not the
 * `provider/model` selector OpenCode expects. Shipped defaults first.
 *
 * @param {string[]} hosts
 * @param {Record<string, Record<string, Record<string, unknown>>>} overrides
 */
function shippedSettings(hosts, overrides) {
  /** @type {Record<string, Record<string, Record<string, unknown>>>} */
  const roleSettings = {};
  const shipped = defaults();
  for (const host of hosts) {
    /** @type {Record<string, Record<string, unknown>>} */
    const settings = {};
    const hostDefaults = shipped?.adapters?.[host]?.role_settings ?? {};
    for (const [role, values] of Object.entries(hostDefaults)) {
      settings[role] = { ...(/** @type {object} */ (values)) };
    }
    for (const [role, values] of Object.entries(overrides[host] ?? {})) {
      settings[role] = { ...(settings[role] ?? {}), ...values };
    }
    roleSettings[host] = settings;
  }
  return roleSettings;
}

/** @param {string} root @param {string[]} hosts */
export function writeConfig(root, hosts) {
  // Contained, so a link left where the config belongs is refused rather than
  // followed to whatever it names.
  const file = installPath(root, CONFIG_FILE);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // No `extends` key: defaults come from the installed package's config.json
  // via defaults(), and 0.5.0 does not copy the toolkit source into the target,
  // so a pointer to ./castwork/config.json would name a path that is not
  // there and that nothing reads.
  const next = {
    ...existing,
    hosts,
  };
  delete next.extends;
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
