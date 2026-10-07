/**
 * The CLI: sixteen command paths.
 *
 * Installation, diagnostics, and minimal record operations. A dedicated command
 * exists only where it does something materially better than editing a record
 * by hand.
 */

import fs from 'node:fs';
import path from 'node:path';

import { err, json, out } from './cli-io.js';
import { decisionList, decisionNew } from './decision-cli.js';
import { toolkitRoot } from './adapter-generation.js';
import { CONFIG_FILE, GENERATED_MANIFEST, HOSTS } from './layout.js';
import { PublicError } from './public-error.js';
import { doctor, remove, setup, update } from './setup.js';
import { taskLint, taskList, taskNew, taskSet, taskShow } from './task-cli.js';
import { takeSnapshot } from './snapshot.js';
import { validate } from './validate.js';
import { reportCommand } from './report-cli.js';

/**
 * Every flag the CLI knows. `--debug` and `--help` are global; every other
 * flag belongs to the commands that list it in `COMMAND_PATHS`.
 */
export const FLAGS = Object.freeze({
  json: { value: false, summary: 'Machine-readable output.' },
  host: { value: '<name>', summary: 'Add a project-supported host. Repeatable.' },
  'force-generated': { value: '<path>', summary: 'Replace or delete one generated file that would otherwise be refused. Repeatable.' },
  check: { value: false, summary: 'With update: list what would change, write nothing, exit 1 unless current.' },
  debug: { value: false, summary: 'Print internal stack details.' },
  help: { value: false, summary: 'Print this list.' },
});

/** Accepted by every command. */
export const GLOBAL_FLAGS = Object.freeze(['debug', 'help']);

/**
 * Every command path this CLI answers to, the flags each accepts, and how many
 * arguments follow the path (`Infinity` where the rest is joined into a title
 * or a value). The help output and the usage refusal are both generated from it.
 */
export const COMMAND_PATHS = Object.freeze([
  { path: 'setup', flags: ['host', 'force-generated', 'json'], args: 0, summary: 'Install for the selected hosts and record what was generated.' },
  { path: 'update', flags: ['check', 'force-generated', 'json'], args: 0, summary: 'Regenerate owned files; refuse before writing on a conflict. --check writes nothing.' },
  { path: 'remove', flags: ['json'], args: 0, summary: 'Remove generated files we still own. Records are kept.' },
  { path: 'doctor', flags: ['json'], args: 0, summary: 'Read-only diagnosis of the installation.' },
  { path: 'validate', flags: ['json'], args: 0, summary: 'Check skills, config, links, and generated adapter output.' },
  { path: 'task new', flags: [], args: Infinity, summary: 'Create a task record from the template.' },
  { path: 'task list', flags: ['json'], args: 0, summary: 'List task records with their ids, titles, and statuses.' },
  { path: 'task show', flags: ['json'], args: 1, summary: 'Print one record. --json adds the three check outputs.' },
  { path: 'task lint', flags: ['json'], args: 1, summary: 'Report structural validity, references, and requirements. Never writes.' },
  { path: 'task set', flags: [], args: Infinity, summary: 'One safe frontmatter write.' },
  { path: 'decision new', flags: [], args: Infinity, summary: 'Create a decision record from the template.' },
  { path: 'decision list', flags: ['json'], args: 0, summary: 'List decision records with their ids, statuses, dates, and titles.' },
  { path: 'report', flags: ['json'], args: 1, summary: 'Read-only project, task or decision account: report [<id>].' },
  { path: 'snapshot', flags: ['json'], args: 0, summary: 'Name the working tree as a tree:<sha> candidate reference. Writes no record.' },
  { path: 'version', flags: [], args: 0, summary: 'Print the version.' },
  { path: 'help', flags: [], args: 0, summary: 'Print this list.' },
]);

/**
 * A refusal about how the command was typed. It exits 2, so a caller can tell
 * it from a command that ran and reported something, such as `update --check`
 * exiting 1 because the installation is behind.
 * @param {string} message @param {string} [hint]
 */
function usageError(message, hint) {
  return new PublicError(message, { exitCode: 2, hint: hint ?? 'Run `npx --no castwork help` for the commands and their flags.' });
}

/** How to pass an argument that starts with a dash, said wherever one is refused as a flag. */
const DASH_ARGUMENT = 'An argument that starts with a dash goes after --, as in: task new -- "-x title".';

