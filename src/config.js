/**
 * Machine configuration.
 *
 * It lives in `agenticloop.json` at the target root and nowhere else.
 * `.agenticloop/project.md` owns prose only.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_FILE, HOSTS } from './layout.js';
import { PublicError } from './public-error.js';
import { installPath } from './generated.js';
import { toolkitRoot } from './adapter-generation.js';

/** Shipped defaults. */
export function defaults() {
  return JSON.parse(fs.readFileSync(path.join(toolkitRoot(), 'config.json'), 'utf8'));
}

/**
 * @param {string} root
 * @returns {{hosts: string[], models: Record<string, string>, role_settings: Record<string, Record<string, unknown>>, raw: Record<string, unknown>|null}}
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

  const models = typeof raw.models === 'object' && raw.models !== null ? /** @type {Record<string, string>} */ (raw.models) : {};

  /** @type {Record<string, Record<string, unknown>>} */
  const roleSettings = {};
  const shipped = defaults();
  for (const host of hosts) {
    const hostDefaults = shipped?.adapters?.[host]?.role_settings ?? {};
    for (const [role, settings] of Object.entries(hostDefaults)) {
      roleSettings[role] = { ...(roleSettings[role] ?? {}), ...(/** @type {object} */ (settings)) };
    }
  }
  for (const [role, model] of Object.entries(models)) {
    roleSettings[role] = { ...(roleSettings[role] ?? {}), model: String(model) };
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
