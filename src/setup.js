/**
 * The install lifecycle: setup, update, remove, doctor.
 *
 * Ownership is the whole model. `.agenticloop/generated.json` lists every
 * generated file with its digest. A file whose digest still matches is ours to
 * regenerate or delete; anything else is yours. An update that would have to
 * leave a file of yours in place refuses before writing anything, unless
 * `--force-generated` names that file.
 *
 * There is no migration. A 0.4.x layout is refused with manual steps.
 */

import fs from 'node:fs';
import path from 'node:path';

import { compareVersions, generateAll, packageVersion, sourceDigest, toolkitRoot } from './adapter-generation.js';
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
 * @typedef {{
 *   version: string,
 *   toolkit: string,
 *   source_digest: string,
 *   manifest_version: string|null,
 *   manifest_source_digest: string|null,
 *   downgrade: boolean,
 *   identity_changed: boolean,
 *   unchanged: string[],
 *   changed: string[],
 *   added: string[],
 *   removed: string[],
 *   modified: string[],
 *   collisions: string[],
 *   manifest: 'added'|'changed'|null,
 *   files: Record<string, string>,
 *   contents: Record<string, string>,
 * }} GenerationPlan
 */

/**
 * Compare what this toolkit would generate with what is on disk. Reads only.
 *
 * Every generated path lands in exactly one list. `modified` (a generated file
 * you edited, or one no longer generated that you edited) and `collisions` (a
 * file of yours standing where one would be generated) block an update unless
 * `--force-generated` names them; a forced path is planned as a change, or as
 * a removal when it is no longer generated. A file that already holds exactly
 * what would be generated is `unchanged` whoever wrote it, so a lost manifest
 * or a hand-synced file is adopted instead of refused. `manifest` says whether
 * `.agenticloop/generated.json` itself would be written, since it is tracked
 * like the files it lists and has to be committed with them.
 *
 * @param {string} root
 * @param {{path: string, content: string}[]} files
 * @param {{force?: string[]}} [options]
 * @returns {GenerationPlan}
 */
export function planGenerated(root, files, options = {}) {
  const manifest = readManifest(root);
  // One spelling per path, so `./x` and `x`, or `a\\b` and `a/b`, name the same file.
  const force = new Set((options.force ?? []).map((relative) => path.posix.normalize(relative.replace(/\\/g, '/'))));
  /** @type {GenerationPlan} */
  const plan = {
    version: packageVersion(),
    toolkit: toolkitRoot(),
    source_digest: sourceDigest(),
    manifest_version: manifest === null || manifest.version === '' ? null : manifest.version,
    manifest_source_digest: manifest?.source_digest ?? null,
    downgrade: false,
    identity_changed: false,
    unchanged: [],
    changed: [],
    added: [],
    removed: [],
    modified: [],
    collisions: [],
    manifest: null,
    files: {},
    contents: {},
  };

  for (const file of files) {
    const wanted = digest(file.content);
    plan.files[file.path] = wanted;
    plan.contents[file.path] = file.content;
    const state = ownership(root, file.path, manifest);
    if (state === 'absent') {
      plan.added.push(file.path);
      continue;
    }
    const actual = digest(fs.readFileSync(containedPath(root, file.path), 'utf8'));
    if (actual === wanted) plan.unchanged.push(file.path);
    else if (state === 'owned_unchanged' || force.has(file.path)) plan.changed.push(file.path);
    else if (state === 'owned_modified') plan.modified.push(file.path);
    else plan.collisions.push(file.path);
  }

  // Files we used to own and no longer generate.
  for (const [relative, recorded] of Object.entries(manifest?.files ?? {})) {
    if (plan.files[relative] !== undefined) continue;
    const full = containedPath(root, relative);
    if (!fs.existsSync(full)) continue;
    if (digest(fs.readFileSync(full, 'utf8')) === recorded || force.has(relative)) plan.removed.push(relative);
    else plan.modified.push(relative);
  }

  // A force naming nothing this installation generates or recorded would
  // otherwise be dropped in silence, and the refusal it was meant to lift would
  // read as if the flag had not worked.
  const unknown = [...force].filter((relative) => plan.files[relative] === undefined && manifest?.files?.[relative] === undefined);
  if (unknown.length > 0) {
    throw new PublicError(`--force-generated names a path this installation neither generates nor recorded: ${unknown.join(', ')}`, {
      hint: 'Name the path exactly as update or doctor printed it. Nothing was written.',
    });
  }

  // A manifest written by a newer copy is refused rather than rewritten by an
  // older one: an old pinned CLI regenerating over newer output silently takes
  // back whatever the newer presets fixed.
  if (plan.manifest_version !== null) plan.downgrade = (compareVersions(plan.manifest_version, plan.version) ?? 0) > 0;
  // Which generator wrote the manifest. Differing alone is not behind: the
  // files may be exactly what this copy generates. A write records it.
  plan.identity_changed = manifest !== null
    && (plan.manifest_version !== plan.version || plan.manifest_source_digest !== plan.source_digest);

  if (manifest === null) plan.manifest = 'added';
  else if (manifest.layout_version !== LAYOUT_VERSION
    || JSON.stringify(sortedEntries(manifest.files)) !== JSON.stringify(sortedEntries(plan.files))) plan.manifest = 'changed';
  return plan;
}

