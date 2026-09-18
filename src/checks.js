/**
 * Pure checks over a parsed task record.
 *
 * Every function here takes the parsed record plus an optional observation map
 * and performs no I/O. The CLI gathers observations; these functions never do.
 * They are exported from the package so an independent consumer uses the same
 * interface.
 *
 * Three outputs, never merged: structural validity, reference availability,
 * and requirement evaluation.
 */

import { declaredRequirements, recordEntries } from './record.js';

/** Trust of a supporting fact. */
export const CHECKED = 'checked';
export const ASSERTED = 'asserted';

/**
 * @typedef {{ref: string, available: 'available'|'unavailable'|'not_checked', kind: 'candidate'|'link'}} ReferenceResult
 * @typedef {{fact: string, trust: 'checked'|'asserted'}} SupportingFact
 * @typedef {{requirement: string, status: 'satisfied'|'not_satisfied'|'unknown', reason: string, facts: SupportingFact[]}} RequirementResult
 * @typedef {{refs?: Record<string, boolean>, files?: Record<string, boolean>}} Observations
 */

/**
 * Structural validity: is the record well formed?
 * @param {import('./record.js').ParsedRecord} record
 */
export function structuralValidity(record) {
  return {
    valid: record.errors.length === 0,
    errors: record.errors,
    info: record.info,
  };
}

/**
 * The current candidate is the last entry in the candidates list.
 * @param {import('./record.js').ParsedRecord} record
 */
export function currentCandidate(record) {
  const { candidates } = recordEntries(record);
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
}

/**
 * Reference availability. An unavailable reference is not malformed: it may
 * resolve in another checkout. Nothing is ever fetched from a remote.
 * @param {import('./record.js').ParsedRecord} record
 * @param {Observations} [observations]
 * @returns {ReferenceResult[]}
 */
export function referenceAvailability(record, observations = {}) {
  const { candidates, evidence, assessments } = recordEntries(record);
  const refs = observations.refs ?? null;
  const files = observations.files ?? null;
  /** @type {ReferenceResult[]} */
  const out = [];

  for (const candidate of candidates) {
    const ref = candidate.ref === undefined || candidate.ref === null ? '' : String(candidate.ref);
    if (ref === '') continue;
    out.push({
      ref,
      kind: 'candidate',
      available: refs === null ? 'not_checked' : refs[ref] ? 'available' : 'unavailable',
    });
  }

  for (const entry of [...evidence, ...assessments]) {
    const link = entry.output ?? entry.findings;
    if (typeof link !== 'string' || !isRelativePath(link)) continue;
    out.push({
      ref: link,
      kind: 'link',
      available: files === null ? 'not_checked' : files[link] ? 'available' : 'unavailable',
    });
  }

  return out;
}

/** A linked file, as opposed to a short inline string. @param {string} value */
function isRelativePath(value) {
  if (value.includes('\n') || value.trim() === '') return false;
  if (value.startsWith('#')) return false;
  return /^[.\w][\w./-]*\.[A-Za-z0-9]+$/.test(value) && !value.startsWith('/');
}

/**
 * The effective evidence entry for a check and candidate: the last in document
 * order. A later `fail` overrides an earlier `pass`.
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} check
 * @param {string} candidateRef
 */
export function effectiveEvidence(record, check, candidateRef) {
  const { evidence } = recordEntries(record);
  let found = null;
  for (const entry of evidence) {
    if (String(entry.check) !== check) continue;
    if (String(entry.candidate) !== candidateRef) continue;
    found = entry;
  }
  return found;
}

/**
 * The effective assessments for a candidate: the last entry in document order
 * per (candidate, actor), or per (candidate, role) when actor is absent.
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} candidateRef
 */
