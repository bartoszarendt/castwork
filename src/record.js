/**
 * Task record parsing: frontmatter plus recognized body headings.
 *
 * Parsing is separate from checking. This module reports what a record says;
 * `checks.js` reports what that means. Neither performs I/O.
 */

import { parseYaml, YamlError } from './yaml.js';

/** Recognized status values. Progress, not a transition graph. */
export const STATUS_VALUES = Object.freeze([
  'draft',
  'agent_ready',
  'in_progress',
  'in_review',
  'needs_revision',
  'blocked',
  'needs_context',
  'done',
  'cancelled',
]);

/** Recognized requirement kinds. A new kind needs a real consumer. */
export const REQUIREMENT_KINDS = Object.freeze(['checks', 'independent_review', 'assessment_roles']);

/** The four canonical role ids. */
export const ROLE_IDS = Object.freeze(['coordinator', 'thinker', 'worker', 'verifier']);

/** Recognized assessment verdicts. */
export const VERDICTS = Object.freeze(['accept', 'reject', 'needs_revision']);

/** Recognized evidence results. */
export const RESULTS = Object.freeze(['pass', 'fail']);

/** Recognized body headings. Any other heading is permitted. */
export const RECOGNIZED_HEADINGS = Object.freeze([
  'Intent',
  'Scope',
  'Out of scope',
  'Acceptance criteria',
  'Blockers and decisions',
]);

/** Frontmatter fields the format recognizes. Others are informational. */
export const RECOGNIZED_FIELDS = Object.freeze([
  'schema',
  'id',
  'title',
  'status',
  'depends_on',
  'allowed_paths',
  'requirements',
  'candidates',
  'evidence',
  'assessments',
]);

const REQUIRED_FIELDS = Object.freeze(['schema', 'id', 'title', 'status']);

/**
 * Safe conversion at the check/diagnostic boundary. Preserve the existing
 * scalar and array comparisons; YAML mappings have no primitive conversion.
 * This never changes the recorded frontmatter values.
 * @param {unknown} value
 * @returns {string}
 */
export function recordValueText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item == null ? '' : recordValueText(item)).join(',');
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * @typedef {{code: string, message: string, field?: string, index?: number}} Diagnostic
 */

/**
 * @typedef {object} ParsedRecord
 * @property {Record<string, unknown>} frontmatter
 * @property {string} body
 * @property {{heading: string, level: number}[]} headings
 * @property {Diagnostic[]} errors      structural errors
 * @property {Diagnostic[]} info        informational notes
 * @property {string|null} path
 */

/**
 * Split `---` delimited frontmatter from the body.
 * @param {string} text
 * @returns {{yaml: string|null, body: string}}
 */
export function splitFrontmatter(text) {
  const normalized = text.replace(/^﻿/, '');
  if (!/^---\s*\r?\n/.test(normalized)) return { yaml: null, body: normalized };
  const rest = normalized.slice(normalized.indexOf('\n') + 1);
  const match = rest.match(/^---[ \t]*(\r?\n|$)/m);
  if (!match || match.index === undefined) return { yaml: null, body: normalized };
  return {
    yaml: rest.slice(0, match.index),
    body: rest.slice(match.index + match[0].length),
  };
}

/** @param {string} body */
function collectHeadings(body) {
  const headings = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (match) headings.push({ heading: match[2], level: match[1].length });
  }
  return headings;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Diagnostic[]} errors
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function push(errors, code, message, extra = {}) {
  errors.push({ code, message, ...extra });
}

/**
 * @param {Diagnostic[]} errors
 * @param {Record<string, unknown>} frontmatter
 * @param {string} field
 * @param {string[]} required
 * @param {Record<string, string[]>} enums
 */
