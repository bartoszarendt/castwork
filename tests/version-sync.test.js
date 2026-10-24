/**
 * One version, stated alike wherever the repository states it: the package,
 * its lockfile, the Claude Code plugin and marketplace manifests, the status
 * lines, and a changelog heading. A bump changes them together.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { packageVersion, toolkitRoot } from '../src/adapter-generation.js';

/** @param {string} relative */
function read(relative) {
  return fs.readFileSync(path.join(toolkitRoot(), relative), 'utf8').replace(/\r\n/g, '\n');
}

/** @param {string} relative */
function json(relative) {
  return JSON.parse(read(relative));
}

const version = packageVersion();

test('the lockfile and both plugin manifests state the package version', () => {
  const lock = json('package-lock.json');
  assert.equal(lock.version, version, 'package-lock.json');
  assert.equal(lock.packages[''].version, version, 'package-lock.json packages[""]');
  assert.equal(json('.claude-plugin/plugin.json').version, version, '.claude-plugin/plugin.json');
  const listed = json('.claude-plugin/marketplace.json').plugins.find((/** @type {{name: string}} */ plugin) => plugin.name === 'castwork');
  assert.ok(listed, 'marketplace.json lists castwork');
  assert.equal(listed.version, version, '.claude-plugin/marketplace.json');
});

test('every status line names the package version as current', () => {
  const lines = {
    'AGENTS.md': /\*\*Status:\*\* version (\S+) is current\./,
    'CASTWORK.md': /\*\*Status:\*\* version (\S+) is current\./,
    'README.md': /Version (\S+) is\s+(?:>\s*)?current\./,
    'docs/downstream-adoption.md': /\*\*Status:\*\* (\S+) is current\./,
  };
  for (const [file, pattern] of Object.entries(lines)) {
    const match = read(file).match(pattern);
    assert.ok(match, `${file} has a status line`);
    assert.equal(match[1], version, file);
  }
});

test('the changelog has a heading for the package version, below Unreleased at most', () => {
  const headings = [...read('CHANGELOG.md').matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
  assert.ok(headings.includes(version), `CHANGELOG.md has ## ${version}`);
  const top = headings[0] === 'Unreleased' ? headings[1] : headings[0];
  assert.equal(top, version, 'the newest released heading is the package version');
});
