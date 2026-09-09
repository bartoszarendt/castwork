import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'agenticloop-context-measure-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('dispatch acting-context measurement', () => {
  it('reports deterministic exact UTF-8 component bytes and rejects duplicates', () => {
    const packet = join(temp, 'packet.json');
    const role = join(temp, 'role.md');
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
    assert.deepEqual(result.components.map(item => item.kind), [
      'canonical_packet',
      'generated_role_wrapper',
      'generated_activation_wrapper',
      'canonical_reference',
    ]);
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
  });

  it('measures actual OpenCode orientation and ordinary-role wrappers from generated artifacts', async t => {
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

    // M4 counts the concrete initial-supervisor bundle. M5 counts only each
    // delegated role wrapper before packet/task evidence, while retaining the
    // same generated component measurement for auditability.
    const orientation = measure('orchestrator');
    assert.equal(orientation.totalCanonicalWords, 6193, JSON.stringify(orientation));
    assert.equal(orientation.actualInputTokens, 'unavailable');
    const delegated = {};
    for (const role of ['maintainer', 'engineer', 'auditor']) {
      const measurement = measure(role);
      const wrapper = measurement.components.find(item => item.kind === 'generated_role_wrapper');
      assert.ok(wrapper, `${role} must have a generated role wrapper component`);
      assert.equal(wrapper.canonicalWords, {
        maintainer: 4632,
        engineer: 4097,
        auditor: 2362,
      }[role], `${role} M5 measurement drifted`);
      assert.equal(measurement.actualInputTokens, 'unavailable');
      delegated[role] = {
        canonicalWords: wrapper.canonicalWords,
        utf8Bytes: wrapper.utf8Bytes,
        characters: wrapper.characters,
      };
    }
    const canonicalPacket = orientation.components.find(item => item.kind === 'canonical_packet');
    const rawPacket = readFileSync(packet, 'utf8');
    t.diagnostic(JSON.stringify({
      M4: {
        canonicalWords: orientation.totalCanonicalWords,
        utf8Bytes: orientation.totalUtf8Bytes,
        characters: orientation.totalCharacters,
        actualInputTokens: orientation.actualInputTokens,
      },
      M5: delegated,
      packetConstruction: {
        serialization: orientation.packetSerialization,
        rawUtf8Bytes: Buffer.byteLength(rawPacket, 'utf8'),
        canonicalUtf8Bytes: canonicalPacket.utf8Bytes,
        rawEndsWithNewline: rawPacket.endsWith('\n'),
        canonicalPacketEndsWithNewline: false,
      },
    }, null, 2));
  });
});
