/**
 * Pure raw-text archive preparation and strict, in-memory verification.
 *
 * Archiving moves list entries only: the prefix of each entry list before the
 * first entry for the current candidate. The body stays in the record, since
 * moving prose would need its original order guessed back.
 */
import {isDeepStrictEqual} from 'node:util';
import {parseRecord, recordValueText, relocateEntryLabel, splitFrontmatter, LARGE_RECORD_BYTES, RECORD_YAML} from './record.js';
import {currentCandidate, mayBeDone, requirementEvaluation, structuralValidity} from './checks.js';
import {deriveReport} from './report.js';
import {parseYaml, formatScalar} from './yaml.js';

const fields = ['candidates', 'evidence', 'assessments'];
const bytes = text => new TextEncoder().encode(text).length;
const label = file => file?.replace(/\\/g, '/').split('/').at(-1) ?? '<unknown>';

/** Source spans keep line endings, comments and whitespace byte-for-byte. */
function sourceLines(text) {
  const rows = []; let start = 0;
  for (const line of text.matchAll(/[^\n]*\n|[^\n]+$/g)) { rows.push({start, end: start + line[0].length, text: line[0].replace(/\r?\n$/, '')}); start += line[0].length; }
  return rows;
}
function parts(text) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text);
  if (!match || match.index !== 0) return null;
  const yaml = match[1], start = match[0].indexOf('\n') + 1;
  return {yaml, start, end: start + yaml.length, body_start: match[0].length, body: text.slice(match[0].length)};
}
function rawList(yaml, field, expected) {
  if (!Array.isArray(expected)) return null;
  const rows = sourceLines(yaml);
  const key = rows.findIndex(row => new RegExp(`^${field}:[ \\t]*(?:#.*)?$`).test(row.text));
  if (key < 0) return null;
  let end = key + 1;
  while (end < rows.length && !/^[^\s#]/.test(rows[end].text)) end++;
  const candidates = rows.slice(key + 1, end).flatMap((row, i) => { const m = /^( *)-(?:[ \t]|$)/.exec(row.text); return m ? [{row: key + 1 + i, indent: m[1].length}] : []; });
  if (!candidates.length) return expected.length ? null : {start: rows[key].end, end: end < rows.length ? rows[end].start : yaml.length, starts: [], indent: 0};
  const indent = Math.min(...candidates.map(item => item.indent));
  const items = candidates.filter(item => item.indent === indent);
  if (items.length !== expected.length) return null;
  const starts = items.map(item => {
    let row = item.row;
    while (row > key + 1 && /^\s*(?:#.*)?$/.test(rows[row - 1].text)) row--;
    return rows[row].start;
  });
  // Trailing comments belong to no following item and stay in the source.
  let last = end;
  while (last > items.at(-1).row + 1 && /^\s*(?:#.*)?$/.test(rows[last - 1].text)) last--;
  const blockEnd = last < rows.length ? rows[last].start : yaml.length;
  try {
    for (let i = 0; i < starts.length; i++) {
      const parsed = parseYaml(`${field}:\n${yaml.slice(starts[i], starts[i + 1] ?? blockEnd)}`, RECORD_YAML);
      if (!isDeepStrictEqual(parsed[field], [expected[i]])) return null;
    }
  } catch { return null; }
  return {start: rows[key].end, end: blockEnd, starts, indent};
}
function replaceRanges(text, ranges) {
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) text = text.slice(0, range.start) + (range.text ?? '') + text.slice(range.end);
  return text;
}

/** Propose the specified moves, without guessing lost original body order.
 * @param {string} recordText @param {string|null} archiveText
 * @param {import('./record.js').ParsedRecord} record
 * @param {{date: string, archive_path: string}} options
 */
export function splitArchive(recordText, archiveText, record, options) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return {refused: 'a YYYY-MM-DD move date is required'};
  const original = parts(recordText);
  if (!original || record.errors.some(e => e.code.startsWith('frontmatter.'))) return {refused: 'unreadable or unsplittable frontmatter'};
  if (record.archive?.errors.length) return {refused: `invalid existing archive: ${record.archive.errors.map(e => e.message).join('; ')}`};
  const eol = recordText.includes('\r\n') ? '\r\n' : '\n';
  let archive = archiveText ?? `---${eol}schema: 1${eol}archive_of: ${formatScalar(recordValueText(record.frontmatter.id))}${eol}---${eol}`;
  if (!parts(archive)) return {refused: 'existing archive frontmatter cannot be split'};
  const primary = parseRecord(recordText);
  const ref = currentCandidate(record)?.ref;
  const moves = [], listCounts = {}, reasons = [];
  for (const field of fields) {
    const values = primary.frontmatter[field];
    const raw = rawList(original.yaml, field, values);
    let count = 0;
    if (raw && ref != null) {
      count = values.findIndex(entry => entry && typeof entry === 'object' && recordValueText(entry[field === 'candidates' ? 'ref' : 'candidate']) === recordValueText(ref));
      if (count < 0) count = values.length;
    } else if (Array.isArray(values) && values.length) reasons.push(`${field}: flow-style or unsplittable list retained`);
    const older = parts(archive);
    const existingValues = record.archive?.frontmatter[field];
    const existingRaw = rawList(older.yaml, field, existingValues ?? []);
    if (count && existingValues != null && (!existingRaw || existingRaw.indent !== raw.indent)) {
      reasons.push(`${field}: existing archive list formatting prevents raw append`); count = 0;
    }
    listCounts[field] = count;
    if (!count) continue;
    const start = raw.starts[0], end = raw.starts[count] ?? raw.end;
    const chunk = original.yaml.slice(start, end);
    moves.push({start: original.start + start, end: original.start + end, kind: field});
    const insertion = existingRaw ? older.start + existingRaw.end : older.end;
    const header = existingRaw ? '' : `${field}:${eol}`;
    archive = archive.slice(0, insertion) + header + chunk + archive.slice(insertion);
  }
  const moving = Object.values(listCounts).some(Boolean);
  if (!moving) return {record_text: recordText, archive_text: archiveText, summary: {moved: false, lists: listCounts,
    bytes_before: bytes(recordText), bytes_after: bytes(recordText), raw_moves: [], retained: reasons}};
  let nextRecord = replaceRanges(recordText, moves);
  const next = parts(nextRecord);
  const pointer = `Earlier rounds: [${label(options.archive_path)}](${label(options.archive_path)}), moved by \`task archive\`.${eol}`;
  if (!next.body.startsWith(pointer)) nextRecord = nextRecord.slice(0, next.body_start) + pointer + nextRecord.slice(next.body_start);
  // One dated part per run, saying when these entries moved.
  archive += `${/\r?\n$/.test(archive) ? '' : eol}## Entries moved ${options.date}${eol}`;
  return {record_text: nextRecord, archive_text: archive, summary: {moved: true, lists: listCounts,
    bytes_before: bytes(recordText), bytes_after: bytes(nextRecord),
    raw_moves: [...moves].sort((a, b) => a.start - b.start).map(move => ({kind: move.kind, start_byte: bytes(recordText.slice(0, move.start)), end_byte: bytes(recordText.slice(0, move.end))})), retained: [...reasons, ...(bytes(nextRecord) > LARGE_RECORD_BYTES ? ['the body and the entries from the current candidate on keep the record over 100 KB; the body is never moved'] : [])]}};
}

/** Strip ONLY physical navigation/diagnostic locations, not prose or outcomes. */
function comparison(value, at = '', root = value) {
  if (Array.isArray(value)) return value.map((child, index) => comparison(child, `${at}.${index}`, root));
  if (value === null || typeof value !== 'object') return value;
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    const reportProblem = /^\.problems\.\d+$/.test(at) && value.record_path !== undefined;
    if (reportProblem && ['record_path', 'field', 'index', 'logical_index', 'locations'].includes(key)) continue;
    if (reportProblem && key === 'path') { copy.path = value.record_path; continue; }
    if (reportProblem && key === 'message') {
      let message = child;
      if (value.locations) message = message.slice(0, message.lastIndexOf('; sources: '));
      else {
        message = message.replace(`${label(value.path)} `, '');
        if (value.code === 'report.ref_missing') message = message.slice(`${value.field}[${value.index}] `.length);
        else message = relocateEntryLabel(message, value.field, value.index, value.logical_index, value.code);
      }
      copy.message = message; continue;
    }
    const diagnostic = /^\.records\.\d+\.task\.structural\.(errors|info)\.\d+$/.test(at);
    const navigation = /^\.records\.\d+\.task\.(contract\.[^.]+|current_state|latest_sections\.sections\.\d+)$/.test(at) || /^\.records\.\d+\.sections\.[^.]+$/.test(at) || /^\.records\.\d+\.findings_references\.\d+\.section$/.test(at);
    if (/^\.records\.\d+\.task$/.test(at) && key === 'archive') continue;
    if (navigation && ['line', 'pointer', 'start_line', 'end_line', 'omission_pointer'].includes(key)) continue;
    // The attention row repeats the Blockers section's file:line pointer.
    if (/^\.attention\.\d+$/.test(at) && key === 'blockers_pointer') continue;
    if (diagnostic && ['path', 'logical_index'].includes(key)) continue;
    if (diagnostic && key === 'index') { copy.index = value.logical_index ?? child; continue; }
    if (diagnostic && key === 'message' && Object.hasOwn(value, 'path')) {
      let message = child.replace(`${label(value.path)} `, '');
      if (value.field && value.logical_index !== undefined) {
        const row = root.records?.[Number(at.split('.')[2])];
        if (value.code === 'candidate.moving_ref') message = message.slice(`${value.field}[${value.index}] `.length);
        else message = relocateEntryLabel(message, value.field, value.index, value.logical_index, value.code, row?.task?.entries.evidence[value.logical_index]?.check);
      }
      copy.message = message; continue;
    }
    copy[key] = comparison(child, `${at}.${key}`, root);
  }
  return copy;
}
function firstDifference(a, b, at = 'report') {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const difference = firstDifference(a[key], b[key], `${at}.${key}`); if (difference) return difference;
    }
  }
  return at;
}

/**
 * Writing the pair is expected to change two things about the selected record
 * and nothing else: Git sees it uncommitted, and its size note may change or
 * go. Those two are taken out of the comparison for that record only; the same
 * difference in another record, or any other Git difference, still refuses.
 * @param {ReturnType<typeof deriveReport>} before @param {ReturnType<typeof deriveReport>} after @param {string|null} selected
 */
function expectedPhysicalChanges(before, after, selected) {
  const row = (/** @type {ReturnType<typeof deriveReport>} */ report) => report.records.find(record => record.kind === 'task' && record.path === selected);
  const a = row(before), b = row(after);
  if (!a || !b) return;
  if (b.git?.uncommitted === true && a.git?.uncommitted !== true) {
    const {uncommitted, ...rest} = b.git;
    b.git = a.git === null && Object.keys(rest).length === 0 ? null : rest;
  }
  for (const record of [a, b]) {
    if (record.task) record.task.structural = {...record.task.structural, info: record.task.structural.info.filter(note => note.code !== 'record.large')};
  }
}

/** Verify proposed pair; no I/O and no relaxed semantic comparison. */
export function verifyArchive(original, proposed, options) {
  if (options.corpus && options.corpus.filter(input => input.kind === 'task' && input.record.path === original.path).length !== 1) return 'selected task missing or ambiguous in report corpus';
  if (options.problems?.length) return `report corpus could not be fully read: ${options.problems.map(problem => `${problem.path ?? ''} ${problem.message}`).join('; ')}`;
  const next = parseRecord(proposed.record_text, {path: original.path ?? undefined, archive: {text: proposed.archive_text, path: options.archive_path}});
  if (next.archive?.errors.length) return `invalid proposed archive: ${next.archive.errors.map(e => e.message).join('; ')}`;
  for (const field of fields) if (!isDeepStrictEqual(original.frontmatter[field] ?? [], next.frontmatter[field] ?? [])) return `${field} merged values or order changed`;
  const codes = record => structuralValidity(record).errors.map(e => e.code).sort();
  if (!isDeepStrictEqual(codes(original), codes(next))) return 'structural error codes or counts changed';
  if (!isDeepStrictEqual(requirementEvaluation(original), requirementEvaluation(next))) return 'requirement results or reasons changed';
  if (mayBeDone(original).allowed !== mayBeDone(next).allowed) return 'done decision changed';
  const target = {record: original, kind: 'task', body_line: options.body_line};
  const inputs = options.corpus ? options.corpus.map(input => input.record.path === original.path ? target : input) : [target];
  const before = deriveReport(inputs, {git: options.git_before, problems: options.problems});
  const bodyLine = proposed.record_text.slice(0, proposed.record_text.length - (next.physical_body ?? next.body).length).split('\n').length;
  const after = deriveReport(inputs.map(input => input.record.path === original.path ? {record: next, kind: 'task', body_line: bodyLine} : input), {git: options.git_after, problems: options.problems});
  expectedPhysicalChanges(before, after, original.path);
  const difference = firstDifference(comparison(before), comparison(after));
  if (difference) return `${difference} changed; exact report preservation cannot be verified`;
  // Archive navigation can grow, but it is not an exemption for altering old
  // prose. A successful list-only move adds just the prescribed dated heading.
  const priorBody = original.archive?.body ?? '';
  if (!next.archive.body.startsWith(priorBody)) return 'existing archive body changed';
  const appended = next.archive.body.slice(priorBody.length);
  if (appended === '' && !proposed.summary?.moved) return null;
  if (!/^(?:\r?\n)?## Entries moved \d{4}-\d{2}-\d{2}(?:\r?\n|$)$/.test(appended)) return 'archive body gained unverified text';
  return null;
}