export function effectiveAssessments(record, candidateRef) {
  const { assessments } = recordEntries(record);
  /** @type {Map<string, Record<string, unknown>>} */
  const byKey = new Map();
  for (const entry of assessments) {
    if (String(entry.candidate) !== candidateRef) continue;
    const actor = entry.actor === undefined || entry.actor === null ? '' : String(entry.actor);
    const key = actor === '' ? `role:${String(entry.role)}` : `actor:${actor}`;
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/**
 * Requirement evaluation.
 *
 * A requirement means a favorable outcome was obtained, not that an assessment
 * was performed. An undeclared requirement is never introduced.
 *
 * @param {import('./record.js').ParsedRecord} record
 * @param {Observations} [observations]
 * @returns {RequirementResult[]}
 */
export function requirementEvaluation(record, observations = {}) {
  const requirements = declaredRequirements(record);
  const candidate = currentCandidate(record);
  /** @type {RequirementResult[]} */
  const out = [];

  const candidateRef = candidate && candidate.ref !== undefined && candidate.ref !== null ? String(candidate.ref) : null;

  if (requirements.checks) {
    for (const check of requirements.checks) {
      out.push(evaluateCheck(record, check, candidateRef));
    }
  }

  if (requirements.independent_review === true) {
    out.push(evaluateIndependentReview(record, candidate, candidateRef));
  }

  if (requirements.assessment_roles) {
    for (const role of requirements.assessment_roles) {
      out.push(evaluateAssessmentRole(record, role, candidateRef));
    }
  }

  void observations;
  return out;
}

/**
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} check
 * @param {string|null} candidateRef
 * @returns {RequirementResult}
 */
function evaluateCheck(record, check, candidateRef) {
  const name = `checks:${check}`;
  if (candidateRef === null) {
    return { requirement: name, status: 'not_satisfied', reason: 'candidate.missing', facts: [] };
  }
  const entry = effectiveEvidence(record, check, candidateRef);
  if (!entry) {
    return { requirement: name, status: 'not_satisfied', reason: 'evidence.missing', facts: [] };
  }
  /** @type {SupportingFact[]} */
  const facts = [{ fact: `evidence for ${check} on ${candidateRef} is ${String(entry.result)}`, trust: ASSERTED }];
  if (entry.exit_code !== undefined && entry.exit_code !== null) {
    facts.push({ fact: `recorded exit_code ${String(entry.exit_code)}`, trust: ASSERTED });
  }
  if (String(entry.result) === 'pass') {
    return { requirement: name, status: 'satisfied', reason: 'evidence.pass', facts };
  }
  return { requirement: name, status: 'not_satisfied', reason: 'evidence.fail', facts };
}

/**
 * Independence is evaluated against the recorded producers of the current
 * candidate, not against role names.
 * @param {import('./record.js').ParsedRecord} record
 * @param {Record<string, unknown>|null} candidate
 * @param {string|null} candidateRef
 * @returns {RequirementResult}
 */
function evaluateIndependentReview(record, candidate, candidateRef) {
  const name = 'independent_review';
  if (candidate === null || candidateRef === null) {
    return { requirement: name, status: 'not_satisfied', reason: 'candidate.missing', facts: [] };
  }
  const producers = Array.isArray(candidate.producers) ? candidate.producers.map(String) : [];
  const accepting = effectiveAssessments(record, candidateRef).filter((entry) => String(entry.verdict) === 'accept');

  if (accepting.length === 0) {
    const anyAssessment = effectiveAssessments(record, candidateRef).length > 0;
    return {
      requirement: name,
      status: 'not_satisfied',
      reason: anyAssessment ? 'assessment.not_accepted' : 'assessment.missing',
      facts: [],
    };
  }

  if (producers.length === 0) {
    return {
      requirement: name,
      status: 'unknown',
      reason: 'producers.missing',
      facts: [{ fact: `candidate ${candidateRef} records no producers`, trust: ASSERTED }],
    };
  }

  const withActor = accepting.filter((entry) => entry.actor !== undefined && entry.actor !== null && String(entry.actor) !== '');
  if (withActor.length === 0) {
    return {
      requirement: name,
      status: 'unknown',
      reason: 'actor.missing',
      facts: [{ fact: 'every accepting assessment lacks an actor', trust: ASSERTED }],
    };
  }

  for (const entry of withActor) {
    const actor = String(entry.actor);
    if (!producers.includes(actor)) {
      return {
        requirement: name,
        status: 'satisfied',
        reason: 'actor.independent',
        facts: [
          { fact: `accepting actor ${actor}`, trust: ASSERTED },
          { fact: `candidate producers ${producers.join(', ')}`, trust: ASSERTED },
          { fact: `${actor} is not among the producers`, trust: CHECKED },
        ],
      };
    }
  }

  const actors = withActor.map((entry) => String(entry.actor));
  return {
    requirement: name,
    status: 'not_satisfied',
    reason: 'actor.is_producer',
    facts: [
      { fact: `accepting actors ${actors.join(', ')}`, trust: ASSERTED },
      { fact: `candidate producers ${producers.join(', ')}`, trust: ASSERTED },
      { fact: 'every accepting actor is also a producer', trust: CHECKED },
    ],
  };
}

/**
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} role
 * @param {string|null} candidateRef
 * @returns {RequirementResult}
 */
function evaluateAssessmentRole(record, role, candidateRef) {
  const name = `assessment_roles:${role}`;
  if (candidateRef === null) {
    return { requirement: name, status: 'not_satisfied', reason: 'candidate.missing', facts: [] };
  }
  const forRole = effectiveAssessments(record, candidateRef).filter((entry) => String(entry.role) === role);
  if (forRole.length === 0) {
    return { requirement: name, status: 'not_satisfied', reason: 'assessment.missing', facts: [] };
  }
  const accepted = forRole.some((entry) => String(entry.verdict) === 'accept');
  const verdicts = forRole.map((entry) => String(entry.verdict));
  /** @type {SupportingFact[]} */
  const facts = [{ fact: `effective ${role} verdicts: ${verdicts.join(', ')}`, trust: ASSERTED }];
  return accepted
    ? { requirement: name, status: 'satisfied', reason: 'assessment.accepted', facts }
    : { requirement: name, status: 'not_satisfied', reason: 'assessment.not_accepted', facts };
}

/**
 * All three outputs for one record.
 * @param {import('./record.js').ParsedRecord} record
 * @param {Observations} [observations]
 */
export function checkRecord(record, observations = {}) {
  return {
    structural: structuralValidity(record),
    references: referenceAvailability(record, observations),
    requirements: requirementEvaluation(record, observations),
  };
}

/**
 * Duplicate task ids across a corpus of records.
 *
 * An id is the handle every other record and every command uses to name a
 * task, so two records sharing one make both ambiguous. This is a corpus-level
 * structural error: a single record cannot see it, which is why it is reported
 * here rather than by the parser.
 *
 * Detection is deterministic: records are compared in the order given, and
 * every record sharing an id is reported with the paths of all its twins.
 *
 * @param {import('./record.js').ParsedRecord[]} records
 * @returns {Map<string, import('./record.js').Diagnostic>} keyed by record path
 */
export function duplicateIdErrors(records) {
  /** @type {Map<string, {path: string|null, index: number}[]>} */
  const byId = new Map();
  records.forEach((record, index) => {
    const id = record.frontmatter.id;
    if (id === undefined || id === null || String(id).trim() === '') return;
    const key = String(id);
    if (!byId.has(key)) byId.set(key, []);
    (byId.get(key) ?? []).push({ path: record.path, index });
  });

  /** @type {Map<string, import('./record.js').Diagnostic>} */
  const errors = new Map();
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const others = entries.filter((other) => other.index !== entry.index).map((other) => other.path ?? '<unknown>');
      errors.set(entry.path ?? String(entry.index), {
        code: 'id.duplicate',
        message: `duplicate task id ${id}, also declared by ${others.join(', ')}`,
        field: 'id',
      });
    }
  }
  return errors;
}

/**
 * Whether the record may claim `status: done`: every declared requirement
 * satisfied. This is the single write validation, not an authorization gate.
 * @param {import('./record.js').ParsedRecord} record
 * @param {Observations} [observations]
 */
export function mayBeDone(record, observations = {}) {
  const results = requirementEvaluation(record, observations);
  const blocking = results.filter((result) => result.status !== 'satisfied');
  return { allowed: blocking.length === 0, blocking };
}