/** @param {Record<string, string>} files */
function sortedEntries(files) {
  return Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1));
}

/** @param {GenerationPlan} plan */
function planIsBlocked(plan) {
  return plan.downgrade || plan.modified.length > 0 || plan.collisions.length > 0;
}

/** @param {GenerationPlan} plan */
function planIsCurrent(plan) {
  return !planIsBlocked(plan)
    && plan.changed.length === 0
    && plan.added.length === 0
    && plan.removed.length === 0
    && plan.manifest === null;
}

/**
 * A plan without file contents, for printing, `--json`, and `doctor`.
 * @param {GenerationPlan} plan
 */
export function publicPlan(plan) {
  const { files: _files, contents: _contents, ...rest } = plan;
  return { ...rest, current: planIsCurrent(plan), blocked: planIsBlocked(plan) };
}

/**
 * Refuse, before anything is written, a plan that would leave some generated
 * files old and others new: an agent reading a half-updated installation cannot
 * tell which half it has.
 *
 * @param {GenerationPlan} plan
 */
function refuseBlocked(plan) {
  if (!planIsBlocked(plan)) return;
  if (plan.downgrade) {
    throw new PublicError(
      `nothing was written: ${GENERATED_MANIFEST} was written by agenticloop ${plan.manifest_version}, newer than this copy, ${plan.version}, at ${plan.toolkit}`,
      {
        hint: [
          'Run the newer copy instead: move the version this repository pins, or run the',
          'checkout that wrote it with node <checkout>/bin/agenticloop.js. Check which copy',
          'runs with npx --no agenticloop version.',
        ].join('\n'),
      },
    );
  }
  const lines = [
    ...plan.modified.map((relative) => `  ${relative} (generated, then modified locally)`),
    ...plan.collisions.map((relative) => `  ${relative} (yours; not generated by this installation)`),
  ];
  throw new PublicError(`nothing was written: ${lines.length} generated path(s) would be left as they are\n${lines.join('\n')}`, {
    hint: [
      'Restore or move each file and run the command again, or name each one with',
      '--force-generated <path> to replace it with the generated version, or to',
      'delete it when it is no longer generated.',
    ].join('\n'),
  });
}

/**
 * Apply a plan that is not blocked. Writes only what differs, and rewrites the
 * manifest only when its contents change, so an update with nothing to do
 * leaves the working tree untouched.
 *
 * Writes are not transactional: a write that fails partway, such as on a full
 * disk, leaves some files new and the manifest old. Running update again
 * finishes the job, because a file that already holds what would be generated
 * is adopted. There is deliberately no rollback.
 *
 * @param {string} root
 * @param {GenerationPlan} plan
 */
function applyPlan(root, plan) {
  refuseBlocked(plan);
  for (const relative of [...plan.added, ...plan.changed]) {
    const full = containedPath(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, plan.contents[relative], 'utf8');
  }
  for (const relative of plan.removed) fs.rmSync(containedPath(root, relative));

  // Dropping a host from the config and running `update` is the documented way
  // to stop generating for it, so the directories it owned should not be left
  // standing empty afterwards, looking installed.
  pruneEmptyDirectories(root, plan.removed);

  const manifest = plan.manifest ?? (plan.identity_changed ? 'changed' : null);
  if (manifest !== null) {
    writeManifest(root, { layout_version: LAYOUT_VERSION, version: plan.version, source_digest: plan.source_digest, files: plan.files });
  }
  return { added: plan.added, changed: plan.changed, removed: plan.removed, unchanged: plan.unchanged, manifest };
}

