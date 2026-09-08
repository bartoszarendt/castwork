import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { generateOpencodeArtifacts } from '../src/adapters/opencode.js';
import { loadAgenticLoopConfig } from '../src/json.js';
import { seedTargetLayout } from './helpers/layout-fixture.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVE_CONSUMER_DIRECTORIES = ['agents', 'skills', 'backends', 'commands', 'docs', 'memory', 'src'];
const ACTIVE_CONSUMER_FILES = ['README.md'];
const ACTIVE_CONSUMER_EXTENSIONS = new Set(['.md', '.js']);
const GENERATED_CONSUMER_DIRECTORIES = ['.opencode'];
const GENERATED_OPEN_CODE_REFERENCES = new Map([
  ['.opencode/agents/auditor.md', 2],
  ['.opencode/agents/engineer.md', 2],
  ['.opencode/agents/maintainer.md', 2],
  ['.opencode/agents/orchestrator.md', 6],
  ['.opencode/commands/agenticloop.md', 2],
]);
const EXPECTED_REFERENCES = new Map([
  ['agents/auditor.md', { count: 1, owner: 'path convention' }],
  ['agents/engineer.md', { count: 1, owner: 'Project Operating Facts' }],
  ['agents/maintainer.md', { count: 1, owner: 'Project Operating Facts' }],
  ['agents/orchestrator.md', { count: 5, owner: 'path convention, Advance Authorization Boundary, and Project Operating Facts' }],
  ['backends/README.md', { count: 1, owner: 'methodology index' }],
  ['commands/lifecycle-protocol.md', { count: 1, owner: 'methodology index' }],
  ['commands/start.md', { count: 2, owner: 'path convention and Lifecycle At A Glance' }],
  ['docs/codex-setup.md', { count: 2, owner: 'installed Codex orientation' }],
  ['docs/copilot-setup.md', { count: 1, owner: 'installed Copilot orientation' }],
  ['docs/cursor-setup.md', { count: 2, owner: 'installed Cursor orientation' }],
  ['docs/downstream-adoption.md', { count: 3, owner: 'downstream toolkit orientation' }],
  ['docs/getting-started.md', { count: 1, owner: 'dispatch recognition routing' }],
  ['docs/opencode-setup.md', { count: 1, owner: 'installed OpenCode orientation' }],
  ['docs/workflow-examples.md', { count: 3, owner: 'downstream workflow examples' }],
  ['memory/README.md', { count: 1, owner: 'Project Operating Facts guidance' }],
  ['memory/scaffold/README.md', { count: 3, owner: 'installed toolkit scaffold' }],
  ['memory/scaffold/project.md', { count: 3, owner: 'target project scaffold' }],
  ['README.md', { count: 8, owner: 'public methodology orientation' }],
  ['skills/debugging-before-fixes/SKILL.md', { count: 0, owner: 'Lifecycle Protocol: Attempt And Review Budgets' }],
  ['skills/decision-capture/SKILL.md', { count: 1, owner: 'Project Operating Facts' }],
  ['skills/event-logging/SKILL.md', { count: 0, owner: 'event-logging CLI implementation' }],
  ['skills/parallel-delegation/SKILL.md', { count: 1, owner: 'Project Operating Facts' }],
  ['skills/review-and-accept/SKILL.md', { count: 0, owner: 'review-checkpoint implementation' }],
  ['skills/role-delegation/SKILL.md', { count: 2, owner: 'Advance Authorization Boundary and Context Read Discipline' }],
  ['skills/setup-agenticloop/SKILL.md', { count: 1, owner: 'process document selection' }],
  ['skills/task-closeout/SKILL.md', { count: 0, owner: 'worktree CLI reference' }],
  ['skills/task-record-contract/SKILL.md', { count: 0, owner: 'Lifecycle Protocol: Attempt And Review Budgets' }],
  ['skills/work-unit-audit/SKILL.md', { count: 0, owner: 'Lifecycle Protocol: Attempt And Review Budgets' }],
  ['src/layout.js', { count: 4, owner: 'installed process-document layout' }],
  ['src/review-provenance.js', { count: 1, owner: 'delegation-mode vocabulary' }],
]);

