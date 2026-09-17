import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENTRY = resolve(ROOT, 'src/semantic-evaluator.js');
const STATIC_IMPORT = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;

function evaluatorClosure(entry) {
  const pending = [entry];
  const visited = new Set();
  const external = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        external.add(specifier);
        continue;
      }
      const resolved = resolve(dirname(file), extname(specifier) ? specifier : `${specifier}.js`);
      pending.push(resolved);
    }
  }
  return { files: [...visited].sort(), external: [...external].sort() };
}

describe('semantic evaluator dependency boundary', () => {
  it('keeps the complete transitive closure free of runtime and presentation concerns', () => {
    const closure = evaluatorClosure(ENTRY);
    assert.deepEqual(
      closure.files.map(file => file.slice(ROOT.length).replaceAll('\\', '/')),
      ['src/canonical-json.js', 'src/semantic-evaluator.js'],
    );
    assert.deepEqual(closure.external, ['node:crypto']);

    for (const file of closure.files) {
      const source = readFileSync(file, 'utf8');
      for (const forbidden of [
        /from\s+['"]node:fs/, /from\s+['"]node:child_process/, /from\s+['"]node:http/,
        /from\s+['"]node:https/, /\bDate\.now\s*\(/, /\bnew\s+Date\s*\(/,
        /\bprocess\./, /\bfetch\s*\(/, /event-logging/, /task-cli/, /adapter/,
      ]) {
        assert.doesNotMatch(source, forbidden, `${file} must not reach a forbidden runtime concern`);
      }
    }
  });
});