/**
 * Install, or add a host to an installation.
 *
 * Naming a host adds it to the recorded set; it never replaces it. Under the
 * previous rule `setup --host claude` in a repository that already generated
 * for Codex left `hosts` as `["claude"]`, and the ownership pass then deleted
 * every Codex file it still owned. That is a tracked deletion nobody asked for,
 * and it made a contributor's own host choice a change to the whole repository.
 * Dropping a host is a deliberate edit to `agenticloop.json` followed by
 * `update`, which removes what it no longer generates.
 *
 * @param {string} root
 * @param {{hosts?: string[], force?: string[]}} [options]
 */
export function setup(root, options = {}) {
  const legacy = detectLegacyLayout(root);
  if (legacy.length > 0) refuseLegacy(legacy);

  const existing = readConfig(root);
  const added = [];
  for (const host of options.hosts ?? []) {
    if (!existing.hosts.includes(host) && !added.includes(host)) added.push(host);
  }
  const hosts = [...existing.hosts, ...added];
  if (hosts.length === 0) {
    throw new PublicError('no hosts selected', {
      hint: `Pass --host <name> (one or more of ${HOSTS.join(', ')}), or list them under "hosts" in ${CONFIG_FILE}.`,
    });
  }

  // Planned before anything is seeded, so a refusal leaves the tree as it was.
  const config = readConfig(root, { hosts });
  const plan = planGenerated(root, generateAll(hosts, { roleSettings: config.role_settings, roleRoutes: config.role_routes }), { force: options.force });
  refuseBlocked(plan);

  const created = seedState(root);
  writeConfig(root, hosts);
  const ignored = ensureGitignore(root);
  return { hosts, added_hosts: added, created, ignored, version: plan.version, ...applyPlan(root, plan) };
}

/**
 * Regenerate for the recorded hosts, refusing before any write when a file
 * would have to be left as it is. `check` plans and writes
 * nothing: it is how an agent or CI learns whether this repository is behind
 * the toolkit it just ran, which the package version alone cannot say, since
 * it does not change between unreleased builds.
 *
 * @param {string} root
 * @param {{force?: string[], check?: boolean}} [options]
 */
export function update(root, options = {}) {
  const legacy = detectLegacyLayout(root);
  if (legacy.length > 0) refuseLegacy(legacy);

  const config = readConfig(root);
  if (config.hosts.length === 0) {
    throw new PublicError(`${CONFIG_FILE} lists no hosts`, { hint: 'Run setup first.' });
  }
  const plan = planGenerated(root, generateAll(config.hosts, { roleSettings: config.role_settings, roleRoutes: config.role_routes }), { force: options.force });
  if (options.check) return { hosts: config.hosts, plan: publicPlan(plan) };
  return { hosts: config.hosts, version: plan.version, ...applyPlan(root, plan) };
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
    // update rebuilds a lost manifest, adopting files that already match, so
    // it is the command to run once hosts are recorded.
    findings.push({ level: 'warn', message: `${GENERATED_MANIFEST} is missing`, next: config.hosts.length > 0 ? 'Run update.' : 'Run setup.' });
  } else if (manifest.layout_version !== LAYOUT_VERSION) {
    findings.push({
      level: 'error',
      message: `${GENERATED_MANIFEST} declares layout_version ${manifest.layout_version}, expected ${LAYOUT_VERSION}`,
    });
  }

  // The same plan `update --check` prints, so the two never disagree about
  // whether this repository is current.
  /** @type {'current'|'behind'|'blocked'|null} */
  let generated = null;
  const layoutSpoken = manifest === null || manifest.layout_version === LAYOUT_VERSION;
  if (layoutSpoken && config.hosts.length > 0 && legacy.length === 0 && fs.existsSync(path.join(root, STATE_DIRECTORY))) {
    const plan = planGenerated(root, generateAll(config.hosts, { roleSettings: config.role_settings, roleRoutes: config.role_routes }));
    // This copy is older than the one that wrote the manifest, and refuses to
    // update, so neither update nor --force-generated is the way forward.
    const newer = plan.downgrade
      ? `Run the newer copy, agenticloop ${plan.manifest_version}, that wrote ${GENERATED_MANIFEST}; this copy, ${plan.version}, refuses to update.`
      : null;
    for (const relative of plan.modified) {
      findings.push({
        level: 'warn',
        message: `generated file modified locally: ${relative}`,
        next: newer ?? `update writes nothing until you restore it or pass --force-generated ${relative}, which overwrites the edit. `
          + 'A host reads its files when a session starts, so an edit takes effect only in a new session. '
          + `Change the canonical source or ${CONFIG_FILE} instead.`,
      });
    }
    for (const relative of plan.collisions) {
      findings.push({ level: 'warn', message: `a file of yours stands where one is generated: ${relative}`, next: newer ?? `update writes nothing until you move it or pass --force-generated ${relative}` });
    }
    const differing = plan.changed.length + plan.added.length + plan.removed.length;
    if (differing > 0) {
      findings.push({
        level: 'warn',
        message: `${differing} generated file(s) differ from what agenticloop ${plan.version} generates`,
        next: newer ?? 'Run update --check to list them, then update. Commit the result on its own and start a new host session.',
      });
    } else if (plan.manifest === 'changed') {
      findings.push({
        level: 'warn',
        message: `${GENERATED_MANIFEST} does not match the generated files`,
        next: newer ?? 'Run update to rewrite it, then commit it.',
      });
    }
    generated = planIsBlocked(plan) ? 'blocked' : planIsCurrent(plan) ? 'current' : 'behind';
  }

  if (manifest !== null) findings.push(...identityFindings(manifest));
  const scaffold = scaffoldFinding(root);
  if (scaffold) findings.push(scaffold);

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    hosts: config.hosts,
    version: manifest?.version ?? null,
    source_digest: manifest?.source_digest ?? null,
    toolkit_version: packageVersion(),
    toolkit_location: toolkitRoot(),
    toolkit_source_digest: sourceDigest(),
    generated,
    generated_files: manifest ? Object.keys(manifest.files).length : 0,
    findings,
  };
}