const STALE_ROUTE = /AGENTIC_LOOP\.md[^\n]*(?:\bglossary\b|\bworktree(?: cleanup)? lifecycle\b|\bGit rules\b|\bevent taxonomy\b|\blifecycle gates emit\b|\bsizing\b|\bauthorized-work-unit\b|\bReview Round Checkpoint\b|\bthree-lens review\b|\bparallel-scan provenance\b|\bAttempt Budget\b)/i;

function activeFiles(root, {
  directories = ACTIVE_CONSUMER_DIRECTORIES,
  files = ACTIVE_CONSUMER_FILES,
} = {}) {
  const collectedFiles = [];
  const visit = directory => {
    for (const entry of readdirSync(directory)) {
      const file = join(directory, entry);
      if (statSync(file).isDirectory()) visit(file);
      else if (ACTIVE_CONSUMER_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) collectedFiles.push(file);
    }
  };
  for (const directory of directories) visit(join(root, directory));
  for (const file of files) collectedFiles.push(join(root, file));
  return collectedFiles;
}

function inspectRoutes(root, surfaces) {
  const references = new Map();
  const stale = [];
  for (const file of activeFiles(root, surfaces)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const body = readFileSync(file, 'utf8');
    const count = [...body.matchAll(/(?:agenticloop\/)?AGENTIC_LOOP\.md/g)].length;
    if (count) references.set(rel, count);
    for (const [index, line] of body.split(/\r?\n/).entries()) {
      if (STALE_ROUTE.test(line)) stale.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  }
  return { references, stale };
}

describe('methodology route integrity', () => {
  it('routes every active AGENTIC_LOOP.md reference to a current canonical owner', () => {
    const { references, stale } = inspectRoutes(REPO_ROOT);
    assert.deepEqual(
      [...references.entries()].sort(([left], [right]) => left.localeCompare(right)),
      [...EXPECTED_REFERENCES.entries()]
        .filter(([, expected]) => expected.count > 0)
        .map(([path, expected]) => [path, expected.count])
        .sort(([left], [right]) => left.localeCompare(right)),
      'update the inventory and declare the canonical owner for every new active methodology reference'
    );
    assert.deepEqual(stale, [], `stale methodology routes:\n${stale.join('\n')}`);
  });

  it('routes every generated OpenCode consumer to a current canonical owner', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'agenticloop-generated-route-ratchet-'));
    try {
      const target = join(scratch, 'target');
      const output = join(scratch, 'generated');
      seedTargetLayout(REPO_ROOT, target, { includeDocs: false, includeScratch: false });
      generateOpencodeArtifacts(loadAgenticLoopConfig(join(target, 'agenticloop.json')), target, output);
      const { references, stale } = inspectRoutes(output, {
        directories: GENERATED_CONSUMER_DIRECTORIES,
        files: [],
      });
      assert.deepEqual(
        [...references.entries()].sort(([left], [right]) => left.localeCompare(right)),
        [...GENERATED_OPEN_CODE_REFERENCES.entries()].sort(([left], [right]) => left.localeCompare(right)),
        'update the generated inventory when a canonical source changes its methodology references',
      );
      assert.deepEqual(stale, [], `stale generated methodology routes:\n${stale.join('\n')}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a scratch stale route in a documentation consumer before it can reach users', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'agenticloop-route-ratchet-'));
    try {
      for (const directory of ACTIVE_CONSUMER_DIRECTORIES) {
        cpSync(join(REPO_ROOT, directory), join(scratch, directory), { recursive: true });
      }
      for (const file of ACTIVE_CONSUMER_FILES) cpSync(join(REPO_ROOT, file), join(scratch, file));
      const consumer = join(scratch, 'docs', 'getting-started.md');
      writeFileSync(consumer, `${readFileSync(consumer, 'utf8')}\nAGENTIC_LOOP.md owns sizing.\n`, 'utf8');
      assert.match(inspectRoutes(scratch).stale.join('\n'), /sizing/i);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
