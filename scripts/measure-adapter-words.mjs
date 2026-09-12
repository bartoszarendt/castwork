#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  for (const dir of adapter.dirs) for (const file of walk(join(output, dir))) {
    if (!/\.(md|toml|ya?ml)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
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
  return Object.freeze(Object.fromEntries(Object.entries(measurements).map(([category, measurement]) => [
    category,
    Object.freeze(measurement),
  ])));
}

/** Generate each adapter into a disposable fixture and return full surface measurements. */
export function measureAdapterSurface() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'agenticloop-adapter-words-'));
  try {
    return Object.fromEntries(ADAPTERS.map(adapter => [adapter.name, measure(adapter, tmpDir)]));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Generate each adapter into a disposable fixture and return canonical word counts. */
export function measureAdapterWords() {
  return Object.fromEntries(Object.entries(measureAdapterSurface()).map(([adapter, categories]) => [
    adapter,
    Object.fromEntries(Object.entries(categories).map(([category, measurement]) => [
      category,
      measurement.canonicalWords,
    ])),
  ]));
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(measureAdapterSurface(), null, 2)}\n`);
