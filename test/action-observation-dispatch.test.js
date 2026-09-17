import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { ACTION_OBSERVATION_KIND } from '../src/action-observation-contract.js';
import { createDispatchFixture } from './helpers/dispatch-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'action-observation-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function enabledProjectMap() {
  return readFileSync(join(ROOT, 'memory/scaffold/project.md'), 'utf8')
    .replace('event_logging: disabled', 'event_logging: enabled');
}

function options(fixture, observed) {
  return {
    operatorTrustRoot: fixture.operatorTrustRoot,
    operatorActivationRoot: fixture.operatorActivationRoot,
    hostAuthority: protectedHostBoundary(fixture.trust),
    protectedTransitionObserver: event => observed.push(event),
  };
}

describe('prepare-dispatch action observation', () => {
  it('records the exact consumed decision once and passive explanation adds no attempt', async () => {
    const fixture = await createDispatchFixture(temp, 'recorded', { projectMapContent: enabledProjectMap() });
    const observed = [];
    const prepared = await runCliInProcess([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', '.agenticloop/tmp/packet.json', '--json', '--target', fixture.root,
    ], options(fixture, observed));
    assert.equal(prepared.status, 0, prepared.stderr);

    const decision = observed.find(event => event.actionId === 'dispatch')?.evaluatorOutcome?.semanticEvaluation;
    assert.ok(decision, 'protected command observer must expose the consumed semantic result');
    const logPath = join(fixture.root, '.agenticloop/logs/T-001.jsonl');
    const events = readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.length, 1);
    const record = events[0].data;
    assert.equal(record.kind, ACTION_OBSERVATION_KIND);
    assert.equal(record.evaluationId, decision.evaluationId);
    assert.equal(record.verdict, decision.verdict);
    assert.deepEqual(record.reasonIds, [...new Set(decision.reasons.map(reason => reason.reasonId))].sort());
    assert.equal(record.finalOutcome, 'recorded');

    const explained = await runCliInProcess([
      'task', 'explain', 'T-001', '--action', 'prepare_dispatch', '--json', '--target', fixture.root,
    ], options(fixture, observed));
    assert.equal(explained.status, 0, explained.stderr);
    assert.equal(readFileSync(logPath, 'utf8').trim().split('\n').length, 1,
      'passive explanation must not count as an attempted action');

    const started = await runCliInProcess([
      'task', 'role-start', 'T-001', '--packet', '.agenticloop/tmp/packet.json', '--json', '--target', fixture.root,
    ], options(fixture, observed));
    assert.equal(started.status, 0, started.stderr || started.stdout);
  });

  it('never lets an observation write failure block the protected action', async () => {
    const fixture = await createDispatchFixture(temp, 'write-failure', { projectMapContent: enabledProjectMap() });
    writeFileSync(join(fixture.root, '.agenticloop/logs'), 'not-a-directory\n', 'utf8');
    const observed = [];
    const prepared = await runCliInProcess([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', '.agenticloop/tmp/packet.json', '--json', '--target', fixture.root,
    ], options(fixture, observed));
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
    assert.ok(observed.some(event => event.evaluatorOutcome?.semanticEvaluation?.verdict === 'legal'));
    assert.equal(readFileSync(join(fixture.root, '.agenticloop/logs'), 'utf8'), 'not-a-directory\n');
  });
});