function validateEntries(errors, frontmatter, field, required, enums) {
  const value = frontmatter[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    push(errors, 'field.not_a_list', `${field} must be a list`, { field });
    return [];
  }
  const entries = [];
  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      push(errors, 'entry.not_a_mapping', `${field}[${index}] must be a mapping`, { field, index });
      return;
    }
    for (const key of required) {
      if (entry[key] === undefined || entry[key] === null || entry[key] === '') {
        push(errors, 'entry.missing_field', `${field}[${index}] is missing required field ${key}`, { field, index });
      }
    }
    for (const [key, allowed] of Object.entries(enums)) {
      const found = entry[key];
      if (found !== undefined && found !== null && !allowed.includes(recordValueText(found))) {
        push(errors, 'entry.unknown_value', `${field}[${index}].${key} is not one of ${allowed.join(', ')}`, { field, index });
      }
    }
    entries.push(entry);
  });
  return entries;
}

/** Above this, a record is reported as large: logs belong in linked files. */
export const LARGE_RECORD_BYTES = 100 * 1024;

/**
 * A reference that names one object and cannot move: a hex object id of 7 to
 * 64 digits, or a snapshot, `tree:` followed by one. `HEAD`, a branch, or a
 * label such as `worktree-T005` names whatever it points at today.
 * @param {string} ref
 */
export function isObjectId(ref) {
  return /^(tree:)?[0-9a-f]{7,64}$/i.test(ref);
}

/** The entry lists the checks read, which a body block cannot stand in for. */
const ENTRY_LISTS = Object.freeze(['candidates', 'evidence', 'assessments']);

/**
 * The fenced code blocks in a body, as CommonMark reads them: a fence opens
 * with three or more backticks or tildes, at any indentation so a block inside
 * a list item counts, and closes only with the same character, at least as
 * many of them, and nothing after them.
 *
 * @param {string} body
 * @returns {{language: string, lines: string[]}[]}
 */
