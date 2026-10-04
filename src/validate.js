/**
 * validate: skills, config, links, and generated adapter output.
 *
 * Read-only. It reports what is wrong; it never repairs.
 */

import fs from 'node:fs';
import path from 'node:path';

import { commandDescriptions, generateHost, readAdapter, readRoles, resolveRoutes, skillFrontmatter, toolkitRoot } from './adapter-generation.js';
import { bindingProblem, readConfig, settingsFor } from './config.js';
import { containedPath, digest, diskDigest, readManifest } from './generated.js';
import { PublicError } from './public-error.js';
import { CONFIG_FILE, HOSTS } from './layout.js';
import { parseRecord, ROLE_IDS } from './record.js';

/** @typedef {{level: 'error'|'warn', where: string, message: string}} Finding */

/** @param {Finding[]} findings @param {string} where @param {string} message */
function error(findings, where, message) {
  findings.push({ level: 'error', where, message });
}

/** @param {Finding[]} findings @param {string} where @param {string} message */
function warn(findings, where, message) {
  findings.push({ level: 'warn', where, message });
}

/** @param {Finding[]} findings */
function validateSkills(findings) {
  const directory = path.join(toolkitRoot(), 'skills');
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name, 'SKILL.md');
    const where = `skills/${name}`;
    if (!fs.existsSync(file)) {
      error(findings, where, 'has no SKILL.md');
      continue;
    }
    const record = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
    const front = record.frontmatter;
    if (String(front.name ?? '') !== name) {
      error(findings, where, `frontmatter name "${String(front.name ?? '')}" does not match the directory name`);
    }
    if (String(front.description ?? '').trim() === '') {
      error(findings, where, 'frontmatter description is empty');
    }
    const metadata = front.metadata;
    if (typeof metadata !== 'object' || metadata === null) {
      warn(findings, where, 'frontmatter has no metadata block');
    }
    const body = record.body.toLowerCase();
    for (const word of ['activation', 'activate', 'receipt', 'packet', 'closeout', 'hydrate', 'dispatch']) {
      if (body.includes(word)) {
        error(findings, where, `names removed vocabulary "${word}"; a skill may not require activation or a prior command`);
      }
    }
  }
}

/** @param {Finding[]} findings */
function validateRoles(findings) {
  const roles = readRoles();
  const found = roles.map((role) => role.id);
  for (const id of ROLE_IDS) {
    if (!found.includes(id)) error(findings, 'agents/', `canonical role ${id} is missing`);
  }
  const directory = path.join(toolkitRoot(), 'skills');
  const skills = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => fs.existsSync(path.join(directory, name, 'SKILL.md')))
    : [];
  for (const role of roles) findings.push(...roleFindings(role, skills));
}

/**
 * Findings for one parsed canonical role, given the skill ids the toolkit has.
 * Separate from reading the files so a test can check a malformed role.
 *
 * @param {{id: string, description: string, procedures: string[], body: string}} role
 * @param {string[]} skills
 * @returns {Finding[]}
 */
export function roleFindings(role, skills) {
  /** @type {Finding[]} */
  const findings = [];
  const where = `agents/${role.id}.md`;
  if (role.description.trim() === '') error(findings, where, 'frontmatter description is empty');
  // A line generation cannot read would leave the role with no procedures in
  // silence, in the plugin's file and every generated one.
  if (/^Procedure skills:/m.test(role.body) && role.procedures.length === 0) {
    error(findings, where, 'has a Procedure skills line that is not its closing line, or names something other than `skill-id`s separated by commas');
  }
  for (const procedure of role.procedures) {
    if (!skills.includes(procedure)) error(findings, where, `names procedure ${procedure}, which is not a skill under skills/`);
  }
  const lines = role.body.split('\n').length;
  if (lines >= 100) warn(findings, where, `${lines} body lines; roles are meant to stay under 100`);
  return findings;
}

/**
 * The entry command carries two descriptions, and they may not collapse into
 * one. The command description is read after the user invoked it by name; the
 * skill index description is what a host reads when deciding whether to load
 * Castwork unprompted.
 *
 * @param {Finding[]} findings
 */
function validateCommand(findings) {
  const file = path.join(toolkitRoot(), 'commands', 'start.md');
  const where = 'commands/start.md';
  if (!fs.existsSync(file)) {
    error(findings, where, 'is missing');
    return;
  }
  const parsed = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
  try {
    commandDescriptions(parsed.frontmatter);
  } catch (refusal) {
    error(findings, where, refusal instanceof PublicError ? refusal.message : String(refusal));
  }
}

/** @param {Finding[]} findings */
function validateConfig(findings) {
  const file = path.join(toolkitRoot(), 'config.json');
  /** @type {Record<string, any>} */
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (parseError) {
    error(findings, 'config.json', `not valid JSON: ${String(parseError)}`);
    return;
  }
  findings.push(...shippedConfigFindings(config));
}

