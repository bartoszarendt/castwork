import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../src/canonical-json.js';
import { measureCanonicalText } from '../src/canonical-word-count.js';
import {
  generateOpencodeArtifacts,
  resolveOpencodeAgentPath,
  resolveOpencodeCommandPath,
} from '../src/adapters/opencode.js';
import { loadAgenticLoopConfig } from '../src/json.js';
import { createDispatchFixture } from './helpers/dispatch-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { seedTargetLayout } from './helpers/layout-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'measure-dispatch-context.mjs');
const CANONICAL_TEXT_MEASUREMENT_METHOD = measureCanonicalText('').method;
let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'agenticloop-context-measure-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('dispatch acting-context measurement', () => {
  it('reports deterministic exact UTF-8 component bytes and rejects duplicates', () => {
    const packet = join(temp, 'packet.json');
    // A literal backslash is legal in a POSIX filename and models the separator
    // a Windows-resolved component path contributes to the portable report.
    const platformShapedDirectory = join(temp, 'platform-shaped\\component');
    mkdirSync(platformShapedDirectory, { recursive: true });
    const role = join(platformShapedDirectory, 'role.md');
    const activation = join(temp, 'activation.md');
    const reference = join(temp, 'reference.md');
    const packetValue = { z: 1, a: 'żółć' };
    writeFileSync(packet, JSON.stringify(packetValue, null, 2), 'utf8');
    writeFileSync(role, 'role\n', 'utf8');
    writeFileSync(activation, 'activation\n', 'utf8');
    writeFileSync(reference, 'reference\n', 'utf8');
    const args = [
      '--packet', packet,
      '--role-wrapper', role,
      '--activation-wrapper', activation,
      '--reference', reference,
    ];
    const first = run(args);
    const second = run(args);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    const result = JSON.parse(first.stdout);
    assert.equal(result.packetSerialization, 'canonicalJson');
    assert.equal(result.measurementMethod, 'agenticloop.dispatch-context/v3');
    assert.equal(result.canonicalTextMethod, CANONICAL_TEXT_MEASUREMENT_METHOD);
    assert.equal(result.lifecycle, undefined);
    assert.deepEqual(result.normalization, { lineEndings: 'LF', pathSeparators: '/' });
    assert.deepEqual(result.intendedPlatformComponents, []);
    assert.deepEqual(result.components.map(item => item.kind), [
      'canonical_packet',
      'generated_role_wrapper',
      'generated_activation_wrapper',
      'canonical_reference',
    ]);
    assert.ok(result.components.every(item => !item.path.includes('\\')), 'component paths use normalized slash separators');
    const expected = [canonicalJson(packetValue), 'role\n', 'activation\n', 'reference\n'].map(measureCanonicalText);
    assert.deepEqual(result.components.map(({ kind, path, bytes, ...measurement }) => measurement), expected);
    assert.deepEqual(result.components.map(item => item.bytes), expected.map(item => item.utf8Bytes));
    assert.equal(result.totalCanonicalWords, expected.reduce((sum, item) => sum + item.canonicalWords, 0));
    assert.equal(result.totalUtf8Bytes, expected.reduce((sum, item) => sum + item.utf8Bytes, 0));
    assert.equal(result.totalCharacters, expected.reduce((sum, item) => sum + item.characters, 0));
    assert.equal(result.actualInputTokens, 'unavailable');

    const duplicate = run([...args, '--reference', role]);
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stderr, /same context component/);

    const callerSuppliedLifecycle = run([...args, '--lifecycle', 'source-package-clean-offline-install']);
    assert.equal(callerSuppliedLifecycle.status, 2);
    assert.match(callerSuppliedLifecycle.stderr, /unknown option '--lifecycle'/);
  });

  it('measures generated source artifacts without claiming a package/install lifecycle', async () => {
    const fixture = await createDispatchFixture(temp, 'generated-opencode-packet');
    const prepared = await runCliInProcess([
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', '.agenticloop/tmp/packet.json', '--json', '--target', fixture.root,
    ], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      operatorActivationRoot: fixture.operatorActivationRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.equal(prepared.status, 0, prepared.stderr);

    const generatedTarget = join(temp, 'generated-opencode-target');
    const output = join(temp, 'generated-opencode-output');
    seedTargetLayout(REPO_ROOT, generatedTarget, { includeDocs: false, includeScratch: false });
    generateOpencodeArtifacts(
      loadAgenticLoopConfig(join(generatedTarget, 'agenticloop.json')),
      generatedTarget,
      output,
    );

    const packet = join(fixture.root, '.agenticloop', 'tmp', 'packet.json');
    const activation = resolveOpencodeCommandPath(output);
    const protocol = join(generatedTarget, 'agenticloop', 'commands', 'lifecycle-protocol.md');
    const measure = role => {
      const result = run([
        '--packet', packet,
        '--role-wrapper', resolveOpencodeAgentPath(output, role),
        '--activation-wrapper', activation,
        '--reference', protocol,
      ]);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };

    // This source-level check covers the component method only. The packed
    // package boundary owns the M4/M5 lifecycle observation.
    const orientation = measure('orchestrator');
    assert.equal(orientation.actualInputTokens, 'unavailable');
    for (const role of ['maintainer', 'engineer', 'auditor']) {
      const measurement = measure(role);
      const wrapper = measurement.components.find(item => item.kind === 'generated_role_wrapper');
      assert.ok(wrapper, `${role} must have a generated role wrapper component`);
      assert.equal(measurement.actualInputTokens, 'unavailable');
    }
  });
});
