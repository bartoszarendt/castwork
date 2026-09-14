#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateClaudeCodeArtifacts } from '../src/adapters/claude-code.js';
import { generateCodexArtifacts } from '../src/adapters/codex.js';
import { generateCopilotArtifacts } from '../src/adapters/copilot.js';
import { generateCursorArtifacts } from '../src/adapters/cursor.js';
import { generateOpencodeArtifacts } from '../src/adapters/opencode.js';
import { loadAgenticLoopConfig } from '../src/json.js';
import { measureCanonicalText } from '../src/canonical-word-count.js';
import { seedTargetLayout } from '../test/helpers/layout-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CANONICAL_TEXT_MEASUREMENT_METHOD = measureCanonicalText('').method;

const ADAPTERS = Object.freeze([
  { name: 'opencode', generate: generateOpencodeArtifacts, dirs: ['.opencode'] },
  { name: 'codex', generate: generateCodexArtifacts, dirs: ['.codex', '.agents'] },
  { name: 'claude-code', generate: generateClaudeCodeArtifacts, dirs: ['.claude'] },
  { name: 'copilot', generate: generateCopilotArtifacts, dirs: ['.github'] },
  { name: 'cursor', generate: generateCursorArtifacts, dirs: ['.cursor'] },
]);

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function platformFacts(output, path, text) {
  const shellFact = text.match(/Shell dialect: (POSIX shell|PowerShell 7\+).*$/m);
  return shellFact ? [{
    kind: 'shell-operating-fact', path: relative(output, path).replace(/\\/g, '/'),
    value: shellFact[1], intendedPlatformSpecific: true,
  }] : [];
}

function measure(adapter, tmpDir) {
  const fixture = mkdtempSync(join(tmpDir, `${adapter.name}-fixture-`));
  seedTargetLayout(REPO_ROOT, fixture, { includeDocs: false, includeScratch: false });
  const output = mkdtempSync(join(tmpDir, `${adapter.name}-output-`));
  adapter.generate(loadAgenticLoopConfig(join(fixture, 'agenticloop.json')), fixture, output);
  const categories = ['generatedPayload', 'agentDefinitions', 'activationSurface', 'referenceLibrary'];
  const measurements = Object.fromEntries(categories.map(category => [category, {
    canonicalWords: 0,
    utf8Bytes: 0,
    characters: 0,
    actualInputTokens: 'unavailable',
  }]));
  const intendedPlatformComponents = [];
  for (const dir of adapter.dirs) for (const file of walk(join(output, dir))) {
    if (!/\.(md|toml|ya?ml)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    intendedPlatformComponents.push(...platformFacts(output, file, text));
    const component = measureCanonicalText(text);
    for (const category of ['generatedPayload']) {
      measurements[category].canonicalWords += component.canonicalWords;
      measurements[category].utf8Bytes += component.utf8Bytes;
      measurements[category].characters += component.characters;
    }
    const path = file.replace(/\\/g, '/');
    const category = path.includes('/references/')
      ? 'referenceLibrary'
      : /\/agents\//.test(path)
        ? 'agentDefinitions'
        : 'activationSurface';
    measurements[category].canonicalWords += component.canonicalWords;
    measurements[category].utf8Bytes += component.utf8Bytes;
    measurements[category].characters += component.characters;
  }
  return Object.freeze({
    components: Object.freeze(Object.fromEntries(Object.entries(measurements).map(([category, measurement]) => [
      category,
      Object.freeze({ method: CANONICAL_TEXT_MEASUREMENT_METHOD, ...measurement }),
    ]))),
    intendedPlatformComponents: Object.freeze(intendedPlatformComponents),
  });
}

/** Generate each adapter into a disposable fixture and return full surface measurements. */
export function measureAdapterSurface() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'agenticloop-adapter-words-'));
  try {
    return Object.freeze({
      schemaVersion: 2,
      measurementMethod: CANONICAL_TEXT_MEASUREMENT_METHOD,
      normalization: Object.freeze({ lineEndings: 'LF', pathSeparators: '/' }),
      hostPlatform: process.platform,
      adapters: Object.freeze(Object.fromEntries(ADAPTERS.map(adapter => [adapter.name, measure(adapter, tmpDir)]))),
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Generate each adapter into a disposable fixture and return canonical word counts. */
export function measureAdapterWords() {
  return Object.fromEntries(Object.entries(measureAdapterSurface().adapters).map(([adapter, result]) => [
    adapter,
    Object.fromEntries(Object.entries(result.components).map(([category, measurement]) => [
      category,
      measurement.canonicalWords,
    ])),
  ]));
}

/** Test-only portable one-sided budget policy for generated measurements. */
export function evaluateMeasurementBudget(measurements, policy) {
  const errors = [];
  for (const [component, requirement] of Object.entries(policy.components ?? {})) {
    const measurement = measurements?.[component];
    if (!measurement) {
      errors.push(`${component}: missing component`);
      continue;
    }
    if (measurement.method !== (requirement.method ?? CANONICAL_TEXT_MEASUREMENT_METHOD)) {
      errors.push(`${component}: invalid measurement method`);
      continue;
    }
    if (!Number.isFinite(measurement.canonicalWords)) {
      errors.push(`${component}: invalid canonical word measurement`);
      continue;
    }
    if (measurement.canonicalWords > requirement.upperBound) {
      errors.push(`${component}: exceeded upper bound ${requirement.upperBound}`);
    }
    if (measurement.canonicalWords > requirement.previous && !requirement.regressionExplanation) {
      errors.push(`${component}: unexplained regression`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(measureAdapterSurface(), null, 2)}\n`);
