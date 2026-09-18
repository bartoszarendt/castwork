/**
 * Local observations, gathered by the CLI and handed to the pure checks.
 *
 * Optional and local only. Nothing is fetched from a remote. When gathering is
 * skipped the checks report `not_checked`, which is a different thing from
 * `unavailable`.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { isRelativePath } from './checks.js';
import { recordEntries } from './record.js';

/** @param {string} target */
function realpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/**
 * Does this reference resolve in the local repository?
 * @param {string} root
 * @param {string} ref
 */
function refResolves(root, ref) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gather what can be observed locally about one record.
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} root
 * @returns {import('./checks.js').Observations}
 */
export function observe(record, root) {
  const { candidates, evidence, assessments } = recordEntries(record);
  /** @type {Record<string, boolean>} */
  const refs = {};
  /** @type {Record<string, boolean>} */
  const files = {};

  let isRepository = true;
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    isRepository = false;
  }

  for (const candidate of candidates) {
    const ref = candidate.ref === undefined || candidate.ref === null ? '' : String(candidate.ref);
    if (ref === '') continue;
    refs[ref] = isRepository ? refResolves(root, ref) : false;
  }

  const realRoot = realpath(path.resolve(root)) ?? path.resolve(root);
  for (const entry of [...evidence, ...assessments]) {
    const link = entry.output ?? entry.findings;
    if (typeof link !== 'string' || !isRelativePath(link)) continue;
    // Linked paths are repository-root relative, which is why no `..` is
    // needed and none is accepted. Resolving against the record's own directory
    // would have required traversal to reach anything useful, and traversal is
    // what lets a record ask whether an arbitrary file exists on the machine
    // running the checks.
    const resolved = path.resolve(realRoot, link);
    if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) continue;
    files[link] = fs.existsSync(resolved);
  }

  return { refs, files };
}