/** @param {string} name */
function spell(name) {
  const { value } = FLAGS[/** @type {keyof typeof FLAGS} */ (name)];
  return value ? `--${name} ${value}` : `--${name}`;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const positionals = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  /** Every flag named, in order, so a command can refuse one it does not take. */
  const named = /** @type {string[]} */ ([]);
  const repeated = { host: /** @type {string[]} */ ([]), 'force-generated': /** @type {string[]} */ ([]) };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    // After a bare `--` every token is an argument, so a title or a value may
    // start with a dash: `task new -- "-x title"`.
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    // A single-dash option is refused rather than read as an argument: none is
    // accepted, and `update -check` must not run as a plain `update`.
    if (/^-[A-Za-z]/.test(token)) {
      throw usageError(`unknown flag ${token}`, `Flags are spelled with two dashes. ${DASH_ARGUMENT} Nothing was read or written.`);
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const separator = token.indexOf('=');
    const name = separator < 0 ? token.slice(2) : token.slice(2, separator);
    const inline = separator < 0 ? undefined : token.slice(separator + 1);
    if (!Object.hasOwn(FLAGS, name)) {
      throw usageError(`unknown flag --${name}`, `Known flags: ${Object.keys(FLAGS).map(spell).join(', ')}. ${DASH_ARGUMENT} Nothing was read or written.`);
    }
    named.push(name);
    if (name === 'host' || name === 'force-generated') {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw usageError(`--${name} needs a value`);
      // `update --force-generated --check` read `--check` as the path, and the
      // check was silently lost. A value that starts with a dash goes after `=`.
      if (inline === undefined && value.startsWith('-')) {
        throw usageError(`--${name} needs a value, not ${value}`, `Write the value after it, as in ${spell(name)}; one that starts with a dash goes after =, as in --${name}=-x. Nothing was read or written.`);
      }
      repeated[name].push(value);
      continue;
    }
    // `--check=yes` used to be read as a string rather than as `--check`, which
    // ran a writing update. A switch takes no value.
    if (inline !== undefined) throw usageError(`--${name} takes no value`, `Write --${name} on its own. Nothing was read or written.`);
    flags[name] = true;
  }
  return { positionals, flags, named, hosts: repeated.host, force: repeated['force-generated'] };
}

/**
 * Refuse, before anything is read or written, a flag the command does not take
 * or an argument it has no place for. An old copy of this CLI accepted any
 * flag, so `update --check` run by a copy without `--check` rewrote tracked
 * files as a plain `update`.
 *
 * @param {string[]} positionals
 * @param {string[]} named
 */
export function checkUsage(positionals, named) {
  const command = positionals[0];
  if (command === undefined) {
    const stray = named.filter((flag) => !GLOBAL_FLAGS.includes(flag));
    if (stray.length > 0 && !named.includes('help')) throw usageError(`--${stray[0]} needs a command`);
    return null;
  }
  const entry = COMMAND_PATHS.find((candidate) => candidate.path === `${command} ${positionals[1] ?? ''}`)
    ?? COMMAND_PATHS.find((candidate) => candidate.path === command);
  if (!entry) {
    if (command === 'task' || command === 'decision') {
      const known = COMMAND_PATHS.filter((candidate) => candidate.path.startsWith(`${command} `)).map((candidate) => candidate.path);
      throw usageError(`unknown command: ${command} ${positionals[1] ?? ''}`.trim(), `Known: ${known.join(', ')}.`);
    }
    throw usageError(`unknown command: ${command}`);
  }
  // `--help` prints the list, whatever else was typed.
  if (named.includes('help')) return entry;
  for (const flag of named) {
    if (GLOBAL_FLAGS.includes(flag) || entry.flags.includes(flag)) continue;
    const accepted = [...entry.flags, ...GLOBAL_FLAGS].map(spell).join(', ');
    throw usageError(`${entry.path} does not take --${flag}`, `${entry.path} accepts ${accepted}. Nothing was read or written.`);
  }
  const extra = positionals.length - entry.path.split(' ').length - entry.args;
  if (extra > 0) {
    throw usageError(`${entry.path} does not take the argument ${positionals[positionals.length - extra]}`, 'Nothing was read or written.');
  }
  return entry;
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(toolkitRoot(), 'package.json'), 'utf8')).version;
}

function help() {
  out('castwork <command> [options]\n');
  out('Castwork: shared task records and roles for agent work.');
  out('Agents choose the workflow. Hosts execute it.\n');
  out('Commands:');
  const width = Math.max(...COMMAND_PATHS.map((entry) => entry.path.length));
  for (const entry of COMMAND_PATHS) {
    out(`  ${entry.path.padEnd(width)}  ${entry.summary}`);
    if (entry.flags.length > 0) out(`  ${''.padEnd(width)}  flags: ${entry.flags.map(spell).join(', ')}`);
  }
  out('\nFlags:');
  const flagWidth = Math.max(...Object.keys(FLAGS).map((name) => spell(name).length));
  for (const [name, flag] of Object.entries(FLAGS)) {
    const hosts = name === 'host' ? ` One of ${HOSTS.join(', ')}.` : '';
    const scope = GLOBAL_FLAGS.includes(name) ? ' Any command.' : '';
    out(`  ${spell(name).padEnd(flagWidth)}  ${flag.summary}${hosts}${scope}`);
  }
  out('\nA flag a command does not take is refused, exit 2, before anything is read or written.');
  out('Through npx, run `npx --no castwork help`: npm itself consumes --help.');
  out('\nRecords are ordinary Markdown. Editing one by hand is a first-class way to use this.');
}