function fencedBlocks(body) {
  const blocks = [];
  /** @type {{marker: string, language: string, lines: string[]}|null} */
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    if (open === null) {
      const start = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
      // A backtick fence's info string may not contain a backtick.
      if (start && !(start[1][0] === '`' && start[2].includes('`'))) {
        open = { marker: start[1], language: start[2].trim().split(/\s+/)[0].toLowerCase(), lines: [] };
      }
      continue;
    }
    const end = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (end && end[1][0] === open.marker[0] && end[1].length >= open.marker.length) {
      blocks.push({ language: open.language, lines: open.lines });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  return blocks;
}

/**
 * Entry-list keys at the top level of an unlabeled or YAML fenced block in the
 * body. Such a block reads like a record's entries and is never evaluated, so
 * a record kept that way lints as "no requirements declared" and reaches
 * `done` trivially.
 *
 * @param {string} body
 * @returns {string[]}
 */
function bodyEntryKeys(body) {
  const found = new Set();
  for (const block of fencedBlocks(body)) {
    if (!['', 'yaml', 'yml'].includes(block.language)) continue;
    const content = block.lines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    // The block's own left margin is its top level, wherever it is indented.
    const margin = Math.min(...content.map((line) => line.length - line.trimStart().length));
    for (const line of content) {
      const key = /^([a-z_]+):/.exec(line.slice(margin));
      if (key && line.length - line.trimStart().length === margin && ENTRY_LISTS.includes(key[1])) found.add(key[1]);
    }
  }
  return ENTRY_LISTS.filter((key) => found.has(key));
}

/** Words that make a variable name a secret's, as whole segments of it. */
const SECRET_WORDS = Object.freeze([['TOKEN'], ['SECRET'], ['PASSWORD'], ['PASSWD'], ['API', 'KEY'], ['APIKEY']]);

/** @param {string} name */
function isSecretName(name) {
  const segments = name.toUpperCase().split(/[_-]+/).filter((segment) => segment !== '');
  return SECRET_WORDS.some((word) => segments.some((_, start) => word.every((part, offset) => segments[start + offset] === part)));
}

/**
 * A value worth flagging: a literal, not a reference to one (`$NAME`,
 * `%NAME%`, `${NAME}`), a number, a boolean, or something already redacted.
 * @param {string} raw
 */
function isLiteralSecret(raw) {
  const value = /^(["'])(.*)\1$/.exec(raw)?.[2] ?? raw;
  if (value === '' || /^[$%<]/.test(value)) return false;
  if (/^-?\d+(\.\d+)?$/.test(value) || /^(on|off|true|false)$/i.test(value)) return false;
  return !value.includes('***');
}

/**
 * Whether a command carries a credential: a URL with a password in it, or a
 * secret-named variable or option assigned a literal. Deliberately narrow: a
 * false alarm costs a reader's attention, and a reference such as
 * `$DATABASE_URL` or `%TOKEN%` is exactly what to write.
 * @param {string} command
 */
export function carriesCredential(command) {
  for (const match of command.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s/@]+)@/gi)) {
    if (isLiteralSecret(match[1])) return true;
  }
  const assignment = /(?:^|[\s;&|(])(?:\$env:([A-Za-z_][\w-]*)\s*=\s*|(-{0,2}[A-Za-z_][\w-]*)=)("[^"]*"|'[^']*'|[^\s;&|)]+)/g;
  for (const match of command.matchAll(assignment)) {
    if (isSecretName(match[1] ?? match[2]) && isLiteralSecret(match[3])) return true;
  }
  return false;
}

/**
 * Notes on evidence entries that are well formed but unlikely to say what the
 * writer meant. Informational: none changes an outcome.
 *
 * @param {Record<string, unknown>} frontmatter
 * @param {Record<string, unknown>[]} evidence
 * @returns {Diagnostic[]}
 */
function entryNotes(frontmatter, evidence) {
  /** @type {Diagnostic[]} */
  const notes = [];
  const requirements = frontmatter.requirements;
  const declared = isPlainObject(requirements) && Array.isArray(requirements.checks) ? requirements.checks.map(recordValueText) : null;
  /** @type {Map<string, number[]>} */
  const undeclared = new Map();
  evidence.forEach((entry, index) => {
    const where = { field: 'evidence', index };
    const check = entry.check === undefined || entry.check === null ? '' : recordValueText(entry.check);
    if (declared !== null && check !== '' && !declared.includes(check)) {
      undeclared.set(check, [...(undeclared.get(check) ?? []), index]);
    }
    const command = typeof entry.command === 'string' ? entry.command : '';
    if (/\bcastwork(?:\.js)?\s+task\s+lint\b/.test(command)) {
      notes.push({
        code: 'evidence.lint_as_evidence',
        message: `evidence[${index}] records task lint, which reports on the record, not on the candidate`,
        ...where,
      });
    }
    if (carriesCredential(command)) {
      notes.push({
        code: 'evidence.credential_like',
        message: `evidence[${index}].command looks like it carries a credential; record the variable's name, never its value`,
        ...where,
      });
    }
  });
  // One note per name: a record with hundreds of such entries printed one
  // line for each.
  for (const [check, indexes] of undeclared) {
    const count = indexes.length === 1 ? `evidence[${indexes[0]}]` : `${indexes.length} evidence entries, from evidence[${indexes[0]}]`;
    notes.push({
      code: 'evidence.undeclared_check',
      message: `check ${check} (${count}) is not among requirements.checks (${/** @type {string[]} */ (declared).join(', ')}); a subset of a declared check goes under its own name, and only a declared name counts`,
      field: 'evidence',
      index: indexes[0],
    });
  }
  return notes;
}

/**
 * Parse one task record.
 * @param {string} text
 * @param {{path?: string}} [options]
 * @returns {ParsedRecord}
 */
export function parseRecord(text, options = {}) {
  /** @type {Diagnostic[]} */
  const errors = [];
  /** @type {Diagnostic[]} */
  const info = [];
  const { yaml, body } = splitFrontmatter(text);

  /** @type {Record<string, unknown>} */
  let frontmatter = {};
  let readable = false;
  if (yaml === null) {
    push(errors, 'frontmatter.missing', 'the record has no --- delimited frontmatter');
  } else {
    try {
      const parsed = parseYaml(yaml);
      if (!isPlainObject(parsed)) {
        push(errors, 'frontmatter.not_a_mapping', 'frontmatter must be a mapping');
      } else {
        frontmatter = parsed;
        readable = true;
      }
    } catch (error) {
      const message = error instanceof YamlError ? error.message : recordValueText(error);
      push(errors, 'frontmatter.unparseable', `frontmatter could not be parsed: ${message}`);
    }
  }

  // Frontmatter that could not be read has no fields to be missing. Reporting
  // every required field as absent buried the one error that mattered.
  for (const field of readable ? REQUIRED_FIELDS : []) {
    if (frontmatter[field] === undefined || frontmatter[field] === null || frontmatter[field] === '') {
      push(errors, 'field.missing', `required field ${field} is missing`, { field });
    }
  }

  if (frontmatter.schema !== undefined && frontmatter.schema !== null && !Number.isInteger(frontmatter.schema)) {
    push(errors, 'field.not_an_integer', 'schema must be an integer', { field: 'schema' });
  }

  const status = frontmatter.status;
  if (status !== undefined && status !== null && !STATUS_VALUES.includes(recordValueText(status))) {
    push(errors, 'status.unknown', `unknown status value ${recordValueText(status)}`, { field: 'status' });
  }

  for (const field of ['depends_on', 'allowed_paths']) {
    const value = frontmatter[field];
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      push(errors, 'field.not_a_list', `${field} must be a list`, { field });
    }
  }

  const requirements = frontmatter.requirements;
  if (requirements !== undefined && requirements !== null) {
    if (!isPlainObject(requirements)) {
      push(errors, 'requirements.not_a_mapping', 'requirements must be a mapping', { field: 'requirements' });
    } else {
      for (const kind of Object.keys(requirements)) {
        if (!REQUIREMENT_KINDS.includes(kind)) {
          push(errors, 'requirement.unknown_kind', `unknown requirement kind ${kind}`, { field: 'requirements' });
          continue;
        }
        const value = requirements[kind];
        if ((kind === 'checks' || kind === 'assessment_roles') && !Array.isArray(value)) {
          push(errors, 'requirement.not_a_list', `requirements.${kind} must be a list`, { field: 'requirements' });
        }
        if (kind === 'assessment_roles' && Array.isArray(value)) {
          for (const role of value) {
            if (!ROLE_IDS.includes(recordValueText(role))) {
              push(errors, 'requirement.unknown_role', `requirements.assessment_roles contains unknown role ${recordValueText(role)}`, { field: 'requirements' });
            }
          }
        }
        if (kind === 'independent_review' && typeof value !== 'boolean') {
          push(errors, 'requirement.not_a_boolean', 'requirements.independent_review must be true or false', { field: 'requirements' });
        }
      }
    }
  }

  const candidateEntries = validateEntries(errors, frontmatter, 'candidates', ['ref'], {});
  candidateEntries.forEach((entry, index) => {
    if (entry.producers === undefined || entry.producers === null) return;
    if (!Array.isArray(entry.producers)) {
      push(errors, 'entry.not_a_list', `candidates[${index}].producers must be a list`, { field: 'candidates', index });
      return;
    }
    entry.producers.forEach((producer, position) => {
      if (typeof producer !== 'string' || producer.trim() === '') {
        push(errors, 'identity.blank', `candidates[${index}].producers[${position}] is not an identity`, { field: 'candidates', index });
      }
    });
  });
  const evidenceEntries = validateEntries(errors, frontmatter, 'evidence', ['check', 'candidate', 'result'], { result: [...RESULTS] });
  for (const [field, entries] of [['evidence', evidenceEntries]]) {
    /** @type {Record<string, unknown>[]} */ (entries).forEach((entry, index) => {
      if (entry.actor !== undefined && entry.actor !== null && (typeof entry.actor !== 'string' || entry.actor.trim() === '')) {
        push(errors, 'identity.blank', `${field}[${index}].actor is not an identity`, { field, index });
      }
    });
  }
  const assessmentEntries = validateEntries(errors, frontmatter, 'assessments', ['candidate', 'role', 'verdict'], {
    role: [...ROLE_IDS],
    verdict: [...VERDICTS],
  });
  assessmentEntries.forEach((entry, index) => {
    if (entry.actor !== undefined && entry.actor !== null && (typeof entry.actor !== 'string' || entry.actor.trim() === '')) {
      push(errors, 'identity.blank', `assessments[${index}].actor is not an identity`, { field: 'assessments', index });
    }
  });

  for (const key of Object.keys(frontmatter)) {
    // A requirement kind at the top level would be an unrecognized field,
    // permitted, and would silently stop counting, so a record could reach
    // `done` without it. It is an error, so lint and `done` refuse it.
    if (REQUIREMENT_KINDS.includes(key)) {
      push(errors, 'requirement.misplaced', `${key} is at the top level; move it under requirements:`, { field: key });
      continue;
    }
    if (!RECOGNIZED_FIELDS.includes(key)) {
      info.push({ code: 'field.unrecognized', message: `unrecognized frontmatter field ${key} (permitted)`, field: key });
    }
  }

  info.push(...entryNotes(frontmatter, evidenceEntries));
  const current = candidateEntries[candidateEntries.length - 1];
  const currentRef = current === undefined || current.ref === undefined || current.ref === null ? '' : recordValueText(current.ref);
  if (currentRef !== '' && !isObjectId(currentRef)) {
    info.push({
      code: 'candidate.moving_ref',
      message: `the current candidate ${currentRef} is a name, not an object id, and names can move; record the commit id or a snapshot (tree:<sha>)`,
      field: 'candidates',
      index: /** @type {unknown[]} */ (frontmatter.candidates).lastIndexOf(current),
    });
  }
  const inBody = bodyEntryKeys(body);
  if (inBody.length > 0) {
    info.push({
      code: 'entries.in_body',
      message: `a fenced block in the body holds ${inBody.join(', ')}; these are not read by checks; move them into the frontmatter lists`,
    });
  }
  const size = new TextEncoder().encode(text).length;
  if (size > LARGE_RECORD_BYTES) {
    info.push({ code: 'record.large', message: `the record is ${Math.round(size / 1024)} KB; move run logs to linked files` });
  }

  const headings = collectHeadings(body);
  const seen = new Set();
  for (const { heading } of headings) {
    if (!RECOGNIZED_HEADINGS.includes(heading)) continue;
    if (seen.has(heading)) {
      push(errors, 'heading.duplicate', `duplicate recognized heading ${heading}`);
    }
    seen.add(heading);
  }

  return { frontmatter, body, headings, errors, info, path: options.path ?? null };
}

