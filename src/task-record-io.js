/** Task/paired archive reads. Filesystem work stays outside the pure parser. */
import fs from 'node:fs';
import path from 'node:path';
import {installPath, recordDirectory} from './generated.js';
import {ARCHIVE_SUFFIX, TASKS_DIRECTORY} from './layout.js';
import {parseRecord} from './record.js';

/** @param {string} file */
export const archivePath = file => file.slice(0, -3) + ARCHIVE_SUFFIX;

/** Containment plus leaf realpath checks, also used immediately before writes.
 * @param {string} root @param {string} file @param {typeof fs} [io]
 */
export function safeTaskPath(root, file, io = fs) {
  return checkedLeaf(installPath(root, path.relative(root, file)), io);
}

/** The caller already validated the shared parent; still check leaf AND destination. */
function checkedLeaf(target, io = fs) {
  const file = target;
  const stat = io.lstatSync(target, {throwIfNoEntry: false});
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error(`symbolic link or junction: ${file}`);
    if (!stat.isFile()) throw new Error(`not a regular task file: ${file}`);
    if (path.relative(target, io.realpathSync.native(target)) !== '') throw new Error(`redirected task path: ${file}`);
  }
  return target;
}

/** @param {string} root @param {string} file @param {{path?: string,text?: string,checked_directory?: string}} [options] */
export function readTask(root, file, options = {}) {
  const sharedParent = options.checked_directory === path.dirname(file);
  const safeFile = sharedParent ? file : safeTaskPath(root, file);
  const text = options.text ?? fs.readFileSync(sharedParent ? checkedLeaf(safeFile) : safeFile, 'utf8');
  const paired = archivePath(file);
  let archiveText = null, archiveError = null;
  try {
    const safe = sharedParent ? checkedLeaf(paired) : safeTaskPath(root, paired);
    if (fs.lstatSync(safe, {throwIfNoEntry: false})) archiveText = fs.readFileSync(safe, 'utf8');
  } catch (error) { archiveError = error instanceof Error ? error.message : String(error); }
  const displayPath = options.path ?? file;
  const displayArchive = archivePath(displayPath);
  const record = parseRecord(text, {path: displayPath, ...(archiveText === null ? {} : {archive: {text: archiveText, path: displayArchive}})});
  if (archiveError) {
    const diagnostic = {code: 'archive.read_failed', message: `${displayArchive}: ${archiveError}`, path: displayArchive};
    record.errors.push(diagnostic);
    record.archive = {path: displayArchive, frontmatter: {}, body: '', body_line: 1, errors: [diagnostic]};
  }
  return {file, text, archive_text: archiveText, archive_path: paired, record};
}

/** Orphans never enter the task corpus or numbering.
 * @param {string} root
 */
export function orphanArchives(root, options = {}) {
  const directory = options.directory ?? recordDirectory(root, TASKS_DIRECTORY);
  if (!fs.existsSync(directory)) return [];
  const names = options.names ?? fs.readdirSync(directory);
  const tasks = new Set(names.filter(name => {
    if (!name.endsWith('.md') || name.endsWith(ARCHIVE_SUFFIX)) return false;
    try { const stat = fs.lstatSync(path.join(directory, name)); return !stat.isSymbolicLink() && stat.isFile(); }
    catch { return true; } // main enumeration names the unreadable primary; not an orphan
  }));
  return names.filter(name => name.endsWith(ARCHIVE_SUFFIX) && !tasks.has(name.slice(0, -ARCHIVE_SUFFIX.length) + '.md'))
    .sort().map(name => ({code: 'archive.orphan', path: `${TASKS_DIRECTORY}/${name}`, message: 'archive has no paired task record'}));
}
