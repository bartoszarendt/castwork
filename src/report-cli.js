/** Report I/O only: record reads and optional, read-only local Git observations. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { recordDirectory } from './generated.js';
import { parseRecord } from './record.js';
import { deriveReport } from './report.js';
import { renderReport } from './report-text.js';
import { out, json, err } from './cli-io.js';

/** @param {unknown} error */
const message = (error) => error instanceof Error ? error.message : String(error);
/** @param {string} root @returns {import('./report.js').GitObservation} */
export function reportGit(root) {
  const git = (/** @type {string[]} */ args) => execFileSync(
    'git', ['--no-optional-locks', '-C', root, ...args],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 10000},
  );
  try {
    // Exactly one log for the entire corpus. --relative also supports a project
    // root below the Git root. Dates mean commits visible here, not lifetimes.
    const log = git(['log', '--format=%x1e%cI', '--name-only', '-z', '--relative', '--no-renames', '--', '.castwork/']);
    /** @type {Record<string, import('./report.js').GitRecord>} */
    const records = Object.create(null);
    for (const commit of log.split('\x1e').slice(1)) {
      const [date, ...files] = commit.split('\0');
      for (const raw of files) {
        const file = raw.replace(/^\n/, '');
        if (!file) continue;
        records[file] ??= {};
        const entry = records[file];
        // Min/max commit dates are not document selection or creation/closure.
        if (!entry.first_commit || Date.parse(date) < Date.parse(entry.first_commit)) entry.first_commit = date;
        if (!entry.last_commit || Date.parse(date) > Date.parse(entry.last_commit)) entry.last_commit = date;
      }
    }
    const prefix = git(['rev-parse', '--show-prefix']).trim();
    // Porcelain paths are always repository-relative, unlike --relative log.
    const projectPath = (/** @type {string} */ file) => prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
    const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.castwork/']).split('\0');
    for (let index = 0; index < status.length; index += 1) {
      const row = status[index];
      if (!row) continue;
      const file = projectPath(row.slice(3));
      records[file] ??= {};
      records[file].uncommitted = true;
      if (/[RC]/.test(row.slice(0, 2))) {
        const source = projectPath(status[++index] ?? '');
        if (source) {
          records[source] ??= {};
          records[source].uncommitted = true;
        }
      }
    }
    return {records};
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : message(error);
    return {omitted: `local Git observations unavailable: ${stderr || message(error)}`};
  }
}
/** @param {string} root */
export function readReportInputs(root) {
  /** @type {import('./report.js').ReportInput[]} */
  const inputs = [];
  /** @type {import('./report.js').Problem[]} */
  const problems = [];
  const fail = (/** @type {string} */ file, /** @type {unknown} */ error) => problems.push({code: 'report.read_failed', path: file, message: message(error), incomplete: true});
  for (const kind of /** @type {const} */ (['task','decision'])) {
    const directory = `.castwork/${kind === 'task' ? 'tasks' : 'decisions'}`;
    let names;
    let resolved;
    try {
      resolved = recordDirectory(root, directory);
      names = fs.existsSync(resolved) ? fs.readdirSync(resolved).filter((name) => name.endsWith('.md')).sort() : [];
    } catch (error) {
      fail(directory, error);
      continue;
    }
    for (const name of names) {
      const relative = `${directory}/${name}`;
      let text;
      try {
        // recordDirectory validated all parent components and resolved the root
        // once. Names come from readdir, but still must be a single segment on
        // both supported separator conventions. Check the leaf AND its real
        // destination: lstat alone would miss a redirected parent directory.
        if (/[\\/]/.test(name) || name === '.' || name === '..') throw new Error(`invalid record file name: ${name}`);
        const file = path.join(resolved, name);
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error(`the installation resolves through a symbolic link: ${relative}`);
        if (path.relative(file, fs.realpathSync.native(file)) !== '') throw new Error(`record path resolves through a redirected parent: ${relative}`);
        if (!stat.isFile()) continue;
        text = fs.readFileSync(file, 'utf8');
      } catch (error) {
        fail(relative, error);
        continue;
      }
      // Parsing/check defects are not filesystem failures. Expected YAML
      // diagnostics are returned by parseRecord and handled by derivation.
      const record = parseRecord(text, {path: relative});
      const bodyLine = text.slice(0, text.length - record.body.length).split('\n').length;
      inputs.push({record, kind, body_line: bodyLine});
    }
  }
  return {inputs, problems};
}
/** @param {string} root @param {string|null} id @param {{json?: boolean}} [options] */
export function reportCommand(root, id, options = {}) {
  const {inputs, problems} = readReportInputs(root);
  const git = reportGit(root);
  const report = deriveReport(inputs, {git, problems, project: path.basename(path.resolve(root))});
  let code = problems.length ? 1 : 0;
  let selected = null;
  if (id !== null) {
    const matches = report.records.filter((record) => record.id !== '' && record.id === id);
    if (matches.length !== 1) {
      report.complete = false;
      report.problems.push({code: matches.length ? 'report.id_ambiguous' : 'report.id_unknown', message: matches.length ? `id ${id} is declared by ${matches.map((r) => r.path).join(', ')}` : `no task or decision record declares id ${id}`, incomplete: true});
      code = 1;
    } else {
      selected = matches[0];
    }
  }
  // A selected JSON view retains corpus relations and the entire selected file,
  // but does not repeat all other large bodies and histories.
  const result = id === null ? {view: 'project', ...report} : {
    ...report, view: selected?.kind ?? 'selection', selected,
    records: report.records.map((record) => ({
      id: record.id, path: record.path, kind: record.kind, status: record.status, title: record.title,
    })),
    recent: [], attention: [],
  };
  if (options.json) {
    json(result);
    for (const problem of report.problems) err(`${problem.code}${problem.path ? ` ${problem.path}` : ''}: ${problem.message}`);
    if (git.omitted) err(git.omitted);
  } else {
    const selectionProblem = report.problems.find((problem) => problem.code === 'report.id_unknown' || problem.code === 'report.id_ambiguous');
    if (selectionProblem) err(`error: ${selectionProblem.message}`);
    else out(renderReport(report, selected));
    for (const problem of problems) err(`${problem.code} ${problem.path}: ${problem.message}`);
  }
  return {code, report: result};
}