/** @param {{findings: {level: string, where?: string, message: string, next?: string}[]}} report */
function printFindings(report) {
  for (const finding of report.findings) {
    const where = finding.where ? `${finding.where}: ` : '';
    out(`${finding.level.padEnd(5)} ${where}${finding.message}`);
    if (finding.next) out(`      → ${finding.next}`);
  }
}

/**
 * Every path written, the manifest included: it is tracked, and committing the
 * files without it leaves digests that make the next update refuse them.
 * @param {{added: string[], changed: string[], removed: string[], manifest: 'added'|'changed'|null}} result
 * @returns {boolean} whether anything was listed
 */
function printChanges(result) {
  for (const relative of result.changed) out(`  changed ${relative}`);
  for (const relative of result.added) out(`  added   ${relative}`);
  for (const relative of result.removed) out(`  removed ${relative} (no longer generated)`);
  if (result.manifest !== null) out(`  ${result.manifest.padEnd(7)} ${GENERATED_MANIFEST}`);
  return result.changed.length + result.added.length + result.removed.length > 0 || result.manifest !== null;
}

/** Said after every update that changed something, because nothing else will. */
const HANDOFF = [
  'Review the files listed above and commit them together, with whatever caused them (an',
  `${CONFIG_FILE} edit, or a package or lockfile upgrade), apart from task work.`,
  'Running host sessions keep the instructions and model settings they started with:',
  'start a new session, then run the entry command again (/castwork, or $castwork in Codex).',
].join('\n');

/**
 * @param {string[]} argv
 * @param {{cwd?: string}} [options]
 * @returns {number} exit code
 */
