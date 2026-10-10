/**
 * `task add`: append one candidate, evidence, or assessment entry to a task
 * record's frontmatter list.
 *
 * A convenience over editing the YAML by hand, which stays equally valid. It
 * decides nothing an agent would not: every value is the one given, nothing is
 * attributed that was not named, and an entry names a candidate already
 * recorded. What it adds is a correct entry, the record's own formatting kept,
 * checked in memory before the record is replaced under its lock.
 */

import { isDeepStrictEqual } from 'node:util';

import { out } from './cli-io.js';
import { PublicError } from './public-error.js';
import { RECORD_YAML, recordEntries, recordValueText, RESULTS, ROLE_IDS, VERDICTS } from './record.js';
import { findRecord } from './task-cli.js';
import { readTask, replaceRecord, withRecordLock } from './task-record-io.js';
import { formatScalar, parseYaml } from './yaml.js';

/**
 * The fields each kind of entry takes, in the order they are written, and the
 * ones it requires. The order follows docs/record-format.md.
 */
const KINDS = Object.freeze({
  candidate: { list: 'candidates', fields: ['ref', 'producers', 'note', 'host', 'model', 'at'], required: ['ref'] },
  evidence: { list: 'evidence', fields: ['check', 'candidate', 'result', 'command', 'exit_code', 'actor', 'host', 'model', 'at', 'output'], required: ['check', 'candidate', 'result'] },
  assessment: { list: 'assessments', fields: ['candidate', 'role', 'actor', 'verdict', 'host', 'model', 'at', 'findings'], required: ['candidate', 'role', 'verdict'] },
});

/** @param {string} message @param {string} [hint] */
const refuse = (message, hint = 'Nothing was written.') => new PublicError(message, { hint });

/**
 * Read `key=value` arguments into the entry they describe, typed as the record
 * format types them.
 * @param {keyof typeof KINDS} kind
 * @param {string[]} pairs
 * @param {Date} now the clock `at=now` reads
 * @returns {Record<string, unknown>}
 */
export function entryFromPairs(kind, pairs, now = new Date()) {
  const spec = KINDS[kind];
  /** @type {Record<string, string>} */
  const given = Object.create(null);
  for (const pair of pairs) {
    const split = pair.indexOf('=');
    if (split <= 0) throw refuse(`${pair} is not key=value`, `castwork task add T-001 ${kind} ${spec.required.map((key) => `${key}=...`).join(' ')}. Nothing was written.`);
    const key = pair.slice(0, split);
    const value = pair.slice(split + 1);
    if (!spec.fields.includes(key)) throw refuse(`${kind} takes no field ${key}`, `Fields: ${spec.fields.join(', ')}. Nothing was written.`);
    if (Object.hasOwn(given, key)) throw refuse(`${key} is given twice`);
    if (value.trim() === '') throw refuse(`${key} is empty; leave out a field you do not know`);
    given[key] = value;
  }
  const missing = spec.required.filter((key) => !Object.hasOwn(given, key));
  if (missing.length > 0) throw refuse(`${kind} needs ${missing.join(', ')}`);

  /** @type {Record<string, unknown>} */
  const entry = Object.create(null);
  for (const key of spec.fields) {
    if (!Object.hasOwn(given, key)) continue;
    const value = given[key];
    if (key === 'producers') {
      const producers = value.split(',').map((producer) => producer.trim());
      if (producers.some((producer) => producer === '')) throw refuse('producers has a blank entry', 'Separate actors with commas, as in producers=worker@claude,worker@codex. Nothing was written.');
      entry[key] = producers;
    } else if (key === 'exit_code') {
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw refuse(`exit_code ${value} is not an integer`);
      entry[key] = Number(value);
    } else if (key === 'at' && value === 'now') {
      entry[key] = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    } else {
      entry[key] = value;
    }
  }
  const allowed = { result: RESULTS, verdict: VERDICTS, role: ROLE_IDS };
  for (const [key, values] of Object.entries(allowed)) {
    if (Object.hasOwn(entry, key) && !values.includes(/** @type {string} */ (entry[key]))) {
      throw refuse(`${key} ${recordValueText(entry[key])} is not one of ${values.join(', ')}`);
    }
  }
  return entry;
}

/**
 * The entry as YAML list item lines at the given indent.
 * @param {Record<string, unknown>} entry @param {number} indent @param {string} eol
 */
function renderEntry(entry, indent, eol) {
  const pad = ' '.repeat(indent);
  return Object.entries(entry).map(([key, value], index) => {
    const text = Array.isArray(value) ? `[${value.map((item) => formatScalar(item)).join(', ')}]`
      : typeof value === 'number' ? String(value) : formatScalar(/** @type {string} */ (value));
    return `${pad}${index === 0 ? '- ' : '  '}${key}: ${text}`;
  }).join(eol);
}

/**
 * Append the entry to the named top-level block list in the frontmatter text.
 * A list written in flow style, or a key holding something other than a list,
 * is left for a hand edit.
 * @param {string} yaml @param {string} list @param {Record<string, unknown>} entry @param {string} eol
 */
