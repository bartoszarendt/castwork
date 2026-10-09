/** Explicit task archival only. Reads, containment and staged writes live here. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {recordDirectory} from './generated.js';
import {ARCHIVE_SUFFIX, TASKS_DIRECTORY} from './layout.js';
import {readTask, orphanArchives, safeTaskPath} from './task-record-io.js';
import {duplicateIdErrors} from './checks.js';
import {LARGE_RECORD_BYTES, recordValueText} from './record.js';
import {splitArchive, verifyArchive} from './archive.js';
import {json, out} from './cli-io.js';
import {PublicError} from './public-error.js';
import {readReportInputs, reportGit} from './report-cli.js';

const message = error => error instanceof Error ? error.message : String(error);

/** Injectable operations for races and second-rename failure tests.
 * Re-read both inputs immediately before staging. Archive replacement first;
 * restore its previous bytes if the record replacement fails.
 */
export function writeArchivePair(root, input, proposed, io = fs) {
  const file = safeTaskPath(root, input.file, io), archive = safeTaskPath(root, input.archive_path, io);
  const before = io.readFileSync(file);
  const older = io.lstatSync(archive, {throwIfNoEntry: false}) ? io.readFileSync(archive) : null;
  if (!before.equals(Buffer.from(input.text)) || (older === null) !== (input.archive_text === null) ||
    older && !older.equals(Buffer.from(input.archive_text))) throw new Error('record or archive changed between read and write; nothing was written');
  const suffix = `${process.pid}.${randomUUID()}.tmp`;
  const recordTemp = path.join(path.dirname(file), `.${path.basename(file)}.${suffix}`);
  const archiveTemp = path.join(path.dirname(file), `.${path.basename(archive)}.${suffix}`);
  const restoreTemp = path.join(path.dirname(file), `.${path.basename(archive)}.restore.${suffix}`);
  const temps = new Set();
  const stage = (target, bytes) => {
    const fd = io.openSync(target, 'wx'); temps.add(target);
    try { io.writeFileSync(fd, bytes); } finally { io.closeSync(fd); }
  };
  try {
    stage(recordTemp, proposed.record_text); stage(archiveTemp, proposed.archive_text);
    safeTaskPath(root, file, io); safeTaskPath(root, archive, io);
    io.renameSync(archiveTemp, archive); temps.delete(archiveTemp);
    try { io.renameSync(recordTemp, file); temps.delete(recordTemp); }
    catch (error) {
      let restored;
      try {
        safeTaskPath(root, archive, io);
        if (older === null) { io.unlinkSync(archive); restored = `removed archive created by this run: ${archive}`; }
        else { stage(restoreTemp, older); io.renameSync(restoreTemp, archive); temps.delete(restoreTemp); restored = `restored previous archive bytes: ${archive}`; }
      } catch (restoreError) { restored = `archive restoration failed: ${message(restoreError)}`; }
      throw new Error(`${message(error)}; ${restored}`);
    }
  } finally {
    for (const temp of temps) {
      // A failed exclusive create does not authorize deleting someone else's file.
      if (io.existsSync(temp)) io.unlinkSync(temp);
    }
  }
}

/** @param {string} root @param {string|null} id @param {{check?: boolean,json?: boolean,io?: typeof fs,date?: string}} [options] */
export function taskArchive(root, id = null, options = {}) {
  const directory = recordDirectory(root, TASKS_DIRECTORY);
  const names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.md') && !name.endsWith(ARCHIVE_SUFFIX)).sort() : [];
  const all = [], failures = [];
  for (const name of names) {
    try {
      const file = path.join(directory, name);
      if (!fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink()) continue;
      all.push(readTask(root, file));
    } catch (error) { failures.push({id: null, path: `${TASKS_DIRECTORY}/${name}`, status: 'failed', reason: message(error)}); }
  }
  const duplicates = duplicateIdErrors(all.map(input => input.record));
  const selected = id !== null ? all.filter(input => recordValueText(input.record.frontmatter.id) === id) : all.filter(input => Buffer.byteLength(input.text) > LARGE_RECORD_BYTES);
  if (id !== null && !selected.length && !failures.length) throw new PublicError(`no task record with id ${id}`);
  let problems = [];
  try { problems = orphanArchives(root); } catch (error) { problems.push({code: 'archive.enumeration_failed', path: TASKS_DIRECTORY, message: message(error)}); }
  const records = [...failures];
  const git = reportGit(root);
  const corpus = readReportInputs(root);
  problems = [...problems, ...corpus.problems].filter((problem, index, all) => all.findIndex(other => other.code === problem.code && other.path === problem.path && other.message === problem.message) === index);
  for (const input of selected) {
    const result = {id: recordValueText(input.record.frontmatter.id), path: path.relative(root, input.file), archive_path: path.relative(root, input.archive_path)};
    try {
      const duplicate = duplicates.get(input.record.path);
      if (duplicate) { records.push({...result, status: 'refused', reason: duplicate.message}); continue; }
      if (input.record.archive?.errors.length) { records.push({...result, status: 'refused', reason: `invalid or unreadable archive: ${input.record.archive.errors.map(e => e.message).join('; ')}`}); continue; }
      const proposed = splitArchive(input.text, input.archive_text, input.record, {date: options.date ?? new Date().toISOString().slice(0, 10), archive_path: input.archive_path});
      if ('refused' in proposed) { records.push({...result, status: 'refused', reason: proposed.refused}); continue; }
      if (!proposed.summary.moved) { records.push({...result, status: 'noop', summary: proposed.summary}); continue; }
      const bodyLine = input.text.slice(0, input.text.length - (input.record.physical_body ?? input.record.body).length).split('\n').length;
      const relative = path.relative(root, input.file).split(path.sep).join('/');
      const observed = git.records?.[relative];
      const gitAfter = git.omitted ? git : {records: {...git.records, [relative]: {...observed, ...(proposed.record_text !== input.text ? {uncommitted: true} : {})}}};
      const refused = verifyArchive({...input.record, path: relative}, proposed, {archive_path: path.relative(root, input.archive_path).split(path.sep).join('/'), body_line: bodyLine,
        git_before: git, git_after: gitAfter, corpus: corpus.inputs, problems: corpus.problems});
      if (refused) { records.push({...result, status: 'refused', reason: refused, summary: proposed.summary}); continue; }
      if (!options.check) writeArchivePair(root, input, proposed, options.io);
      records.push({...result, status: options.check ? 'checked' : 'archived', summary: proposed.summary});
    } catch (error) { records.push({...result, status: 'failed', reason: message(error)}); }
  }
  const result = {ok: !problems.length && records.every(record => !['refused', 'failed'].includes(record.status)), check: Boolean(options.check), records, problems};
  if (options.json) json(result);
  else {
    if (!records.length && !problems.length) out('no records over 100 KB to archive');
    for (const row of records) {
      out(`${row.id ?? '<unreadable>'} ${row.path}: ${row.status}${row.reason ? ` — ${row.reason}` : ''}`);
      if (row.summary) {
        out(`  proposed: ${Object.entries(row.summary.lists).map(([field, count]) => `${count} ${field}`).join(', ')}; ${row.summary.blockers} Blockers entries; sections: ${row.summary.sections.join(', ') || 'none'}`);
        out(`  record bytes: ${row.summary.bytes_before} -> ${row.summary.bytes_after}${row.status === 'refused' ? ' (proposal refused; actual file unchanged)' : ''}`);
        for (const reason of row.summary.retained) out(`  retained: ${reason}`);
      }
    }
    for (const problem of problems) out(`${problem.code} ${problem.path}: ${problem.message}`);
  }
  return result;
}