export function run(argv, options = {}) {
  const root = options.cwd ?? process.cwd();
  const { positionals, flags, named, hosts, force } = parseArgs(argv);
  checkUsage(positionals, named);
  const asJson = flags.json === true;
  const command = positionals[0];

  if (command === 'report' && flags.help === true && asJson) {
    json({complete: true, problems: [], usage: 'castwork report [<id>] [--json]'});
    return 0;
  }
  if (command === undefined || command === 'help' || flags.help === true) {
    help();
    return 0;
  }

  switch (command) {
    case 'report':
      return reportCommand(root, positionals[1] ?? null, {json: asJson}).code;

    case 'version': {
      out(version());
      return 0;
    }

    case 'setup': {
      const result = setup(root, { hosts, force });
      if (asJson) { json(result); return 0; }
      out(`installed for ${result.hosts.join(', ')}`);
      // Only worth saying when something was already there to add to.
      if (result.added_hosts.length > 0 && result.added_hosts.length !== result.hosts.length) {
        out(`  host    ${result.added_hosts.join(', ')}`);
      }
      for (const created of result.created) out(`  created ${created}`);
      printChanges(result);
      return 0;
    }

    case 'update': {
      if (flags.check === true) {
        const { plan } = update(root, { force, check: true });
        if (asJson) { json(plan); return plan.current ? 0 : 1; }
        out(`toolkit: castwork ${plan.version} (${plan.toolkit})`);
        out(`source:  ${plan.source_digest}`);
        if (plan.identity_changed) {
          out(`manifest: written by castwork ${plan.manifest_version ?? 'unknown'} (${plan.manifest_source_digest ?? 'no source_digest'})`);
        }
        printChanges(plan);
        if (plan.downgrade) out(`  blocked ${GENERATED_MANIFEST} (written by castwork ${plan.manifest_version}, newer than this copy)`);
        for (const relative of plan.modified) out(`  blocked ${relative} (generated, then modified locally)`);
        for (const relative of plan.collisions) out(`  blocked ${relative} (yours; not generated by this installation)`);
        if (plan.current && plan.identity_changed) out('up to date; warn: a different build wrote the manifest, and update would record this one');
        else if (plan.current) out('up to date');
        else if (plan.downgrade) out('update would write nothing: run the newer copy of castwork instead');
        else if (plan.blocked) out('update would write nothing until each blocked file is restored, moved, or named with --force-generated');
        else out('run update to apply these changes');
        return plan.current ? 0 : 1;
      }
      const result = update(root, { force });
      if (asJson) { json(result); return 0; }
      if (printChanges(result)) out(HANDOFF);
      else out('everything is up to date');
      return 0;
    }

    case 'remove': {
      const result = remove(root);
      if (asJson) { json(result); return 0; }
      for (const removed of result.removed) out(`  removed ${removed}`);
      for (const kept of result.kept) out(`  kept    ${kept} (modified locally)`);
      out('records under .castwork/ were not touched');
      return 0;
    }

    case 'doctor': {
      const report = doctor(root);
      // --json changes the shape of the output, never the verdict.
      if (asJson) { json(report); return report.ok ? 0 : 1; }
      out(`running: castwork ${report.toolkit_version} at ${report.toolkit_location} (${report.toolkit_source_digest})`);
      out(`manifest: ${report.version === null ? 'none' : `castwork ${report.version || 'unknown'} (${report.source_digest ?? 'no source_digest'})`}`);
      out(`hosts: ${report.hosts.length > 0 ? report.hosts.join(', ') : 'none configured'}`);
      out(`generated files: ${report.generated_files}${report.generated ? ` (${report.generated}; toolkit ${report.toolkit_version})` : ''}`);
      if (report.findings.length === 0) out('no findings');
      printFindings(report);
      return report.ok ? 0 : 1;
    }

    case 'validate': {
      const report = validate(root);
      if (asJson) { json(report); return report.ok ? 0 : 1; }
      if (report.findings.length === 0) out('validate: no findings');
      printFindings(report);
      return report.ok ? 0 : 1;
    }

    case 'task': {
      const sub = positionals[1];
      switch (sub) {
        case 'new':
          taskNew(root, positionals.slice(2).join(' '));
          return 0;
        case 'list':
          taskList(root, { json: asJson });
          return 0;
        case 'show':
          if (!positionals[2]) throw usageError('task show needs a task id', 'castwork task show T-001. Nothing was read or written.');
          taskShow(root, positionals[2], { json: asJson });
          return 0;
        case 'lint': {
          const result = taskLint(root, positionals[2] ?? null, { json: asJson });
          return result.ok ? 0 : 1;
        }
        case 'set':
          taskSet(root, positionals[2], positionals[3], positionals.slice(4).join(' '));
          return 0;
        default:
          throw new PublicError(`unknown command: task ${sub ?? ''}`.trim(), {
            hint: 'Known: task new, task list, task show, task lint, task set.',
          });
      }
    }

    case 'snapshot': {
      const snapshot = takeSnapshot(root);
      if (asJson) { json(snapshot); return 0; }
      out(snapshot.ref);
      out(`base: ${snapshot.base ?? 'none (no commit yet)'}`);
      out(`differs from base in ${snapshot.paths.length} path${snapshot.paths.length === 1 ? '' : 's'}`);
      for (const relative of snapshot.paths) out(`  ${relative}`);
      return 0;
    }

    case 'decision': {
      const sub = positionals[1];
      switch (sub) {
        case 'new':
          decisionNew(root, positionals.slice(2).join(' '));
          return 0;
        case 'list':
          decisionList(root, { json: asJson });
          return 0;
        default:
          throw new PublicError(`unknown command: decision ${sub ?? ''}`.trim(), { hint: 'Known: decision new, decision list.' });
      }
    }

    default:
      throw new PublicError(`unknown command: ${command}`, { hint: 'Run `castwork help` for the command list.' });
  }
}

/** @param {string[]} argv */
export function main(argv) {
  // `--debug` is a flag only before a bare `--`; after it, it is an argument.
  const end = argv.indexOf('--');
  const options = end < 0 ? argv : argv.slice(0, end);
  const debug = options.includes('--debug');
  // Identify the command without accepting malformed flags, so a task title
  // containing "report" never changes another command's error output.
  let requestCommand;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      requestCommand = argv[index + 1];
      break;
    }
    if (token === '--host' || token === '--force-generated') {
      index += 1;
      continue;
    }
    if (!token.startsWith('-')) {
      requestCommand = token;
      break;
    }
  }
  try {
    return run([...options.filter((token) => token !== '--debug'), ...(end < 0 ? [] : argv.slice(end))]);
  } catch (error) {
    // Report promises one JSON document even when argument parsing refuses it.
    if (requestCommand === 'report' && options.some((token) => /^--json(?:=|$)/.test(token))) {
      json({complete: false, problems: [{code: error instanceof PublicError && error.exitCode === 2 ? 'report.usage' : 'report.operation_failed', message: error instanceof Error ? error.message : String(error), incomplete: true}]});
    }
    if (error instanceof PublicError) {
      err(`error: ${error.message}`);
      if (error.hint) err(error.hint);
      if (debug && error.stack) err(error.stack);
      return error.exitCode;
    }
    err(`error: ${error instanceof Error ? error.message : String(error)}`);
    if (debug && error instanceof Error && error.stack) err(error.stack);
    return 1;
  }
}
