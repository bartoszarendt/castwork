/** Task/paired archive reads, and the locked writes of a task record. Filesystem work stays outside the pure parser. */
import fs from 'node:fs';
import path from 'node:path';
import {installPath, recordDirectory} from './generated.js';
import {ARCHIVE_SUFFIX, TASKS_DIRECTORY} from './layout.js';
import {parseRecord} from './record.js';
import {PublicError} from './public-error.js';
import {err} from './cli-io.js';

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
    // The archive exists and could not be read; that is the error to report,
    // not that the pointer names an archive the parser never saw.
    record.errors = record.errors.filter((error) => error.code !== 'archive.missing');
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

/** How long a writer waits for another castwork command writing the same record. */
const LOCK_WAIT_MS = 10000;

/**
 * Run one read-modify-write of a task record while holding its lock file, and
 * replace the record in one rename. Every castwork command that writes a task
 * record's frontmatter takes this lock, so two of them never interleave and
 * neither loses the other's entry. An edit made by hand, outside castwork,
 * while a command writes is not covered.
 * @template T
 * @param {string} file the task record
 * @param {() => T} write reads, checks and replaces the record; throwing first writes nothing
 * @returns {T}
 */
export function withRecordLock(file, write) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let handle = null;
  while (handle === null) {
    try {
      handle = fs.openSync(lock, 'wx');
    } catch (error) {
      const code = error instanceof Error ? /** @type {NodeJS.ErrnoException} */ (error).code : undefined;
      // On Windows a lock another command is deleting reads as EPERM until it
      // is gone: held, for this purpose, rather than an error.
      const held = code === 'EEXIST' || (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES'));
      if (!held) throw error;
      if (Date.now() > deadline) {
        // No lock file at all means nothing holds it: the folder refused it.
        if (code !== 'EEXIST' && !fs.existsSync(lock)) {
          throw new PublicError(`${path.basename(lock)} could not be created: ${error instanceof Error ? error.message : String(error)}`, {
            hint: 'Check that the tasks folder can be written. Nothing was written.',
          });
        }
        throw new PublicError(`${path.basename(file)} is being written by another castwork command`, {
          hint: `If none is running, a stopped one left ${path.basename(lock)} behind; remove it and try again. Nothing was written.`,
        });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return write();
  } finally {
    fs.closeSync(handle);
    releaseLock(lock);
  }
}

/**
 * Remove a lock after its write. A scanner or indexer on Windows can hold the
 * file for a moment, so removal is retried; failing that, the write still
 * stands, and only a warning says the lock is left, rather than a failure that
 * would invite running the same command, and adding the same entry, again.
 * @param {string} lock
 */
function releaseLock(lock) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      fs.rmSync(lock, {force: true});
      return;
    } catch (error) {
      if (Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        continue;
      }
      err(`warning: ${path.basename(lock)} could not be removed (${error instanceof Error ? error.message : String(error)}); remove it before the next castwork write to this record`);
      return;
    }
  }
}

/**
 * Replace a record's bytes in one rename from a temporary file beside it, so
 * a reader never sees half a record. The temporary name does not end in `.md`.
 * @param {string} file @param {string} text
 */
export function replaceRecord(file, text) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, text, 'utf8');
  // Windows refuses to rename over a file another process has open, even just
  // to read it, as a command that takes no lock may; that clears in moments.
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      fs.renameSync(temporary, file);
      return;
    } catch (error) {
      const code = error instanceof Error ? /** @type {NodeJS.ErrnoException} */ (error).code : undefined;
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        continue;
      }
      fs.rmSync(temporary, {force: true});
      throw error;
    }
  }
}
