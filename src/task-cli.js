/**
 * Record operations: new, list, show, lint, set.
 *
 * A dedicated command exists only where it does something materially better
 * than editing the record by hand. Everything here stays consistent with a
 * hand edit, and `show --json` agrees with whatever you wrote.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { checkRecord, currentCandidate, duplicateIdErrors, mayBeDone, readyToClose, requirementEvaluation, structuralValidity } from './checks.js';
import { err, heading, json, out, table } from './cli-io.js';
import { toolkitRoot } from './adapter-generation.js';
import { recordDirectory, recordFiles } from './generated.js';
import { PROJECT_FILE, TASKS_DIRECTORY } from './layout.js';
import { observationContext, observe, prefetchObjects } from './observations.js';
import { declaredRequirements, parseRecord, RECORD_YAML, recordEntries, recordValueText, STATUS_VALUES } from './record.js';
import { formatScalar, parseYaml } from './yaml.js';
import { PublicError } from './public-error.js';
import {orphanArchives, readTask, replaceRecord, withRecordLock} from './task-record-io.js';

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
  // Replacement functions, so `$&` or `$\`` in a title stays text.
  const content = template
    .replace(/^id: .*$/m, () => `id: ${formatScalar(id)}`)
    .replace(/^title: .*$/m, () => `title: ${formatScalar(title.trim())}`);
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
 * @param {{drift?: boolean}} [options]
 */
function reportFor(record, root, context, options) {
  const observations = observe(record, root, context, options);
  return checkRecord(record, observations);
}

