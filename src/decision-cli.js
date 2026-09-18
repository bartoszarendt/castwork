/** Decision records: a template and nothing more. */

import fs from 'node:fs';
import path from 'node:path';

import { toolkitRoot } from './adapter-generation.js';
import { out } from './cli-io.js';
import { DECISIONS_DIRECTORY } from './layout.js';
import { parseRecord } from './record.js';
import { PublicError } from './public-error.js';
import { formatScalar } from './yaml.js';

/** @param {string} root @param {string} title */
export function decisionNew(root, title) {
  if (!title || title.trim() === '') {
    throw new PublicError('a title is required', { hint: 'agenticloop decision new "Short decision title"' });
  }
  const directory = path.join(root, DECISIONS_DIRECTORY);
  if (!fs.existsSync(directory)) {
    throw new PublicError(`${DECISIONS_DIRECTORY}/ does not exist`, { hint: 'Run setup first.' });
  }

  let highest = 0;
  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.md'))) {
    const record = parseRecord(fs.readFileSync(path.join(directory, name), 'utf8'));
    const match = String(record.frontmatter.id ?? name).match(/(\d+)/);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const id = `D-${String(highest + 1).padStart(3, '0')}`;

  const template = fs.readFileSync(path.join(toolkitRoot(), 'memory', 'decision-record.md'), 'utf8');
  const content = template
    .replace(/^id: .*$/m, `id: ${formatScalar(id)}`)
    .replace(/^title: .*$/m, `title: ${formatScalar(title.trim())}`)
    .replace(/^date: .*$/m, `date: ${new Date().toISOString().slice(0, 10)}`);

  const file = path.join(directory, `${id}.md`);
  if (fs.existsSync(file)) throw new PublicError(`${file} already exists`);
  fs.writeFileSync(file, content, 'utf8');
  out(`created ${path.relative(root, file)}`);
  return file;
}
