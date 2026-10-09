/**
 * Record operations: new, list, show, lint, set.
 *
 * A dedicated command exists only where it does something materially better
 * than editing the record by hand. Everything here stays consistent with a
 * hand edit, and `show --json` agrees with whatever you wrote.
 */

import fs from 'node:fs';
import path from 'node:path';

import { checkRecord, currentCandidate, duplicateIdErrors, mayBeDone, readyToClose, requirementEvaluation, structuralValidity } from './checks.js';
import { err, heading, json, out, table } from './cli-io.js';
import { toolkitRoot } from './adapter-generation.js';
import { recordDirectory, recordFiles } from './generated.js';
import { PROJECT_FILE, TASKS_DIRECTORY } from './layout.js';
import { observationContext, observe, prefetchObjects } from './observations.js';
import { declaredRequirements, parseRecord, recordEntries, recordValueText, STATUS_VALUES } from './record.js';
import { formatScalar } from './yaml.js';
import { PublicError } from './public-error.js';
import {orphanArchives, readTask} from './task-record-io.js';

/** @param {string} root */
export function listRecordFiles(root) {
  return recordFiles(root, TASKS_DIRECTORY);
}

/** @param {string} root @param {string} id */
export function findRecord(root, id) {
  const matches = [];
  for (const file of listRecordFiles(root)) {
    const {record} = readTask(root, file);
    if (String(record.frontmatter.id ?? '') === id) matches.push({ file, record });
  }
  if (matches.length === 0) {
    throw new PublicError(`no task record with id ${id}`, { hint: `Looked in ${TASKS_DIRECTORY}/.` });
  }
  if (matches.length > 1) {
    const paths = matches.map((match) => path.relative(root, match.file)).join(', ');
    throw new PublicError(`task id ${id} is declared by more than one record: ${paths}`, {
      hint: 'Give each record a unique id, then run the command again. Nothing was changed.',
    });
  }
  return matches[0];
}

