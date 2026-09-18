/**
 * Machine configuration.
 *
 * It lives in `agenticloop.json` at the target root and nowhere else.
 * `.agenticloop/project.md` owns prose only.
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

/**
 * Read the `models` shorthand.
 *
 * One string per role, applied to the selected host. It is a convenience for
 * the single-host case and nothing more: host model namespaces do not overlap
 * — `claude-opus-5`, `gpt-5.4` and `openai/gpt-5.6` name models to three
 * different hosts — so one string cannot be right for two of them at once.
 * Rather than write a Claude id into a Codex agent file, this refuses and
 * sends the user to `role_settings`, which is per host.
 *
 * @param {Record<string, unknown>} raw
 * @param {string[]} hosts
 * @returns {Record<string, string|null>}
 */
function readModels(raw, hosts) {
  const declared = raw.models;
  if (declared === undefined) return {};
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new PublicError(`${CONFIG_FILE} models must be a map of role to model`);
  }
  const entries = Object.entries(declared);
  if (entries.length > 0 && hosts.length > 1) {
    throw new PublicError(`${CONFIG_FILE} models applies to every selected host, and ${hosts.length} are selected`, {
      hint: `A model id is host-specific, so one string cannot serve ${hosts.join(' and ')}. Move these under role_settings.<host>.<role>.model.`,
    });
  }
  /** @type {Record<string, string|null>} */
  const models = {};
  for (const [role, model] of entries) {
    if (!ROLE_IDS.includes(role)) {
      throw new PublicError(`${CONFIG_FILE} models names unknown role ${role}`, {
        hint: `Known roles: ${ROLE_IDS.join(', ')}.`,
      });
    }
    models[role] = settingValue(model, `${CONFIG_FILE} models.${role}`);
  }
  return models;
}

/**
 * @param {string} root
 * @returns {{hosts: string[], models: Record<string, string|null>, role_settings: Record<string, Record<string, Record<string, unknown>>>, raw: Record<string, unknown>|null}}
 */
export function readConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    return { hosts: [], models: {}, role_settings: {}, raw: null };
  }
  /** @type {Record<string, unknown>} */
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new PublicError(`${CONFIG_FILE} is not valid JSON: ${String(error)}`);
  }

  const hosts = Array.isArray(raw.hosts) ? raw.hosts.map(String) : [];
  for (const host of hosts) {
    if (!HOSTS.includes(host)) {
      throw new PublicError(`${CONFIG_FILE} lists unknown host ${host}`, {
        hint: `Known hosts: ${HOSTS.join(', ')}.`,
      });
    }
  }

  const models = readModels(raw, hosts);
  const overrides = readRoleSettings(raw);

  // Settings are resolved per host, because the same role rarely wants the
  // same string in two hosts: a model id that Claude Code accepts is not the
  // `provider/model` selector OpenCode expects. Least specific first.
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
    for (const [role, model] of Object.entries(models)) {
      settings[role] = { ...(settings[role] ?? {}), model };
    }
    for (const [role, values] of Object.entries(overrides[host] ?? {})) {
      settings[role] = { ...(settings[role] ?? {}), ...values };
    }
    roleSettings[host] = settings;
  }

  return { hosts, models, role_settings: roleSettings, raw };
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
    models: existing.models ?? {},
  };
  delete next.extends;
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
