/** Pure report derivation. File identity, not id or ref, is the counting unit.
 * No I/O; recorded prose and dates never alter the existing checks' results.
 */
import { declaredRequirements, isObjectId, recordEntries, recordValueText, RESULTS, VERDICTS } from './record.js';
import { currentCandidate, duplicateIdErrors, effectiveEvidence, effectiveAssessments, requirementEvaluation, readyToClose, structuralValidity } from './checks.js';
import { HOSTS } from './layout.js';

/** @typedef {import('./record.js').ParsedRecord} ParsedRecord */
/** @typedef {{record: ParsedRecord, kind: 'task'|'decision', body_line?: number}} ReportInput */
/** @typedef {{code: string, path?: string, message: string, incomplete?: boolean, aggregates?: string[]}} Problem */
/** @typedef {{first_commit?: string, last_commit?: string, uncommitted?: boolean}} GitRecord */
/** @typedef {{records?: Record<string, GitRecord>, omitted?: string}} GitObservation */
/** @param {unknown} value */
export function recordedText(value) {
  if (value === undefined) return '';
  if (value === null || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
/** The id key every other command selects and diagnoses duplicates by. The raw
 * YAML value stays in frontmatter; a blank key declares no id.
 * @param {unknown} value
 */
export function idKey(value) {
  const key = value == null ? '' : recordValueText(value);
  return key.trim() === '' ? '' : key;
}
/** @param {unknown} value */
const list = (value) => Array.isArray(value) ? value : [];
/** @param {unknown} value */
const mapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const blocking = (value) => value === 'needs_revision' || value === 'reject';

/** Calendar validity, without Date's rollover of impossible days.
 * @param {string} day
 */
function calendarDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}
/** @param {unknown} raw @param {boolean} [decision] */
export function recordedDate(raw, decision = false) {
  const value = raw == null ? '' : recordedText(raw);
  if (value === '') return { kind: 'missing', raw: value };
  if (calendarDay(value)) return { kind: 'date_only', raw: value, day: value };
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!decision && match && calendarDay(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60) {
    const offset = match[6];
    if (offset.length === 1 || (Number(offset.slice(1, 3)) < 24 && Number(offset.slice(4)) < 60)) {
      const instant = Date.parse(value);
      if (Number.isFinite(instant)) return { kind: 'timestamp', raw: value, day: match[1], instant,
        whole_seconds: Math.floor(instant / 1000), fraction: (match[5] ?? '').replace(/0+$/, '') };
    }
  }
  return { kind: 'malformed', raw: value };
}

/** Compare instants at their recorded fractional precision, without BigInt JSON.
 * @param {ReturnType<typeof recordedDate>} a @param {ReturnType<typeof recordedDate>} b
 */
function compareInstants(a, b) {
  const seconds = (a.whole_seconds ?? 0) - (b.whole_seconds ?? 0);
  if (seconds) return seconds;
  const width = Math.max(a.fraction?.length ?? 0, b.fraction?.length ?? 0);
  const left = (a.fraction ?? '').padEnd(width, '0');
  const right = (b.fraction ?? '').padEnd(width, '0');
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Prepare headings, fences and logical prose entries once per body.
 * @param {string} body
 */
function prepareBody(body) {
  const lines = body.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const headings = [];
  let fence = '';
  const fenced = new Set();
  // Content column of the outermost open list item. A heading indented to it
  // belongs to that item, so it neither ends a section nor splits the item.
  let itemContent = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      fenced.add(index);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = '';
      continue;
    }
    if (line.trim() === '') continue;
    const item = /^(\s*)([-+*]|\d+[.)])([ \t]+)\S/.exec(line);
    if (item) {
      if (itemContent === null || indent < itemContent) itemContent = indent + item[2].length + (item[3].length > 4 ? 1 : item[3].length);
      continue;
    }
    const inItem = itemContent !== null && indent >= itemContent;
    if (!inItem && itemContent !== null && (lines[index - 1]?.trim() === '' || marker || /^ {0,3}#/.test(line))) itemContent = null;
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1];
      fenced.add(index);
      continue;
    }
    // A closing run of #s needs whitespace before it: `## Decision#` is titled
    // `Decision#`, not `Decision`.
    const heading = inItem ? null : /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) headings.push({ index, level: heading[1].length, title: /^#+$/.test(heading[2]) ? '' : heading[2].replace(/[ \t]+#+$/, '') });
  }
  const headingIndexes = new Set(headings.map(h => h.index));
  const entries = [];
  let start = -1;
  let listIndent = null;
  const flush = (/** @type {number} */ end) => {
    while (start >= 0 && end > start && lines[end - 1].trim() === '') end -= 1;
    if (start >= 0 && end > start) entries.push({index: start, text: lines.slice(start, end).join('\n')});
    start = -1;
    listIndent = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fenced.has(index)) {
      if (start < 0) start = index;
      continue;
    }
    if (headingIndexes.has(index)) {
      flush(index);
      continue;
    }
    if (line.trim() === '') {
      if (listIndent === null) flush(index);
      continue;
    }
    const bullet = /^(\s*)(?:[-+*]|\d+[.)])\s/.exec(line);
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (start >= 0 && ((bullet && (listIndent === null || indent <= listIndent)) ||
      (listIndent !== null && indent <= listIndent && lines[index - 1]?.trim() === ''))) flush(index);
    if (start < 0) {
      start = index;
      listIndent = bullet ? indent : null;
    }
  }
  flush(lines.length);
  return { lines, headings, entries };
}
/** Section includes its heading; pointer is one-based in the original file.
 * @param {string} body @param {string} title @param {string} path @param {number} [bodyLine]
 */
