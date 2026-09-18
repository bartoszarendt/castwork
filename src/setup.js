/**
 * The install lifecycle: setup, update, remove, doctor.
 *
 * Ownership is the whole model. `.agenticloop/generated.json` lists every
 * generated file with its digest. A file whose digest still matches is ours to
 * regenerate or delete; anything else is yours and is left alone.
 *
 * There is no migration. A 0.4.x layout is refused with manual steps.
 */

import fs from 'node:fs';
import path from 'node:path';

import { generateAll, toolkitRoot } from './adapter-generation.js';
import { readConfig, writeConfig } from './config.js';
import { containedPath, digest, installPath, ownership, readManifest, writeManifest } from './generated.js';
import {
  CONFIG_FILE,
  DECISIONS_DIRECTORY,
  GENERATED_MANIFEST,
  HOSTS,
  LAYOUT_VERSION,
  LEGACY_STATE_DIRECTORIES,
  LEGACY_STATE_FILES,
  LOCAL_DIRECTORY,
  PROJECT_FILE,
  STATE_DIRECTORY,
  TASKS_DIRECTORY,
} from './layout.js';
import { PublicError } from './public-error.js';

/** @param {string} root */
function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(toolkitRoot(), 'package.json'), 'utf8')).version;
}

/**
 * A 0.4.x installation is refused, never migrated or overwritten.
 * @param {string} root
 * @returns {string[]} reasons, empty when the layout is clean
 */
export function detectLegacyLayout(root) {
  const reasons = [];
  for (const name of LEGACY_STATE_DIRECTORIES) {
    if (fs.existsSync(path.join(root, STATE_DIRECTORY, name))) {
      reasons.push(`${STATE_DIRECTORY}/${name}/ exists`);
    }
  }
  for (const name of LEGACY_STATE_FILES) {
    if (fs.existsSync(path.join(root, STATE_DIRECTORY, name))) {
      reasons.push(`${STATE_DIRECTORY}/${name} exists`);
    }
  }
  const oldManifest = path.join(root, 'agenticloop', 'manifest.json');
  if (fs.existsSync(oldManifest)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(oldManifest, 'utf8'));
      if (parsed.layoutVersion !== undefined && parsed.layout_version === undefined) {
        reasons.push(`agenticloop/manifest.json declares layoutVersion ${String(parsed.layoutVersion)}`);
      }
    } catch {
      // An unreadable old manifest is not itself proof of a 0.4.x layout.
    }
  }
  return reasons;
}

/** @param {string[]} reasons */
function refuseLegacy(reasons) {
  throw new PublicError(
    `this looks like a 0.4.x installation: ${reasons.join('; ')}`,
    {
      hint: [
        'There is no migration. To install 0.5.0:',
        '  1. delete the generated host directories and agenticloop/ from this repository',
        `  2. delete the 0.4.x state directories under ${STATE_DIRECTORY}/`,
        `  3. keep ${PROJECT_FILE}, ${TASKS_DIRECTORY}/ and ${DECISIONS_DIRECTORY}/ — they are yours`,
        '  4. run setup again',
      ].join('\n'),
    },
  );
}

/**
 * Seed the target-owned state.
 *
 * Every path is resolved through `installPath` first, so a link standing where
 * one of these belongs is refused before anything is created rather than
 * followed out of the repository.
 *
 * @param {string} root
 */
function seedState(root) {
  const created = [];
  for (const directory of [STATE_DIRECTORY, TASKS_DIRECTORY, DECISIONS_DIRECTORY, LOCAL_DIRECTORY]) {
    const full = installPath(root, directory);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      created.push(directory);
    }
  }
  const project = installPath(root, PROJECT_FILE);
  if (!fs.existsSync(project)) {
    fs.copyFileSync(path.join(toolkitRoot(), 'memory', 'scaffold', 'project.md'), project);
    created.push(PROJECT_FILE);
  }
  return created;
}

/** @param {string} root */
function ensureGitignore(root) {
  const file = installPath(root, '.gitignore');
  const line = `${LOCAL_DIRECTORY}/`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.split(/\r?\n/).some((entry) => entry.trim() === line)) return false;
  const next = existing === '' || existing.endsWith('\n') ? `${existing}${line}\n` : `${existing}\n${line}\n`;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

/**
 * Write the planned files, respecting ownership.
 * @param {string} root
 * @param {{path: string, content: string}[]} files
 * @param {{force?: string[]}} [options]
 */
function writeGenerated(root, files, options = {}) {
  const manifest = readManifest(root);
  const force = new Set(options.force ?? []);
  /** @type {Record<string, string>} */
  const next = {};
  const written = [];
  const skipped = [];
  const collisions = [];

  for (const file of files) {
    const state = ownership(root, file.path, manifest);
    if (state === 'user_owned') {
      collisions.push(file.path);
      continue;
    }
    if (state === 'owned_modified' && !force.has(file.path)) {
      skipped.push(file.path);
      next[file.path] = manifest?.files?.[file.path] ?? digest(file.content);
      continue;
    }
    const full = containedPath(root, file.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.content, 'utf8');
    next[file.path] = digest(file.content);
    written.push(file.path);
  }

  // Files we used to own and no longer generate are removed when unchanged.
  const removed = [];
  for (const [relative, recorded] of Object.entries(manifest?.files ?? {})) {
    if (next[relative] !== undefined) continue;
    const full = containedPath(root, relative);
    if (fs.existsSync(full) && digest(fs.readFileSync(full, 'utf8')) === recorded) {
      fs.rmSync(full);
      removed.push(relative);
    } else if (fs.existsSync(full)) {
      skipped.push(relative);
      next[relative] = recorded;
    }
  }

  writeManifest(root, { layout_version: LAYOUT_VERSION, version: packageVersion(), files: next });
  return { written, skipped, collisions, removed };
}

