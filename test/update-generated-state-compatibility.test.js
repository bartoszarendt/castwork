import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { canonicalSha256 } from '../src/canonical-json.js';
import {
  createDispatchConsumption,
  dispatchConsumptionRelativePath,
  DISPATCH_CONSUMPTION_SCHEMA_VERSION,
  listDispatchConsumptions,
  migrateDispatchConsumptionAtProtectedBoundary,
} from '../src/handoff-consumption.js';
import {
  currentLifecycleBinding,
  lifecycleSchemaSetDigest,
  lifecycleSchemaSetRegistry,
} from '../src/lifecycle-compatibility.js';
import { executeGenerationPlan } from '../src/generation-transaction.js';
import { createPathClassifier } from '../src/product-lineage.js';
import { evaluateDispatchCleanState } from '../src/repository-state.js';
import { createDispatchFixture, git, prepare } from './helpers/dispatch-fixture.js';
import { fixtureDispatchValidator } from './helpers/handoff-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';
import { recognizeHandoff } from '../src/handoff-recognition.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIN = join(REPO_ROOT, 'bin', 'agenticloop.js');

function legacyV4(record) {
  const legacy = structuredClone(record);
  legacy.schemaVersion = 4;
  delete legacy.toolkitPackageVersion;
  delete legacy.lifecycleSchemaSetDigest;
  delete legacy.digest;
  legacy.digest = `sha256:agenticloop.dispatch-consumption.v4:${canonicalSha256(legacy)}`;
  return legacy;
}

function priorBoundV5(record) {
  const prior = lifecycleSchemaSetRegistry().find(entry => entry.reader === 'retained-v1');
  assert.ok(prior, 'the v1 schema set must remain registered with its reader');
  const retained = structuredClone(record);
  retained.lifecycleSchemaSetDigest = prior.digest;
  delete retained.digest;
  retained.digest = `sha256:agenticloop.dispatch-consumption.v5:${canonicalSha256(retained)}`;
  return retained;
}

function unavailableBoundV5(record) {
  const unavailable = structuredClone(record);
  unavailable.lifecycleSchemaSetDigest = 'sha256:agenticloop.lifecycle-schema-set.v2:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  delete unavailable.digest;
  unavailable.digest = `sha256:agenticloop.dispatch-consumption.v5:${canonicalSha256(unavailable)}`;
  return unavailable;
}

function unsupportedV6(record) {
  const unsupported = structuredClone(record);
  unsupported.schemaVersion = DISPATCH_CONSUMPTION_SCHEMA_VERSION + 1;
  delete unsupported.digest;
  unsupported.digest = `sha256:agenticloop.dispatch-consumption.v${unsupported.schemaVersion}:${canonicalSha256(unsupported)}`;
  return unsupported;
}

