import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {parseRecord, recordEntries} from '../src/record.js';
import {mayBeDone, requirementEvaluation, structuralValidity} from '../src/checks.js';
import {deriveReport} from '../src/report.js';
import {splitArchive, verifyArchive} from '../src/archive.js';
import {taskArchive, writeArchivePair} from '../src/archive-cli.js';
import {readTask} from '../src/task-record-io.js';
import {recordFiles} from '../src/generated.js';
import {ARCHIVE_SUFFIX, TASKS_DIRECTORY} from '../src/layout.js';
import {taskLint, taskList, taskNew, taskSet, taskShow} from '../src/task-cli.js';
import {reportCommand} from '../src/report-cli.js';
const bin = path.resolve('bin/castwork.js');
const prefix = '---\nschema: 1\nid: T-001\ntitle: Test\nstatus: in_review\n';
const lists = `requirements:
  checks: [test]
candidates:
  # old candidate
  - ref: 1111111
  # current candidate
  - ref: 2222222
evidence:
  - {check: test, candidate: 1111111, result: fail}
  - {check: test, candidate: 2222222, result: pass}
  - {check: test, candidate: 1111111, result: pass}
assessments:
  - {candidate: 1111111, role: verifier, actor: reviewer, verdict: reject}
  - {candidate: 2222222, role: verifier, actor: reviewer, verdict: accept}
`;
const text = (data = lists, body = '## Intent\nOutcome.\n') => prefix + data + '---\n' + body;
const parse = source => parseRecord(source, {path: 'T-001.md'});
function split(source, archive = null) {
  const record = parseRecord(source, {path: 'T-001.md', ...(archive ? {archive: {text: archive, path: 'T-001.archive.md'}} : {})});
  return splitArchive(source, archive, record, {date: '2026-10-09', archive_path: 'T-001.archive.md'});
}
function merged(pair) { return parseRecord(pair.record_text, {path: 'T-001.md', archive: {text: pair.archive_text, path: 'T-001.archive.md'}}); }
function capture(fn) {
  let stdout = '', stderr = ''; const a = process.stdout.write, b = process.stderr.write;
  process.stdout.write = chunk => {stdout += String(chunk); return true;}; process.stderr.write = chunk => {stderr += String(chunk); return true;};
  try {return {value: fn(), get stdout(){return stdout;}, get stderr(){return stderr;}};} finally {process.stdout.write = a; process.stderr.write = b;}
}
function root(t, source = text(), archive = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-archive-'));
  fs.mkdirSync(path.join(dir, TASKS_DIRECTORY), {recursive: true});
  const file = path.join(dir, TASKS_DIRECTORY, 'T-001.md'); fs.writeFileSync(file, source);
  if (archive) fs.writeFileSync(file.slice(0, -3) + ARCHIVE_SUFFIX, archive);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return {dir, file};
}

