import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMAND_PATHS, parseArgs } from '../src/cli-main.js';
import { writeFrontmatterField } from '../src/task-cli.js';

test('the CLI declares exactly sixteen command paths', () => {
  assert.equal(COMMAND_PATHS.length, 16);
});

test('every command path is kebab-case', () => {
  for (const entry of COMMAND_PATHS) {
    assert.match(entry.path, /^[a-z]+(?: [a-z]+(?:-[a-z]+)*)?$/, `${entry.path} is not kebab-case`);
  }
});

test('no removed command is reachable', () => {
  const paths = COMMAND_PATHS.map((entry) => entry.path);
  for (const removed of ['activate', 'audit', 'closeout', 'hydrate', 'init', 'worktree', 'improvement', 'guidance', 'status', 'task explain']) {
    assert.ok(!paths.includes(removed), `${removed} should not exist`);
  }
});

test('parseArgs collects positionals, flags, and repeatable options', () => {
  const parsed = parseArgs(['task', 'lint', 'T-1', '--json', '--host', 'codex', '--host=opencode', '--force-generated', 'a.md']);
  assert.deepEqual(parsed.positionals, ['task', 'lint', 'T-1']);
  assert.equal(parsed.flags.json, true);
  assert.deepEqual(parsed.hosts, ['codex', 'opencode']);
  assert.deepEqual(parsed.force, ['a.md']);
});

test('writeFrontmatterField replaces one field and leaves the rest byte for byte', () => {
  const text = '---\nschema: 1\nid: T-1\n# a comment\nstatus: draft\n---\n\n## Intent\nkeep me\n';
  const next = writeFrontmatterField(text, 'status', 'in_review');
  assert.ok(next.includes('status: in_review'));
  assert.ok(next.includes('# a comment'));
  assert.ok(next.includes('## Intent\nkeep me'));
  assert.ok(!next.includes('status: draft'));
});

test('writeFrontmatterField appends a field that is absent', () => {
  const text = '---\nschema: 1\nid: T-1\nstatus: draft\n---\n\nbody\n';
  const next = writeFrontmatterField(text, 'title', 'Hello');
  assert.ok(next.includes('title: Hello'));
  assert.ok(next.includes('body'));
});
