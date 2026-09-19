/**
 * The CLI: thirteen command paths.
 *
 * Installation, diagnostics, and minimal record operations. A dedicated command
 * exists only where it does something materially better than editing a record
 * by hand.
 */

import fs from 'node:fs';
import path from 'node:path';

import { err, json, out } from './cli-io.js';
import { decisionNew } from './decision-cli.js';
import { toolkitRoot } from './adapter-generation.js';
import { HOSTS } from './layout.js';
import { PublicError } from './public-error.js';
import { doctor, remove, setup, update } from './setup.js';
import { taskLint, taskList, taskNew, taskSet, taskShow } from './task-cli.js';
import { validate } from './validate.js';

/** Every command path this CLI answers to. The help output is generated from it. */
export const COMMAND_PATHS = Object.freeze([
  { path: 'setup', summary: 'Install for the selected hosts and record what was generated.' },
  { path: 'update', summary: 'Regenerate owned files; skip ones you modified unless forced.' },
  { path: 'remove', summary: 'Remove generated files we still own. Records are kept.' },
  { path: 'doctor', summary: 'Read-only diagnosis of the installation.' },
  { path: 'validate', summary: 'Check skills, config, links, and generated adapter output.' },
  { path: 'task new', summary: 'Create a task record from the template.' },
  { path: 'task list', summary: 'List task records with their ids, titles, and statuses.' },
  { path: 'task show', summary: 'Print one record. --json adds the three check outputs.' },
  { path: 'task lint', summary: 'Report structural validity, references, and requirements. Never writes.' },
  { path: 'task set', summary: 'One safe frontmatter write.' },
  { path: 'decision new', summary: 'Create a decision record from the template.' },
  { path: 'version', summary: 'Print the version.' },
  { path: 'help', summary: 'Print this list.' },
]);

/** @param {string[]} argv */
export function parseArgs(argv) {
  const positionals = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  const repeated = { host: /** @type {string[]} */ ([]), 'force-generated': /** @type {string[]} */ ([]) };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split('=', 2);
    if (name === 'host' || name === 'force-generated') {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new PublicError(`--${name} needs a value`);
      repeated[name].push(value);
      continue;
    }
    flags[name] = inline ?? true;
  }
  return { positionals, flags, hosts: repeated.host, force: repeated['force-generated'] };
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(toolkitRoot(), 'package.json'), 'utf8')).version;
}

function help() {
  out('agenticloop <command> [options]\n');
  out('Agentic Loop provides a small, portable vocabulary for agent work.');
  out('Agents choose the workflow. Hosts execute it.\n');
  out('Commands:');
  const width = Math.max(...COMMAND_PATHS.map((entry) => entry.path.length));
  for (const entry of COMMAND_PATHS) out(`  ${entry.path.padEnd(width)}  ${entry.summary}`);
  out('\nOptions:');
  out('  --json                    Machine-readable output where supported.');
  out(`  --host <name>             Add a project-supported host (${HOSTS.join(', ')}). Repeatable.`);
  out('  --force-generated <path>  Overwrite one generated file you modified. Repeatable.');
  out('  --debug                   Print internal stack details.');
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
 * @param {string[]} argv
 * @param {{cwd?: string}} [options]
 * @returns {number} exit code
 */
export function run(argv, options = {}) {
  const root = options.cwd ?? process.cwd();
  const { positionals, flags, hosts, force } = parseArgs(argv);
  const asJson = flags.json === true;
  const command = positionals[0];

  if (command === undefined || command === 'help' || flags.help === true) {
    help();
    return 0;
  }

  switch (command) {
    case 'version': {
      out(version());
      return 0;
    }

    case 'setup': {
      const result = setup(root, { hosts, force });
      if (asJson) { json(result); return 0; }
      out(`installed for ${result.hosts.join(', ')}`);
      // Only worth saying when something was already there to add to.
      if (result.added.length > 0 && result.added.length !== result.hosts.length) {
        out(`  added   ${result.added.join(', ')}`);
      }
      for (const created of result.created) out(`  created ${created}`);
      for (const written of result.written) out(`  wrote   ${written}`);
      for (const skipped of result.skipped) out(`  skipped ${skipped} (modified locally)`);
      for (const collision of result.collisions) out(`  kept    ${collision} (yours; not overwritten)`);
      return 0;
    }

    case 'update': {
      const result = update(root, { force });
      if (asJson) { json(result); return 0; }
      for (const written of result.written) out(`  wrote   ${written}`);
      for (const skipped of result.skipped) out(`  skipped ${skipped} (modified locally; pass --force-generated to overwrite)`);
      for (const collision of result.collisions) out(`  kept    ${collision} (yours; not overwritten)`);
      for (const removed of result.removed) out(`  removed ${removed} (no longer generated)`);
      if (result.written.length === 0 && result.skipped.length === 0) out('everything is up to date');
      return 0;
    }

    case 'remove': {
      const result = remove(root);
      if (asJson) { json(result); return 0; }
      for (const removed of result.removed) out(`  removed ${removed}`);
      for (const kept of result.kept) out(`  kept    ${kept} (modified locally)`);
      out('records under .agenticloop/ were not touched');
      return 0;
    }

    case 'doctor': {
      const report = doctor(root);
      // --json changes the shape of the output, never the verdict.
      if (asJson) { json(report); return report.ok ? 0 : 1; }
      out(`hosts: ${report.hosts.length > 0 ? report.hosts.join(', ') : 'none configured'}`);
      out(`generated files: ${report.generated_files}`);
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
          if (!positionals[2]) throw new PublicError('a task id is required', { hint: 'agenticloop task show T-001' });
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

    case 'decision': {
      if (positionals[1] !== 'new') {
        throw new PublicError(`unknown command: decision ${positionals[1] ?? ''}`.trim(), { hint: 'Known: decision new.' });
      }
      decisionNew(root, positionals.slice(2).join(' '));
      return 0;
    }

    default:
      throw new PublicError(`unknown command: ${command}`, { hint: 'Run `agenticloop help` for the command list.' });
  }
}

/** @param {string[]} argv */
export function main(argv) {
  const debug = argv.includes('--debug');
  try {
    return run(argv.filter((token) => token !== '--debug'));
  } catch (error) {
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
