/** Plain text projection. Only history, mentions, and prose excerpts are bounded. */
import { mentionedIds, recordedText as str } from './report.js';
import { recordValueText } from './record.js';
/** @typedef {ReturnType<import('./report.js').deriveReport>} Report */
/** @typedef {Report['records'][number]} Row */

/** Wrap to 100 columns, including long tokens; never drop current state.
 * @param {string} value @param {number} [width]
 */
function wrap(value, width = 100) {
  const lines = [];
  for (const original of value.split('\n')) {
    const originalIndent = original.match(/^\s*/)?.[0] ?? '';
    const label = /^\s*\S.*? {2,}/.exec(original)?.[0] ?? /^\s*[^:]+: /.exec(original)?.[0];
    const indent = originalIndent.length >= width ? originalIndent :
      ' '.repeat(label && label.length < width ? label.length : originalIndent.length);
    // A recorded scalar can itself start beyond the target column. Reapplying
    // that indentation would make no progress; keep the line intact instead.
    if (indent.length >= width) {
      lines.push(original);
      continue;
    }
    let remaining = original;
    while (remaining.length > width) {
      const space = remaining.lastIndexOf(' ', width);
      const end = space > indent.length ? space : width;
      lines.push(remaining.slice(0, end));
      remaining = indent + remaining.slice(end).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}
/** @param {unknown} value @param {number} [lines] */
function excerpt(value, lines = 1) {
  const flat = str(value).replace(/\s+/g, ' ').trim();
  const max = lines * 86;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
/** @param {ReturnType<import('./report.js').sectionExcerpt>} section */
function paragraph(section) { return section?.entries[0] ?? ''; }
/** @param {Report} report @param {Row} record */
function gitLine(report, record) {
  const git = record.git;
  return `Git  ${report.git_omitted ?? (git?.first_commit ? `first commit ${git.first_commit};
  last commit ${git.last_commit} (visible locally)` : 'no commits visible in local history')}${git?.uncommitted ? '; uncommitted record changes' : ''}`;
}
/** @param {Report} report @param {string} path */
function label(report, path) {
  const row = report.records.find((r) => r.path === path);
  return row ? `${row.id} (${row.status})${row.kind === 'decision' ? ` ${row.title}` : ''}` : path;
}
/** @param {Report} report @param {Row} row @param {string[]} lines */
function mentions(report, row, lines) {
  const incoming = report.relations.find((r) => r.path === row.path)?.mentioned_by ?? [];
  const blockers = row.sections['Blockers and decisions'];
  const cited = mentionedIds([excerpt(blockers?.first, 2), excerpt(blockers?.last, 2)].join('\n'), row.mentions);
  const priority = (/** @type {Row} */ record) => record.kind === 'decision' ? cited.includes(record.id) ? 0 : 1 : 2;
  const outgoing = row.mentions.flatMap(id => report.records.filter(record => record.id === id))
    .sort((a, b) => priority(a) - priority(b)).map(record => record.path);
  for (const [name, paths] of [['Mentions', outgoing], ['Mentioned by', incoming]]) {
    const items = /** @type {string[]} */ (paths);
    lines.push(`${name}  ${items.slice(0,5).map((p) => label(report, p)).join(' · ') || 'none'}${items.length > 5 ? ` · ${items.length - 5} more not shown; --json retains all` : ''}`);
  }
}
/** @param {Report} report @param {Row} row */
function taskText(report, row) {
  const task = row.task;
  if (!task) return [];
  const lines = [`${row.id}  ${row.title}  ${row.status}${task.structural.valid ? '' : ' · structurally invalid, see task lint'}`];
  if (row.sections.Intent) lines.push(`Intent  ${excerpt(paragraph(row.sections.Intent), 2)}`);
  const requires = row.frontmatter.requirements;
  const requirementText = requires && typeof requires === 'object' && !Array.isArray(requires)
    ? Object.entries(requires).map(([kind, value]) => `${kind} ${str(value)}`).join(' · ') || 'none declared'
    : requires === undefined ? 'none declared' : `${str(requires)} (raw value)`;
  lines.push(`Requires  ${requirementText}`, '');
  const current = task.current;
  if (!current) lines.push(task.counts.candidates ? 'Current candidate  no mapping entry to evaluate' : 'Current candidate  none recorded');
  else {
    const entry = current.entry;
    lines.push(`Current candidate  #${current.number} of ${task.counts.candidates}  ${current.valid_ref ? current.ref : `invalid ref ${entry?.ref === undefined ? '<missing>' : str(entry.ref)} (current mapping retained)`}`);
    lines.push(`  producers ${JSON.stringify(entry?.producers ?? [])}${entry?.host !== undefined ? ` · host ${str(entry.host)}` : ''}${entry?.model !== undefined ? ` · model ${str(entry.model)}` : ''}`);
    if (entry?.at !== undefined) lines.push(`  recorded at ${str(entry.at)}`);
    if (entry?.note !== undefined) {
      const note = str(entry.note);
      lines.push(`  note ${excerpt(note, 2)}${note.replace(/\s+/g, ' ').trim().length > 172 ? ' (excerpt; remainder in --json)' : ''}`);
    }
    if (current.entries.length > 1) lines.push(`  ref repeats entries ${current.entries.slice(0,-1).map((n) => `#${n}`).join(', ')}; results shown once here, under last entry`);
    for (const check of current.checks) lines.push(`  ${check.check}  ${check.outcome === 'no_evidence' ? 'no evidence' : str(check.result)}${check.outcome === 'unrecognized' ? ' (unrecognized)' : ''}`);
    lines.push(`  ${current.other_checks.count} other ${current.other_checks.count === 1 ? 'check (distinct name)' : 'checks (distinct names)'}, ${current.other_checks.failed} failed by effective result${current.other_checks.unrecognized ? `, ${current.other_checks.unrecognized} unrecognized` : ''}`);
    for (const other of current.other_checks.results.filter((r) => !(typeof r.evidence?.result === 'string' && ['pass','fail'].includes(r.evidence.result)))) lines.push(`  other check ${other.check}  ${str(other.evidence?.result)} (unrecognized)`);
    for (const assessment of current.assessments) {
      const reference = row.findings_references.find(entry => entry.reference === assessment.findings);
      const findings = reference ? `${reference.reference} (reference)${reference.section ? ` · recorded prose ${reference.section.pointer}: ${excerpt(reference.section.first)}` : ''}`
        : excerpt(str(assessment.findings).split('\n')[0]);
      lines.push(`  ${str(assessment.actor) || `${str(assessment.role)} (no actor)`}  ${str(assessment.verdict)}  ${findings}`);
    }
  }
  lines.push('', 'Requirements');
  if (!task.requirements.length) lines.push('  no requirements declared');
  for (const requirement of task.requirements) lines.push(`  ${requirement.requirement}  ${requirement.status} (${requirement.reason})`);
  const section = row.sections['Blockers and decisions'];
  if (section) lines.push('', `Blockers and decisions  ${section.lines} lines · ${section.pointer} · recorded prose`, `  first  ${excerpt(section.first,2)}`, `  last   ${excerpt(section.last,2)}`);
  if (task.malformed_candidates.length) lines.push(`  Malformed candidate entries ${task.malformed_candidates.slice(0, 5).map(entry => `#${entry.number} ${excerpt(entry.entry)}`).join('; ')} (not evaluated by lint)${task.malformed_candidates.length > 5 ? `; ${task.malformed_candidates.length - 5} more in --json` : ''}`);
  const earlierEntries = Array.isArray(row.frontmatter.candidates) ? row.frontmatter.candidates.filter((_, index) => index + 1 !== current?.number) : [];
  const earlier = task.rounds.filter((r) => r.ref !== current?.ref);
  const assessed = earlier.filter((r) => r.assessments.length);
  const shown = assessed.slice(-5);
  const earlierBlocking = task.entries.assessments.filter((a) => earlier.some((r) => r.ref === recordValueText(a.candidate)) && (a.verdict === 'needs_revision' || a.verdict === 'reject')).length;
  const distinctEarlier = new Set(earlierEntries.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(entry => entry.ref == null ? '' : recordValueText(entry.ref)).filter(Boolean)).size;
  const historyLabel = task.malformed_candidates.length ? 'History (excluding evaluated entry)' : 'Earlier';
  lines.push('', `${historyLabel}  ${earlierEntries.length} ${earlierEntries.length === 1 ? 'entry' : 'entries'}, ${distinctEarlier} distinct refs (${earlier.length} not current), ${assessed.length} assessed refs not current`,
    `  ${earlierBlocking} blocking verdicts on refs not current; ${task.counts.repeated_entries} of ${task.counts.candidates} entries repeat an earlier ref`);
  for (const round of shown) lines.push(`  ${excerpt(`#${round.last_entry} ${round.ref.length > 18 ? `${round.ref.slice(0,18)}…` : round.ref}  ${round.assessments.map((a) => str(a.verdict)).join('; ')}  ${str(round.assessments.at(-1)?.findings)}`)}`);
  const shownEntries = shown.length;
  const currentEntries = current ? 1 : 0;
  lines.push(`  ${assessed.length - shown.length} earlier assessed refs and ${earlier.length - assessed.length} unassessed refs not shown`,
    `  ${shownEntries + currentEntries} candidate ${shownEntries + currentEntries === 1 ? 'entry' : 'entries'} shown, ${task.counts.candidates - shownEntries - currentEntries} omitted (repeats included); --json retains all ${task.counts.candidates}`);
  const relation = report.relations.find((r) => r.path === row.path);
  lines.push('', 'Depends on');
  if (!relation?.depends_on.length) lines.push('  none');
  for (const dep of relation?.depends_on ?? []) lines.push(`  ${dep.records.length ? dep.records.map((p) => label(report,p)).join(' · ') : `${dep.id} (not found)`}`);
  lines.push('Needed by');
  if (!relation?.needed_by.length) lines.push('  none');
  for (const p of relation?.needed_by ?? []) lines.push(`  ${label(report,p)}`);
  mentions(report,row,lines);
  lines.push(gitLine(report,row));
  return lines;
}
/** @param {Report} report @param {Row} row */
function decisionText(report,row) {
  const lines = [`${row.id}  ${row.title}  ${row.status}  ${str(row.date)}`];
  let found = false;
  for (const title of ['Decision','Context','Consequences','Revisit if']) {
    const section = row.sections[title];
    if (!section) continue;
    found = true;
    lines.push(`${title}  ${excerpt(title === 'Decision' ? paragraph(section) : section.first.split('\n')[0],title === 'Decision' ? 4 : 1)}`);
  }
  if (!found) lines.push(`Recorded prose  ${excerpt(row.first_paragraph,4)}`);
  mentions(report,row,lines);
  lines.push(gitLine(report,row));
  return lines;
}
/** @param {Report} report */
function projectText(report) {
  const t = report.totals, q = report.quality;
  const lines = [`${report.project}  ${t.tasks} tasks  ${t.decisions} decisions`,
    'Record values are asserted; Git dates are observed locally. This report decides nothing.',
    `Tasks  ${Object.entries(t.task_statuses).map(([k,v]) => `${k} ${v}`).join(' · ')}`,
    `  ${t.invalid_tasks} of ${t.tasks} structurally invalid (task lint)`, '', 'Attention'];
  const drafts = report.attention.filter((row) => row.status === 'draft' && row.no_candidate);
  // Display priority only: derivation/JSON retain all records and their order.
  const priority = (/** @type {Report['attention'][number]} */ row) => {
    if (row.fail.length || row.unrecognized.length) return 0;
    if (['blocked', 'needs_context', 'needs_revision'].includes(row.status)) return 1;
    if (row.no_evidence.length || row.no_current_evidence) return 2;
    if (row.ready_to_close) return 3;
    return 4;
  };
  const attention = report.attention.filter((row) => !(row.status === 'draft' && row.no_candidate))
    .filter((row) => row.fail.length || row.no_evidence.length || row.unrecognized.length || row.no_candidate || row.no_current_evidence || row.ready_to_close || ['blocked', 'needs_context', 'needs_revision'].includes(row.status))
    .sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  const retained = (/** @type {Report['attention'][number]} */ row) => ['blocked', 'needs_context'].includes(row.status);
  const ordinary = attention.filter(row => !retained(row)).slice(0, 10);
  const shown = attention.filter(row => retained(row) || ordinary.includes(row));
  for (const row of shown) {
    lines.push(`  ${row.id}  ${row.status}${row.ready_to_close ? ' · ready to close' : ''}${row.no_candidate ? ' · no candidate' : row.no_current_evidence ? ' · current candidate has no evidence' : ''}`);
    if (row.fail.length) lines.push(`    failing now: ${row.fail.join(', ')}`);
    if (row.no_evidence.length) lines.push(`    no evidence now: ${row.no_evidence.join(', ')}`);
    if (row.unrecognized.length) lines.push(`    unrecognized: ${row.unrecognized.map((c) => `${c.check} ${str(c.result)}`).join(', ')}`);
    if (row.blockers) lines.push(`    blockers (recorded prose): ${excerpt(row.blockers)}${row.blockers_continues ? ' … (paragraph continues)' : ''}${row.blockers_pointer ? ` · ${row.blockers_pointer}` : ''}`);
  }
  if (shown.length > 10) lines.push(`  Attention overflow: ${shown.length} records shown to retain all blocked/needs_context records; at most 10 ordinary rows`);
  if (drafts.length) lines.push(`  ${drafts.length} candidate-less drafts summarized; --json retains all`);
  if (!attention.length && !drafts.length) lines.push('  none recorded');
  if (attention.length > shown.length) lines.push(`  ${attention.length - shown.length} attention records not shown; --json retains all`);
  const c = t.current_triples;
  lines.push(`  Current nonterminal triples: ${c.fail} fail, ${c.no_evidence} no evidence, ${c.unrecognized} unrecognized / ${c.base} triples`, '',
    'Rework  declared checks only, within each record',
    `  recorded candidates ${t.candidates} entries / ${t.tasks} records; ${t.distinct_refs} distinct refs summed per record`,
    `  entries per record: 0: ${t.candidate_histogram.zero}, 1: ${t.candidate_histogram.one}, 2: ${t.candidate_histogram.two}, 3-5: ${t.candidate_histogram.three_to_five}, 6+: ${t.candidate_histogram.six_plus}`,
    `  max ${t.max_candidates} entries: ${t.max_candidate_records.slice(0, 5).map((p) => label(report,p)).join(', ')} (${t.max_candidate_records.length} records; ${Math.max(0, t.max_candidate_records.length - 5)} omitted; --json retains all)`,
    `  blocking verdicts recorded ${t.blocking_verdicts} / ${t.assessments} assessments, on ${t.blocking_records} / ${t.tasks} records`,
    `  records with blocking verdicts: 1: ${t.blocking_histogram.one}, 2: ${t.blocking_histogram.two}, 3+: ${t.blocking_histogram.three_plus}`,
    `  declared-check fails recorded ${t.declared_fails_recorded} / ${t.evidence} evidence entries (reruns included)`,
    `  fail names: ${Object.entries(t.declared_fail_names).slice(0,5).map(([k,v]) => `${k} ${v}`).join(', ') || 'none'}${Object.keys(t.declared_fail_names).length > 5 ? `; ${Object.keys(t.declared_fail_names).length - 5} more names in --json` : ''}`,
    `  outcome triples ${t.outcome_triples.base}: pass ${t.outcome_triples.pass}, fail ${t.outcome_triples.fail}, no evidence ${t.outcome_triples.no_evidence}, unrecognized ${t.outcome_triples.unrecognized}`,
    '', 'Recent  by recorded calendar day; instants within a day, date-only entries last');
  for (const row of report.recent.slice(0,10)) lines.push(`  ${row.date.day}  ${row.id}  ${row.kind === 'candidates' ? 'candidate' : row.kind === 'evidence' ? str(row.entry.result) : row.kind === 'assessments' ? str(row.entry.verdict) : str(row.entry.status)}  ${excerpt(row.entry.ref ?? row.entry.check ?? row.entry.actor ?? row.entry.title)}  ${row.date.kind === 'date_only' ? 'date only' : row.date.raw}`);
  lines.push(`  ${Math.max(0,report.recent.length - 10)} dated entries not shown; ${q.without_at} / ${q.entries} entries have no at; not placed`, '',
    `Decisions  ${t.decisions}: ${Object.entries(t.decision_statuses).map(([k,v]) => `${k} ${v}`).join(' · ')}`,
    `  most mentioned (tasks): ${report.mentioned_decisions.slice(0,5).map((d) => `${d.id} ${d.tasks}`).join(', ') || 'none'} / ${t.tasks} tasks`, '', 'Record quality',
    `  host not a host id: ${q.legacy_host.count} / ${q.entries} entries (${q.legacy_host.names.slice(0,5).join(', ') || 'none'})`,
    `    ${q.legacy_host.dated} dated, latest recorded ${q.legacy_host.latest_recorded || 'none'}; ${q.legacy_host.undated} undated or malformed`,
    ...(q.legacy_host.latest_date_only ? [`    latest date-only observation ${q.legacy_host.latest_date_only}; no instant or exact ordering against timestamps`] : []),
    `  without at ${q.without_at} / ${q.entries}; date-only at ${q.date_only_at}; malformed at ${q.malformed_at}`,
    `  malformed decision dates ${q.malformed_decision_dates} / ${t.decisions}`,
    `  host and model ${q.host_model} / ${q.entries}; candidate model ${q.candidate_model} / ${t.candidates}`,
    `  moving refs ${q.moving_refs} / ${t.candidates} candidate entries`,
    report.git_omitted ? `Git  ${report.git_omitted}` : `Git  first/last commits visible locally available in record views; ${report.records.filter((r) => r.git?.uncommitted).length} records have uncommitted changes`);
  return lines;
}
/** @param {Report} report @param {Row|null} [selected] */
export function renderReport(report, selected = null) {
  const lines = [];
  if (!report.complete) {
    lines.push('Incomplete: derivation coverage is partial.');
    for (const p of report.problems.filter((p) => p.incomplete)) lines.push(`  ${p.code}${p.path ? ` ${p.path}` : ''}: ${p.message}`);
  }
  lines.push(...(selected ? selected.kind === 'task' ? taskText(report,selected) : decisionText(report,selected) : projectText(report)));
  const remaining = report.problems.filter((p) => !p.incomplete);
  if (remaining.length) {
    lines.push('', 'Problems');
    for (const p of remaining) lines.push(`  ${p.code}${p.path ? ` ${p.path}` : ''}: ${p.message}`);
  }
  return lines.flatMap((line) => wrap(line)).join('\n');
}
