import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

import { planAdapterArtifacts, generateAdapterArtifacts, IMPLEMENTED_ADAPTERS } from '../src/adapter-generation.js';
import { validateTopLevelCommandHandlerParity } from '../src/cli.js';
import { COMMAND_REGISTRY } from '../src/cli-registry.js';
import { loadAgenticLoopConfig } from '../src/json.js';
import {
  ACCEPTED_REFUSAL_FAMILIES,
  HARD_REFUSAL_ALLOWLIST,
  HISTORICAL_PRODUCER_EXCEPTIONS,
  REFUSAL_CLASSES,
  assertRefusalClassCatalog,
  repairPolicyViewFor,
  validateCatalog,
} from '../src/refusal-classes.js';
import { REPAIR_POLICY } from '../src/repair-policy.js';
import { createValidationResult, validateValidationResult } from '../src/result-envelope.js';
import { validateConfig } from '../src/validate-config.js';
import { seedTargetLayout } from './helpers/layout-fixture.js';
import { runCliInProcess } from './helpers/run-cli.js';
import {
  F6_DIAGNOSTIC_PROOF_BINDINGS,
  F7_DIAGNOSTIC_PROOF_BINDINGS,
  F8_DIAGNOSTIC_PROOF_BINDINGS,
  f6DiagnosticProofBindingsFor,
} from './helpers/diagnostic-proof-bindings.js';
import { F6_EXECUTABLE_PROBE_IDS, runF6ExecutableProbe } from './helpers/f6-executable-probes.js';
import { F7_EXECUTABLE_PROBE_IDS, runF7ExecutableProbe } from './helpers/f7-executable-probes.js';
import { F8_EXECUTABLE_PROBE_IDS, runF8ExecutableProbe } from './helpers/f8-executable-probes.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HARD_CLASSES = new Set(['retained_hard_refusal', 'material_human_decision']);

describe('canonical command and result boundaries', () => {
  it('keeps registry top-level command keys equal to executable top-level handler keys', () => {
    assert.deepEqual(validateTopLevelCommandHandlerParity(), { ok: true, errors: [] });
    const withoutOne = { ...COMMAND_REGISTRY };
    delete withoutOne.validate;
    assert.deepEqual(validateTopLevelCommandHandlerParity(withoutOne), {
      ok: false,
      errors: ["executable handler 'validate' has no registry declaration"],
    });
    assert.deepEqual(validateTopLevelCommandHandlerParity({ ...COMMAND_REGISTRY, invented: {} }), {
      ok: false,
      errors: ["registered command 'invented' has no executable handler"],
    });
  });

  it('proves registry/parser coverage for every declared command and subcommand', async () => {
    for (const [command, spec] of Object.entries(COMMAND_REGISTRY)) {
      const routes = Object.keys(spec.subcommands ?? {}).length > 0
        ? Object.keys(spec.subcommands).map(subcommand => [command, subcommand])
        : [[command]];
      for (const route of routes) {
        const run = await runCliInProcess([...route, '--definitely-not-an-option', '--json']);
        assert.notEqual(run.status, 0, route.join(' '));
        const result = JSON.parse(run.stdout);
        assert.equal(result.diagnostics[0]?.code, 'cli.usage', route.join(' '));
      }
    }
  });

  it('rejects malformed diagnostics and unauthorized routing fields at serialization input', () => {
    const valid = createValidationResult({ command: 'test' });
    const malformed = {
      ...valid,
      ok: false,
      disposition: 'blocked',
      diagnostics: [{ code: 'cli.unexpected', message: 'x', level: 'error', ownerRouting: 'bypass' }],
    };
    const checked = validateValidationResult(malformed);
    assert.equal(checked.ok, false);
    assert.match(checked.errors.join('\n'), /unknown fields|routing capabilities/);
  });
});

