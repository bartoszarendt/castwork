import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseRequiredCheckInventory,
  REQUIRED_CHECK_EXPLAIN_REFUSAL_CODE,
  requiredCheckEvidenceMatchesInventory,
  validateRequiredCheckInventory,
  validateRequiredCheckEvidence,
} from '../src/required-checks.js';
import { receiveRoleReturn } from '../src/dispatch-envelope.js';
import { canonicalSha256 } from '../src/canonical-json.js';
import {
  createDispatchFixture,
  git,
  prepare,
  producerBinding,
  readyReturn,
  repositoryEvidence,
} from './helpers/dispatch-fixture.js';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'al-required-checks-')); });
after(() => rmSync(temp, { recursive: true, force: true }));

describe('canonical required-check model', () => {
  it('parses command, manual, and mixed inventories in stable RC order', () => {
    const parsed = parseRequiredCheckInventory([
      '- [RC-2] manual: Inspect the generated adapter output.',
      '- [RC-1] command: `npm test`',
    ].join('\n'));
    assert.equal(parsed.ok, true, parsed.errors.join('\n'));
    assert.deepEqual(parsed.checks, [
      { id: 'RC-1', kind: 'command', command: 'npm test' },
      { id: 'RC-2', kind: 'manual', instruction: 'Inspect the generated adapter output.' },
    ]);
  });

  it('rejects duplicates, missing bullets, empty inventories, and malformed kinds', () => {
    const cases = [
      '- [RC-1] command: `npm test`\n- [RC-1] manual: Inspect.',
      'RC-1 command: `npm test`',
      '',
      '- [RC-1] review: Inspect.',
      '- [RC-1] command: npm test',
    ];
    for (const value of cases) assert.equal(parseRequiredCheckInventory(value).ok, false, value);
  });

  it('refuses task explain as a required check with its typed diagnostic', () => {
    for (const command of [
      'npx agenticloop@latest task explain T-001 --json',
      'pnpm dlx agenticloop task explain T-001 --json',
      'npm exec agenticloop -- task explain T-001 --json',
    ]) {
      const parsed = parseRequiredCheckInventory(`- [RC-1] command: \`${command}\``);
      assert.equal(parsed.ok, false, command);
      assert.match(parsed.errors.join('\n'), /must not invoke task explain/);
      assert.deepEqual(parsed.diagnostics.map(item => item.code), [REQUIRED_CHECK_EXPLAIN_REFUSAL_CODE]);
    }
  });

  it('refuses task explain in authorized legacy command bullets with its typed diagnostic', () => {
    const parsed = parseRequiredCheckInventory(
      '- [RC-1] agenticloop task explain T-001',
      { allowLegacy: true },
    );
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join('\n'), /command required check 'RC-1' must not invoke task explain/);
    assert.deepEqual(parsed.diagnostics.map(item => item.code), [REQUIRED_CHECK_EXPLAIN_REFUSAL_CODE]);
    assert.match(parsed.diagnostics[0].message, /command required check 'RC-1'/);
  });

  it('refuses task explain in persisted inventories with its typed diagnostic and check id', () => {
    for (const command of [
      'npx agenticloop@latest task explain T-001 --json',
      'pnpm dlx agenticloop task explain T-001 --json',
      'npm exec agenticloop -- task explain T-001 --json',
    ]) {
      const validated = validateRequiredCheckInventory([
        { id: 'RC-7', kind: 'command', command },
      ]);
      assert.equal(validated.ok, false, command);
      assert.match(validated.errors.join('\n'), /command required check 'RC-7' must not invoke task explain/);
      assert.deepEqual(validated.diagnostics.map(item => item.code), [REQUIRED_CHECK_EXPLAIN_REFUSAL_CODE]);
      assert.match(validated.diagnostics[0].message, /command required check 'RC-7'/);
    }
  });

  it('allows blank lines but rejects unexpected prose instead of dropping it', () => {
    const blank = parseRequiredCheckInventory([
      '- [RC-1] command: `npm test`',
      '',
      '   ',
      '- [RC-2] manual: Inspect the final state.',
      '',
    ].join('\n'));
    assert.equal(blank.ok, true, blank.errors.join('\n'));
    assert.equal(blank.checks.length, 2);

    for (const value of [
      '- [RC-1] command: `npm test`\nRun the suite before review.',
      'Guidance paragraph.\n- [RC-1] command: `npm test`',
      '- [RC-1] command: `npm test`\n  continuation prose without a bullet',
      '- [RC-1] command: `npm test`\n<!-- HTML comments are content too -->',
    ]) {
      const parsed = parseRequiredCheckInventory(value);
      assert.equal(parsed.ok, false, value);
      assert.match(parsed.errors.join('\n'), /rejects non-bullet content/, value);
    }
    // The authorized legacy-bullet path still parses pre-P35 command-only
    // bullets, but it does not reinterpret arbitrary prose either.
    const legacy = parseRequiredCheckInventory('- `npm test`', { allowLegacy: true });
    assert.equal(legacy.ok, true, legacy.errors.join('\n'));
    assert.equal(parseRequiredCheckInventory('- `npm test`\nlegacy note', { allowLegacy: true }).ok, false);
    // Without the explicit legacy allowance the same bullet fails closed.
    assert.equal(parseRequiredCheckInventory('- `npm test`').ok, false);
  });

  it('enforces command and manual exit-code rules and stable identities', () => {
    const inventory = parseRequiredCheckInventory([
      '- [RC-1] command: `npm test`',
      '- [RC-2] manual: Inspect generated output.',
    ].join('\n')).checks;
    const valid = [
      { id: 'RC-1', kind: 'command', command: 'npm test', outcome: 'passed', exitCode: 0, evidence: 'green' },
      { id: 'RC-2', kind: 'manual', instruction: 'Inspect generated output.', outcome: 'passed', exitCode: null, evidence: 'inspected' },
    ];
    assert.equal(validateRequiredCheckEvidence(valid).ok, true);
    assert.equal(requiredCheckEvidenceMatchesInventory(valid, inventory), true);
    assert.equal(validateRequiredCheckEvidence([{ ...valid[1], exitCode: 0 }]).ok, false);
    assert.equal(validateRequiredCheckEvidence([{ ...valid[0], exitCode: 1 }]).ok, false);
    assert.equal(requiredCheckEvidenceMatchesInventory([{ ...valid[0], command: 'npm run test' }, valid[1]], inventory), false);
  });

  it('rejects reordered mixed return evidence with a precise canonical-order diagnostic', async () => {
    const fixture = await createDispatchFixture(temp, 'mixed', {
      requiredChecksText: [
        '- [RC-1] command: `npm test`',
        '- [RC-2] manual: Inspect generated output.',
      ].join('\n'),
    });
    const prepared = prepare(fixture);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    const evidence = repositoryEvidence(prepared.packet, {
      checks: [
        { id: 'RC-1', kind: 'command', command: 'npm test', outcome: 'passed', exitCode: 0, evidence: 'green' },
        { id: 'RC-2', kind: 'manual', instruction: 'Inspect generated output.', outcome: 'passed', exitCode: null, evidence: 'inspected' },
      ],
    });
    const roleReturn = JSON.parse(JSON.stringify(readyReturn(prepared.packet, evidence)));
    roleReturn.checks.reverse();
    const { digest: _priorDigest, ...projection } = roleReturn;
    roleReturn.digest = `sha256:agenticloop.role-return.v5:${canonicalSha256(projection)}`;
    const received = receiveRoleReturn({
      raw: JSON.stringify(roleReturn),
      packet: prepared.packet,
      refetchTask: fixture.refetchTask,
      refetchRepositoryEvidence: () => evidence,
      ...producerBinding(fixture.trust, prepared.packet, roleReturn, evidence),
    }, fixture.options);
    assert.equal(received.ok, false);
    assert.deepEqual(received.validation.errors, ['role return checks must use canonical RC identity order']);
  });

  it('accepts RC-1 through RC-10 through the return receiver finish projection', async () => {
    const requiredChecksText = Array.from({ length: 10 }, (_, index) =>
      `- [RC-${index + 1}] command: \`npm run check-${index + 1}\``
    ).join('\n');
    const fixture = await createDispatchFixture(temp, 'two-digit-finish-candidate', { requiredChecksText });
    const prepared = prepare(fixture);
    assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
    assert.deepEqual(prepared.packet.task.requiredChecks.map(check => check.id),
      Array.from({ length: 10 }, (_, index) => `RC-${index + 1}`));

    const checks = prepared.packet.task.requiredChecks.map(check => ({
      id: check.id,
      kind: 'command',
      command: check.command,
      outcome: 'passed',
      exitCode: 0,
      evidence: `${check.id} passed`,
    }));
    writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const verified = true;\n', 'utf8');
    git(fixture.root, ['add', 'src/existing.js']);
    git(fixture.root, ['commit', '-m', 'verify ten required checks\n\nTask: T-001\nAgent: engineer']);
    const productHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const evidence = repositoryEvidence(prepared.packet, {
      head: productHead,
      changedPaths: ['src/existing.js'],
      checks,
    });
    evidence.productAttribution = {
      range: { base: prepared.packet.repository.head, head: productHead },
      commits: [productHead],
    };
    const roleReturn = readyReturn(prepared.packet, evidence);
    const received = receiveRoleReturn({
      raw: JSON.stringify(roleReturn),
      packet: prepared.packet,
      refetchTask: fixture.refetchTask,
      refetchRepositoryEvidence: () => evidence,
      runGit: fixture.runGit,
      ...producerBinding(fixture.trust, prepared.packet, roleReturn, evidence),
    }, fixture.options);
    assert.equal(received.ok, true, received.validation.errors?.join('\n'));
    assert.deepEqual(received.finishCandidate.requiredCheckSet,
      Array.from({ length: 10 }, (_, index) => `RC-${index + 1}`));
  });
});
