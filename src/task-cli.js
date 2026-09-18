/**
 * Record operations: new, list, show, lint, set.
 *
 * A dedicated command exists only where it does something materially better
 * than editing the record by hand. Everything here stays consistent with a
 * hand edit, and `show --json` agrees with whatever you wrote.
 */

import fs from 'node:fs';
import path from 'node:path';

import { checkRecord, mayBeDone } from './checks.js';
import { heading, json, out, table } from './cli-io.js';
import { toolkitRoot } from './adapter-generation.js';
import { PROJECT_FILE, TASKS_DIRECTORY } from './layout.js';
import { observe } from './observations.js';
import { parseRecord, STATUS_VALUES } from './record.js';
import { PublicError } from './public-error.js';

/** @param {string} root */
function tasksDirectory(root) {
  const directory = path.join(root, TASKS_DIRECTORY);
  if (!fs.existsSync(directory)) {
    throw new PublicError(`${TASKS_DIRECTORY}/ does not exist`, { hint: 'Run setup first.' });
  }
  return directory;
}

/** @param {string} root */
export function listRecordFiles(root) {
  const directory = tasksDirectory(root);
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => path.join(directory, name));
}

/** @param {string} root @param {string} id */
export function findRecord(root, id) {
  for (const file of listRecordFiles(root)) {
    const record = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
    if (String(record.frontmatter.id ?? '') === id) return { file, record };
  }
  throw new PublicError(`no task record with id ${id}`, { hint: `Looked in ${TASKS_DIRECTORY}/.` });
}