describe('adapter registry boundary', () => {
  it('plans, generates, and validates every supported adapter through the shared registry', () => {
    const target = mkdtempSync(join(tmpdir(), 'adapter-boundary-'));
    try {
      seedTargetLayout(REPO_ROOT, target, { includeDocs: false, includeScratch: false });
      const alConfig = loadAgenticLoopConfig(join(target, 'agenticloop.json'));
      const planned = planAdapterArtifacts({ target, alConfig, adapter: 'all' });
      assert.equal(planned.ok, true, planned.errors.join('\n'));
      assert.deepEqual(planned.adapters, IMPLEMENTED_ADAPTERS);
      for (const adapter of IMPLEMENTED_ADAPTERS) {
        assert.ok(planned.plan.files.some(path => path.includes(adapter === 'claude-code' ? '.claude/' : adapter === 'copilot' ? '.github/' : adapter === 'cursor' ? '.cursor/' : `.${adapter}/`) || path.includes('SKILL.md')), adapter);
      }
      const generated = generateAdapterArtifacts({ target, alConfig, adapter: 'all' });
      assert.equal(generated.ok, true, generated.errors.join('\n'));
      for (const path of generated.files) assert.equal(existsSync(join(target, ...path.split('/'))), true, path);
      assert.deepEqual(validateConfig(target, { adapters: IMPLEMENTED_ADAPTERS }).errors, []);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('diagnostic catalog and executable proof boundaries', () => {
  it('validates the catalog explicitly and keeps every producer reference resolvable', () => {
    assert.equal(validateCatalog(), true);
    assert.deepEqual(REPAIR_POLICY, repairPolicyViewFor(REFUSAL_CLASSES));
    for (const [code, entry] of Object.entries(REFUSAL_CLASSES)) {
      if (entry.producers === null) {
        assert.ok(HISTORICAL_PRODUCER_EXCEPTIONS[code], `${code} requires a historical disposition`);
        continue;
      }
      for (const producer of entry.producers ?? []) {
        assert.equal(existsSync(join(REPO_ROOT, ...producer.split('/'))), true, `${code}: ${producer}`);
      }
    }
  });

  it('keeps unrelated version/help imports safe while explicit validation rejects inconsistency', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agenticloop-catalog-fixture-'));
    try {
      cpSync(REPO_ROOT, fixture, {
        recursive: true,
        filter(source) {
          const rel = relative(REPO_ROOT, source).replaceAll('\\', '/');
          return rel === '' || !['.git', '.agenticloop', '.docs', 'node_modules', 'opencode.json']
            .some(excluded => rel === excluded || rel.startsWith(`${excluded}/`));
        },
      });
      const fixtureCatalog = join(fixture, 'src', 'refusal-classes.js');
      writeFileSync(fixtureCatalog, readFileSync(fixtureCatalog, 'utf8').replace(
        'const catalog = [...F1, ...F2, ...F3, ...F4, ...F5, ...F6, ...F7, ...F8];',
        'const catalog = [...F1, ...F2, ...F3, ...F4, ...F5, ...F6, ...F7, ...F8, F1[0]];',
      ));
      const cli = join(fixture, 'bin', 'agenticloop.js');
      const imported = spawnSync(process.execPath, ['--input-type=module', '--eval',
        `await import(${JSON.stringify(pathToFileURL(fixtureCatalog).href)});`,
      ], { encoding: 'utf8' });
      assert.equal(imported.status, 0, imported.stderr);
      for (const args of [['--version'], ['help']]) {
        const smoke = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
        assert.equal(smoke.status, 0, smoke.stderr);
      }
      const validation = spawnSync(process.execPath, [cli, 'validate', '--target', fixture], { encoding: 'utf8' });
      assert.notEqual(validation.status, 0);
      assert.match(validation.stdout, /Diagnostic Catalog/);
      assert.match(validation.stdout, /duplicate refusal classification/);
    } finally {
      rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('keeps hard-refusal accounting exhaustive and warning-only diagnostics separate', () => {
    assert.equal(REFUSAL_CLASSES['return.assurance.session_reported'].refusalClass, 'advisory_diagnostic');
    assert.equal(HARD_REFUSAL_ALLOWLIST.some(entry => entry.code === 'return.assurance.session_reported'), false);
    assert.deepEqual(
      HARD_REFUSAL_ALLOWLIST.map(entry => entry.code).sort(),
      Object.values(REFUSAL_CLASSES).filter(entry => HARD_CLASSES.has(entry.refusalClass)).map(entry => entry.code).sort(),
    );
    assert.throws(() => assertRefusalClassCatalog({
      classifications: { ...REFUSAL_CLASSES, invented: { ...REFUSAL_CLASSES['cli.unexpected'], code: 'invented' } },
    }), /row count changed/);
    assert.deepEqual(ACCEPTED_REFUSAL_FAMILIES, ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
  });

  for (const [family, bindings, ids, runProbe] of [
    ['F6', F6_DIAGNOSTIC_PROOF_BINDINGS, F6_EXECUTABLE_PROBE_IDS, runF6ExecutableProbe],
    ['F7', F7_DIAGNOSTIC_PROOF_BINDINGS, F7_EXECUTABLE_PROBE_IDS, runF7ExecutableProbe],
    ['F8', F8_DIAGNOSTIC_PROOF_BINDINGS, F8_EXECUTABLE_PROBE_IDS, runF8ExecutableProbe],
  ]) {
    it(`executes every ${family} material-boundary proof through its production path`, async () => {
      const expected = Object.values(REFUSAL_CLASSES)
        .filter(entry => entry.family === family && HARD_CLASSES.has(entry.refusalClass))
        .map(entry => entry.code).sort();
      assert.deepEqual(bindings.map(entry => entry.code).sort(), expected);
      assert.deepEqual(bindings.map(entry => entry.probeId).sort(), [...ids].sort());
      for (const binding of bindings) {
        const observed = await runProbe(binding.probeId);
        assert.ok(observed.diagnostics.some(item => item?.code === binding.code), binding.probeId);
        assert.equal(binding.factOwner, REFUSAL_CLASSES[binding.code].factOwner);
      }
    });
  }

  it('derives proof fact ownership from the catalog', () => {
    const code = F6_DIAGNOSTIC_PROOF_BINDINGS[0].code;
    const definitions = { ...REFUSAL_CLASSES, [code]: { ...REFUSAL_CLASSES[code], factOwner: 'changed-owner' } };
    assert.equal(f6DiagnosticProofBindingsFor(definitions)[0].factOwner, 'changed-owner');
  });
});