export function sectionExcerpt(body, title, path, bodyLine = 1) {
  return preparedSection(prepareBody(body), title, path, bodyLine);
}
/** @param {ReturnType<typeof prepareBody>} prepared @param {string} title
 * @param {string} path @param {number} [bodyLine]
 */
function preparedSection(prepared, title, path, bodyLine = 1) {
  const { lines, headings } = prepared;
  const matching = headings.filter(entry => entry.title.toLowerCase() === title.toLowerCase());
  const heading = matching.find(entry => entry.level === 2) ?? matching.reduce((best, entry) =>
    !best || entry.level < best.level ? entry : best, matching[0]);
  if (!heading) return null;
  const end = headings.find((entry) => entry.index > heading.index && entry.level <= heading.level)?.index ?? lines.length;
  const content = lines.slice(heading.index + 1, end);
  const entries = prepared.entries.filter(entry => entry.index > heading.index && entry.index < end).map(entry => entry.text);
  return { title, line: bodyLine + heading.index, pointer: `${path}:${bodyLine + heading.index}`, lines: end - heading.index,
    first: entries[0] ?? '', last: entries.at(-1) ?? '', entries, text: content.join('\n') };
}

/** Match only ids declared in the supplied corpus; never prefix match a check name.
 * @param {string} body @param {string[]} ids
 */