/** @param {string} root */
function nextId(root) {
  let highest = 0;
  for (const file of listRecordFiles(root)) {
    const record = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
    const match = String(record.frontmatter.id ?? '').match(/(\d+)\s*$/);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `T-${String(highest + 1).padStart(3, '0')}`;
}

/** @param {string} root @param {string} title */
export function taskNew(root, title) {
  if (!title || title.trim() === '') {
    throw new PublicError('a title is required', { hint: 'agenticloop task new "Short task title"' });
  }
  const id = nextId(root);
  const template = fs.readFileSync(path.join(toolkitRoot(), 'memory', 'task-record.md'), 'utf8');
  const content = template
    .replace(/^id: .*$/m, `id: ${id}`)
    .replace(/^title: .*$/m, `title: ${title.trim()}`);
  const file = path.join(tasksDirectory(root), `${id}.md`);
  if (fs.existsSync(file)) throw new PublicError(`${file} already exists`);
  fs.writeFileSync(file, content, 'utf8');
  out(`created ${path.relative(root, file)}`);
  return file;
}

/** @param {string} root @param {{json?: boolean}} [options] */
export function taskList(root, options = {}) {
  const rows = [];
  for (const file of listRecordFiles(root)) {
    const record = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
    rows.push({
      id: String(record.frontmatter.id ?? path.basename(file, '.md')),
      status: String(record.frontmatter.status ?? 'unknown'),
      title: String(record.frontmatter.title ?? ''),
      path: path.relative(root, file),
    });
  }
  if (options.json) {
    json(rows);
    return rows;
  }
  if (rows.length === 0) {
    out(`no task records in ${TASKS_DIRECTORY}/`);
    return rows;
  }
  table([['ID', 'STATUS', 'TITLE'], ...rows.map((row) => [row.id, row.status, row.title])]);
  return rows;
}

/**
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} root
 */
function reportFor(record, root) {
  const observations = observe(record, root);
  return checkRecord(record, observations);
}

/** @param {string} root @param {string} id @param {{json?: boolean}} [options] */
export function taskShow(root, id, options = {}) {
  const { file, record } = findRecord(root, id);
  const report = reportFor(record, root);
  if (options.json) {
    json({
      id: String(record.frontmatter.id ?? ''),
      path: path.relative(root, file),
      frontmatter: record.frontmatter,
      structural: report.structural,
      references: report.references,
      requirements: report.requirements,
    });
    return report;
  }
  out(fs.readFileSync(file, 'utf8').trimEnd());
  printReport(report);
  return report;
}

/** @param {ReturnType<typeof checkRecord>} report */
function printReport(report) {
  heading('Structural validity');
  if (report.structural.valid) out('valid');
  for (const error of report.structural.errors) out(`error  ${error.code}: ${error.message}`);
  for (const note of report.structural.info) out(`info   ${note.code}: ${note.message}`);

  heading('Reference availability');
  if (report.references.length === 0) out('no references recorded');
  for (const reference of report.references) out(`${reference.available.padEnd(12)} ${reference.kind}  ${reference.ref}`);

  heading('Requirement evaluation');
  if (report.requirements.length === 0) out('no requirements declared');
  for (const requirement of report.requirements) {
    out(`${requirement.status.padEnd(14)} ${requirement.requirement}  (${requirement.reason})`);
    for (const fact of requirement.facts) out(`               ${fact.trust.padEnd(9)} ${fact.fact}`);
  }
}

/**
 * Never writes. Exits non-zero on a structural error, or on `status: done`
 * with a requirement that is not satisfied.
 * @param {string} root
 * @param {string|null} id
 * @param {{json?: boolean}} [options]
 */
export function taskLint(root, id, options = {}) {
  const targets = id
    ? [findRecord(root, id)]
    : listRecordFiles(root).map((file) => ({ file, record: parseRecord(fs.readFileSync(file, 'utf8'), { path: file }) }));

  const reports = [];
  let failed = false;

  for (const { file, record } of targets) {
    const report = reportFor(record, root);
    const status = String(record.frontmatter.status ?? '');
    const unsatisfied = report.requirements.filter((requirement) => requirement.status !== 'satisfied');
    const claimsDone = status === 'done' && unsatisfied.length > 0;
    if (!report.structural.valid || claimsDone) failed = true;

    reports.push({
      id: String(record.frontmatter.id ?? path.basename(file, '.md')),
      path: path.relative(root, file),
      structural: report.structural,
      references: report.references,
      requirements: report.requirements,
      claims_done_unsatisfied: claimsDone,
    });

    if (!options.json) {
      heading(`${String(record.frontmatter.id ?? path.basename(file, '.md'))}  ${path.relative(root, file)}`);
      printReport(report);
      if (claimsDone) {
        out('');
        out(`error  status.done_unsatisfied: status is done but ${unsatisfied.length} requirement(s) are not satisfied`);
      }
    }
  }

  if (options.json) json({ ok: !failed, records: reports });
  return { ok: !failed, reports };
}

/**
 * One safe frontmatter write. `status done` is validated; everything else is not.
 * @param {string} root
 * @param {string} id
 * @param {string} field
 * @param {string} value
 */
export function taskSet(root, id, field, value) {
  if (field === undefined || value === undefined) {
    throw new PublicError('a field and a value are required', { hint: 'agenticloop task set T-001 status in_review' });
  }
  const { file, record } = findRecord(root, id);

  if (field === 'status') {
    if (!STATUS_VALUES.includes(value)) {
      throw new PublicError(`unknown status value ${value}`, { hint: `Known values: ${STATUS_VALUES.join(', ')}.` });
    }
    if (value === 'done') {
      const verdict = mayBeDone(record, observe(record, root));
      if (!verdict.allowed) {
        const lines = verdict.blocking.map((requirement) => `  ${requirement.requirement}: ${requirement.status} (${requirement.reason})`);
        throw new PublicError(
          `${id} declares requirements that are not satisfied, so status was not changed:\n${lines.join('\n')}`,
          { hint: 'Record the missing evidence or assessment, or change the declared requirements. Nothing was written.' },
        );
      }
    }
  }

  const text = fs.readFileSync(file, 'utf8');
  const updated = writeFrontmatterField(text, field, value);
  fs.writeFileSync(file, updated, 'utf8');
  out(`${id}: ${field} = ${value}`);
  return file;
}

/**
 * Replace one scalar frontmatter field in place, preserving everything else
 * including comments and formatting.
 * @param {string} text
 * @param {string} field
 * @param {string} value
 */
export function writeFrontmatterField(text, field, value) {
  const match = text.match(/^(---\s*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!match) throw new PublicError('the record has no --- delimited frontmatter');
  const [, open, body, close] = match;
  const pattern = new RegExp(`^${field.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:.*$`, 'm');
  const line = `${field}: ${value}`;
  const nextBody = pattern.test(body) ? body.replace(pattern, line) : `${body}\n${line}`;
  return `${open}${nextBody}${close}${text.slice(match[0].length)}`;
}

/** @param {string} root */
export function projectPolicy(root) {
  const file = path.join(root, PROJECT_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
