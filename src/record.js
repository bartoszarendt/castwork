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
      if (found !== undefined && found !== null && !allowed.includes(String(found))) {
        push(errors, 'entry.unknown_value', `${field}[${index}].${key} is not one of ${allowed.join(', ')}`, { field, index });
      }
    }
    entries.push(entry);
  });
  return entries;
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
      const message = error instanceof YamlError ? error.message : String(error);
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
  if (status !== undefined && status !== null && !STATUS_VALUES.includes(String(status))) {
    push(errors, 'status.unknown', `unknown status value ${String(status)}`, { field: 'status' });
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
            if (!ROLE_IDS.includes(String(role))) {
              push(errors, 'requirement.unknown_role', `requirements.assessment_roles contains unknown role ${String(role)}`, { field: 'requirements' });
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
    if (!RECOGNIZED_FIELDS.includes(key)) {
      info.push({ code: 'field.unrecognized', message: `unrecognized frontmatter field ${key} (permitted)`, field: key });
    }
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
  if (Array.isArray(requirements.checks)) out.checks = requirements.checks.map(String);
  if (typeof requirements.independent_review === 'boolean') out.independent_review = requirements.independent_review;
  if (Array.isArray(requirements.assessment_roles)) out.assessment_roles = requirements.assessment_roles.map(String);
  return out;
}