function appendToList(yaml, list, entry, eol) {
  const rows = [];
  for (let start = 0; ;) {
    const newline = yaml.indexOf('\n', start);
    const stop = newline === -1 ? yaml.length : newline;
    rows.push({ start, end: stop > start && yaml[stop - 1] === '\r' ? stop - 1 : stop, text: yaml.slice(start, stop).replace(/\r$/, '') });
    if (newline === -1) break;
    start = newline + 1;
  }
  const key = rows.findIndex((row) => row.text.startsWith(`${list}:`));
  if (key === -1) return `${yaml}${eol}${list}:${eol}${renderEntry(entry, 2, eol)}`;
  if (!/^[ \t]*(?:#.*)?$/.test(rows[key].text.slice(list.length + 1))) {
    throw refuse(`${list} is not written as a block list`, `Edit the record to add this entry, or rewrite ${list} with one "- " item per line. Nothing was written.`);
  }
  // The list runs while lines are indented, blank, or items at column 0.
  let last = key;
  let indent = null;
  for (let i = key + 1; i < rows.length; i += 1) {
    const text = rows[i].text;
    if (text.trim() === '') continue;
    if (!/^[ \t]/.test(text) && !/^-(?:[ \t]|$)/.test(text)) break;
    const item = /^( *)-(?:[ \t]|$)/.exec(text);
    if (item && indent === null) indent = item[1].length;
    last = i;
  }
  return `${yaml.slice(0, rows[last].end)}${eol}${renderEntry(entry, indent ?? 2, eol)}${yaml.slice(rows[last].end)}`;
}

/**
 * Append one entry to a task record, under its lock.
 * @param {string} root
 * @param {string} id
 * @param {string} kind candidate, evidence, or assessment
 * @param {string[]} pairs key=value arguments
 * @param {{now?: Date}} [options]
 */
export function taskAdd(root, id, kind, pairs, options = {}) {
  if (!id || !kind) throw refuse('a task id and an entry kind are required', 'castwork task add T-001 evidence check=test candidate=<ref> result=pass. Nothing was written.');
  if (!Object.hasOwn(KINDS, kind)) throw refuse(`unknown entry kind ${kind}`, `Known: ${Object.keys(KINDS).join(', ')}. Nothing was written.`);
  const spec = KINDS[/** @type {keyof typeof KINDS} */ (kind)];
  const entry = entryFromPairs(/** @type {keyof typeof KINDS} */ (kind), pairs, options.now);
  const { file } = findRecord(root, id);

  return withRecordLock(file, () => {
    // Read again under the lock: another command may have written it meanwhile.
    const { record, text } = readTask(root, file);
    if (kind !== 'candidate') {
      const recorded = recordEntries(record).candidates.map((candidate) => recordValueText(candidate.ref));
      if (!recorded.includes(/** @type {string} */ (entry.candidate))) {
        throw refuse(`${id} records no candidate ${recordValueText(entry.candidate)}`, 'Name a ref from candidates, exactly as recorded, or add the candidate first. Nothing was written.');
      }
    }

    const match = text.match(/^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n)(---[ \t]*(?:\r?\n|$))/);
    if (!match) throw refuse(`${id} has no --- delimited frontmatter`);
    const [whole, open, yaml, eol, close] = match;
    /** @type {unknown} */
    let before = null;
    try {
      // Read as every reader reads it: with the line break before the closing ---.
      before = parseYaml(`${yaml}${eol}`, RECORD_YAML);
    } catch {
      // Reported below.
    }
    if (before === null || typeof before !== 'object' || Array.isArray(before)) throw refuse(`${id}'s frontmatter cannot be read, so the write could not be checked`, 'Edit the record by hand instead. Nothing was written.');
    const prior = /** @type {Record<string, unknown>} */ (before);
    if (prior[spec.list] !== undefined && prior[spec.list] !== null && !Array.isArray(prior[spec.list])) throw refuse(`${spec.list} is not a list`, 'Edit the record by hand instead. Nothing was written.');

    const nextYaml = appendToList(yaml, spec.list, entry, eol);
    /** @type {Record<string, unknown>} */
    let after;
    try {
      after = /** @type {Record<string, unknown>} */ (parseYaml(`${nextYaml}${eol}`, RECORD_YAML));
    } catch (error) {
      throw refuse(`adding the entry would leave the frontmatter unreadable: ${error instanceof Error ? error.message : String(error)}`, 'Edit the record by hand instead. Nothing was written.');
    }
    const others = (/** @type {Record<string, unknown>} */ map) => Object.keys(map).filter((key) => key !== spec.list);
    const list = /** @type {unknown[]} */ (prior[spec.list] ?? []);
    const preserved = isDeepStrictEqual(after[spec.list], [...list, entry]) && isDeepStrictEqual(others(prior), others(after)) &&
      others(prior).every((key) => isDeepStrictEqual(prior[key], after[key]));
    if (!preserved) throw refuse(`adding the entry would change more than ${spec.list}`, 'Edit the record by hand instead. Nothing was written.');

    replaceRecord(file, `${open}${nextYaml}${eol}${close}${text.slice(whole.length)}`);
    out(`${id}: added ${spec.list}[${list.length}]`);
    return { file, list: spec.list, index: list.length, entry };
  });
}
