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

import { recordEntries } from './record.js';

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

  for (const entry of [...evidence, ...assessments]) {
    const link = entry.output ?? entry.findings;
    if (typeof link !== 'string') continue;
    if (link.includes('\n') || link.startsWith('#') || link.startsWith('/')) continue;
    if (!/^[.\w][\w./-]*\.[A-Za-z0-9]+$/.test(link)) continue;
    const base = record.path ? path.dirname(record.path) : root;
    files[link] = fs.existsSync(path.resolve(base, link));
  }

  return { refs, files };
}
