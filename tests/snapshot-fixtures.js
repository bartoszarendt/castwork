/**
 * Shared fixtures for the snapshot tests, which are split across files so the
 * test runner can run them side by side: each test builds its own repository
 * and spends most of its time waiting on git.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { referenceAvailability } from '../src/checks.js';
import { observe } from '../src/observations.js';
import { parseRecord } from '../src/record.js';
import { setup } from '../src/setup.js';

export { runCli as cli } from './cli-in-process.js';

export const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'castwork.js');

export function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A repository with one commit and Castwork installed. */
export function repository(t, { commit = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-snapshot-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.log\n', 'utf8');
  fs.writeFileSync(path.join(root, 'app.txt'), 'one\n', 'utf8');
  setup(root, { hosts: ['codex'] });
  if (commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'base');
  }
  return root;
}

/** Everything a snapshot or a lint must leave alone. */
export function state(root) {
  const gitDir = path.join(root, '.git');
  const objects = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else objects.push(path.relative(gitDir, full));
    }
  };
  walk(path.join(gitDir, 'objects'));
  return {
    index: fs.existsSync(path.join(gitDir, 'index')) ? fs.readFileSync(path.join(gitDir, 'index')).toString('base64') : null,
    head: fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8'),
    refs: git(root, 'for-each-ref'),
    // Without --no-optional-locks, status itself may rewrite the real index.
    status: git(root, '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all'),
    app: fs.readFileSync(path.join(root, 'app.txt'), 'utf8'),
    objects: objects.sort(),
  };
}

/** Every file under `.git`, with its bytes. */
export function gitDirectory(root) {
  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(path.join(root, '.git'));
  return files;
}

/** @param {string} root @param {string} candidates */
export function writeTask(root, candidates) {
  fs.writeFileSync(
    path.join(root, '.castwork', 'tasks', 'T-001.md'),
    `---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n${candidates}---\n\n## Intent\nx\n`,
    'utf8',
  );
}

/** @param {string} root @param {string} candidates */
export function references(root, candidates) {
  const record = parseRecord(`---\nschema: 1\nid: T-001\ntitle: t\nstatus: in_review\ncandidates:\n${candidates}---\n`);
  return referenceAvailability(record, observe(record, root));
}