/**
 * Findings for a parsed shipped `config.json`.
 *
 * Separate from reading the file so a test can check a broken configuration
 * without rewriting the toolkit's own file, which other tests running at the
 * same time read.
 *
 * @param {Record<string, any>} config
 * @returns {Finding[]}
 */
export function shippedConfigFindings(config) {
  /** @type {Finding[]} */
  const findings = [];
  // config.json carries per-host role settings and nothing else. Role ids,
  // descriptions and bodies come from agents/*.md, and every skill is projected
  // to every host, so there is no role-to-skill list left to check.
  //
  // These defaults are merged into every install, so a typo here is a setting
  // that disappears in silence — the same failure a target's own
  // `role_settings` refuses outright. Hold our own file to that contract too.
  for (const [host, adapter] of Object.entries(config.adapters ?? {})) {
    if (!HOSTS.includes(host)) {
      error(findings, 'config.json', `adapters.${host} is not a supported host`);
      continue;
    }
    try {
      skillFrontmatter(readAdapter(host));
    } catch (refusal) {
      error(findings, `src/adapters/${host}.json`, refusal instanceof PublicError ? refusal.message : String(refusal));
    }
    const accepted = settingsFor(host);
    for (const [role, settings] of Object.entries(adapter?.role_settings ?? {})) {
      if (!ROLE_IDS.includes(role)) {
        error(findings, 'config.json', `adapters.${host}.role_settings.${role} is not a role id`);
        continue;
      }
      if (role === 'coordinator') {
        error(findings, 'config.json', `adapters.${host}.role_settings.coordinator configures the session Castwork is invoked in, which takes no role settings`);
        continue;
      }
      for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (settings ?? {}))) {
        if (!accepted.includes(key)) {
          error(findings, 'config.json', `adapters.${host}.role_settings.${role}.${key} is not a setting ${host} accepts`);
        } else if (typeof value !== 'string' || value === '') {
          error(findings, 'config.json', `adapters.${host}.role_settings.${role}.${key} is not a non-empty string`);
        }
      }
      const binding = bindingProblem(host, /** @type {Record<string, unknown>} */ (settings ?? {}));
      if (binding) error(findings, 'config.json', `adapters.${host}.role_settings.${role}.${binding.key} ${binding.problem}. ${binding.hint}`);
    }
  }
  for (const key of JSON.stringify(config).match(/"[a-z_]*[A-Z][A-Za-z_]*":/g) ?? []) {
    const name = key.slice(1, -2);
    if (name !== 'permissionMode') warn(findings, 'config.json', `field ${name} is not snake_case`);
  }
  return findings;
}

/** @param {Finding[]} findings */
function validateDocumentLinks(findings) {
  const root = toolkitRoot();
  const files = ['README.md', 'CASTWORK.md', 'AGENTS.md', ...fs.readdirSync(path.join(root, 'docs')).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)];
  for (const relative of files) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/.test(target)) continue;
      const resolved = path.resolve(path.dirname(full), target);
      if (!fs.existsSync(resolved)) error(findings, relative, `broken link: ${target}`);
    }
  }
}

/** @param {Finding[]} findings @param {string} root */
function validateGeneratedOutput(findings, root) {
  const config = readConfig(root);
  if (config.hosts.length === 0) return;
  const manifest = readManifest(root);
  if (!manifest) {
    warn(findings, CONFIG_FILE, 'hosts are configured but no generated manifest exists; run setup');
    return;
  }
  for (const host of config.hosts) {
    /** @type {{path: string, content: string}[]} */
    let planned;
    try {
      planned = generateHost(host, {
        roleSettings: config.role_settings[host],
        routes: resolveRoutes(host, config.role_routes, config.role_settings, config.hosts),
      });
    } catch (generationError) {
      error(findings, `adapters/${host}`, `generation failed: ${String(generationError)}`);
      continue;
    }
    for (const file of planned) {
      const recorded = manifest.files[file.path];
      if (recorded === undefined) {
        warn(findings, file.path, `would be generated for ${host} but is not in the manifest; run update`);
        continue;
      }
      const full = containedPath(root, file.path);
      if (!fs.existsSync(full)) {
        error(findings, file.path, 'is in the manifest but missing on disk; run update');
        continue;
      }
      const actual = diskDigest(full);
      if (actual !== recorded) {
        warn(findings, file.path, 'differs from the manifest digest; update writes nothing until it is restored or forced');
      } else if (actual !== digest(file.content)) {
        warn(findings, file.path, 'is out of date with the canonical sources; run update');
      }
    }
  }
}

/** @param {string} root */
export function validate(root) {
  /** @type {Finding[]} */
  const findings = [];
  validateSkills(findings);
  validateRoles(findings);
  validateCommand(findings);
  validateConfig(findings);
  validateDocumentLinks(findings);
  validateGeneratedOutput(findings, root);
  return { ok: findings.every((finding) => finding.level !== 'error'), findings };
}