test('raw prefix split preserves order, comments and bytes for LF and CRLF, including an old entry after the boundary', () => {
  for (const eol of ['\n','\r\n']) {
    const source = text().replaceAll('\n', eol), pair = split(source);
    assert.equal(pair.refused, undefined);
    assert.deepEqual(pair.summary.lists, {candidates: 1, evidence: 1, assessments: 1});
    assert.ok(pair.archive_text.includes(`# old candidate${eol}  - ref: 1111111${eol}`));
    assert.ok(pair.record_text.includes(`# current candidate${eol}  - ref: 2222222${eol}`));
    assert.ok(pair.record_text.includes(`candidate: 1111111, result: pass`));
    for (const field of ['candidates','evidence','assessments']) assert.deepEqual(merged(pair).frontmatter[field], parse(source).frontmatter[field]);
    assert.deepEqual(requirementEvaluation(merged(pair)), requirementEvaluation(parse(source)));
    assert.equal(mayBeDone(merged(pair)).allowed, mayBeDone(parse(source)).allowed);
    assert.equal(verifyArchive(parse(source), pair, {archive_path: 'T-001.archive.md', body_line: 1}), null);
    const again = split(pair.record_text, pair.archive_text);
    assert.equal(again.summary.moved, false); assert.equal(again.record_text, pair.record_text); assert.equal(again.archive_text, pair.archive_text);
    assert.equal((pair.record_text.match(/Earlier rounds:/g) ?? []).length, 1);
  }
});
test('a repeated current ref retains its earlier candidate and evidence prefix; flow-style lists stay whole', () => {
  const source = text(`candidates:
  - ref: 2222222
  - ref: 1111111
  - ref: 2222222
evidence:
  - {check: test, candidate: 2222222, result: pass}
  - {check: test, candidate: 1111111, result: fail}
`);
  assert.equal(split(source).summary.moved, false);
  const flow = text('candidates: [{ref: 1111111}, {ref: 2222222}]\nevidence: [{check: test, candidate: 1111111, result: fail}]\n');
  assert.equal(split(flow).summary.moved, false);
  assert.match(split(flow).summary.retained.join(' '), /flow-style/);
});
test('the body never moves: Blockers entries and older sections stay in the record, byte for byte', () => {
  const entries = Array.from({length: 14}, (_, i) => `- round ${i}\n  child\n`).join('\n');
  const sections = Array.from({length: 5}, (_, i) => `## Round ${i}\ntext ${i}\n\n`).join('');
  const body = '## Intent\nOutcome\n## Blockers and decisions\n' + entries + sections;
  const pair = split(text(lists, body));
  assert.deepEqual(pair.summary.lists, {candidates: 1, evidence: 1, assessments: 1});
  assert.equal(pair.summary.blockers, undefined); assert.equal(pair.summary.sections, undefined);
  assert.ok(pair.record_text.endsWith(body));
  assert.ok(!pair.archive_text.includes('round 0'));
  assert.match(pair.archive_text, /\n## Entries moved 2026-10-09\n$/);
  assert.equal(verifyArchive(parse(text(lists, body)), pair, {archive_path: 'T-001.archive.md', body_line: 1}), null);
});
test('strict verification refuses tampered outcomes and appended prose', () => {
  const safe = split(text()); safe.record_text = safe.record_text.replace('result: pass', 'result: fail');
  assert.match(verifyArchive(parse(text()), safe, {archive_path: 'T-001.archive.md'}), /evidence merged/);
  const prose = split(text()); prose.archive_text += 'An added claim.\n';
  assert.match(verifyArchive(parse(text()), prose, {archive_path: 'T-001.archive.md'}), /archive body gained unverified text/);
});
test('archived candidate later becomes current again with its old evidence, and malformed/credential entries remain visible', () => {
  const pair = split(text());
  const source = pair.record_text.replace('  - ref: 2222222', '  - ref: 2222222\n  - ref: 1111111');
  const record = parseRecord(source, {path: 'T-001.md', archive: {text: pair.archive_text, path: 'T-001.archive.md'}});
  assert.equal(requirementEvaluation(record)[0].status, 'satisfied'); // last old-ref pass stayed after split
  const archive = pair.archive_text.replace('result: fail}', 'result: strange, command: "PASSWORD=secret"}');
  const invalid = parseRecord(pair.record_text, {path: 'T-001.md', archive: {text: archive, path: 'T-001.archive.md'}});
  assert.equal(mayBeDone(invalid).allowed, false);
  assert.match(invalid.errors[0].message, /T-001\.archive\.md evidence\[0\]/);
  assert.match(invalid.info.find(note => note.code === 'evidence.credential_like').message, /T-001\.archive\.md evidence\[0\]/);
});
test('archive format rejects wrong ids, extra fields, flow lists and unreadable YAML, not body heading duplicates', () => {
  for (const archive of ['---\nschema: 1\narchive_of: Other\n---\n','---\nschema: 1\narchive_of: T-001\nstatus: done\n---\n','---\nschema: 1\narchive_of: T-001\nevidence: []\n---\n','---\nschema: [\n---\n']) {
    const record = parseRecord(text(), {archive: {text: archive, path: 'bad.archive.md'}});
    assert.ok(record.archive.errors.length); assert.equal(mayBeDone(record).allowed, false);
  }
  const record = parseRecord(text(), {archive: {text: '---\nschema: 1\narchive_of: T-001\n---\n## Intent\nx\n## Intent\ny\n```yaml\nevidence: []\n```\n'}});
  assert.equal(record.errors.length, 0); assert.ok(record.info.some(note => note.code === 'entries.in_body'));
});
test('indented block lists use the same YAML subset, and unrelated prose pointers are not removed', () => {
  const body = 'Earlier rounds: [Other.archive.md](Other.archive.md), moved by `task archive`.\n## Intent\nOutcome\n';
  const archive = '---\n  schema: 1\n  archive_of: T-001\n  evidence:\n    - {check: test, candidate: 1111111, result: pass}\n---\n';
  const record = parseRecord(text(lists, body), {path: 'T-001.md', archive: {text: archive, path: 'T-001.archive.md'}});
  assert.deepEqual(record.archive.errors, []);
  assert.equal(record.body, body);
});

test('every task consumer uses the logical record, archives are never listed or numbered, and text show is unchanged stdout', t => {
  const pair = split(text()), {dir, file} = root(t, pair.record_text, pair.archive_text);
  for (const relative of [TASKS_DIRECTORY, './' + TASKS_DIRECTORY, TASKS_DIRECTORY.replaceAll('/', '\\'), TASKS_DIRECTORY + '/', './' + TASKS_DIRECTORY + '/', TASKS_DIRECTORY.replaceAll('/', '\\') + '\\']) assert.equal(recordFiles(dir, relative).length, 1);
  const listed = capture(() => taskList(dir, {json: true})); assert.equal(listed.value.length, 1); assert.equal(listed.value[0].requirements_satisfied, true);
  const shown = capture(() => taskShow(dir, 'T-001', {json: true})); assert.deepEqual(JSON.parse(shown.stdout).frontmatter.evidence, JSON.parse(JSON.stringify(parse(text()).frontmatter.evidence)));
  const plain = capture(() => taskShow(dir, 'T-001')); assert.equal(plain.stdout, pair.record_text); assert.match(plain.stderr, /T-001.archive.md/);
  assert.equal(capture(() => taskLint(dir, 'T-001', {json: true})).value.ok, true);
  const report = capture(() => reportCommand(dir, 'T-001', {json: true})).value.report;
  assert.equal(report.totals.tasks, 1); assert.equal(report.totals.evidence, 3); assert.equal(report.selected.task.archive.entries.evidence, 1);
  capture(() => taskSet(dir, 'T-001', 'status', 'done')); assert.match(fs.readFileSync(file, 'utf8'), /status: done/);
  const next = capture(() => taskNew(dir, 'Next')); assert.equal(path.basename(next.value), 'T-002.md');
});
test('final review F1: every report pointer uses its actual file line after a successful archive', t => {
  const {dir, file} = root(t, text(lists, '## Intent\nOutcome\n## Current state\nNow\n## Round\nHistory\n'));
  assert.equal(capture(() => taskArchive(dir, 'T-001', {json: true})).value.records[0].status, 'archived');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const report = capture(() => reportCommand(dir, 'T-001', {json: true})).value.report.selected;
  assert.equal(report.task.contract.intent.line, lines.indexOf('## Intent') + 1);
  assert.equal(report.task.current_state.line, lines.indexOf('## Current state') + 1);
  assert.equal(report.task.latest_sections.sections[0].start_line, lines.indexOf('## Round') + 1);
});

test('final review F2: archived malformed entries give physically located problems', t => {
  const archive = '---\nschema: 1\narchive_of: T-001\nevidence:\n  - malformed\n  - {check: test, candidate: 1111111, result: strange}\nassessments:\n  - {candidate: 1111111, role: verifier, verdict: unclear}\n---\n';
  const {dir} = root(t, text(), archive);
  const report = capture(() => reportCommand(dir, 'T-001', {json: true})).value.report;
  const problem = report.problems.find(p => p.code === 'report.result_unrecognized');
  assert.match(problem.path, /T-001.archive.md$/);
  assert.match(problem.message, /T-001.archive.md evidence\[1\]/);
  assert.match(report.problems.find(p => p.code === 'report.verdict_unrecognized').path, /T-001.archive.md$/);
});

test('final review F3: missing fields in archived entries make coverage incomplete without duplicate validation', t => {
  const missing = root(t, text(), '---\nschema: 1\narchive_of: T-001\nevidence:\n  - {candidate: 1111111, result: pass}\n---\n');
  const result = capture(() => reportCommand(missing.dir, null, {json: true})).value;
  assert.equal(result.code, 1); assert.equal(result.report.complete, false);
  assert.match(result.report.problems.find(p => p.code === 'report.archive_invalid').message, /missing required field check/);
  assert.equal(result.report.records[0].task.structural.errors.filter(e => e.code === 'entry.missing_field').length, 1);
});

test('strict verification exempts only the selected record becoming uncommitted, not other Git differences', () => {
  const original = parse(text()), proposed = split(text());
  const before = {records: {'T-001.md': {first_commit: 'date', last_commit: 'date'}}};
  const after = {records: {'T-001.md': {...before.records['T-001.md'], uncommitted: true}}};
  assert.equal(verifyArchive(original, proposed, {archive_path: 'T-001.archive.md', git_before: before, git_after: after}), null);
  const moved = {records: {'T-001.md': {first_commit: 'other', last_commit: 'date', uncommitted: true}}};
  assert.match(verifyArchive(original, proposed, {archive_path: 'T-001.archive.md', git_before: before, git_after: moved}), /git.first_commit changed/);
  const other = parseRecord(text().replace('id: T-001', 'id: T-002'), {path: 'T-002.md'});
  const corpus = [{kind: 'task', record: original}, {kind: 'task', record: other}];
  const both = {records: {...after.records, 'T-002.md': {uncommitted: true}}};
  assert.match(verifyArchive(original, proposed, {archive_path: 'T-001.archive.md', corpus, git_before: before, git_after: both}), /records\.1\.git changed/);
});

test('final review F5: physical labels never rewrite index-shaped recorded results, verdicts or check names', t => {
  for (const suffix of ['1','0']) {
    const data = lists.replace('{check: test, candidate: 2222222, result: pass}', `{check: "evidence[1]", candidate: 2222222, result: "evidence[${suffix}]"}`)
      .replace('actor: reviewer, verdict: accept}', `actor: reviewer, verdict: "assessments[${suffix}]"}`);
    const {dir} = root(t, text(data));
    const result = capture(() => taskArchive(dir, 'T-001', {json: true})).value;
    assert.equal(result.records[0].status, 'archived');
    const report = capture(() => reportCommand(dir, 'T-001', {json: true})).value.report;
    assert.ok(report.problems.find(p => p.code === 'report.result_unrecognized').message.includes(`evidence[0] result evidence[${suffix}]`));
    assert.ok(report.problems.find(p => p.code === 'report.verdict_unrecognized').message.includes(`assessments[0] verdict assessments[${suffix}]`));
    const note = report.selected.task.structural.info.find(note => note.code === 'evidence.undeclared_check');
    assert.match(note.message, /check evidence\[1\] \(evidence\[0\]\)/);
  }
});

test('index-shaped moving candidate refs stay intact in informational diagnostics', () => {
  const source = text(lists.replaceAll('2222222', '"candidates[1]"'));
  const pair = split(source), record = merged(pair);
  assert.match(record.info.find(note => note.code === 'candidate.moving_ref').message, /current candidate candidates\[1\]/);
  assert.equal(verifyArchive(parse(source), pair, {archive_path: 'T-001.archive.md'}), null);
});

test('final review F6: a missing target refuses strict report comparison', () => {
  const original = parse(text()), proposed = split(text());
  assert.match(verifyArchive(original, proposed, {archive_path: 'T-001.archive.md', corpus: []}), /selected task.*report corpus/);
});

test('final review F6: a failed second corpus read refuses without writing and names the problem', t => {
  const {dir, file} = root(t); const read = fs.readFileSync; let count = 0;
  try {
    fs.readFileSync = (name, ...args) => {
      if (name === file && ++count === 2) throw new Error('injected corpus read failure');
      return read(name, ...args);
    };
    const result = capture(() => taskArchive(dir, 'T-001', {json: true})).value;
    assert.equal(result.ok, false); assert.equal(result.records[0].status, 'refused');
    assert.ok(result.problems.some(problem => problem.code === 'report.read_failed'));
    assert.equal(read(file, 'utf8'), text()); assert.equal(fs.existsSync(file.slice(0, -3) + ARCHIVE_SUFFIX), false);
  } finally { fs.readFileSync = read; }
});

test('strict verification protects existing archive prose, not only entries and counts', () => {
  const older = '---\nschema: 1\narchive_of: T-001\n---\nOlder restriction.\n';
  const original = parseRecord(text(), {path: 'T-001.md', archive: {text: older, path: 'T-001.archive.md'}});
  const proposed = split(text(), older);
  proposed.archive_text = proposed.archive_text.replace('Older restriction.', 'Different assertion.');
  assert.match(verifyArchive(original, proposed, {archive_path: 'T-001.archive.md'}), /existing archive body changed/);
});

test('strict corpus verification catches a generated date becoming another record mention', () => {
  const original = parse(text()), proposed = split(text());
  const decision = parseRecord('---\nid: 2026-10-09\ntitle: Date id\nstatus: accepted\n---\n', {path: 'date-decision.md'});
  const corpus = [{kind: 'task', record: original}, {kind: 'decision', record: decision}];
  assert.match(verifyArchive(original, proposed, {archive_path: 'T-001.archive.md', corpus}), /mentions.*changed/);
});

test('invalid or unreadable archive fails lint, refuses done and makes report incomplete; orphan is a problem, not a task', t => {
  const {dir, file} = root(t, text(), '---\nschema: 1\narchive_of: Other\n---\n');
  assert.equal(capture(() => taskLint(dir, null, {json: true})).value.ok, false);
  assert.throws(() => capture(() => taskSet(dir, 'T-001', 'status', 'done')), /structural error/);
  assert.equal(capture(() => reportCommand(dir, null, {json: true})).value.report.complete, false);
  fs.unlinkSync(file); const lint = capture(() => taskLint(dir, null, {json: true})); assert.equal(lint.value.ok, false); assert.equal(JSON.parse(lint.stdout).records.length, 0); assert.equal(JSON.parse(lint.stdout).problems[0].code, 'archive.orphan');
  assert.equal(capture(() => reportCommand(dir, null, {json: true})).value.report.totals.tasks, 0);
});
test('--check writes nothing, execution archives a safe pair, and a second explicit run is a no-op', t => {
  const {dir, file} = root(t); const before = fs.readFileSync(file);
  const check = capture(() => taskArchive(dir, 'T-001', {check: true, json: true})).value;
  assert.equal(check.ok, true); assert.equal(check.records[0].status, 'checked'); assert.deepEqual(fs.readFileSync(file), before);
  const done = capture(() => taskArchive(dir, 'T-001', {json: true})).value; assert.equal(done.records[0].status, 'archived');
  assert.equal(capture(() => taskArchive(dir, 'T-001', {json: true})).value.records[0].status, 'noop');
  assert.deepEqual(recordEntries(readTask(dir, file).record), recordEntries(parse(text())));
});
test('duplicate ids and unreadable frontmatter refuse before any write; --json emits one document for usage/operation failures', t => {
  const {dir, file} = root(t); fs.writeFileSync(path.join(dir, TASKS_DIRECTORY, 'copy.md'), text());
  const checked = capture(() => taskArchive(dir, 'T-001', {json: true})).value;
  assert.equal(checked.records.length, 2); assert.ok(checked.records.every(row => row.status === 'refused' && /duplicate/.test(row.reason)));
  fs.unlinkSync(path.join(dir, TASKS_DIRECTORY, 'copy.md')); fs.writeFileSync(file, prefix + 'candidates: [\n---\n');
  assert.match(split(fs.readFileSync(file, 'utf8')).refused, /unreadable/);
  for (const args of [['task','archive','--check=yes','--json'],['task','archive','missing','--json']]) {
    const result = spawnSync(process.execPath, [bin, ...args], {cwd: dir, encoding: 'utf8'}); assert.ok(result.status); assert.equal(JSON.parse(result.stdout).ok, false);
  }
});
test('re-read detects changing record or archive and writes nothing', t => {
  for (const target of ['record','archive']) {
    const pair = split(text()), {dir, file} = root(t, text(), target === 'archive' ? pair.archive_text : null);
    const input = readTask(dir, file); const archive = input.archive_path; const before = fs.readFileSync(file);
    const io = {...fs, readFileSync(name, ...args) { const data = fs.readFileSync(name, ...args); return name === (target === 'record' ? file : archive) ? Buffer.concat([data, Buffer.from('changed')]) : data; }};
    assert.throws(() => writeArchivePair(dir, input, pair, io), /changed between read and write/);
    assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp')).length, 0);
  }
});
test('second rename failure restores existing archive or deletes newly created archive; all temp files removed', t => {
  for (const existing of [null, '---\nschema: 1\narchive_of: T-001\n---\nPrevious prose.\n']) {
    const {dir, file} = root(t, text(), existing), input = readTask(dir, file), pair = split(text(), existing); let renames = 0;
    const io = {...fs, renameSync(...args) { if (++renames === 2) throw new Error('injected record rename failure'); fs.renameSync(...args); }};
    assert.throws(() => writeArchivePair(dir, input, pair, io), existing ? /restored previous archive bytes/ : /removed archive created by this run/);
    assert.equal(fs.readFileSync(file, 'utf8'), text()); assert.equal(fs.existsSync(input.archive_path), existing !== null);
    if (existing) assert.equal(fs.readFileSync(input.archive_path, 'utf8'), existing);
    assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')), false);
  }
});
for (const leaf of ['record','archive']) test(`${leaf} symbolic link or junction refuses without touching its destination`, t => {
  const {dir, file} = root(t); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-archive-outside-')); t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
  const link = leaf === 'record' ? file : file.slice(0,-3) + ARCHIVE_SUFFIX;
  if (leaf === 'record') fs.unlinkSync(file);
  fs.symlinkSync(outside, link, 'junction');
  const result = capture(() => taskArchive(dir, 'T-001', {json: true})).value; assert.equal(result.ok, false); assert.deepEqual(fs.readdirSync(outside), []);
});
test('findings anchors resolve across both loaded bodies and archived credentials print even when folded', t => {
  const arc = '---\nschema: 1\narchive_of: T-001\nevidence:\n  - {check: probe, candidate: 1111111, result: pass, command: "TOKEN=secret"}\n---\n## Source finding\nObserved defect.\n';
  const source = text(lists.replace('verdict: accept}', 'verdict: accept, findings: "#source-finding"}'));
  const {dir} = root(t, source, arc);
  const lint = capture(() => taskLint(dir, 'T-001')); assert.match(lint.stdout, /credential_like: T-001.archive.md evidence\[0\]/);
  const report = capture(() => reportCommand(dir, 'T-001', {json: true})).value.report.selected;
  assert.match(report.findings_references[0].section.pointer, /archive.md:/);
  assert.equal(report.findings_references[0].section.first, 'Observed defect.');
});