/**
 * The candidates, evidence, and assessments a record declares, in document order.
 * @param {ParsedRecord} record
 */
export function recordEntries(record) {
  const list = (/** @type {string} */ field) => {
    const value = record.frontmatter[field];
    return Array.isArray(value) ? value.filter(isPlainObject) : [];
  };
  return {
    candidates: /** @type {Record<string, unknown>[]} */ (list('candidates')),
    evidence: /** @type {Record<string, unknown>[]} */ (list('evidence')),
    assessments: /** @type {Record<string, unknown>[]} */ (list('assessments')),
  };
}

/**
 * The declared requirements, normalized. Undeclared requirements are absent;
 * they are never introduced.
 * @param {ParsedRecord} record
 */
export function declaredRequirements(record) {
  const requirements = record.frontmatter.requirements;
  if (!isPlainObject(requirements)) return {};
  /** @type {{checks?: string[], independent_review?: boolean, assessment_roles?: string[]}} */
  const out = {};
  if (Array.isArray(requirements.checks)) out.checks = requirements.checks.map(recordValueText);
  if (typeof requirements.independent_review === 'boolean') out.independent_review = requirements.independent_review;
  if (Array.isArray(requirements.assessment_roles)) out.assessment_roles = requirements.assessment_roles.map(recordValueText);
  return out;
}