/** @param {string} root */
function nextId(root) {
  let highest = 0;
  for (const file of listRecordFiles(root)) {
    const {record} = readTask(root, file);
    const match = String(record.frontmatter.id ?? '').match(/(\d+)\s*$/);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `T-${String(highest + 1).padStart(3, '0')}`;
}

/** @param {string} root @param {string} title */
export function taskNew(root, title) {
  if (!title || title.trim() === '') {
    throw new PublicError('a title is required', { hint: 'castwork task new "Short task title"' });
  }
  const id = nextId(root);
  const template = fs.readFileSync(path.join(toolkitRoot(), 'memory', 'task-record.md'), 'utf8');
  const content = template
    .replace(/^id: .*$/m, `id: ${formatScalar(id)}`)
    .replace(/^title: .*$/m, `title: ${formatScalar(title.trim())}`);
  const file = path.join(recordDirectory(root, TASKS_DIRECTORY, { create: true }), `${id}.md`);
  if (fs.existsSync(file)) throw new PublicError(`${file} already exists`);
  fs.writeFileSync(file, content, 'utf8');
  out(`created ${path.relative(root, file)}`);
  return file;
}

/** @param {string} root @param {{json?: boolean}} [options] */
export function taskList(root, options = {}) {
  const rows = [];
  /**
   * Structural validity per row: it decides "ready to close", and is reported
   * by lint, not listed.
   * @type {Map<object, boolean>}
   */
  const valid = new Map();
  for (const problem of orphanArchives(root)) err(`${problem.code} ${problem.path}: ${problem.message}`);
  for (const file of listRecordFiles(root)) {
    const {record} = readTask(root, file);
    rows.push({
      id: String(record.frontmatter.id ?? path.basename(file, '.md')),
      status: String(record.frontmatter.status ?? 'unknown'),
      title: String(record.frontmatter.title ?? ''),
      path: path.relative(root, file),
      requirements_satisfied: requirementsSatisfied(record),
    });
    valid.set(rows[rows.length - 1], structuralValidity(record).valid);
  }
  if (options.json) {
    json(rows);
    return rows;
  }
  if (rows.length === 0) {
    out(`no task records in ${TASKS_DIRECTORY}/`);
    return rows;
  }
  table([['ID', 'STATUS', 'TITLE'], ...rows.map((row) => [row.id, readyToClose(row, valid.get(row) === true) ? `${row.status} (ready to close)` : row.status, row.title])]);
  return rows;
}

/**
 * Whether every requirement a record declares is satisfied, from requirement
 * evaluation alone; `null` when it declares none, since nothing then says the
 * work is finished. Structural validity is a separate output, and
 * `task set <id> status done` needs both. Requirement evaluation reads only
 * the record, so listing costs no git call.
 *
 * @param {import('./record.js').ParsedRecord} record
 * @returns {boolean|null}
 */
function requirementsSatisfied(record) {
  const results = requirementEvaluation(record);
  if (results.length === 0) return null;
  return results.every((result) => result.status === 'satisfied');
}

/**
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} root
 * @param {import('./observations.js').ObservationContext} [context]
 */
function reportFor(record, root, context) {
  const observations = observe(record, root, context);
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
  process.stdout.write(fs.readFileSync(file, 'utf8'));
  if (record.archive) err(`archive: ${path.relative(root, record.archive.path ?? '')}`);
  return report;
}

/** Text-only projection; parser notes and JSON remain complete.
 * @param {import('./record.js').ParsedRecord} record
 * @param {import('./record.js').Diagnostic[]} notes
 */
function lintNotes(record, notes) {
  const evidence = recordEntries(record).evidence;
  const current = currentCandidate(record);
  const onCurrent = (/** @type {Record<string, unknown>|undefined} */ entry) =>
    current !== null && entry !== undefined && recordValueText(entry.candidate) === recordValueText(current.ref);
  const declared = declaredRequirements(record).checks;
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  if (declared) evidence.forEach((entry, index) => {
    const name = entry.check == null ? '' : recordValueText(entry.check);
    if (name && !declared.includes(name)) groups.set(name, [...(groups.get(name) ?? []), index]);
  });
  const rendered = notes.filter(note => note.code !== 'evidence.undeclared_check' &&
    (note.code !== 'evidence.lint_as_evidence' || onCurrent(evidence[note.logical_index ?? note.index ?? -1])));
  let earlierNames = 0, earlierEntries = 0;
  for (const [name, indexes] of groups) {
    const currentIndexes = indexes.filter(index => onCurrent(evidence[index]));
    if (!currentIndexes.length) { earlierNames += 1; earlierEntries += indexes.length; continue; }
    const index = currentIndexes[0];
    const raw = record.frontmatter.evidence;
    const location = record.entry_locations?.evidence?.[Array.isArray(raw) ? raw.indexOf(evidence[index]) : index];
    const first = location ? `${location.path?.replace(/\\/g, '/').split('/').at(-1)} evidence[${location.index}]` : `evidence[${index}]`;
    const count = currentIndexes.length === 1 ? first : `${currentIndexes.length} evidence entries, from ${first}`;
    rendered.push({code: 'evidence.undeclared_check', message: `check ${name} (${count}) is not among requirements.checks (${declared?.join(', ')}); a subset of a declared check goes under its own name, and only a declared name counts`});
  }
  if (earlierNames) rendered.push({code: 'evidence.undeclared_check', message: `${earlierNames} undeclared check names, ${earlierEntries} entries on earlier candidates; --json lists them`});
  const earlierLint = notes.filter(note => note.code === 'evidence.lint_as_evidence' && !onCurrent(evidence[note.logical_index ?? note.index ?? -1])).length;
  if (earlierLint) rendered.push({code: 'evidence.lint_as_evidence', message: `${earlierLint} entries on earlier candidates record task lint; --json lists them`});
  return rendered;
}

/** @param {ReturnType<typeof checkRecord>} report
 * @param {import('./record.js').ParsedRecord} [lintRecord]
 */
function printReport(report, lintRecord) {
  heading('Structural validity');
  if (report.structural.valid) out('valid');
  for (const error of report.structural.errors) out(`error  ${error.code}: ${error.message}`);
  for (const note of lintRecord ? lintNotes(lintRecord, report.structural.info) : report.structural.info) out(`info   ${note.code}: ${note.message}${note.code === 'record.large' ? '; task archive can move earlier rounds after exact verification' : ''}`);

  heading('Reference availability');
  if (report.references.length === 0) out('no references recorded');
  // Only the current candidate decides anything, so it is the one printed in
  // full; a record revised many times listed every earlier one first.
  const candidates = report.references.filter((reference) => reference.kind === 'candidate');
  const earlier = candidates.slice(0, -1);
  if (earlier.length > 0) {
    const unavailable = earlier.filter((reference) => reference.available === 'unavailable').length;
    out(`${earlier.length} earlier candidate${earlier.length === 1 ? '' : 's'}, ${unavailable} unavailable`);
  }
  for (const reference of [...candidates.slice(-1), ...report.references.filter((entry) => entry.kind !== 'candidate')]) {
    out(`${reference.available.padEnd(12)} ${reference.kind}  ${reference.ref}${reference.kind === 'candidate' ? '  (current)' : ''}`);
    if (reference.same_tree_as) out(`             commit ${reference.ref} has the same tree as snapshot ${reference.same_tree_as}`);
    if (reference.drift === 'matches') out('             working tree matches the snapshot');
    if (reference.drift === 'differs') {
      const paths = reference.drift_paths ?? [];
      const shown = paths.slice(0, 5).join(', ');
      out(`             working tree differs from the snapshot in ${paths.length} path${paths.length === 1 ? '' : 's'}: ${shown}${paths.length > 5 ? ', …' : ''}`);
      out('             evidence belongs to the snapshot; take a new one and record a new candidate for the changed tree');
    }
  }

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
  const all = listRecordFiles(root).map((file) => readTask(root, file));
  const problems = orphanArchives(root);

  // Lint diagnoses rather than refuses, so an ambiguous id reports every record
  // that claims it instead of erroring the way a write would.
  const targets = id ? all.filter((entry) => String(entry.record.frontmatter.id ?? '') === id) : all;
  if (id && targets.length === 0) {
    throw new PublicError(`no task record with id ${id}`, { hint: `Looked in ${TASKS_DIRECTORY}/.` });
  }

  const duplicates = duplicateIdErrors(all.map((entry) => entry.record));
  // One lookup for every reference in the run, rather than a git process per
  // candidate of every record.
  const context = observationContext(root);
  prefetchObjects(context, targets.map((entry) => entry.record));

  const reports = [];
  let failed = problems.length > 0;
  if (!options.json) for (const problem of problems) err(`${problem.code} ${problem.path}: ${problem.message}`);

  for (const { file, record } of targets) {
    const report = reportFor(record, root, context);
    const duplicate = duplicates.get(file);
    if (duplicate) {
      report.structural = {
        ...report.structural,
        valid: false,
        errors: [...report.structural.errors, duplicate],
      };
    }
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
      printReport(report, record);
      if (claimsDone) {
        out('');
        out(`error  status.done_unsatisfied: status is done but ${unsatisfied.length} requirement(s) are not satisfied`);
      }
    }
  }

  if (options.json) json({ ok: !failed, records: reports, ...(problems.length ? {problems} : {}) });
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
    throw new PublicError('a field and a value are required', { hint: 'castwork task set T-001 status in_review' });
  }
  const { file, record } = findRecord(root, id);

  if (field === 'status') {
    if (!STATUS_VALUES.includes(value)) {
      throw new PublicError(`unknown status value ${value}`, { hint: `Known values: ${STATUS_VALUES.join(', ')}.` });
    }
    if (value === 'done') {
      // Availability is reported separately; completion depends on the record.
      const verdict = mayBeDone(record);
      if (!verdict.allowed) {
        if (!verdict.structural.valid) {
          const lines = verdict.structural.errors.map((error) => `  ${error.code}: ${error.message}`);
          throw new PublicError(
            `${id} has a structural error, so status was not changed:\n${lines.join('\n')}`,
            { hint: 'Run task lint to see all three outputs, then fix the record. Nothing was written.' },
          );
        }
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
  const line = `${field}: ${formatScalar(value)}`;
  const nextBody = pattern.test(body) ? body.replace(pattern, line) : `${body}\n${line}`;
  return `${open}${nextBody}${close}${text.slice(match[0].length)}`;
}

/** @param {string} root */
export function projectPolicy(root) {
  const file = path.join(root, PROJECT_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
