/**
 * Decision records: a template, and a list for finding the ones that bear on
 * the work. The files stay authoritative; nothing here validates a decision or
 * decides which one governs.
 */

import fs from 'node:fs';
import path from 'node:path';

import { toolkitRoot } from './adapter-generation.js';
import { json, out, table } from './cli-io.js';
import { recordDirectory, recordFiles } from './generated.js';
import { DECISIONS_DIRECTORY } from './layout.js';
import { parseRecord, splitFrontmatter } from './record.js';
import { PublicError } from './public-error.js';
import { formatScalar, parseYaml, YamlError } from './yaml.js';

/** @param {string} root @param {string} title */
export function decisionNew(root, title) {
  if (!title || title.trim() === '') {
    throw new PublicError('a title is required', { hint: 'agenticloop decision new "Short decision title"' });
  }
  const directory = recordDirectory(root, DECISIONS_DIRECTORY, { create: true });

  let highest = 0;
  for (const file of recordFiles(root, DECISIONS_DIRECTORY)) {
    const record = parseRecord(fs.readFileSync(file, 'utf8'));
    const match = String(record.frontmatter.id ?? path.basename(file)).match(/(\d+)/);
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

/**
 * The frontmatter of a decision record, or why it could not be read. A task
 * record's field rules do not apply to a decision, so only the YAML is parsed.
 * @param {string} text
 * @returns {{frontmatter: Record<string, unknown>, error: string|null}}
 */
function decisionFrontmatter(text) {
  const { yaml } = splitFrontmatter(text);
  if (yaml === null) return { frontmatter: {}, error: 'the record has no --- delimited frontmatter' };
  try {
    const parsed = parseYaml(yaml);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { frontmatter: {}, error: 'frontmatter must be a mapping' };
    }
    return { frontmatter: /** @type {Record<string, unknown>} */ (parsed), error: null };
  } catch (error) {
    const message = error instanceof YamlError ? error.message : String(error);
    return { frontmatter: {}, error: `frontmatter could not be parsed: ${message}` };
  }
}

/** @param {unknown} value */
function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Every decision record, superseded ones included, with the status each one
 * records. A record whose frontmatter cannot be read is listed with the reason,
 * because no other command reports it.
 * @param {string} root @param {{json?: boolean}} [options]
 */
export function decisionList(root, options = {}) {
  const rows = [];
  for (const file of recordFiles(root, DECISIONS_DIRECTORY)) {
    const { frontmatter, error } = decisionFrontmatter(fs.readFileSync(file, 'utf8'));
    rows.push({
      id: text(frontmatter.id) || path.basename(file, '.md'),
      status: error ? null : text(frontmatter.status) || null,
      date: text(frontmatter.date),
      title: text(frontmatter.title),
      path: path.relative(root, file),
      error,
    });
  }
  if (options.json) {
    json(rows);
    return rows;
  }
  if (rows.length === 0) {
    out(`no decision records in ${DECISIONS_DIRECTORY}/`);
    return rows;
  }
  table([
    ['ID', 'STATUS', 'DATE', 'TITLE'],
    ...rows.map((row) => [row.id, row.error ? 'unreadable' : row.status ?? 'unknown', row.date, row.title]),
  ]);
  for (const row of rows.filter((entry) => entry.error)) out(`\n${row.path}: ${row.error}`);
  return rows;
}