/**
 * Whether the copy running now is the one that wrote the manifest. A newer
 * manifest makes `setup` and `update` refuse; a different generator under
 * the same version is only worth knowing.
 *
 * @param {import('./generated.js').Manifest} manifest
 * @returns {{level: 'warn', message: string, next: string}[]}
 */
function identityFindings(manifest) {
  const running = packageVersion();
  const location = toolkitRoot();
  const order = manifest.version === '' ? null : compareVersions(manifest.version, running);
  if (order !== null && order > 0) {
    return [{
      level: 'warn',
      message: `${GENERATED_MANIFEST} was written by agenticloop ${manifest.version}, newer than the copy running now, ${running} at ${location}`,
      next: `setup and update refuse to write with this copy. Run the newer copy, agenticloop ${manifest.version}, or move the version this repository pins.`,
    }];
  }
  if (manifest.version !== running) {
    return [{
      level: 'warn',
      message: `${GENERATED_MANIFEST} was written by agenticloop ${manifest.version || 'an unknown version'}; the copy running now is ${running} at ${location}`,
      next: 'Check this is the copy you meant to run (npx --no agenticloop version), then run update --check.',
    }];
  }
  if (manifest.source_digest !== sourceDigest()) {
    return [{
      level: 'warn',
      message: manifest.source_digest === null
        ? `${GENERATED_MANIFEST} records no source_digest, so the build that wrote it is unknown`
        : `${GENERATED_MANIFEST} was written by a different build of agenticloop ${running} (${manifest.source_digest}); the copy running now is ${sourceDigest()} at ${location}`,
      next: 'Check this is the copy you meant to run. update records this build in the manifest.',
    }];
  }
  return [];
}

/**
 * `project.md` still exactly as `setup` seeded it. Agents read it for the
 * working policy, the checks, and the plan, and a scaffold says none of that.
 *
 * @param {string} root
 */
function scaffoldFinding(root) {
  const file = path.join(root, PROJECT_FILE);
  if (!fs.existsSync(file)) return null;
  const normalise = (/** @type {string} */ text) => text.replace(/\r\n/g, '\n').trim();
  const scaffold = fs.readFileSync(path.join(toolkitRoot(), 'memory', 'scaffold', 'project.md'), 'utf8');
  if (normalise(fs.readFileSync(file, 'utf8')) !== normalise(scaffold)) return null;
  return {
    level: /** @type {'warn'} */ ('warn'),
    message: `${PROJECT_FILE} is still the scaffold setup wrote`,
    next: 'Fill in what the project is, its working policy, its checks, its setup facts, and the documents that say what comes next.',
  };
}
