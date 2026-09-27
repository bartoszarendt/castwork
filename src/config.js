/**
 * Project configuration.
 *
 * It lives in `agenticloop.json` at the target root and nowhere else.
 * `.agenticloop/project.md` owns prose only, and `.agenticloop/local/` is
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

/** The settings one host accepts, in the spelling `agenticloop.json` uses. */
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
    /** @type {Record<string, Record<string, unknown>>} */
    const byRole = {};
    for (const [role, settings] of Object.entries(roles)) {
      if (!ROLE_IDS.includes(role)) {
        throw new PublicError(`${CONFIG_FILE} role_settings.${host} names unknown role ${role}`, {
          hint: `Known roles: ${ROLE_IDS.join(', ')}.`,
        });
      }
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        throw new PublicError(`${CONFIG_FILE} role_settings.${host}.${role} must be a map of setting to value`);
      }
      /** @type {Record<string, unknown>} */
      const checked = {};
      for (const [key, value] of Object.entries(settings)) {
        if (!accepted.includes(key)) {
          throw new PublicError(`host ${host} has no setting ${key}`, {
            hint: `${host} accepts: ${accepted.join(', ')}.`,
          });
        }
        checked[key] = settingValue(value, `${CONFIG_FILE} role_settings.${host}.${role}.${key}`);
      }
      byRole[role] = checked;
    }
    byHost[host] = byRole;
  }
  return byHost;
}

/** The roles a route can send to another host. The coordinator is the session that routes. */
export const ROUTABLE_ROLES = Object.freeze(ROLE_IDS.filter((role) => role !== 'coordinator'));

/** What a route falls back to when its host cannot run the role. */
export const ROUTE_FALLBACKS = Object.freeze(['current_host', 'leave_open']);

/**
 * @typedef {{host: string, fallback: string}} RoleRoute
 */

/**
 * Read `role_routes`: which host the project prefers each role to run in when
 * the coordinator works from another one, and what to do when that host
 * cannot run it.
 *
 * A route is a separate map rather than a role setting because it is not a
 * setting the target host reads: it is a choice the coordinator acts on. Model
 * and reasoning for the routed role stay in `role_settings` under the host the
 * route names. Whether the route's host is among the generated hosts is checked
 * when generating, against the host set being generated, so `setup --host` can
 * add the host a route already names.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, RoleRoute>}
 */
function readRoleRoutes(raw) {
  const declared = raw.role_routes;
  if (declared === undefined) return {};
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${CONFIG_FILE} role_routes must be a map of role to route`);
  }

  /** @type {Record<string, RoleRoute>} */
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
    if (typeof route !== 'object' || route === null || Array.isArray(route)) {
      throw new PublicError(`${CONFIG_FILE} role_routes.${role} must be a map with host and fallback`);
    }
    const entry = /** @type {Record<string, unknown>} */ (route);
    for (const key of Object.keys(entry)) {
      if (key !== 'host' && key !== 'fallback') {
        throw new PublicError(`${CONFIG_FILE} role_routes.${role} has no key ${key}`, {
          hint: `A route takes host and fallback. Model and reasoning for the routed role go in role_settings.<host>.${role}.`,
        });
      }
    }
    if (typeof entry.host !== 'string' || !HOSTS.includes(entry.host)) {
      throw new PublicError(`${CONFIG_FILE} role_routes.${role}.host must name a known host`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
    const fallbackHint = 'Set fallback to current_host (run the role in the host that routes it) or leave_open (leave its part undone).';
    if (entry.fallback === undefined) {
      throw new PublicError(`${CONFIG_FILE} role_routes.${role} has no fallback`, { hint: fallbackHint });
    }
    if (typeof entry.fallback !== 'string' || !ROUTE_FALLBACKS.includes(entry.fallback)) {
      throw new PublicError(`${CONFIG_FILE} role_routes.${role}.fallback must be one of ${ROUTE_FALLBACKS.join(', ')}`, {
        hint: fallbackHint,
      });
    }
    routes[role] = { host: entry.host, fallback: entry.fallback };
  }
  return routes;
}

/**
 * `hosts` resolves settings for a host set other than the recorded one, so
 * `setup` can plan for a host it is about to add before it writes anything.
 *
 * @param {string} root
 * @param {{hosts?: string[]}} [options]
 * @returns {{hosts: string[], role_settings: Record<string, Record<string, Record<string, unknown>>>, role_routes: Record<string, RoleRoute>, raw: Record<string, unknown>|null}}
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
  // so a pointer to ./agenticloop/config.json would name a path that is not
  // there and that nothing reads.
  const next = {
    ...existing,
    hosts,
  };
  delete next.extends;
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