/** Statuses whose snapshot whole-project lint does not compare with today's tree. */
const CLOSED_STATUSES = Object.freeze(['done', 'cancelled']);

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
  for (const note of lintRecord ? lintNotes(lintRecord, report.structural.info) : report.structural.info) out(`info   ${note.code}: ${note.message}${note.code === 'record.large' ? '; task archive can move the entries for earlier candidates, and the body stays' : ''}`);

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

  // A closed task's snapshot is history: compared with today's tree it differs
  // as a matter of course, and advising a new candidate there would replace the
  // artifact that was assessed. Its references and structure are still checked;
  // `task lint <id>` still compares it.
  let undrifted = 0;
  for (const { file, record } of targets) {
    const closed = id === null && CLOSED_STATUSES.includes(recordValueText(record.frontmatter.status ?? ''));
    if (closed && recordValueText(currentCandidate(record)?.ref ?? '').startsWith('tree:')) undrifted += 1;
    const report = reportFor(record, root, context, { drift: !closed });
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

  if (!options.json && undrifted > 0) {
    out('');
    out(`working tree not compared with the snapshots of ${undrifted} done or cancelled record${undrifted === 1 ? '' : 's'}; task lint <id> compares one`);
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
  const { file } = findRecord(root, id);
  // Read again under the lock: another command may have written it meanwhile.
  return withRecordLock(file, () => {
    const { record, text } = readTask(root, file);

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

    replaceRecord(file, writeFrontmatterField(text, field, value));
    out(`${id}: ${field} = ${value}`);
    return file;
  });
}

/** A field name the writer can address: one YAML reads bare as a key. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Recognized fields that hold a list or a mapping, never one value. */
const STRUCTURED_FIELDS = Object.freeze(['depends_on', 'allowed_paths', 'requirements', 'candidates', 'evidence', 'assessments']);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Replace or add one top-level scalar frontmatter field, preserving every other
 * byte, comments and line endings included.
 *
 * The new text is checked in memory before anything is written: it must read
 * back with the field holding the value and every other field unchanged, or
 * the write is refused. The key is matched literally and the value is inserted
 * literally, so neither is a pattern. A record with structural errors stays
 * editable; one whose frontmatter cannot be read does not, since nothing could
 * then be checked.
 * @param {string} text
 * @param {string} field
 * @param {string} value
 */
export function writeFrontmatterField(text, field, value) {
  const refuse = (/** @type {string} */ message, hint = 'Edit the record by hand instead. Nothing was written.') => new PublicError(message, { hint });
  if (!FIELD_NAME.test(field)) throw refuse(`${field} is not a plain field name`, 'task set writes one top-level field, such as status or title. Nothing was written.');
  if (STRUCTURED_FIELDS.includes(field)) throw refuse(`${field} holds a list or a mapping, and task set writes one value`);
  const match = text.match(/^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n)(---[ \t]*(?:\r?\n|$))/);
  if (!match) throw refuse('the record has no --- delimited frontmatter');
  const [whole, open, yaml, eol, close] = match;

  /** @type {unknown} */
  let before = null;
  try {
    // Read as every reader reads it: with the line break before the closing ---.
    before = parseYaml(`${yaml}${eol}`, RECORD_YAML);
  } catch {
    // Reported below: nothing can be checked against unreadable frontmatter.
  }
  if (!isMapping(before)) throw refuse('the frontmatter cannot be read, so the write could not be checked');

  const line = `${field}: ${formatScalar(value)}`;
  let nextYaml = `${yaml}${eol}${line}`;
  if (Object.hasOwn(before, field)) {
    if (before[field] !== null && typeof before[field] === 'object') throw refuse(`${field} holds a list or a mapping, and task set writes one value`);
    const span = scalarSpan(yaml, field, before[field]);
    if (span === null) throw refuse(`${field} could not be found as one top-level key`);
    nextYaml = yaml.slice(0, span.start) + line + yaml.slice(span.end);
  }

  /** @type {unknown} */
  let after = null;
  try {
    after = parseYaml(`${nextYaml}${eol}`, RECORD_YAML);
  } catch (error) {
    throw refuse(`writing ${field} would leave the frontmatter unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const others = (/** @type {Record<string, unknown>} */ map) => Object.keys(map).filter((key) => key !== field);
  const expected = /** @type {Record<string, unknown>} */ (parseYaml(line, RECORD_YAML))[field];
  const preserved = isMapping(after) && isDeepStrictEqual(after[field], expected) && isDeepStrictEqual(others(before), others(after)) &&
    others(before).every((key) => isDeepStrictEqual(before[key], after[key]));
  if (!preserved) throw refuse(`writing ${field} would change more than ${field}`);
  return `${open}${nextYaml}${eol}${close}${text.slice(whole.length)}`;
}

/**
 * Where a top-level scalar field's value is written: its key line, plus the
 * indented lines a block or multi-line scalar continues on. A value that reads
 * back whole from its key line alone is that line, so nothing after it is
 * taken along.
 * @param {string} yaml
 * @param {string} field
 * @param {unknown} value the field's parsed value
 * @returns {{start: number, end: number}|null}
 */
function scalarSpan(yaml, field, value) {
  /** @type {{start: number, end: number, text: string}[]} */
  const rows = [];
  for (let start = 0; ;) {
    const newline = yaml.indexOf('\n', start);
    const stop = newline === -1 ? yaml.length : newline;
    const end = stop > start && yaml[stop - 1] === '\r' ? stop - 1 : stop;
    rows.push({ start, end, text: yaml.slice(start, end) });
    if (newline === -1) break;
    start = newline + 1;
  }
  const keyRows = rows.filter((row) => row.text.startsWith(`${field}:`) && /^(?:$|[ \t])/.test(row.text.slice(field.length + 1)));
  if (keyRows.length !== 1) return null;
  const index = rows.indexOf(keyRows[0]);
  let whole = false;
  try {
    whole = isDeepStrictEqual(/** @type {Record<string, unknown>} */ (parseYaml(keyRows[0].text, RECORD_YAML))[field], value);
  } catch {
    // An opening line that does not read alone continues below it.
  }
  let last = index;
  if (!whole) {
    // The value continues on lines indented at least as far as its first one;
    // a less indented line, such as a comment after it, is not part of it.
    let indent = null;
    for (let i = index + 1; i < rows.length; i += 1) {
      if (rows[i].text.trim() === '') continue;
      const depth = rows[i].text.length - rows[i].text.trimStart().length;
      if (depth === 0 || depth < (indent ?? depth)) break;
      indent ??= depth;
      last = i;
    }
  }
  return { start: rows[index].start, end: rows[last].end };
}

/** @param {string} root */
export function projectPolicy(root) {
  const file = path.join(root, PROJECT_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
