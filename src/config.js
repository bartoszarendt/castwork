/**
 * Project configuration.
 *
 * It lives in `castwork.json` at the target root and nowhere else.
 * `.castwork/project.md` owns prose only, and `.castwork/local/` is
 * machine-local state rather than a second layer read from here: everything
 * this file holds is generated into tracked output, so it describes the
 * repository and not the machine the repository is checked out on.
 *
 * A role setting is a plain value passed to one host. This module decides
 * which settings a host accepts by asking that host's adapter, and never
 * interprets the values themselves: `high` means whatever the host says it
 * means, and a value this toolkit has never heard of reaches the host intact.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_FILE, HOSTS } from './layout.js';
import { PublicError } from './public-error.js';
import { installPath } from './generated.js';
import { toolkitRoot, readAdapter } from './adapter-generation.js';
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
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, Record<string, Record<string, unknown>>>}
 */
function readRoleSettings(raw) {
  const declared = raw.role_settings;
  if (declared === undefined) return {};
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${CONFIG_FILE} role_settings must be a map of host to role to settings`);
  }

  /** @type {Record<string, Record<string, Record<string, unknown>>>} */
  const byHost = {};
  for (const [host, roles] of Object.entries(declared)) {
    if (!HOSTS.includes(host)) {
      throw new PublicError(`${CONFIG_FILE} role_settings names unknown host ${host}`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) {
      throw new PublicError(`${CONFIG_FILE} role_settings.${host} must be a map of role to settings`);
    }
    const accepted = settingsFor(host);
    const hostDefaults = defaults()?.adapters?.[host]?.role_settings ?? {};
    /** @type {Record<string, Record<string, unknown>>} */
    const byRole = {};
    for (const [role, settings] of Object.entries(roles)) {
      if (!ROLE_IDS.includes(role)) {
        throw new PublicError(`${CONFIG_FILE} role_settings.${host} names unknown role ${role}`, {
          hint: `Known roles: ${ROLE_IDS.join(', ')}.`,
        });
      }
      if (role === 'coordinator') {
        throw new PublicError(`${CONFIG_FILE} role_settings.${host} cannot configure the coordinator`, {
          hint: `The coordinator is the session you invoke Castwork in, which runs on the host's own settings. Remove role_settings.${host}.coordinator; settings apply to ${ROLE_IDS.filter((id) => id !== 'coordinator').join(', ')}.`,
        });
      }
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        throw new PublicError(`${CONFIG_FILE} role_settings.${host}.${role} must be a map of setting to value`);
      }
      /** @type {Record<string, unknown>} */
      const checked = {};
      for (const [key, value] of Object.entries(settings)) {
        if (!accepted.includes(key)) {
          const retired = key === 'reasoning_effort' ? `${RETIRED_EFFORT[/** @type {keyof typeof RETIRED_EFFORT} */ (host)]} ` : '';
          throw new PublicError(`${CONFIG_FILE} role_settings.${host}.${role}.${key}: host ${host} has no setting ${key}`, {
            hint: `${retired}${host} accepts: ${accepted.join(', ')}.`,
          });
        }
        checked[key] = settingValue(value, `${CONFIG_FILE} role_settings.${host}.${role}.${key}`);
      }
      const binding = bindingProblem(host, { ...(hostDefaults[role] ?? {}), ...checked });
      if (binding) {
        throw new PublicError(`${CONFIG_FILE} role_settings.${host}.${role}.${binding.key} ${binding.problem}`, {
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
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, string>} role to host id
 */
function readRoleRoutes(raw) {
  const declared = raw.role_routes;
  if (declared === undefined) return {};
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${CONFIG_FILE} role_routes must be a map of role to host`, {
      hint: 'For example: "role_routes": { "worker": "codex" }.',
    });
  }

  /** @type {Record<string, string>} */
  const routes = {};
  for (const [role, route] of Object.entries(declared)) {
    if (role === 'coordinator') {
      throw new PublicError(`${CONFIG_FILE} role_routes cannot route the coordinator`, {
        hint: `The coordinator is the session that routes the other roles. Routable roles: ${ROUTABLE_ROLES.join(', ')}.`,
      });
    }
    if (!ROLE_IDS.includes(role)) {
      throw new PublicError(`${CONFIG_FILE} role_routes names unknown role ${role}`, {
        hint: `Routable roles: ${ROUTABLE_ROLES.join(', ')}.`,
      });
    }
    if (typeof route !== 'string') {
      throw new PublicError(`${CONFIG_FILE} role_routes.${role} must be a host id`, {
        hint: `Write "${role}": "<host>". A route has no fallback: a role its host cannot run runs in the host that routes it. Model and reasoning go in role_settings.<host>.${role}.`,
      });
    }
    if (!HOSTS.includes(route)) {
      throw new PublicError(`${CONFIG_FILE} role_routes.${role} names unknown host ${route}`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
    routes[role] = route;
  }
  return routes;
}

/**
 * `hosts` resolves settings for a host set other than the recorded one, so
 * `setup` can plan for a host it is about to add before it writes anything.
 *
 * @param {string} root
 * @param {{hosts?: string[]}} [options]
 * @returns {{hosts: string[], role_settings: Record<string, Record<string, Record<string, unknown>>>, role_routes: Record<string, string>, raw: Record<string, unknown>|null}}
 */
export function readConfig(root, options = {}) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    const hosts = options.hosts ?? [];
    return { hosts, role_settings: shippedSettings(hosts, {}), role_routes: {}, raw: null };
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
  const routes = readRoleRoutes(raw);
  const hosts = options.hosts ?? recorded;
  return { hosts, role_settings: shippedSettings(hosts, overrides), role_routes: routes, raw };
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