/**
 * @param {string} root
 * @param {{hosts?: string[], force?: string[]}} [options]
 */
export function setup(root, options = {}) {
  const legacy = detectLegacyLayout(root);
  if (legacy.length > 0) refuseLegacy(legacy);

  const existing = readConfig(root);
  const hosts = options.hosts && options.hosts.length > 0 ? options.hosts : existing.hosts;
  if (hosts.length === 0) {
    throw new PublicError('no hosts selected', {
      hint: `Pass --host <name> (one or more of ${HOSTS.join(', ')}), or list them under "hosts" in ${CONFIG_FILE}.`,
    });
  }

  const created = seedState(root);
  writeConfig(root, hosts);
  const ignored = ensureGitignore(root);
  const config = readConfig(root);
  const files = generateAll(hosts, { roleSettings: config.role_settings });
  const result = writeGenerated(root, files, { force: options.force });

  return { hosts, created, ignored, ...result };
}

/**
 * @param {string} root
 * @param {{force?: string[]}} [options]
 */
export function update(root, options = {}) {
  const legacy = detectLegacyLayout(root);
  if (legacy.length > 0) refuseLegacy(legacy);

  const config = readConfig(root);
  if (config.hosts.length === 0) {
    throw new PublicError(`${CONFIG_FILE} lists no hosts`, { hint: 'Run setup first.' });
  }
  const files = generateAll(config.hosts, { roleSettings: config.role_settings });
  return { hosts: config.hosts, ...writeGenerated(root, files, { force: options.force }) };
}

/**
 * Deletes only manifest entries whose digest still matches. Never touches
 * project.md, tasks/, or decisions/.
 * @param {string} root
 */
export function remove(root) {
  const manifest = readManifest(root);
  if (!manifest) {
    throw new PublicError('nothing to remove: no generated manifest found');
  }
  const removed = [];
  const kept = [];
  for (const [relative, recorded] of Object.entries(manifest.files)) {
    const full = containedPath(root, relative);
    if (!fs.existsSync(full)) continue;
    if (digest(fs.readFileSync(full, 'utf8')) === recorded) {
      fs.rmSync(full);
      removed.push(relative);
    } else {
      kept.push(relative);
    }
  }
  pruneEmptyDirectories(root, removed);
  fs.rmSync(containedPath(root, GENERATED_MANIFEST), { force: true });
  return { removed, kept };
}

/** @param {string} root @param {string[]} relatives */
function pruneEmptyDirectories(root, relatives) {
  const directories = new Set();
  for (const relative of relatives) {
    let dir = path.dirname(relative);
    while (dir && dir !== '.' && dir !== path.sep) {
      directories.add(dir);
      dir = path.dirname(dir);
    }
  }
  for (const dir of [...directories].sort((a, b) => b.length - a.length)) {
    /** @type {string} */
    let full;
    try {
      full = containedPath(root, dir);
    } catch {
      continue;
    }
    try {
      if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } catch {
      // A directory that will not go is not a failure worth reporting.
    }
  }
}

/**
 * Read-only diagnosis.
 * @param {string} root
 */
export function doctor(root) {
  const legacy = detectLegacyLayout(root);
  const manifest = readManifest(root);
  const config = readConfig(root);
  const findings = [];

  if (legacy.length > 0) {
    findings.push({ level: 'error', message: `0.4.x layout detected: ${legacy.join('; ')}` });
  }
  if (!fs.existsSync(path.join(root, STATE_DIRECTORY))) {
    findings.push({ level: 'error', message: `${STATE_DIRECTORY}/ is missing`, next: 'Run setup.' });
  }
  if (config.hosts.length === 0) {
    findings.push({ level: 'warn', message: `${CONFIG_FILE} lists no hosts`, next: 'Run setup and select a host.' });
  }
  if (!manifest) {
    findings.push({ level: 'warn', message: `${GENERATED_MANIFEST} is missing`, next: 'Run setup.' });
  } else {
    if (manifest.layout_version !== LAYOUT_VERSION) {
      findings.push({
        level: 'error',
        message: `${GENERATED_MANIFEST} declares layout_version ${manifest.layout_version}, expected ${LAYOUT_VERSION}`,
      });
    }
    for (const relative of Object.keys(manifest.files)) {
      const state = ownership(root, relative, manifest);
      if (state === 'absent') findings.push({ level: 'warn', message: `generated file missing: ${relative}`, next: 'Run update.' });
      if (state === 'owned_modified') {
        findings.push({ level: 'info', message: `generated file modified locally: ${relative}`, next: `update skips it unless you pass --force-generated ${relative}` });
      }
    }
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    hosts: config.hosts,
    version: manifest?.version ?? null,
    generated_files: manifest ? Object.keys(manifest.files).length : 0,
    findings,
  };
}