function taskDigest(root, taskId = 'T-001') {
  const content = readFileSync(join(root, '.agenticloop', 'tasks', `${taskId}.md`), 'utf8');
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function fixtureCli(fixture, args) {
  return runCliInProcess([...args, '--target', fixture.root], {
    operatorTrustRoot: fixture.operatorTrustRoot,
    hostAuthority: protectedHostBoundary(fixture.trust),
  });
}

function runPublicCli(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function writeAttempt(root, transform = legacyV4) {
  const fixture = await createDispatchFixture(root, 'compatibility');
  const prepared = prepare(/** @type {any} */ (fixture));
  assert.equal(prepared.ok, true, prepared.validation.errors?.join('\n'));
  const packet = prepared.packet;
  const recognition = recognizeHandoff({
    transition: 'role_start',
    expectation: {
      backend: 'files', taskId: 'T-001', roleId: 'engineer',
      taskContractDigest: packet.task.contractDigest, carrierDigest: packet.task.digest,
      packetId: packet.packetId, packetDigest: packet.digest,
      workUnitIdentity: packet.decomposition?.workUnitId ?? null, artifactHead: packet.repository.head,
      worktreeRoot: packet.repository.worktree, minimumActivationAssurance: 'operator_confirmed',
    },
    preparedDispatch: packet,
    validatePreparedDispatch: fixtureDispatchValidator(/** @type {any} */ (fixture)),
  });
  assert.equal(recognition.recognized, true, JSON.stringify(recognition.diagnostics));
  const current = createDispatchConsumption({
    backend: 'files', taskId: 'T-001', recognition,
    currentCarrierDigest: recognition.boundIdentity.currentCarrierDigest,
  });
  const persisted = transform(current);
  const relPath = dispatchConsumptionRelativePath(persisted);
  const path = join(fixture.root, relPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  return { fixture, packet, current, relPath, path };
}

async function initializedTarget(root) {
  const initialized = runPublicCli(['init', '--target', root]);
  assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
}

async function seedLifecycleRecord(target, transform) {
  const source = await writeAttempt(target, transform);
  const path = join(target, source.relPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, readFileSync(source.path, 'utf8'), 'utf8');
  return path;
}

test('mid-attempt update admits a readable v4 attempt without rewriting it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-mid-attempt-update-'));
  try {
    const { fixture, current, path } = await writeAttempt(root, legacyV4);
    assert.equal(current.schemaVersion, DISPATCH_CONSUMPTION_SCHEMA_VERSION);
    assert.deepEqual(
      { toolkitPackageVersion: current.toolkitPackageVersion, lifecycleSchemaSetDigest: current.lifecycleSchemaSetDigest },
      currentLifecycleBinding(),
    );
    assert.equal(current.lifecycleSchemaSetDigest, lifecycleSchemaSetDigest());
    const before = readFileSync(path, 'utf8');
    const updated = runPublicCli(['update', '--target', fixture.root]);
    assert.equal(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.equal(readFileSync(path, 'utf8'), before, 'update admission never rewrites an active attempt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('update refuses an incompatible attempt without rewriting it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-incompatible-update-'));
  try {
    const { fixture, path } = await writeAttempt(root, unsupportedV6);
    const before = readFileSync(path, 'utf8');
    const result = runPublicCli(['update', '--target', fixture.root]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported_new_version/);
    assert.equal(readFileSync(path, 'utf8'), before, 'update refusal must preserve the incompatible record');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validate admits readable retained attempts without rewriting them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-readable-validation-'));
  try {
    await initializedTarget(root);
    const path = await seedLifecycleRecord(root, legacyV4);
    const before = readFileSync(path, 'utf8');
    const result = runPublicCli(['validate', '--target', root]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(path, 'utf8'), before, 'validation admission never rewrites a retained attempt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validate reports only incompatible attempts as lifecycle compatibility errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-incompatible-validation-'));
  try {
    await initializedTarget(root);
    const path = await seedLifecycleRecord(root, unsupportedV6);
    const before = readFileSync(path, 'utf8');
    const result = runPublicCli(['validate', '--target', root]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Lifecycle Compatibility/);
    assert.match(result.stdout, /unsupported_new_version/);
    assert.equal(readFileSync(path, 'utf8'), before, 'validation must not rewrite an incompatible attempt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real protected prepare-return boundary atomically migrates unavailable bound semantics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-migration-boundary-'));
  try {
    const { fixture, packet, current, relPath, path } = await writeAttempt(root, unavailableBoundV5);
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    writeFileSync(join(fixture.root, '.agenticloop', 'tmp', 'packet.json'), JSON.stringify(packet), 'utf8');
    const result = await runCliInProcess([
      'task', 'prepare-return', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence', '.agenticloop/tmp/checks.json', '--outcome', 'implementation_ready_for_review',
      '--output', '.agenticloop/tmp/return.json', '--json', '--target', fixture.root,
    ], {
      operatorTrustRoot: fixture.operatorTrustRoot,
      hostAuthority: protectedHostBoundary(fixture.trust),
    });
    assert.notEqual(result.status, 0, 'the incomplete fixture may fail only after protected-boundary migration');
    const migrated = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(
      { toolkitPackageVersion: migrated.toolkitPackageVersion, lifecycleSchemaSetDigest: migrated.lifecycleSchemaSetDigest },
      currentLifecycleBinding(),
    );
    assert.equal(relPath, dispatchConsumptionRelativePath(migrated));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real protected prepare-return boundary reads a valid v4 attempt without rewriting it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-v4-prepare-return-'));
  try {
    const fixture = await createDispatchFixture(root, 'compatibility-v4-return', {
      requiredChecksText: '- [RC-1] command: `node --version`',
    });
    const packet = prepare(/** @type {any} */ (fixture)).packet;
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    writeFileSync(join(fixture.root, '.agenticloop', 'tmp', 'packet.json'), JSON.stringify(packet), 'utf8');

    const started = await fixtureCli(fixture, [
      'task', 'status', 'T-001', 'in-progress', '--expect-digest', taskDigest(fixture.root),
      '--dispatch-packet', '.agenticloop/tmp/packet.json', '--json',
    ]);
    assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
    git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
    git(fixture.root, ['commit', '-m', 'start the legacy attempt\n\nTask: T-001\nAgent: engineer']);

    const current = listDispatchConsumptions(fixture.root, 'T-001', { backend: 'files' });
    assert.equal(current.ok, true, current.errors.join('\n'));
    const persisted = legacyV4(current.records[0]);
    const handoffPath = join(fixture.root, dispatchConsumptionRelativePath(persisted));
    writeFileSync(handoffPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    const before = readFileSync(handoffPath, 'utf8');
    git(fixture.root, ['add', '.agenticloop/handoffs']);
    git(fixture.root, ['commit', '-m', 'retain the valid v4 attempt\n\nTask: T-001\nAgent: engineer']);

    writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const current = "legacy return";\n', 'utf8');
    git(fixture.root, ['add', 'src/existing.js']);
    git(fixture.root, ['commit', '-m', 'implement legacy return\n\nTask: T-001\nAgent: engineer']);
    const productHead = git(fixture.root, ['rev-parse', 'HEAD']);

    const artifact = await fixtureCli(fixture, [
      'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
      '--expect-digest', taskDigest(fixture.root), '--product-head', productHead, '--json',
    ]);
    assert.equal(artifact.status, 0, `${artifact.stdout}\n${artifact.stderr}`);
    git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
    git(fixture.root, ['commit', '-m', 'record the legacy implementation artifact\n\nTask: T-001\nAgent: engineer']);

    const checksPath = '.agenticloop/tmp/checks.json';
    const initialized = await fixtureCli(fixture, [
      'task', 'check-evidence-init', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--output', checksPath, '--json',
    ]);
    assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    for (const check of JSON.parse(readFileSync(join(fixture.root, checksPath), 'utf8'))) {
      const updated = await fixtureCli(fixture, [
        'task', 'check-evidence-update', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
        '--input', checksPath, '--output', checksPath, '--check', check.id, '--outcome', 'passed',
        '--evidence', `${check.id} passed`,
        '--execution-output', `.agenticloop/checks/T-001/${check.id}.execution.json`, '--json',
      ]);
      assert.equal(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    }

    const returned = await fixtureCli(fixture, [
      'task', 'prepare-return', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence', checksPath, '--outcome', 'implementation_ready_for_review',
      '--output', '.agenticloop/tmp/return.json', '--json',
    ]);
    assert.equal(returned.status, 0, `${returned.stdout}\n${returned.stderr}`);
    assert.equal(readFileSync(handoffPath, 'utf8'), before, 'retained v4 semantics must not rewrite the active attempt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the protected prepare-return boundary refuses an unsupported version without rewriting it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-unsupported-prepare-return-'));
  try {
    const { fixture, packet, path } = await writeAttempt(root, unsupportedV6);
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    writeFileSync(join(fixture.root, '.agenticloop', 'tmp', 'packet.json'), JSON.stringify(packet), 'utf8');
    const before = readFileSync(path, 'utf8');
    const refused = await fixtureCli(fixture, [
      'task', 'prepare-return', 'T-001', '--packet', '.agenticloop/tmp/packet.json',
      '--check-evidence', '.agenticloop/tmp/checks.json', '--outcome', 'implementation_ready_for_review',
      '--output', '.agenticloop/tmp/return.json', '--json',
    ]);
    assert.notEqual(refused.status, 0);
    const result = JSON.parse(refused.stdout);
    assert.equal(result.diagnostics[0].code, 'verification.context.malformed');
    assert.match(result.errors.join('\n'), /unsupported_new_version/);
    assert.equal(readFileSync(path, 'utf8'), before, 'an unsupported record must remain byte-for-byte intact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migration failure preserves the old record and explains the incompatibility', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-migration-rollback-'));
  try {
    const { fixture, current, path } = await writeAttempt(root, unavailableBoundV5);
    const before = readFileSync(path, 'utf8');
    const result = migrateDispatchConsumptionAtProtectedBoundary(fixture.root, 'T-001', current.packetId, {
      beforeWrite: () => { throw new Error('simulated protected-boundary write failure'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.migrated, false);
    assert.match(result.errors.join('\n'), /simulated protected-boundary write failure/);
    assert.equal(readFileSync(path, 'utf8'), before, 'failed migration leaves the old record intact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v4 dispatch consumption preserves its persisted check-evidence output while being read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-v4-check-output-'));
  try {
    const { fixture, path } = await writeAttempt(root, record => {
      const legacy = legacyV4(record);
      legacy.acceptedResult.checkEvidenceOutput = '.agenticloop/tmp/T-001-checks.json';
      delete legacy.digest;
      legacy.digest = `sha256:agenticloop.dispatch-consumption.v4:${canonicalSha256(legacy)}`;
      return legacy;
    });
    const read = listDispatchConsumptions(fixture.root, 'T-001', { backend: 'files' });
    assert.equal(read.ok, true, read.errors.join('\n'));
    assert.equal(read.records[0].acceptedResult.checkEvidenceOutput, '.agenticloop/tmp/T-001-checks.json');
    assert.match(readFileSync(path, 'utf8'), /"checkEvidenceOutput": "\.agenticloop\/tmp\/T-001-checks\.json"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compatibility scope keeps the lifecycle adoption coverage title behavior-focused', () => {
  const titleSource = readFileSync(new URL('./lifecycle-adoption-cli.test.js', import.meta.url), 'utf8');
  assert.match(titleSource, /describe\('production lifecycle adoption and review-attachment commands'/);
  assert.doesNotMatch(titleSource, /\bP[0-9]{2}-[0-9]+\b/i);
});

function cleanGateRunner({ staged = '', unstaged = '', untracked = '', ignored = '' } = {}) {
  return args => {
    if (args.includes('--cached')) return { status: 0, stdout: staged };
    if (args[0] === 'diff') return { status: 0, stdout: unstaged };
    if (args.includes('--ignored')) return { status: 0, stdout: ignored };
    if (args[0] === 'ls-files') return { status: 0, stdout: untracked };
    return { status: 0, stdout: '' };
  };
}

test('generated-local paths are permitted only by canonical manifest ownership', () => {
  const generated = evaluateDispatchCleanState({
    runGit: cleanGateRunner({
      untracked: '.opencode/agent/engineer.md\nagenticloop/agents/engineer.md\n',
      ignored: '.opencode/agent/engineer.md\nagenticloop/agents/engineer.md\n',
    }),
    scopePatterns: ['src/**'],
  });
  assert.equal(generated.ok, true, JSON.stringify(generated.findings));

  const unexpected = evaluateDispatchCleanState({
    runGit: cleanGateRunner({ untracked: 'src/unexpected.js\n.agenticloop/unowned.json\n' }),
    scopePatterns: ['src/**'],
  });
  assert.equal(unexpected.ok, false);
  assert.deepEqual(unexpected.state.untrackedRelevantPaths, ['.agenticloop/unowned.json', 'src/unexpected.js']);

  const tracked = evaluateDispatchCleanState({
    runGit: cleanGateRunner({ unstaged: '.opencode/agent/engineer.md\n' }),
    scopePatterns: ['src/**'],
  });
  assert.equal(tracked.ok, false, 'a tracked generated-path change is still dirty');
  assert.match(tracked.findings[0].message, /unstaged tracked changes/);
});

test('the clean gate uses the generation transaction write set for shared GitHub paths in both layouts', () => {
  const root = mkdtempSync(join(tmpdir(), 'al-generated-github-ownership-'));
  const generatedPaths = [
    '.github/agents/engineer.agent.md',
    '.github/skills/agenticloop/SKILL.md',
    '.github/prompts/agenticloop.prompt.md',
  ];
  const targetOwnedPaths = [
    '.github/CODEOWNERS',
    '.github/dependabot.yml',
    '.github/ISSUE_TEMPLATE/bug.md',
    '.github/copilot-instructions.md',
    '.github/workflows/ci.yml',
    '.github/agents/project-owned.agent.md',
    '.github/skills/project-owned/SKILL.md',
    '.github/prompts/project-owned.prompt.md',
  ];
  try {
    const transaction = executeGenerationPlan(root, {
      outputRoot: '.',
      adapters: ['copilot'],
      files: generatedPaths,
      actions: generatedPaths.map(relPath => ({
        type: 'write-file', adapter: 'copilot', relPath, content: `generated ${relPath}\n`,
      })),
    });
    assert.equal(transaction.ok, true, transaction.errors.join('\n'));

    for (const legacyLayout of [false, true]) {
      const layoutName = legacyLayout ? 'legacy' : 'current';
      const classifier = createPathClassifier(root, { legacyLayout });
      for (const path of targetOwnedPaths) {
        assert.equal(classifier.classify(path), 'product', `${path} must remain target-owned in ${layoutName} layout`);
      }
      for (const path of generatedPaths) {
        assert.equal(classifier.classify(path), 'toolkit_generated', `${path} must derive from the transaction write set in ${layoutName} layout`);
      }

      for (const [kind, value] of [['untracked', targetOwnedPaths], ['ignored', targetOwnedPaths]]) {
        const blocked = evaluateDispatchCleanState({
          runGit: cleanGateRunner({ [kind]: `${value.join('\n')}\n` }),
          scopePatterns: ['.github/**'], target: root, legacyLayout,
        });
        assert.equal(blocked.ok, false, `${kind} target-owned shared paths must block in ${layoutName} layout`);
        assert.deepEqual(blocked.state[`${kind}RelevantPaths`], value.slice().sort());
      }

      for (const [kind, value] of [['untracked', generatedPaths], ['ignored', generatedPaths]]) {
        const permitted = evaluateDispatchCleanState({
          runGit: cleanGateRunner({ [kind]: `${value.join('\n')}\n` }),
          scopePatterns: ['.github/**'], target: root, legacyLayout,
        });
        assert.equal(permitted.ok, true, `${kind} generated transaction output must remain permitted in ${layoutName} layout`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('live preflight excludes transaction-recorded generated commits from product lineage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-preflight-generated-lineage-'));
  try {
    const fixture = await createDispatchFixture(root, 'preflight-generated-lineage');
    const packetPath = '.agenticloop/tmp/packet.json';
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    const prepared = await fixtureCli(fixture, [
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
      '--output', packetPath, '--json',
    ]);
    assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`);
    const packet = JSON.parse(readFileSync(join(fixture.root, packetPath), 'utf8'));
    const started = await fixtureCli(fixture, [
      'task', 'role-start', 'T-001', '--packet', packetPath, '--json',
    ]);
    assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
    git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
    git(fixture.root, ['commit', '-m', 'start the live attempt\n\nTask: T-001\nAgent: engineer']);

    const generatedPath = '.github/agents/engineer.agent.md';
    const generated = executeGenerationPlan(fixture.root, {
      outputRoot: '.', adapters: ['copilot'], files: [generatedPath],
      actions: [{ type: 'write-file', adapter: 'copilot', relPath: generatedPath, content: 'generated engineer shim\n' }],
    });
    assert.equal(generated.ok, true, generated.errors.join('\n'));
    git(fixture.root, ['add', '.github', '.agenticloop/generated-artifacts.json']);
    git(fixture.root, ['commit', '-m', 'write generated host output\n\nTask: T-001\nAgent: engineer']);
    const generatedHead = git(fixture.root, ['rev-parse', 'HEAD']);

    const generatedOnly = await fixtureCli(fixture, [
      'task', 'handoff-preflight', 'T-001', '--host', 'opencode', '--json',
    ]);
    assert.equal(generatedOnly.status, 0, `${generatedOnly.stdout}\n${generatedOnly.stderr}`);
    const generatedOnlyResult = JSON.parse(generatedOnly.stdout);
    assert.equal(generatedOnlyResult.liveAttemptGate.derivedProductHead, packet.repository.head);
    assert.equal(generatedOnlyResult.liveAttemptGate.nextStep, 'product_work');

    writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const current = "product work";\n', 'utf8');
    git(fixture.root, ['add', 'src/existing.js']);
    git(fixture.root, ['commit', '-m', 'implement product work\n\nTask: T-001\nAgent: engineer']);
    const productHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const productCommit = await fixtureCli(fixture, [
      'task', 'handoff-preflight', 'T-001', '--host', 'opencode', '--json',
    ]);
    assert.equal(productCommit.status, 0, `${productCommit.stdout}\n${productCommit.stderr}`);
    const productCommitResult = JSON.parse(productCommit.stdout);
    assert.equal(productCommitResult.liveAttemptGate.derivedProductHead, productHead);
    assert.equal(productCommitResult.liveAttemptGate.nextStep, 'implementation_artifact_evidence');

    const preflightSource = readFileSync(new URL('../src/handoff-preflight.js', import.meta.url), 'utf8');
    assert.match(
      preflightSource,
      /deriveProductHead\(\{\s*runGit: args => runGit\(resolvedTarget, args\),\s*baseHead: lineage\.dispatchConsumption\.productBaseHead,\s*head: repositoryState\.head,\s*classifier: createPathClassifier\(resolvedTarget\),\s*\}\)/s,
      'live preflight must use the same target-bound ownership classifier as other product-lineage consumers'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function startCommandCheckAttempt(root, name) {
  const fixture = await createDispatchFixture(root, name, {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const packetPath = '.agenticloop/tmp/packet.json';
  mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
  const packet = prepare(/** @type {any} */ (fixture)).packet;
  writeFileSync(join(fixture.root, packetPath), JSON.stringify(packet), 'utf8');
  const started = await fixtureCli(fixture, [
    'task', 'status', 'T-001', 'in-progress', '--expect-digest', taskDigest(fixture.root),
    '--dispatch-packet', packetPath, '--json',
  ]);
  assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', 'start the command-check attempt\n\nTask: T-001\nAgent: engineer']);
  return { fixture, packet, packetPath };
}

function commitGeneratedHostOutput(root, content) {
  const generatedPath = '.github/agents/engineer.agent.md';
  const generated = executeGenerationPlan(root, {
    outputRoot: '.', adapters: ['copilot'], files: [generatedPath],
    actions: [{ type: 'write-file', adapter: 'copilot', relPath: generatedPath, content }],
  });
  assert.equal(generated.ok, true, generated.errors.join('\n'));
  git(root, ['add', '.github', '.agenticloop/generated-artifacts.json']);
  git(root, ['commit', '-m', 'write generated host output\n\nTask: T-001\nAgent: engineer']);
  return git(root, ['rev-parse', 'HEAD']);
}

async function runPassedCommandCheck(fixture, packetPath) {
  const checksPath = '.agenticloop/tmp/checks.json';
  const initialized = await fixtureCli(fixture, [
    'task', 'check-evidence-init', 'T-001', '--packet', packetPath, '--output', checksPath, '--json',
  ]);
  assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const [check] = JSON.parse(readFileSync(join(fixture.root, checksPath), 'utf8'));
  const updated = await fixtureCli(fixture, [
    'task', 'check-evidence-update', 'T-001', '--packet', packetPath,
    '--input', checksPath, '--output', checksPath, '--check', check.id, '--outcome', 'passed',
    '--evidence', `${check.id} passed`,
    '--execution-output', `.agenticloop/checks/T-001/${check.id}.execution.json`, '--json',
  ]);
  assert.equal(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
  const execution = JSON.parse(readFileSync(join(fixture.root, '.agenticloop', 'checks', 'T-001', `${check.id}.execution.json`), 'utf8'));
  return { checksPath, execution };
}

test('command-check execution binds the product commit through later generated output and prepares a return', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-command-check-product-lineage-'));
  try {
    const { fixture, packetPath } = await startCommandCheckAttempt(root, 'command-check-product-lineage');
    writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const current = "product work";\n', 'utf8');
    git(fixture.root, ['add', 'src/existing.js']);
    git(fixture.root, ['commit', '-m', 'implement product work\n\nTask: T-001\nAgent: engineer']);
    const productHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const generatedHead = commitGeneratedHostOutput(fixture.root, 'generated engineer shim\n');

    const { execution } = await runPassedCommandCheck(fixture, packetPath);
    assert.equal(execution.binding.productHead, productHead);
    assert.notEqual(execution.binding.productHead, generatedHead);

    const returnAttempt = await startCommandCheckAttempt(root, 'command-check-return-lineage');
    writeFileSync(join(returnAttempt.fixture.root, 'src', 'existing.js'), 'export const current = "return product work";\n', 'utf8');
    git(returnAttempt.fixture.root, ['add', 'src/existing.js']);
    git(returnAttempt.fixture.root, ['commit', '-m', 'implement return product work\n\nTask: T-001\nAgent: engineer']);
    const returnProductHead = git(returnAttempt.fixture.root, ['rev-parse', 'HEAD']);
    commitGeneratedHostOutput(returnAttempt.fixture.root, 'generated return shim\n');

    const artifact = await fixtureCli(returnAttempt.fixture, [
      'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
      '--expect-digest', taskDigest(returnAttempt.fixture.root), '--product-head', returnProductHead, '--json',
    ]);
    assert.equal(artifact.status, 0, `${artifact.stdout}\n${artifact.stderr}`);
    git(returnAttempt.fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
    git(returnAttempt.fixture.root, ['commit', '-m', 'record implementation artifact\n\nTask: T-001\nAgent: engineer']);
    const { checksPath } = await runPassedCommandCheck(returnAttempt.fixture, returnAttempt.packetPath);

    const returned = await fixtureCli(returnAttempt.fixture, [
      'task', 'prepare-return', 'T-001', '--packet', returnAttempt.packetPath, '--check-evidence', checksPath,
      '--outcome', 'implementation_ready_for_review', '--output', '.agenticloop/tmp/return.json', '--json',
    ]);
    assert.equal(returned.status, 0, `${returned.stdout}\n${returned.stderr}`);
    const roleReturn = JSON.parse(readFileSync(join(returnAttempt.fixture.root, '.agenticloop', 'tmp', 'return.json'), 'utf8'));
    assert.equal(roleReturn.productHead, returnProductHead);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('command-check execution retains the base product head after generated-only committed output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'al-command-check-generated-only-'));
  try {
    const { fixture, packet, packetPath } = await startCommandCheckAttempt(root, 'command-check-generated-only');
    const generatedHead = commitGeneratedHostOutput(fixture.root, 'generated-only engineer shim\n');
    const { execution } = await runPassedCommandCheck(fixture, packetPath);
    assert.equal(execution.binding.productHead, packet.repository.head);
    assert.notEqual(execution.binding.productHead, generatedHead);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy generated paths are permitted only when the clean gate receives legacy layout context', () => {
  const legacy = evaluateDispatchCleanState({
    runGit: cleanGateRunner({ untracked: 'agents/engineer.md\n' }),
    scopePatterns: ['agents/**'],
    legacyLayout: true,
  });
  assert.equal(legacy.ok, true, JSON.stringify(legacy.findings));

  const current = evaluateDispatchCleanState({
    runGit: cleanGateRunner({ untracked: 'agents/engineer.md\n' }),
    scopePatterns: ['agents/**'],
  });
  assert.equal(current.ok, false);
  assert.deepEqual(current.state.untrackedRelevantPaths, ['agents/engineer.md']);
});
