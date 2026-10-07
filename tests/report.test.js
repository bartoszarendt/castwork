/** Constructed fixtures only; expectations follow the public counting contract. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import test from 'node:test';
import {parseRecord} from '../src/record.js';
import {duplicateIdErrors, requirementEvaluation, structuralValidity} from '../src/checks.js';
import {deriveReport, mentionedIds, recordedDate, sectionExcerpt} from '../src/report.js';
import {renderReport} from '../src/report-text.js';
import {readReportInputs, reportCommand, reportGit} from '../src/report-cli.js';
import {main} from '../src/cli-main.js';
import {taskLint} from '../src/task-cli.js';

const bin = path.resolve('bin/castwork.js');
const front = (data) => Object.entries(data).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
function input(data = {}, body = '', file = '.castwork/tasks/A.md', kind = 'task') {
  return {kind, body_line: 10, record: parseRecord(`---\n${front({schema:1,id:'A',title:'Example',status:'in_review',...data})}\n---\n${body}`,{path:file})};
}
const derive = (...inputs) => deriveReport(inputs,{project:'example'});
function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'castwork-report-'));
  fs.mkdirSync(path.join(dir,'.castwork/tasks'),{recursive:true});
  fs.mkdirSync(path.join(dir,'.castwork/decisions'),{recursive:true});
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function put(dir,file,data,body='') {
  fs.writeFileSync(path.join(dir,'.castwork',file),`---\n${front(data)}\n---\n${body}`);
}
function cli(dir, ...args) {
  return spawnSync(process.execPath, [bin, 'report', ...args], {cwd: dir, encoding: 'utf8'});
}
function capture(fn) {
  let stdout = '', stderr = '';
  const originalOut = process.stdout.write, originalErr = process.stderr.write;
  process.stdout.write = (value) => {
    stdout += value;
    return true;
  };
  process.stderr.write = (value) => {
    stderr += value;
    return true;
  };
  try {
    return {value: fn(), get stdout() { return stdout; }, get stderr() { return stderr; }};
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

const history = {
  requirements:{checks:['test','lint'],independent_review:true,assessment_roles:['verifier']},
  candidates:[{ref:'aaaaaaa',producers:['worker@pi']},{ref:'bbbbbbb'},{ref:'aaaaaaa',producers:['worker@pi'],host:'pi',model:'reported/model',at:'2026-10-07T09:00:00Z'}],
  evidence:[{candidate:'aaaaaaa',check:'test',result:'fail'},{candidate:'aaaaaaa',check:'test',result:'fail'},{candidate:'aaaaaaa',check:'test',result:'pass'},
    {candidate:'bbbbbbb',check:'test',result:'pass'},{candidate:'bbbbbbb',check:'test',result:'fail'},
    {candidate:'aaaaaaa',check:'one_off',result:'fail'},{candidate:'aaaaaaa',check:'one_off',result:'pass'},{candidate:'aaaaaaa',check:'other',result:'fail'}],
  assessments:[{candidate:'aaaaaaa',actor:'v1',role:'verifier',verdict:'needs_revision'},
    {candidate:'aaaaaaa',actor:'v1',role:'verifier',verdict:'accept'},{candidate:'aaaaaaa',actor:'v2',role:'verifier',verdict:'reject'},
    {candidate:'bbbbbbb',actor:'v1',role:'verifier',verdict:'accept'}]
};
test('D42-6: entries, per-file refs, every rerun fail, outcome base, current triples and effective other names',()=>{
  const a=input(history), b=input({...history,id:'A'},'', '.castwork/tasks/B.md');
  const r=derive(a,b);
  assert.equal(r.complete,true);
  assert.equal(r.records.length,2);
  assert.equal(r.totals.candidates,6);
  assert.equal(r.totals.distinct_refs,4);
  assert.equal(r.totals.blocking_verdicts,4);
  assert.equal(r.totals.blocking_records,2);
  assert.deepEqual(r.totals.blocking_histogram,{one:0,two:2,three_plus:0,zero:0});
  assert.equal(r.totals.declared_fails_recorded,6);
  assert.deepEqual(r.totals.outcome_triples,{base:8,pass:2,fail:2,no_evidence:4,unrecognized:0});
  assert.deepEqual(r.totals.current_triples,{base:4,pass:2,fail:0,no_evidence:2,unrecognized:0});
  const task=r.records[0].task;
  assert.deepEqual(task.current.entries,[1,3]);
  assert.equal(task.current.number,3);
  assert.equal(task.current.other_checks.count,2);
  assert.equal(task.current.other_checks.failed,1);
  assert.deepEqual(task.current.assessments.map((a)=>a.verdict),['accept','reject']);
  assert.deepEqual(task.requirements,requirementEvaluation(a.record));
  assert.equal(task.requirements.at(-1).reason,'assessment.rejected');
  assert.ok(r.problems.every((p)=>p.code==='id.duplicate'));
  const duplicates = duplicateIdErrors([a.record, b.record]);
  for (const row of r.records) {
    assert.equal(row.task.structural.valid, false);
    assert.equal(row.task.ready_to_close, false);
    assert.deepEqual(row.task.structural.errors, [...structuralValidity(row.path === a.record.path ? a.record : b.record).errors, duplicates.get(row.path)]);
  }
  assert.equal(r.totals.invalid_tasks, 2);
  const text=renderReport(r,r.records[0]);
  assert.match(text,/ref repeats entries #1/);
  assert.equal((text.match(/test  pass/g)||[]).length,1);
  assert.match(text,/2 candidate entries shown, 1 omitted/);
});
test('duplicate otherwise-ready tasks match corpus lint validity and remain separate counting units', t => {
  const dir = root(t);
  const data = {schema: 1, id: 'A', title: 'Ready except duplicate', status: 'in_review',
    requirements: {checks: ['test']}, candidates: [{ref: 'abcdef0'}],
    evidence: [{candidate: 'abcdef0', check: 'test', result: 'pass'}]};
  put(dir, 'tasks/A.md', data);
  put(dir, 'tasks/B.md', data);
  const report = JSON.parse(cli(dir, '--json').stdout);
  const lint = capture(() => taskLint(dir, null, {json: true}));
  assert.equal(lint.value.ok, false);
  const checked = JSON.parse(lint.stdout).records;
  assert.equal(report.totals.tasks, 2);
  assert.equal(report.totals.invalid_tasks, 2);
  assert.equal(report.totals.outcome_triples.pass, 2);
  for (const row of report.records) {
    assert.equal(row.task.requirements[0].status, 'satisfied');
    assert.equal(row.task.ready_to_close, false);
    assert.equal(row.task.structural.valid, false);
    const matching = checked.find(item => item.path.split(path.sep).join('/') === row.path);
    assert.deepEqual(row.task.structural.errors.map(error => error.code), matching.structural.errors.map(error => error.code));
  }
});
test('hundreds of unassessed candidates are bounded by counts, not dropped from JSON',()=>{
  const r=derive(input({candidates:Array.from({length:250},(_,i)=>({ref:`round-${i}`})),requirements:{checks:['test']}}));
  assert.equal(r.totals.candidates,250);
  assert.equal(r.totals.distinct_refs,250);
  assert.deepEqual(r.totals.outcome_triples,{base:250,pass:0,fail:0,no_evidence:250,unrecognized:0});
  const text=renderReport(r,r.records[0]);
  assert.match(text,/249 unassessed refs not shown/);
  assert.match(text,/1 candidate entry shown, 249 omitted/);
  assert.ok(text.split('\n').length<60);
});
test('terminal tasks do not contribute current failing/missing triples',()=>{
  const r=derive(input({...history,status:'done'}),input({...history,status:'cancelled',id:'B'},'','B.md'));
  assert.equal(r.totals.current_triples.base,0);
  assert.equal(r.attention.length,0);
});
test('invalid legacy roles and status still count without conflating validity with coverage',()=>{
  const a=input({...history,status:'legacy',requirements:{checks:['test'],assessment_roles:['auditor']},assessments:[{candidate:'aaaaaaa',role:'auditor',actor:'auditor',verdict:'accept'}]});
  const r=derive(a);
  assert.equal(r.complete,true);
  assert.equal(r.totals.invalid_tasks,1);
  assert.equal(r.records[0].status,'legacy');
  assert.deepEqual(r.records[0].task.requirements,requirementEvaluation(a.record));
  assert.match(renderReport(r,r.records[0]),/structurally invalid/);
});
test('unrecognized results/verdicts preserved, not fail, no-evidence or blocking; lint semantics unchanged',()=>{
  const a=input({requirements:{checks:['test']},candidates:[{ref:'aaaaaaa'}],
    evidence:[{candidate:'aaaaaaa',check:'test',result:'skipped'},{candidate:'aaaaaaa',check:'extra',result:'pending'}],
    assessments:[{candidate:'aaaaaaa',role:'verifier',verdict:'deferred'}]});
  const r=derive(a);
  assert.equal(r.complete,false);
  assert.deepEqual(r.totals.outcome_triples,{base:1,pass:0,fail:0,no_evidence:0,unrecognized:1});
  assert.equal(r.totals.blocking_verdicts,0);
  assert.equal(r.records[0].task.current.other_checks.failed,0);
  assert.equal(r.records[0].task.current.other_checks.unrecognized,1);
  assert.equal(r.records[0].task.current.checks[0].result,'skipped');
  assert.deepEqual(r.records[0].task.requirements,requirementEvaluation(a.record));
  assert.match(renderReport(r,r.records[0]),/skipped \(unrecognized\)/);
  assert.match(renderReport(r,r.records[0]),/deferred/);
  assert.ok(r.problems.some((p)=>p.aggregates.includes('outcome_triples')));
});
test('null and numeric unrecognized outcomes remain visible as recorded values',()=>{
  const r=derive(input({requirements:{checks:['test']},candidates:[{ref:'aaaaaaa'}],
    evidence:[{candidate:'aaaaaaa',check:'test',result:null},{candidate:'aaaaaaa',check:'extra',result:42}],
    assessments:[{candidate:'aaaaaaa',role:'verifier',verdict:null}]}));
  assert.equal(r.complete,false);
  assert.equal(r.records[0].task.current.checks[0].result,null);
  const text=renderReport(r,r.records[0]);
  assert.match(text,/test  null \(unrecognized\)/);
  assert.match(text,/extra  42 \(unrecognized\)/);
  assert.match(text,/verdict null is unrecognized/);
});
test('readable YAML values retain raw data, literal outcome classification and lint parity', t => {
  const dir = root(t);
  put(dir, 'tasks/B.md', {schema: 1, id: 'B', title: 'unaffected', status: 'done'});
  for (const value of [{a: 1}, ['fail'], ['pass'], null, 42, 'skipped']) {
    const data = {schema: 1, id: 'A', title: 'malformed values', status: 'in_review',
      requirements: {checks: ['test'], assessment_roles: ['verifier']},
      candidates: [{ref: 'abcdef0', model: {a: 1}, host: {a: 1}, at: {a: 1}}],
      evidence: [{candidate: 'abcdef0', check: 'test', result: value}],
      assessments: [{candidate: 'abcdef0', role: 'verifier', verdict: value}]};
    put(dir, 'tasks/A.md', data);
    const parsed = input(data);
    const pure = derive(parsed);
    assert.equal(pure.records.length, 1);
    assert.equal(pure.complete, false);
    assert.deepEqual(pure.records[0].task.requirements, requirementEvaluation(parsed.record));
    if (Array.isArray(value) && value[0] === 'pass') {
      assert.equal(pure.records[0].task.requirements[0].status, 'satisfied');
    }
    const lint = capture(() => taskLint(dir, 'A', {json: true}));
    assert.deepEqual(JSON.parse(lint.stdout).records[0].requirements, pure.records[0].task.requirements);
    assert.deepEqual(pure.totals.outcome_triples, {base: 1, pass: 0, fail: 0, no_evidence: 0, unrecognized: 1});
    assert.equal(pure.totals.declared_fails_recorded, 0);
    assert.equal(pure.totals.blocking_verdicts, 0);
    for (const args of [['--json'], ['A', '--json'], ['B', '--json']]) {
      const run = cli(dir, ...args);
      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.totals.tasks, 2);
      assert.equal(report.complete, false);
      assert.ok(!report.problems.some(problem => ['report.read_failed', 'report.frontmatter_unreadable'].includes(problem.code)));
      if (args[0] === 'A') assert.deepEqual(report.selected.frontmatter, data);
    }
    const text = cli(dir, 'A');
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /unrecognized/);
    assert.match(text.stdout, /model \{"a":1\}/);
  }
});
test('interpreted refs group like lint while raw numeric, array and mapping values survive', () => {
  for (const ref of [1234567, ['abcdef0'], {key: 'value'}]) {
    const equivalent = Array.isArray(ref) ? 'abcdef0' : typeof ref === 'object' ? JSON.stringify(ref) : '1234567';
    const a = input({requirements: {checks: ['test']}, candidates: [{ref}, {ref: equivalent}],
      evidence: [{candidate: ref, check: 'test', result: 'fail'}, {candidate: ref, check: 'other', result: 'fail'}],
      assessments: [{candidate: ref, role: 'verifier', actor: 'v', verdict: 'reject'}]});
    const r = derive(a), task = r.records[0].task;
    assert.deepEqual(task.requirements, requirementEvaluation(a.record));
    assert.equal(task.requirements[0].reason, 'evidence.fail');
    assert.equal(task.current.checks[0].outcome, 'fail');
    assert.equal(task.current.other_checks.failed, 1);
    assert.equal(task.current.assessments[0].verdict, 'reject');
    assert.equal(task.counts.distinct_refs, 1);
    assert.equal(task.counts.repeated_entries, 1);
    assert.deepEqual(task.current.entries, [1, 2]);
    assert.equal(r.totals.current_triples.fail, 1);
    assert.equal(r.totals.outcome_triples.fail, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(r.records[0].frontmatter.candidates[0].ref)), ref);
    assert.deepEqual(r.attention[0].fail, ['test']);
    assert.ok(!r.problems.some(p => p.code === 'report.ref_missing'));
    // The same non-string value must also work as the effective current ref.
    const rawCurrent = derive(input({...a.record.frontmatter, candidates: [{ref}]}));
    assert.equal(rawCurrent.records[0].task.current.checks[0].outcome, 'fail');
    assert.equal(rawCurrent.quality.moving_refs, typeof ref === 'object' && !Array.isArray(ref) ? 1 : 0);
  }
});
test('scalar tail is malformed, not the mapping candidate lint evaluates', () => {
  const a = input({requirements: {checks: ['test']}, candidates: [{ref: 'abcdef0'}, 'bad'],
    evidence: [{candidate: 'abcdef0', check: 'test', result: 'fail'}]});
  const r = derive(a), task = r.records[0].task;
  assert.deepEqual(task.requirements, requirementEvaluation(a.record));
  assert.equal(task.current.number, 1);
  assert.equal(task.current.entry.ref, 'abcdef0');
  assert.equal(task.current.checks[0].outcome, 'fail');
  assert.equal(task.counts.candidates, 2);
  assert.deepEqual(task.malformed_candidates, [{number: 2, entry: 'bad'}]);
  assert.match(renderReport(r, r.records[0]), /#1 of 2/);
  assert.match(renderReport(r, r.records[0]), /malformed.*#2/i);
  assert.match(renderReport(r, r.records[0]), /1 candidate entry shown, 1 omitted/);
  const noMapping = derive(input({candidates: ['bad'], requirements: {checks: ['test']}}));
  assert.equal(noMapping.records[0].task.current, null);
  assert.equal(noMapping.attention[0].no_candidate, true);
  assert.equal(noMapping.totals.candidates, 1);
  const noMappingText = renderReport(noMapping, noMapping.records[0]);
  assert.match(noMappingText, /no mapping entry to evaluate/);
  assert.match(noMappingText, /0 candidate entries shown, 1 omitted/);
});
test('missing-ref last mapping is current, never a fallback or a repeated missing ref', () => {
  const r = derive(input({candidates: [{ref: 'abcdef0'}, {}], requirements: {checks: ['test']}}));
  const task = r.records[0].task;
  assert.equal(r.complete, false);
  assert.equal(task.current.number, 2);
  assert.equal(task.current.valid_ref, false);
  assert.deepEqual(JSON.parse(JSON.stringify(task.current.entry)), {});
  assert.equal(task.counts.candidates, 2);
  assert.equal(task.counts.distinct_refs, 1);
  assert.equal(task.counts.repeated_entries, 0);
  assert.equal(task.rounds.length, 1);
  assert.equal(r.totals.outcome_triples.base, 1);
  assert.equal(r.totals.current_triples.base, 0);
  assert.deepEqual(task.requirements, requirementEvaluation(input({candidates: [{ref: 'abcdef0'}, {}], requirements: {checks: ['test']}}).record));
  const text = renderReport(r, r.records[0]);
  assert.match(text, /#2 of 2.*invalid ref/);
  assert.match(text, /1 candidate entry shown, 1 omitted/);
  assert.match(text, /1 unassessed refs not shown/);
  assert.doesNotMatch(text, /none recorded/);
});
test('readable malformed shapes retain original entries and mark uncovered derivation',()=>{
  const r=derive(input({candidates:[{ref:'aaaaaaa'},'bad'],evidence:'bad',assessments:[null]}));
  assert.equal(r.records.length,1);
  assert.equal(r.complete,false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.records[0].frontmatter.candidates)),[{ref:'aaaaaaa'},'bad']);
  assert.equal(r.totals.candidates,2);
  assert.equal(r.records[0].task.current.valid_ref, true);
  assert.equal(r.records[0].task.current.number, 1);
  assert.equal(r.records[0].task.current.entry.ref, 'aaaaaaa');
  assert.deepEqual(r.records[0].task.malformed_candidates, [{number: 2, entry: 'bad'}]);
  assert.equal(r.records[0].task.counts.repeated_entries, 0);
});
test('unreadable frontmatter is listed and excluded, not substituted with a filename id',()=>{
  const bad={record:parseRecord('---\nid: [\n---\n',{path:'bad.md'}),kind:'task'};
  const r=derive(input(),bad);
  assert.equal(r.totals.tasks,1);
  assert.equal(r.complete,false);
  assert.deepEqual(r.problems.map((p)=>[p.code,p.path]),[['report.frontmatter_unreadable','bad.md']]);
});
test('Recent groups recorded-offset calendar day, instant order within it, date only last; malformed excluded',()=>{
  const a=input({candidates:[{ref:'HEAD',host:'desktop',at:'2026-10-08T00:30:00+14:00'},
    {ref:'bbbbbbb',at:'2026-10-07'}, {ref:'ccccccc',at:'not-a-date'}, {ref:'ddddddd'}],
    evidence:[{candidate:'HEAD',check:'x',result:'pass',at:'2026-10-07T23:00:00Z'},
      {candidate:'HEAD',check:'y',result:'pass',at:'2026-10-07T12:00:00-12:00'}]});
  const decision=input({id:'D-1',date:'2026-10-07'},'', 'D.md','decision');
  const badDecision=input({id:'D-2',date:'2026-10-07T12:00:00Z'},'', 'D2.md','decision');
  const r=derive(a,decision,badDecision);
  assert.deepEqual(r.recent.map((e)=>[e.id,e.kind,e.index]),[['A','candidates',1],['A','evidence',2],['A','evidence',1],['A','candidates',2],['D-1','decision',1]]);
  assert.equal(r.quality.date_only_at,1);
  assert.equal(r.quality.malformed_at,1);
  assert.equal(r.quality.without_at,1);
  assert.equal(r.quality.malformed_decision_dates,1);
  assert.equal(r.quality.moving_refs,1);
  assert.equal(r.quality.legacy_host.count,1);
  assert.equal(r.records[0].task.current.ref,'ddddddd');
  assert.equal(recordedDate('2026-02-30').kind,'malformed');
  assert.equal(recordedDate('2026-10-01T24:00:00Z').kind,'malformed');
});
test('latest legacy-host observations compare timestamps by instant without inventing date instants', () => {
  const r = derive(input({candidates: [
    {ref: 'abcdef0', host: 'desktop', at: '2026-10-07T10:30:00Z'},
    {ref: 'abcdef1', host: 'desktop', at: '2026-10-07T23:30:00+14:00'},
    {ref: 'abcdef2', host: 'desktop', at: '2026-10-08'},
  ]}));
  assert.equal(r.quality.legacy_host.latest_recorded, '2026-10-07T10:30:00Z');
  assert.equal(r.quality.legacy_host.latest_date_only, '2026-10-08');
  assert.equal(r.quality.legacy_host.dated, 3);
  assert.match(renderReport(r), /no instant or exact ordering/);
  assert.deepEqual(r.records[0].task.entries.candidates.map(entry => entry.ref), ['abcdef0', 'abcdef1', 'abcdef2']);
});
test('sub-millisecond instants order Recent and legacy observations without truncation', () => {
  const ats = ['2026-10-07T10:30:00.0001Z', '2026-10-07T10:30:00.0009Z',
    '2026-10-07T10:30:00.000900Z', '2026-10-07T23:30:00.9999+14:00'];
  const r = derive(input({candidates: ats.map((at, i) => ({ref: `ref-${i}`, host: 'desktop', at}))}));
  assert.deepEqual(r.recent.map(e => e.index), [2, 3, 1, 4]);
  assert.equal(r.quality.legacy_host.latest_recorded, ats[1]);
  assert.deepEqual(r.records[0].task.entries.candidates.map(e => e.at), ats);
  assert.doesNotThrow(() => JSON.stringify(r));
});
test('mentions use declared non-T ids and boundaries, both ways, distinct from dependencies',()=>{
  assert.deepEqual(mentionedIds('(P42-08) P42-08-C9 xP42-08 P42-08_ P42-08é P42-08. D-1',['P42-08','D-1']),['P42-08','D-1']);
  const a=input({id:'P42-08',depends_on:['B']},'D-1 unknown-D-3');
  const b=input({id:'B'},'', 'B.md');
  const d=input({id:'D-1',status:'superseded'},'P42-08; P42-08-C9','D.md','decision');
  const r=derive(a,b,d);
  assert.deepEqual(r.records[0].mentions,['D-1']);
  assert.deepEqual(r.records[2].mentions,['P42-08']);
  assert.deepEqual(r.relations[1].needed_by,['.castwork/tasks/A.md']);
  assert.deepEqual(r.relations[0].mentioned_by,['D.md']);
});
test('prose spans nested headings and ignores fenced headings; first/last are positional, not latest',()=>{
  const body='## Intent\nDo it.\n\n## Blockers and decisions\n- First item\n  continuation\n\n### Nested\nMiddle paragraph\n\n````md\n## Fake end\n```\nStill inside fence\n````\n\n### Closing\nLast paragraph\n\nsecond last line\n## Other\nOutside';
  const s=sectionExcerpt(body,'Blockers and decisions','A.md',10);
  assert.equal(s.line,13);
  assert.equal(s.lines,17);
  assert.equal(s.first,'- First item\n  continuation');
  assert.equal(s.last,'second last line');
  assert.equal(sectionExcerpt(body,'Missing','A.md'),null);
  const a=input({...history,status:'needs_context'},body);
  const r=derive(a);
  assert.equal(r.attention[0].blockers,'- First item');
  const text=renderReport(r,r.records[0]);
  assert.match(text,/recorded prose/);
  assert.match(text,/first /);
  assert.match(text,/last /);
  assert.doesNotMatch(text,/latest/);
  assert.match(text,/checks:lint  not_satisfied \(evidence.missing\)/);
});
test('canonical sections outrank nested examples and logical list entries retain children', () => {
  const body = '## Context\nExample.\n### Decision\nNot the decision.\n## Decision\nActual decision.\n### Detail\nMore.\n## Consequences\nCost.';
  const s = sectionExcerpt(body, 'Decision', 'D.md', 10);
  assert.equal(s.first, 'Actual decision.');
  assert.equal(s.pointer, 'D.md:14');
  assert.equal(s.lines, 4);
  assert.equal(sectionExcerpt('#### Decision\nDeep\n### Decision\nShallow', 'Decision', 'D.md').first, 'Shallow');
  const list = sectionExcerpt('## Blockers and decisions\n- Parent\n  - Child\n    continuation\n\n  retained paragraph\n- Last\n  1. Detail', 'Blockers and decisions', 'A.md');
  assert.deepEqual(list.entries, ['- Parent\n  - Child\n    continuation\n\n  retained paragraph', '- Last\n  1. Detail']);
  // A literal trailing # is part of the title; only a spaced closing run is not.
  const literal = sectionExcerpt('## Decision#\n\nExample only.\n\n## Decision\n\nReal decision.', 'Decision', 'D.md');
  assert.equal(literal.first, 'Real decision.');
  assert.equal(literal.pointer, 'D.md:5');
  assert.equal(sectionExcerpt('## Decision #\n\nClosed.', 'Decision', 'D.md').first, 'Closed.');
  assert.equal(sectionExcerpt('## C#\n\nSharp.', 'C#', 'D.md').first, 'Sharp.');
  // A heading indented into a list item belongs to the item, not the outline.
  const child = sectionExcerpt('## Blockers and decisions\n\n- Parent\n  ### Details\n  continuation\n- Second\n  ## Nested\n  more\n\n## Next\n\nOther.', 'Blockers and decisions', 'A.md');
  assert.deepEqual(child.entries, ['- Parent\n  ### Details\n  continuation', '- Second\n  ## Nested\n  more']);
  assert.equal(child.lines, 9);
  assert.deepEqual(sectionExcerpt('## Blockers and decisions\n- a\n ## Next\nb', 'Blockers and decisions', 'A.md').entries, ['- a']);
});
test('Attention retains every blocked/context record beyond its ordinary ten-row bound', () => {
  const failures = Array.from({length: 12}, (_, i) => input({id: `F-${i}`, requirements: {checks: ['test']},
    candidates: [{ref: 'abcdef0'}], evidence: [{candidate: 'abcdef0', check: 'test', result: 'fail'}]}, '', `F-${i}.md`));
  const retained = ['blocked', 'needs_context'].map((status, i) => input({id: `B-${i}`, status},
    '## Blockers and decisions\nFirst physical line.\nThe paragraph continues.', `B-${i}.md`));
  const r = derive(...failures, ...retained), text = renderReport(r);
  assert.match(text, /B-0  blocked/);
  assert.match(text, /B-1  needs_context/);
  assert.match(text, /2 attention records not shown/);
  assert.match(text.replace(/\s+/g, ' '), /First physical line.*paragraph continues/);
  assert.match(text, /B-0.md:10/);
  assert.match(text, /Attention overflow/);
  assert.equal(r.attention.length, 14);
  const manyBlocked = derive(...Array.from({length: 12}, (_, i) => input({id: `B-${i}`, status: 'blocked'}, '', `B-${i}.md`)));
  const allBlockedText = renderReport(manyBlocked);
  for (let i = 0; i < 12; i++) assert.ok(allBlockedText.includes(`B-${i}  blocked`));
  assert.doesNotMatch(allBlockedText, /attention records not shown/);
});
test('plain paragraphs and dated list excerpts each retain complete section entries in JSON',()=>{
  for(const body of ['## Blockers and decisions\nNewest first.\n\nOldest last.','## Blockers and decisions\n- 2026-10-07 First\n- 2026-10-01 Last']){
    const s=sectionExcerpt(body,'Blockers and decisions','x');
    assert.equal(s.entries.length,2);
  }
});
test('bounded history/mentions, full current state overflows for 80 checks and many dependencies',()=>{
  const checks=Array.from({length:80},(_,i)=>`check_${i}`),deps=Array.from({length:40},(_,i)=>`DEP-${i}`);
  const candidates=Array.from({length:30},(_,i)=>({ref:`ref-${i}`}));
  const assessments=candidates.map((c)=>({candidate:c.ref,role:'verifier',actor:'v',verdict:'accept'}));
  const r=derive(input({requirements:{checks},depends_on:deps,candidates,assessments},deps.join(' ')), ...deps.map((id,i)=>input({id,depends_on:['A']},'A',`${i}.md`)));
  const text=renderReport(r,r.records[0]);
  assert.ok(text.split('\n').length>120);
  for(const check of checks){assert.ok(text.includes(`${check}  no evidence`));
  assert.ok(text.includes(`checks:${check}  not_satisfied (evidence.missing)`));}
  for(const dep of deps)assert.ok(text.includes(`${dep} (in_review)`));
  assert.equal(r.records[0].task.entries.candidates.length,30);
  assert.equal(r.records[0].task.rounds.length,30);
  assert.match(text,/24 earlier assessed refs and 0 unassessed refs not shown/);
  assert.match(text,/6 candidate entries shown, 24 omitted/);
  assert.match(text,/35 more not shown/);
  assert.ok(text.split('\n').every((l)=>l.length<=100));
});
test('populated text prioritizes action and bounds ties/notes, preserving wrapped indentation and JSON', () => {
  const drafts = Array.from({length: 12}, (_, i) => input({id: `draft-${i}`, status: 'draft'}, '', `draft-${i}.md`));
  const actionable = input({...history, id: 'action', status: 'needs_context',
    candidates: [...history.candidates, {ref: 'ccccccc', producers: ['worker@pi'], note: 'optional note '.repeat(100)}]},
    '## Intent\nA populated paragraph.\n\n## Blockers and decisions\nFirst blocker.\n\n### Nested\nLast blocker.\n', 'action.md');
  const ties = Array.from({length: 12}, (_, i) => input({id: `tie-${i}`, status: 'done', candidates: actionable.record.frontmatter.candidates}, 'action', `tie-${i}.md`));
  const r = derive(...drafts, actionable, ...ties);
  const project = renderReport(r);
  assert.match(project, /action  needs_context/);
  assert.match(project, /blockers \(recorded prose\): First blocker/);
  assert.match(project, /12 candidate-less drafts summarized/);
  assert.match(project, /13\s+records; 8 omitted/);
  const selected = renderReport(r, r.records.find(row => row.id === 'action'));
  assert.match(selected, /excerpt;\s+remainder in --json/);
  assert.match(selected, /\n\nEarlier/);
  assert.match(selected, /3 candidate entries shown, 1 omitted/);
  assert.ok(selected.split('\n').every(line => line.length <= 100));
  assert.ok(selected.split('\n').filter(line => line.includes('remainder in')).every(line => line.startsWith('  ')));
  assert.equal(r.records.find(row => row.id === 'action').task.current.entry.note.length, 1400);
  assert.equal(r.attention.length, 13);
  const indentedModel = `first\n${' '.repeat(100)}tail`;
  const indented = derive(input({candidates: [{ref: 'abcdef0', model: indentedModel}]}));
  const indentedText = renderReport(indented, indented.records[0]);
  assert.ok(indentedText.includes(indentedModel));
  assert.equal(indented.records[0].task.current.entry.model, indentedModel);
});
test('findings anchors resolve only unambiguous loaded headings and preserve references', () => {
  const a = input({candidates: [{ref: 'abcdef0'}], assessments: [
    {candidate: 'abcdef0', role: 'verifier', actor: 'a', verdict: 'reject', findings: '#review-notes'},
    {candidate: 'abcdef0', role: 'verifier', actor: 'b', verdict: 'reject', findings: '#duplicate'},
    {candidate: 'abcdef0', role: 'verifier', actor: 'c', verdict: 'accept', findings: 'logs/review.md'},
    {candidate: 'abcdef0', role: 'verifier', actor: 'd', verdict: 'accept', findings: '#absent'},
  ]}, '## Review notes\nSource-backed finding.\n## Duplicate\nOne.\n### Duplicate\nTwo.');
  const r = derive(a), text = renderReport(r, r.records[0]);
  assert.match(text.replace(/\s+/g, ' '), /#review-notes \(reference\).*recorded prose.*A.md:10.*Source-backed finding/);
  assert.match(text, /#duplicate \(reference\)/);
  assert.match(text, /logs\/review.md \(reference\)/);
  assert.match(text, /#absent \(reference\)/);
  assert.equal(r.records[0].findings_references.filter(ref => ref.section).length, 1);
});
test('displayed Blockers decision citations precede other outgoing mentions without changing membership', () => {
  const decisions = Array.from({length: 7}, (_, i) => input({id: `D-${i}`}, '', `D-${i}.md`, 'decision'));
  const a = input({}, '## Intent\nD-0 D-1 D-2 D-3 D-4\n## Blockers and decisions\nD-5 and D-6 matter here.');
  const r = derive(a, ...decisions), original = JSON.stringify(r);
  const text = renderReport(r, r.records[0]);
  assert.match(text, /Mentions  D-5.*D-6/);
  assert.match(text, /2 more not shown/);
  assert.equal(JSON.stringify(r), original);
  assert.equal(r.records[0].mentions.length, 7);
});
test('golden task text: empty history, missing requirement and no prose section',()=>{
  const r=derive(input({requirements:{checks:['test']}}));
  assert.equal(renderReport(r,r.records[0]),`A  Example  in_review
Requires  checks ["test"]

Current candidate  none recorded

Requirements
  checks:test  not_satisfied (candidate.missing)

Earlier  0 entries, 0 distinct refs (0 not current), 0 assessed refs not current
  0 blocking verdicts on refs not current; 0 of 0 entries repeat an earlier ref
  0 earlier assessed refs and 0 unassessed refs not shown
  0 candidate entries shown, 0 omitted (repeats included); --json retains all 0

Depends on
  none
Needed by
  none
Mentions  none
Mentioned by  none
Git  Git observations not supplied`);
});
test('golden decision text with template sections and fallback without headings',()=>{
  const r=derive(input({id:'D-1',title:'Choice',status:'accepted',date:'2026-10-07'},'## Context\nNeed it.\n## Decision\nChoose it.\n## Consequences\nCost.\n## Revisit if\nChanges.','D.md','decision'));
  assert.equal(renderReport(r,r.records[0]),`D-1  Choice  accepted  2026-10-07
Decision  Choose it.
Context  Need it.
Consequences  Cost.
Revisit if  Changes.
Mentions  none
Mentioned by  none
Git  Git observations not supplied`);
  const fallback=derive(input({id:'D-2',status:'legacy',date:'yesterday'},'First paragraph.\n\nSecond paragraph.','D2.md','decision'));
  assert.match(renderReport(fallback,fallback.records[0]),/Recorded prose  First paragraph\./);
});
test('golden project text has count bases and fixed section order',()=>{
  const r=derive();
  const expected = [
    'example  0 tasks  0 decisions',
    'Record values are asserted; Git dates are observed locally. This report decides nothing.',
    'Tasks  ',
    '  0 of 0 structurally invalid (task lint)',
    '',
    'Attention',
    '  none recorded',
    '  Current nonterminal triples: 0 fail, 0 no evidence, 0 unrecognized / 0 triples',
    '',
    'Rework  declared checks only, within each record',
    '  recorded candidates 0 entries / 0 records; 0 distinct refs summed per record',
    '  entries per record: 0: 0, 1: 0, 2: 0, 3-5: 0, 6+: 0',
    '  max 0 entries:  (0 records; 0 omitted; --json retains all)',
    '  blocking verdicts recorded 0 / 0 assessments, on 0 / 0 records',
    '  records with blocking verdicts: 1: 0, 2: 0, 3+: 0',
    '  declared-check fails recorded 0 / 0 evidence entries (reruns included)',
    '  fail names: none',
    '  outcome triples 0: pass 0, fail 0, no evidence 0, unrecognized 0',
    '',
    'Recent  by recorded calendar day; instants within a day, date-only entries last',
    '  0 dated entries not shown; 0 / 0 entries have no at; not placed',
    '',
    'Decisions  0: ',
    '  most mentioned (tasks): none / 0 tasks',
    '',
    'Record quality',
    '  host not a host id: 0 / 0 entries (none)',
    '    0 dated, latest recorded none; 0 undated or malformed',
    '  without at 0 / 0; date-only at 0; malformed at 0',
    '  malformed decision dates 0 / 0',
    '  host and model 0 / 0; candidate model 0 / 0',
    '  moving refs 0 / 0 candidate entries',
    'Git  Git observations not supplied',
  ].join('\n');
  assert.equal(renderReport(r), expected);
});

test('CLI project quality problems exit 0; selected unknown/ambiguous exit 1, JSON one document',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:'A',status:'legacy',title:'x',...history});
  put(dir,'tasks/B.md',{schema:1,id:'A',status:'done',title:'t'});
  fs.writeFileSync(path.join(dir,'.castwork/tasks/bad.md'),'---\nid: [\n---\n');
  for(const [args,code] of [[['--json'],0],[['A','--json'],1],[['missing','--json'],1]]){
    const run=cli(dir,...args);
    assert.equal(run.status,code,run.stderr);
    const r=JSON.parse(run.stdout);
    assert.equal(r.complete,false);
    assert.equal(r.totals.tasks,2);
    assert.ok(r.problems.every(p=>p.code&&p.message));
    assert.ok(run.stderr.includes('report.frontmatter_unreadable'));
  }
  for (const id of ['A', 'missing']) {
    const selected = cli(dir, id);
    assert.equal(selected.status, 1);
    assert.equal(selected.stdout, '');
    assert.match(selected.stderr, /error:.*(?:declared by|no task or decision)/);
  }
  const text=cli(dir);
  assert.equal(text.status,0);
  assert.match(text.stdout,/Incomplete:/);
  assert.ok(text.stdout.indexOf('bad.md') < text.stdout.indexOf('2 tasks'));
});
test('CLI selected JSON unfolds all entries, text bounding never mutates input',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:'A',title:'x',status:'in_review',...history},'## Intent\nx\n');
  const before=fs.readFileSync(path.join(dir,'.castwork/tasks/A.md'));
  const run=cli(dir,'A','--json');
  assert.equal(run.status,0);
  const r=JSON.parse(run.stdout);
  assert.equal(r.view,'task');
  assert.equal(r.complete,true);
  assert.equal(r.selected.task.entries.candidates.length,3);
  assert.deepEqual(r.selected.frontmatter.candidates,history.candidates);
  assert.ok(run.stderr.includes('Git observations unavailable'));
  assert.deepEqual(fs.readFileSync(path.join(dir,'.castwork/tasks/A.md')),before);
});
test('task/decision id collision is ambiguous; selected decision keeps readable non-task schema',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:'A',title:'t',status:'done'});
  put(dir,'decisions/D.md',{id:'A',title:'choice',status:'superseded',date:'bad'},'No headings.');
  let run=cli(dir,'--json');
  assert.equal(run.status,0);
  assert.equal(JSON.parse(run.stdout).complete,true);
  run=cli(dir,'A','--json');
  assert.equal(run.status,1);
  assert.equal(JSON.parse(run.stdout).problems.at(-1).code,'report.id_ambiguous');
  put(dir,'decisions/D.md',{id:'D',title:'choice',status:'superseded',date:'bad'},'No headings.');
  run=cli(dir,'D','--json');
  assert.equal(run.status,0);
  const r=JSON.parse(run.stdout);
  assert.equal(r.view,'decision');
  assert.equal(r.selected.date,'bad');
  assert.equal(r.selected.task,null);
  assert.equal(r.selected.first_paragraph,'No headings.');
  assert.equal(r.complete,true);
  put(dir,'tasks/no-id.md',{schema:1,title:'Readable but no declared id',status:'draft'});
  run=cli(dir,'','--json');
  assert.equal(run.status,1);
  assert.equal(JSON.parse(run.stdout).problems.at(-1).code,'report.id_unknown');
});
test('ids are keyed as task show and lint key them; raw YAML stays in frontmatter',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:['T-1'],title:'array id',status:'draft'});
  put(dir,'tasks/B.md',{schema:1,id:'T-2',title:'needs T-1',status:'draft',depends_on:['T-1']});
  let run=cli(dir,'T-1','--json');
  assert.equal(run.status,0);
  let r=JSON.parse(run.stdout);
  assert.equal(r.selected.id,'T-1');
  assert.deepEqual(r.selected.frontmatter.id,['T-1']);
  assert.deepEqual(r.relations.find((x)=>x.path===r.selected.path).needed_by,['.castwork/tasks/B.md']);
  assert.deepEqual(r.relations.find((x)=>x.path==='.castwork/tasks/B.md').depends_on,[{id:'T-1',records:['.castwork/tasks/A.md']}]);
  // A scalar twin is the same id: selection refuses, as task show does.
  put(dir,'tasks/C.md',{schema:1,id:'T-1',title:'scalar twin',status:'draft'});
  run=cli(dir,'T-1','--json');
  assert.equal(run.status,1);
  r=JSON.parse(run.stdout);
  assert.equal(r.problems.at(-1).code,'report.id_ambiguous');
  assert.deepEqual(r.problems.filter((p)=>p.code==='id.duplicate').map((p)=>p.path).sort(),['.castwork/tasks/A.md','.castwork/tasks/C.md']);
  assert.equal(spawnSync(process.execPath,[bin,'task','show','T-1'],{cwd:dir,encoding:'utf8'}).status,1);
});
test('a task title containing report does not change task usage/error output',()=>{
  const c=capture(()=>main(['task','new','report','--json']));
  assert.equal(c.value,2);
  assert.equal(c.stdout,'');
  assert.match(c.stderr,/does not take --json/);
  for (const argv of [['--json', '--host', 'report', 'task', 'new', 'x'], ['--json', '--', 'task', 'new', 'report'], ['task', 'set', 'A', 'title', 'report', '--json']]) {
    assert.equal(capture(() => main(argv)).stdout, '');
  }
});
test('CLI every report usage refusal emits exactly one JSON document and exit 2',t=>{
  const dir=root(t);
  for (const argv of [
    ['--json', '--', 'report', 'A', 'B'],
    ['--json', 'report', 'A', 'B'],
    ['report', '--json', '--', 'A', 'B'],
    ['--json', '--host', 'pi', '--', 'report'],
  ]) {
    const run = spawnSync(process.execPath, [bin, ...argv], {cwd: dir, encoding: 'utf8'});
    assert.equal(run.status, 2);
    assert.equal(JSON.parse(run.stdout).problems[0].code, 'report.usage');
  }
  for(const args of [['A','B','--json'],['--by','host','--json'],['--host','pi','--json'],['--json=yes'],['--check','--json']]){
    const run=cli(dir,...args);
    assert.equal(run.status,2);
    const r=JSON.parse(run.stdout);
    assert.equal(r.complete,false);
    assert.equal(r.problems[0].code,'report.usage');
    assert.match(run.stderr,/error:/);
  }
});
test('operational failure preserves derived records and text; JSON exits nonzero with coverage false',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:'A',title:'t',status:'done'});
  fs.rmSync(path.join(dir,'.castwork/decisions'),{recursive:true});
  fs.writeFileSync(path.join(dir,'.castwork/decisions'),'not a directory');
  const run=cli(dir,'--json');
  assert.equal(run.status,1);
  const r=JSON.parse(run.stdout);
  assert.equal(r.complete,false);
  assert.equal(r.totals.tasks,1);
  assert.ok(r.problems.some(p=>p.path==='.castwork/decisions'&&p.code==='report.read_failed'));
  const text=cli(dir);
  assert.equal(text.status,1);
  assert.match(text.stdout,/1 tasks/);
  assert.match(text.stdout,/not a directory/);
});
test('unreadable record file operational error preserves an earlier file (injected EACCES works on Windows)',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:'A',title:'t',status:'done'});
  put(dir,'tasks/Z.md',{schema:1,id:'Z'});
  const read=fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (String(file).endsWith('Z.md')) throw Object.assign(new Error('permission denied'), {code: 'EACCES'});
    return read.call(this, file, ...args);
  };
  try {
    const captured = capture(() => reportCommand(dir, null, {json: true}));
    assert.equal(captured.value.code, 1);
    const report = JSON.parse(captured.stdout);
    assert.equal(report.totals.tasks, 1);
    assert.equal(report.complete, false);
    assert.match(captured.stderr, /permission denied/);
  } finally {
    fs.readFileSync = read;
  }
});
test('report file reads refuse symbolic leaves and redirected parents, skip nonregular entries', t => {
  const dir = root(t);
  put(dir, 'tasks/A.md', {schema: 1, id: 'A', title: 'kept', status: 'draft'});
  put(dir, 'tasks/B.md', {schema: 1, id: 'B', title: 'refused', status: 'draft'});
  fs.mkdirSync(path.join(dir, '.castwork/tasks/directory.md'));
  const originalLstat = fs.lstatSync, originalRealpath = fs.realpathSync.native;
  try {
    fs.lstatSync = (file, ...args) => String(file).endsWith('B.md') ? {isSymbolicLink: () => true} : originalLstat(file, ...args);
    const leaf = readReportInputs(dir);
    assert.deepEqual(leaf.inputs.map(i => i.record.frontmatter.id), ['A']);
    assert.match(leaf.problems[0].message, /symbolic link/);
    fs.lstatSync = originalLstat;
    fs.realpathSync.native = (file, ...args) => String(file).endsWith('B.md') ? path.join(dir, 'redirected/B.md') : originalRealpath(file, ...args);
    const parent = readReportInputs(dir);
    assert.deepEqual(parent.inputs.map(i => i.record.frontmatter.id), ['A']);
    assert.match(parent.problems[0].message, /redirected parent/);
  } finally {
    fs.lstatSync = originalLstat;
    fs.realpathSync.native = originalRealpath;
  }
});
test('report refuses a record directory junction before enumerating its outside files', t => {
  const dir = root(t), outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'outside.md'), '---\nid: OUTSIDE\n---');
  fs.rmdirSync(path.join(dir, '.castwork/tasks'));
  fs.symlinkSync(outside, path.join(dir, '.castwork/tasks'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = readReportInputs(dir);
  assert.equal(result.inputs.length, 0);
  assert.match(result.problems[0].message, /symbolic link/);
});
test('missing .castwork is an operational failure, not an empty success',t=>{
  const dir=root(t);
  fs.rmSync(path.join(dir,'.castwork'),{recursive:true});
  const run=cli(dir,'--json');
  assert.equal(run.status,1);
  assert.equal(JSON.parse(run.stdout).complete,false);
});
test('Git optional failure leaves report complete, exit 0, and explains omitted dates',t=>{
  const dir=root(t);
  put(dir,'tasks/A.md',{schema:1,id:'A',title:'t',status:'done'});
  const run=spawnSync(process.execPath,[bin,'report','--json'],{cwd:dir,env:{...process.env,PATH:''},encoding:'utf8'});
  assert.equal(run.status,0);
  const r=JSON.parse(run.stdout);
  assert.equal(r.complete,true);
  assert.match(r.git_omitted,/unavailable/);
});
test('local Git first/last visible dates and uncommitted changes without writes or lock refresh',t=>{
  const dir=root(t);
  const git=(...args)=>execFileSync('git',['--no-optional-locks','-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git('init');
  git('config','user.name','Fixture');
  git('config','user.email','fixture@example.invalid');
  put(dir,'tasks/A.md',{schema:1,id:'A',title:'t',status:'done'});
  git('add','.castwork/');
  git('commit','-m','fixture');
  const index=fs.readFileSync(path.join(dir,'.git/index'));
  fs.appendFileSync(path.join(dir,'.castwork/tasks/A.md'),'uncommitted');
  const obs=reportGit(dir);
  assert.ok(obs.records['.castwork/tasks/A.md'].first_commit);
  assert.equal(obs.records['.castwork/tasks/A.md'].uncommitted,true);
  assert.deepEqual(fs.readFileSync(path.join(dir,'.git/index')),index);
});
test('nested project Git paths include rename destinations and sources without repository mutations', t => {
  const repository = root(t);
  const dir = path.join(repository, 'packages', 'project');
  fs.mkdirSync(path.join(dir, '.castwork/tasks'), {recursive: true});
  fs.mkdirSync(path.join(dir, '.castwork/decisions'), {recursive: true});
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', repository, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  git('init');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  put(dir, 'tasks/A.md', {schema: 1, id: 'A', title: 'nested', status: 'done'});
  git('add', '.');
  git('commit', '-m', 'nested fixture');
  git('mv', 'packages/project/.castwork/tasks/A.md', 'packages/project/.castwork/tasks/B.md');
  const before = fs.readFileSync(path.join(repository, '.git/index'));
  const status = git('status', '--porcelain');
  const observation = reportGit(dir);
  assert.ok(observation.records['.castwork/tasks/A.md'].first_commit);
  assert.equal(observation.records['.castwork/tasks/A.md'].uncommitted, true);
  assert.equal(observation.records['.castwork/tasks/B.md'].uncommitted, true);
  assert.ok(!Object.keys(observation.records).some(file => file.startsWith('packages/')));
  assert.deepEqual(fs.readFileSync(path.join(repository, '.git/index')), before);
  assert.equal(git('status', '--porcelain'), status);
  const selected = cli(dir, 'A', '--json');
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).selected.git.uncommitted, true);
});
test('exported pure module has no I/O imports or calls and leaves inputs unchanged',()=>{
  const source=fs.readFileSync(new URL('../src/report.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/node:|\.\/.*cli|readFile|execFile|writeFile/);
  const a=input(history),before=JSON.stringify(a);
  derive(a);
  assert.equal(JSON.stringify(a),before);
});
