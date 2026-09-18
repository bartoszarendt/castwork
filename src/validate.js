/**
 * validate: skills, config, links, and generated adapter output.
 *
 * Read-only. It reports what is wrong; it never repairs.
 */

import fs from 'node:fs';
import path from 'node:path';

import { generateHost, readRoles, toolkitRoot } from './adapter-generation.js';
import { readConfig } from './config.js';
import { containedPath, digest, readManifest } from './generated.js';
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
  for (const role of roles) {
    if (role.description.trim() === '') error(findings, `agents/${role.id}.md`, 'frontmatter description is empty');
    const lines = role.body.split('\n').length;
    if (lines > 100) warn(findings, `agents/${role.id}.md`, `${lines} lines; roles are meant to stay under 100`);
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
  // config.json carries per-host role settings and nothing else. Role ids,
  // descriptions and bodies come from agents/*.md, and every skill is projected
  // to every host, so there is no role-to-skill list left to check.
  for (const host of Object.keys(config.adapters ?? {})) {
    if (!HOSTS.includes(host)) error(findings, 'config.json', `adapters.${host} is not a supported host`);
  }
  for (const key of JSON.stringify(config).match(/"[a-z_]*[A-Z][A-Za-z_]*":/g) ?? []) {
    const name = key.slice(1, -2);
    if (name !== 'permissionMode') warn(findings, 'config.json', `field ${name} is not snake_case`);
  }
}

/** @param {Finding[]} findings */
function validateDocumentLinks(findings) {
  const root = toolkitRoot();
  const files = ['README.md', 'AGENTIC_LOOP.md', 'AGENTS.md', ...fs.readdirSync(path.join(root, 'docs')).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)];
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
    for (const file of generateHost(host, { roleSettings: config.role_settings })) {
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
      const actual = digest(fs.readFileSync(full, 'utf8'));
      if (actual !== recorded) {
        warn(findings, file.path, 'differs from the manifest digest; update will skip it unless forced');
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
  validateConfig(findings);
  validateDocumentLinks(findings);
  validateGeneratedOutput(findings, root);
  return { ok: findings.every((finding) => finding.level !== 'error'), findings };
}
