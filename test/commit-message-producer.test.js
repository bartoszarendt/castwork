/**
 * The toolkit ships a producer for the one artifact it is strictest about.
 *
 * `verification.context.malformed` was the largest failure code of the field
 * run - fourteen refusals, three rejected commits, one history reset - and the
 * dominant trigger was a non-contiguous `Task:`/`Agent:` trailer block. The
 * grammar was not being misunderstood: `git commit -m … -m …`, the most natural
 * way for an agent to write a multi-line message, inserts a blank line between
 * every `-m` and therefore strands `Task:` in its own paragraph, outside the
 * final contiguous block the validator requires.
 *
 * Agentic Loop enforced that grammar and provided nothing that emitted it.
 * These cases pin the producer, and pin that the producer and the validator
 * share one renderer - so a message the toolkit hands out can never be one the
 * toolkit rejects.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  COMMIT_MESSAGE_CLASSES,
  evaluateCommitAttribution,
  parseFinalTrailerBlock,
  renderCommitMessage,
} from '../src/commit-attribution.js';
import { publicOutputTargetRelativePath } from '../src/public-output-policy.js';
import { createTaskProjectFixture } from './helpers/task-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'al-commit-message-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function target(name) {
  const root = mkdtempSync(join(temp, `${name}-`));
  createTaskProjectFixture(root);
  mkdirSync(join(root, '.agenticloop', 'tmp'), { recursive: true });
  return root;
}

describe('the defect the producer exists to remove', () => {
  it('confirms repeated -m arguments produce a message the grammar rejects', () => {
    // Reproduced exactly: git joins each -m with a blank line, so only the last
    // paragraph is the final contiguous trailer block and `Task:` is misplaced.
    const gitStyle = ['implement the task', 'Task: T-018', 'Agent: engineer'].join('\n\n');
    const parsed = parseFinalTrailerBlock(gitStyle);
    assert.deepEqual(parsed.trailers, ['Agent: engineer']);
    assert.deepEqual(parsed.misplaced, ['Task: T-018']);
    const checked = evaluateCommitAttribution({ message: gitStyle, taskId: 'T-018', role: 'engineer' });
    assert.equal(checked.ok, false);
    assert.match(checked.errors.join('; '), /misplaced Task\/Agent trailer/);
  });

  it('points at the producer from the refusal, not at the grammar', () => {
    const checked = evaluateCommitAttribution({ message: 'no trailers here', taskId: 'T-018', role: 'engineer' });
    assert.equal(checked.ok, false);
    assert.match(checked.repairPlan, /task commit-message T-018 --class <commit-class>/);
    assert.match(checked.repairPlan, /git commit -F/);
  });
});

describe('the producer and the validator share one renderer', () => {
  it('emits a message the canonical validator accepts, with and without a body', () => {
    for (const body of [null, 'Binds the product head to the commit that introduced src/thing.js.']) {
      const rendered = renderCommitMessage({ taskId: 'T-018', role: 'engineer', subject: 'implement the task', body });
      assert.equal(rendered.ok, true, rendered.errors.join('; '));
      assert.match(rendered.message, /\n\nTask: T-018\nAgent: engineer\n$/);
      const checked = evaluateCommitAttribution({ message: rendered.message, taskId: 'T-018', role: 'engineer' });
      assert.equal(checked.ok, true, checked.errors.join('; '));
      assert.deepEqual(parseFinalTrailerBlock(rendered.message).misplaced, []);
    }
  });

  it('renders one accepted message for every declared commit class', () => {
    for (const [commitClass, role] of Object.entries(COMMIT_MESSAGE_CLASSES)) {
      const rendered = renderCommitMessage({ taskId: 'T-018', role, subject: `record ${commitClass}` });
      assert.equal(rendered.ok, true, `${commitClass}: ${rendered.errors.join('; ')}`);
      assert.equal(
        evaluateCommitAttribution({ message: rendered.message, taskId: 'T-018', role }).ok,
        true,
        `${commitClass} must render a message the validator accepts`
      );
    }
  });

  it('refuses a body that would become a misplaced trailer', () => {
    const rendered = renderCommitMessage({
      taskId: 'T-018', role: 'engineer', subject: 'implement',
      body: 'Task: T-018\n\nmore prose',
    });
    assert.equal(rendered.ok, false);
    assert.match(rendered.errors.join('; '), /cannot contain its own Task or Agent trailer/);
  });
});

describe('task commit-message', () => {
  it('writes a message file Git commits and the validator accepts', async () => {
    const root = target('produced');
    const output = '.agenticloop/tmp/message.txt';
    const result = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact',
      '--body', 'Binds the product head derived from Git.',
      '--output', output, '--json', '--target', root,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.role, 'engineer', 'the commit class decides the role, so no role has to guess it');
    assert.equal(report.commitCommand, `git commit -F ${output}`);

    const written = readFileSync(join(root, output), 'utf8');
    assert.equal(written, report.message);
    assert.equal(evaluateCommitAttribution({ message: written, taskId: 'T-001', role: 'engineer' }).ok, true);

    // Through real Git, with the file, exactly as the emitted command says.
    spawnSync('git', ['add', '-A'], { cwd: root });
    const committed = spawnSync('git', ['commit', '-F', output], { cwd: root, encoding: 'utf8' });
    assert.equal(committed.status, 0, committed.stderr);
    const message = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout;
    assert.equal(evaluateCommitAttribution({ message, taskId: 'T-001', role: 'engineer' }).ok, true);
  });

  it('attributes a maintainer-owned class to the maintainer', async () => {
    const root = target('maintainer-class');
    const output = '.agenticloop/tmp/message.txt';
    const result = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'attempt_abandonment',
      '--subject', 'abandon the expired attempt', '--output', output, '--json', '--target', root,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).role, 'maintainer');
    assert.match(readFileSync(join(root, output), 'utf8'), /\nAgent: maintainer\n$/);
  });

  it('refuses a task-carrier output path without replacing carrier bytes', async () => {
    const root = target('protected-output');
    const carrier = join(root, '.agenticloop', 'tasks', 'T-001.md');
    const before = 'authoritative task carrier\n';
    writeFileSync(carrier, before, 'utf8');
    const result = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', '.agenticloop/tasks/T-001.md',
      '--json', '--target', root,
    ]);
    assert.equal(result.status, 1, result.stderr);
    const refusal = JSON.parse(result.stdout);
    assert.equal(refusal.diagnostics[0].code, 'evidence.negative');
    assert.match(refusal.errors[0], /must not target lifecycle-authority path/);
    assert.equal(readFileSync(carrier, 'utf8'), before);
  });

  it('protects existing root-level carriers for every task without blocking a new cross-task filename', async () => {
    const root = target('root-protected-output');
    const projectMap = join(root, '.agenticloop', 'project.md');
    writeFileSync(
      projectMap,
      readFileSync(projectMap, 'utf8').replace(
        'task_file_template: ".agenticloop/tasks/{taskId}.md"',
        'task_file_template: "{taskId}.md"'
      ),
      'utf8'
    );
    const carrier = join(root, 'T-001.md');
    const before = 'authoritative root task carrier\n';
    writeFileSync(carrier, before, 'utf8');
    const refused = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', 'T-001.md',
      '--json', '--target', root,
    ]);
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal(JSON.parse(refused.stdout).diagnostics[0].code, 'evidence.negative');
    assert.equal(readFileSync(carrier, 'utf8'), before);

    // An unused carrier-shaped filename is still an ordinary public output.
    const differentTaskId = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', 'T-002.md',
      '--json', '--target', root,
    ]);
    assert.equal(differentTaskId.status, 0, differentTaskId.stderr);
    assert.match(readFileSync(join(root, 'T-002.md'), 'utf8'), /Task: T-001/);
    assert.equal(readFileSync(carrier, 'utf8'), before);

    // A carrier can appear after the root-template policy observes an absent
    // public output. The exclusive create must leave that new carrier intact.
    const concurrentCarrier = 'concurrently created root carrier\n';
    const concurrent = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', 'T-003.md',
      '--json', '--target', root,
    ], {
      fsMutationOptions: {
        afterFinalVerification: () => writeFileSync(join(root, 'T-003.md'), concurrentCarrier, 'utf8'),
      },
    });
    assert.equal(concurrent.status, 1, concurrent.stderr);
    assert.equal(JSON.parse(concurrent.stdout).diagnostics[0].code, 'evidence.negative');
    assert.equal(readFileSync(join(root, 'T-003.md'), 'utf8'), concurrentCarrier);

    // Once T-002 is a real configured carrier, T-001 must not overwrite it.
    const crossTaskCarrier = join(root, 'T-002.md');
    const crossTaskBefore = before.replaceAll('T-001', 'T-002');
    writeFileSync(crossTaskCarrier, crossTaskBefore, 'utf8');
    const crossTaskRefusal = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', 'T-002.md',
      '--json', '--target', root,
    ]);
    assert.equal(crossTaskRefusal.status, 1, crossTaskRefusal.stderr);
    assert.equal(JSON.parse(crossTaskRefusal.stdout).diagnostics[0].code, 'evidence.negative');
    assert.equal(readFileSync(crossTaskCarrier, 'utf8'), crossTaskBefore);

    const allowed = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', 'other.md',
      '--json', '--target', root,
    ]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(readFileSync(carrier, 'utf8'), before);
    assert.match(readFileSync(join(root, 'other.md'), 'utf8'), /Task: T-001/);
  });

  it('protects nested dynamic carrier templates without reserving ordinary sibling outputs', async () => {
    const root = target('nested-protected-output');
    const projectMap = join(root, '.agenticloop', 'project.md');
    const template = 'workflow/{taskId}/task-{taskId}1.md';
    writeFileSync(
      projectMap,
      readFileSync(projectMap, 'utf8').replace(
        'task_file_template: ".agenticloop/tasks/{taskId}.md"',
        `task_file_template: "${template}"`
      ),
      'utf8'
    );
    const carrier = taskId => join(root, template.replaceAll('{taskId}', taskId));
    const active = carrier('T-001');
    const crossTask = carrier('T-002');
    mkdirSync(join(root, 'workflow', 'T-001'), { recursive: true });
    mkdirSync(join(root, 'workflow', 'T-002'), { recursive: true });
    writeFileSync(active, 'active carrier\n', 'utf8');
    const crossTaskBefore = 'cross-task carrier\n';
    writeFileSync(crossTask, crossTaskBefore, 'utf8');

    for (const output of [template.replaceAll('{taskId}', 'T-001'), template.replaceAll('{taskId}', 'T-002')]) {
      const refused = await runCliInProcess([
        'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
        '--subject', 'record the implementation artifact', '--output', output,
        '--json', '--target', root,
      ]);
      assert.equal(refused.status, 1, refused.stderr);
      assert.equal(JSON.parse(refused.stdout).diagnostics[0].code, 'evidence.negative');
    }
    assert.equal(readFileSync(active, 'utf8'), 'active carrier\n');
    assert.equal(readFileSync(crossTask, 'utf8'), crossTaskBefore);

    // The literal digit after the repeated token must not merge with a numeric
    // backreference. An absent carrier remains exclusively creatable.
    const absent = carrier('T-004');
    mkdirSync(join(root, 'workflow', 'T-004'), { recursive: true });
    assert.equal(publicOutputTargetRelativePath(root, template.replaceAll('{taskId}', 'T-004'), 'output path', {
      projectConfig: { task_file_template: template }, activeTaskId: 'T-001',
    }).requiresExclusiveCreate, true);
    const created = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', template.replaceAll('{taskId}', 'T-004'),
      '--json', '--target', root,
    ]);
    assert.equal(created.status, 0, created.stderr);
    assert.match(readFileSync(absent, 'utf8'), /Task: T-001/);

    const concurrentOutput = template.replaceAll('{taskId}', 'T-003');
    const concurrentBytes = 'concurrent carrier\n';
    const concurrent = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', concurrentOutput,
      '--json', '--target', root,
    ], {
      fsMutationOptions: {
        afterFinalVerification: () => {
          mkdirSync(join(root, 'workflow', 'T-003'), { recursive: true });
          writeFileSync(carrier('T-003'), concurrentBytes, 'utf8');
        },
      },
    });
    assert.equal(concurrent.status, 1, concurrent.stderr);
    assert.equal(JSON.parse(concurrent.stdout).diagnostics[0].code, 'evidence.negative');
    assert.equal(readFileSync(carrier('T-003'), 'utf8'), concurrentBytes);

    const ordinary = 'workflow/T-001/task-T-00112.md';
    const allowed = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
      '--subject', 'record the implementation artifact', '--output', ordinary,
      '--json', '--target', root,
    ]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(readFileSync(join(root, ordinary), 'utf8'), /Task: T-001/);
  });

  it('protects static-sentinel and regex-literal carrier templates for commit-message output', async () => {
    for (const template of [
      'workflow/__protected_output_probe__/{taskId}/task-{taskId}-record.md',
      'workflow/$&[]()+^/{taskId}/task-{taskId}-record.md',
    ]) {
      const root = target(`static-template-${template.includes('__protected_output_probe__') ? 'sentinel' : 'literals'}`);
      const projectMap = join(root, '.agenticloop', 'project.md');
      writeFileSync(
        projectMap,
        readFileSync(projectMap, 'utf8').replace(
          'task_file_template: ".agenticloop/tasks/{taskId}.md"',
          () => `task_file_template: "${template}"`
        ),
        'utf8'
      );
      const carrier = taskId => template.replaceAll('{taskId}', taskId);
      const active = carrier('T-001');
      const crossTask = carrier('T-002');
      const activeBefore = 'active carrier\n';
      const crossTaskBefore = 'cross-task carrier\n';
      mkdirSync(join(root, active, '..'), { recursive: true });
      mkdirSync(join(root, crossTask, '..'), { recursive: true });
      writeFileSync(join(root, active), activeBefore, 'utf8');
      writeFileSync(join(root, crossTask), crossTaskBefore, 'utf8');

      for (const output of [active, crossTask]) {
        const refused = await runCliInProcess([
          'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
          '--subject', 'record the implementation artifact', '--output', output,
          '--json', '--target', root,
        ]);
        assert.equal(refused.status, 1, refused.stderr);
        assert.equal(JSON.parse(refused.stdout).diagnostics[0].code, 'evidence.negative');
      }
      assert.equal(readFileSync(join(root, active), 'utf8'), activeBefore);
      assert.equal(readFileSync(join(root, crossTask), 'utf8'), crossTaskBefore);

      const absent = carrier('T-003');
      mkdirSync(join(root, absent, '..'), { recursive: true });
      assert.equal(publicOutputTargetRelativePath(root, absent, 'output path', {
        projectConfig: { task_file_template: template }, activeTaskId: 'T-001',
      }).requiresExclusiveCreate, true);
      const created = await runCliInProcess([
        'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
        '--subject', 'record the implementation artifact', '--output', absent,
        '--json', '--target', root,
      ]);
      assert.equal(created.status, 0, created.stderr);
      assert.match(readFileSync(join(root, absent), 'utf8'), /Task: T-001/);

      const ordinary = `workflow/${template.includes('__protected_output_probe__') ? '__protected_output_probe__' : '$&[]()+^'}/T-002/notes/message.txt`;
      mkdirSync(join(root, ordinary, '..'), { recursive: true });
      const allowed = await runCliInProcess([
        'task', 'commit-message', 'T-001', '--class', 'implementation_artifact_evidence',
        '--subject', 'record the implementation artifact', '--output', ordinary,
        '--json', '--target', root,
      ]);
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.match(readFileSync(join(root, ordinary), 'utf8'), /Task: T-001/);
    }
  });

  it('refuses an unknown commit class and names the accepted ones', async () => {
    const root = target('unknown-class');
    const result = await runCliInProcess([
      'task', 'commit-message', 'T-001', '--class', 'invented_class',
      '--subject', 'x', '--output', '.agenticloop/tmp/m.txt', '--json', '--target', root,
    ]);
    assert.equal(result.status, 2);
    const errors = JSON.parse(result.stdout).errors.join('\n');
    assert.match(errors, /Invalid --class value 'invented_class'/);
    assert.match(errors, /implementation_artifact_evidence/);
    assert.match(errors, /attempt_abandonment/);
  });
});