export function mentionedIds(body, ids) {
  if (!ids.length) return [];
  const alternatives = ids.filter(Boolean).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!alternatives.length) return [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_-])`, 'gu');
  const found = new Set([...body.matchAll(pattern)].map((match) => match[0]));
  return ids.filter((id) => found.has(id));
}
/** @returns {{base: number, pass: number, fail: number, no_evidence: number, unrecognized: number}} */
function outcomes() {
  return { base: 0, pass: 0, fail: 0, no_evidence: 0, unrecognized: 0 };
}
/** @param {ReturnType<typeof outcomes>} counts @param {string} outcome */
function addOutcome(counts, outcome) {
  counts.base += 1;
  if (outcome === 'pass') counts.pass += 1;
  else if (outcome === 'fail') counts.fail += 1;
  else if (outcome === 'no_evidence') counts.no_evidence += 1;
  else counts.unrecognized += 1;
}
/** @param {ParsedRecord} record @param {Problem[]} problems
 * @param {import('./record.js').Diagnostic|undefined} duplicate
 */
function taskDerivation(record, problems, duplicate) {
  const path = record.path ?? '<unknown>';
  const entries = recordEntries(record);
  const declared = [...new Set(declaredRequirements(record).checks ?? [])];
  const candidateEntries = list(record.frontmatter.candidates);
  const refKey = (/** @type {unknown} */ ref) => ref == null ? '' : recordValueText(ref);
  const refs = [...new Set(entries.candidates.map(entry => refKey(entry.ref)).filter(Boolean))];
  const malformed = candidateEntries.flatMap((entry, index) => mapping(entry) ? [] : [{number: index + 1, entry}]);
  if (malformed.length) problems.push({code: 'report.candidate_malformed', path,
    message: `malformed candidate entries ${malformed.map(entry => `#${entry.number}`).join(', ')} retained; lint evaluates the last mapping, not a scalar tail`, incomplete: true, aggregates: ['candidates', 'rework']});
  const totals = outcomes();
  const failNames = new Map();
  for (const entry of entries.evidence) {
    if (declared.includes(recordValueText(entry.check)) && entry.result === 'fail') {
      const name = recordValueText(entry.check);
      failNames.set(name, (failNames.get(name) ?? 0) + 1);
    }
  }
  for (const field of ['candidates', 'evidence', 'assessments']) {
    const raw = record.frontmatter[field];
    if (raw != null && (!Array.isArray(raw) || raw.some((entry) => !mapping(entry)))) {
      problems.push({ code: 'report.entry_shape', path, message: `${field} contains entries that cannot be interpreted; preserved in frontmatter`, incomplete: true, aggregates: [field, 'rework'] });
    }
  }
  entries.candidates.forEach((entry) => {
    if (!refKey(entry.ref)) {
      problems.push({ code: 'report.ref_missing', path, message: 'candidate without an interpretable ref; distinct refs, repeated entries and current/outcome triples incomplete', incomplete: true, aggregates: ['distinct_refs', 'repeated_entries', 'outcome_triples', 'failing_now'] });
    }
  });
  entries.evidence.forEach((entry, index) => {
    if (typeof entry.result !== 'string' || !RESULTS.includes(entry.result)) problems.push({ code: 'report.result_unrecognized', path,
      message: `evidence[${index}] result ${recordedText(entry.result)} is unrecognized; recorded fails, outcome triples, current results and other-check outcomes may be incomplete`, incomplete: true,
      aggregates: ['declared_fails_recorded', 'outcome_triples', 'failing_now', 'other_checks'] });
  });
  entries.assessments.forEach((entry, index) => {
    if (typeof entry.verdict !== 'string' || !VERDICTS.includes(entry.verdict)) problems.push({ code: 'report.verdict_unrecognized', path,
      message: `assessments[${index}] verdict ${recordedText(entry.verdict)} is unrecognized; blocking-verdict counts incomplete`, incomplete: true, aggregates: ['blocking_verdicts', 'assessments'] });
  });
  const rounds = refs.map((ref) => {
    // Restrict evidence once per round. Selection still belongs to the check;
    // unrelated entries need not be filtered and scanned for every check name.
    const evidenceEntries = entries.evidence.filter((entry) => recordValueText(entry.candidate) === ref);
    const roundRecord = {...record, frontmatter: {...record.frontmatter, evidence: evidenceEntries}};
    const indexes = candidateEntries.flatMap((entry, index) => mapping(entry) && refKey(entry.ref) === ref ? [index + 1] : []);
    const checks = declared.map((check) => {
      const evidence = effectiveEvidence(roundRecord, check, ref);
      const outcome = evidence === null ? 'no_evidence' : typeof evidence.result === 'string' && RESULTS.includes(evidence.result) ? evidence.result : 'unrecognized';
      addOutcome(totals, outcome);
      return { check, outcome, result: evidence === null ? null : evidence.result, evidence };
    });
    const names = [...new Set(evidenceEntries.map((entry) => recordValueText(entry.check)))].filter((name) => !declared.includes(name));
    const other = names.map((check) => ({ check, evidence: effectiveEvidence(roundRecord, check, ref) }));
    // Use the check's selection rule, then restore document presentation order.
    const assessments = effectiveAssessments(record, ref).sort((a, b) => entries.assessments.indexOf(a) - entries.assessments.indexOf(b));
    return { ref, entries: indexes, last_entry: indexes.at(-1) ?? 0, checks, assessments,
      other_checks: { count: names.length, failed: other.filter((entry) => entry.evidence?.result === 'fail').length,
        unrecognized: other.filter((entry) => !(typeof entry.evidence?.result === 'string' && RESULTS.includes(entry.evidence.result))).length, results: other } };
  }).sort((a, b) => a.last_entry - b.last_entry);
  const currentEntry = currentCandidate(record);
  const currentNumber = currentEntry ? candidateEntries.lastIndexOf(currentEntry) + 1 : 0;
  const current = rounds.find(round => round.ref === refKey(currentEntry?.ref));
  const requirements = requirementEvaluation(record);
  const structural = structuralValidity(record);
  if (duplicate) {
    structural.valid = false;
    structural.errors = [...structural.errors, duplicate];
  }
  const blockingCount = entries.assessments.filter((entry) => blocking(entry.verdict)).length;
  const counts = { candidates: candidateEntries.length, distinct_refs: refs.length, assessed_refs: rounds.filter((round) => round.assessments.length).length,
    repeated_entries: rounds.reduce((count, round) => count + round.entries.length - 1, 0), blocking_verdicts: blockingCount,
    declared_fails_recorded: [...failNames.values()].reduce((a, b) => a + b, 0), declared_fail_names: Object.fromEntries(failNames), outcome_triples: totals,
    evidence: entries.evidence.length, assessments: entries.assessments.length };
  return { entries, declared_checks: declared, rounds, malformed_candidates: malformed,
    current: currentEntry ? {
      ...(current ?? { ref: refKey(currentEntry.ref) || null, entries: [], last_entry: currentNumber, checks: [], assessments: [], other_checks: { count: 0, failed: 0, unrecognized: 0, results: [] } }),
      valid_ref: Boolean(current), entry: currentEntry, number: currentNumber,
    } : null,
    requirements, structural, counts, ready_to_close: readyToClose({status: recordedText(record.frontmatter.status), requirements_satisfied: requirements.length ? requirements.every((r) => r.status === 'satisfied') : null}, structural.valid) };
}

/** Derive the corpus once for all views. Inputs and observations are not mutated.
 * JSON retains raw frontmatter/body as well as every interpreted entry.
 * @param {ReportInput[]} inputs @param {{git?: GitObservation, problems?: Problem[], project?: string}} [options]
 */
export function deriveReport(inputs, options = {}) {
  const problems = [...(options.problems ?? [])];
  const readable = inputs.filter(({record}) => {
    const errors = record.errors.filter((error) => error.code.startsWith('frontmatter.'));
    if (!errors.length) return true;
    problems.push({code: 'report.frontmatter_unreadable', path: record.path ?? undefined, message: errors.map((e) => e.message).join('; '), incomplete: true});
    return false;
  });
  const duplicates = duplicateIdErrors(readable.filter(({kind}) => kind === 'task').map(({record}) => record));
  const ids = [...new Set(readable.map(({record}) => idKey(record.frontmatter.id)).filter(Boolean))];
  const records = readable.map(({record, kind, body_line}) => {
    const path = record.path ?? '<unknown>';
    const id = idKey(record.frontmatter.id);
    const prepared = prepareBody(record.body);
    const base = { kind, path, id, title: recordedText(record.frontmatter.title), status: recordedText(record.frontmatter.status),
      date: record.frontmatter.date, frontmatter: record.frontmatter, body: record.body,
      mentions: mentionedIds(record.body, ids).filter((other) => other !== id),
      sections: Object.fromEntries(['Intent','Blockers and decisions','Context','Decision','Consequences','Revisit if'].map((title) => [title, preparedSection(prepared, title, path, body_line)])),
      first_paragraph: prepared.entries[0]?.text ?? '', git: options.git?.records?.[path] ?? null };
    const task = kind === 'task' ? taskDerivation(record, problems, duplicates.get(path)) : null;
    const references = [...new Set((task?.current?.assessments ?? []).map(entry => entry.findings)
      .filter((value) => typeof value === 'string' && (/^#[^\s]+$/.test(value) || /^[^\s]+(?:\/|\.)[^\s]+$/.test(value))))];
    const findingsReferences = references.map(reference => {
      const matches = reference.startsWith('#') ? prepared.headings.filter(heading =>
        `#${heading.title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')}` === reference) : [];
      const section = matches.length === 1 ? preparedSection(prepared, matches[0].title, path, body_line) : null;
      return {reference, section: section ? {pointer: section.pointer, first: section.first} : null};
    });
    return {...base, task, findings_references: findingsReferences};
  });
  const byId = new Map();
  for (const record of records) {
    if (record.id) byId.set(record.id, [...(byId.get(record.id) ?? []), record]);
  }
  for (const [id, twins] of byId) {
    if (twins.length < 2) continue;
    for (const twin of twins) {
      problems.push({code: 'id.duplicate', path: twin.path, message: `${id} is declared by ${twins.map((r) => r.path).join(', ')}`});
    }
  }
  const relations = records.map((record) => ({ path: record.path,
    mentioned_by: records.filter((other) => other.path !== record.path && other.mentions.includes(record.id)).map((other) => other.path),
    depends_on: list(record.frontmatter.depends_on).map((id) => ({id: idKey(id), records: records.filter((other) => other.kind === 'task' && other.id !== '' && other.id === idKey(id)).map((other) => other.path)})),
    needed_by: record.id === '' ? [] : records.filter((other) => other.kind === 'task' && list(other.frontmatter.depends_on).map(idKey).includes(record.id)).map((other) => other.path) }));
  const tasks = records.filter((r) => r.task !== null);
  const decisions = records.filter((r) => r.kind === 'decision');
  const totalOutcomes = outcomes(), currentOutcomes = outcomes();
  const sum = (/** @type {keyof NonNullable<typeof tasks[number]['task']>['counts']} */ key) => tasks.reduce((n,r) => n + Number(r.task?.counts[key] ?? 0), 0);
  const statuses = (/** @type {typeof records} */ rows) => {
    const counts = new Map();
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return Object.fromEntries(counts);
  };
  const failNames = new Map();
  const histogram = {one: 0, two: 0, three_to_five: 0, six_plus: 0, zero: 0};
  const blockingRecords = {one: 0, two: 0, three_plus: 0, zero: 0};
  let maxCandidates = 0;
  for (const record of tasks) {
    const task = record.task;
    if (!task) continue;
    const n = task.counts.candidates;
    maxCandidates = Math.max(n, maxCandidates);
    histogram[n === 0 ? 'zero' : n === 1 ? 'one' : n === 2 ? 'two' : n <= 5 ? 'three_to_five' : 'six_plus'] += 1;
    const b = task.counts.blocking_verdicts;
    blockingRecords[b === 0 ? 'zero' : b === 1 ? 'one' : b === 2 ? 'two' : 'three_plus'] += 1;
    for (const [name, count] of Object.entries(task.counts.declared_fail_names)) failNames.set(name, (failNames.get(name) ?? 0) + count);
    for (const round of task.rounds) {
      for (const check of round.checks) addOutcome(totalOutcomes, check.outcome);
    }
    if (!['done', 'cancelled'].includes(record.status)) {
      for (const check of task.current?.checks ?? []) addOutcome(currentOutcomes, check.outcome);
    }
  }
  const recent = [];
  const quality = { entries: 0, without_at: 0, date_only_at: 0, malformed_at: 0, malformed_decision_dates: 0,
    candidate_model: 0, candidate_host_model: 0, host_model: 0, moving_refs: 0,
    legacy_host: {count: 0, names: /** @type {string[]} */ ([]), dated: 0, undated: 0, latest_recorded: '', latest_date_only: ''} };
  for (const record of records) {
    if (record.task) {
      for (const [kind, entries] of Object.entries(record.task.entries)) for (const [index, entry] of entries.entries()) {
        quality.entries += 1;
        if (entry.host && entry.model) quality.host_model += 1;
        if (kind === 'candidates') {
          if (entry.model) quality.candidate_model += 1;
          if (entry.host && entry.model) quality.candidate_host_model += 1;
          if (entry.ref != null && recordValueText(entry.ref) && !isObjectId(recordValueText(entry.ref))) quality.moving_refs += 1;
        }
        const date = recordedDate(entry.at);
        if (date.kind === 'missing') quality.without_at += 1;
        else if (date.kind === 'malformed') quality.malformed_at += 1;
        else {
          if (date.kind === 'date_only') quality.date_only_at += 1;
          recent.push({path: record.path, id: record.id, kind, index: index + 1, entry, date});
        }
        if (entry.host && !HOSTS.includes(recordedText(entry.host))) {
          const legacy = quality.legacy_host;
          legacy.count += 1;
          legacy.names.push(recordedText(entry.host));
          if (date.kind === 'timestamp' || date.kind === 'date_only') {
            legacy.dated += 1;
            // Dates have no invented midnight. Keep date-only observations
            // separately when a timestamp exists, without claiming their order.
            const previous = recordedDate(legacy.latest_recorded);
            if (date.kind === 'timestamp' && (previous.kind !== 'timestamp' || compareInstants(date, previous) > 0)) {
              legacy.latest_recorded = date.raw;
            } else if (date.kind === 'date_only') {
              legacy.latest_date_only = date.raw > legacy.latest_date_only ? date.raw : legacy.latest_date_only;
              if (previous.kind !== 'timestamp') legacy.latest_recorded = legacy.latest_date_only;
            }
          } else legacy.undated += 1;
        }
      }
    } else {
      const date = recordedDate(record.date, true);
      if (date.kind === 'malformed') quality.malformed_decision_dates += 1;
      if (date.kind === 'date_only') recent.push({path: record.path, id: record.id, kind: 'decision', index: 1, entry: record.frontmatter, date});
    }
  }
  quality.legacy_host.names = [...new Set(quality.legacy_host.names)];
  recent.sort((a,b) => (b.date.day ?? '').localeCompare(a.date.day ?? '') ||
    (a.date.kind === 'date_only' ? 1 : 0) - (b.date.kind === 'date_only' ? 1 : 0) || compareInstants(b.date, a.date));
  const attention = tasks.filter((r) => !['done','cancelled'].includes(r.status)).map((r) => ({path: r.path, id: r.id, status: r.status,
    fail: r.task?.current?.checks.filter((c) => c.outcome === 'fail').map((c) => c.check) ?? [],
    no_evidence: r.task?.current?.checks.filter((c) => c.outcome === 'no_evidence').map((c) => c.check) ?? [],
    unrecognized: r.task?.current?.checks.filter((c) => c.outcome === 'unrecognized').map((c) => ({check: c.check, result: c.result})) ?? [],
    no_candidate: !r.task?.current, no_current_evidence: !r.task?.entries.evidence.some((e) => recordValueText(e.candidate) === r.task?.current?.ref),
    ready_to_close: r.task?.ready_to_close ?? false,
    blockers: ['blocked','needs_context'].includes(r.status) ? r.sections['Blockers and decisions']?.first.split('\n')[0] ?? '' : '',
    blockers_continues: ['blocked','needs_context'].includes(r.status) && Boolean(r.sections['Blockers and decisions']?.first.includes('\n')),
    blockers_pointer: ['blocked','needs_context'].includes(r.status) ? r.sections['Blockers and decisions']?.pointer ?? '' : ''}));
  const mentionedDecisions = decisions.map((r) => ({id: r.id, path: r.path, tasks: tasks.filter((t) => t.mentions.includes(r.id)).length})).sort((a,b) => b.tasks - a.tasks);
  return { complete: !problems.some((p) => p.incomplete), problems, project: options.project ?? '', records, relations,
    git_omitted: options.git?.omitted ?? (options.git ? null : 'Git observations not supplied'),
    totals: {tasks: tasks.length, decisions: decisions.length, task_statuses: statuses(tasks), decision_statuses: statuses(decisions),
      invalid_tasks: tasks.filter((r) => !r.task?.structural.valid).length,
      candidates: sum('candidates'), distinct_refs: sum('distinct_refs'), evidence: sum('evidence'), assessments: sum('assessments'),
      assessed_refs: sum('assessed_refs'), repeated_entries: sum('repeated_entries'), candidate_histogram: histogram,
      max_candidates: maxCandidates, max_candidate_records: tasks.filter((r) => r.task?.counts.candidates === maxCandidates).map((r) => r.path),
      blocking_verdicts: sum('blocking_verdicts'), blocking_records: tasks.length - blockingRecords.zero, blocking_histogram: blockingRecords,
      declared_fails_recorded: sum('declared_fails_recorded'), declared_fail_names: Object.fromEntries([...failNames].sort((a,b) => b[1] - a[1])),
      outcome_triples: totalOutcomes, current_triples: currentOutcomes }, attention, recent, quality, mentioned_decisions: mentionedDecisions };
}
