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

import { declaredRequirements, recordEntries, recordValueText } from './record.js';

/**
 * Work whose declared requirements are met but whose status was never closed:
 * records `task set <id> status done` would accept. A record that declares no
 * requirement is accepted too, but is never marked: nothing it declares says
 * the work is finished.
 *
 * @param {{status: string, requirements_satisfied: boolean|null}} row
 * @param {boolean} valid whether the record is structurally valid
 */
export function readyToClose(row, valid) {
  return row.requirements_satisfied === true && valid && row.status !== 'done' && row.status !== 'cancelled';
}

/** Trust of a supporting fact. */
export const CHECKED = 'checked';
export const ASSERTED = 'asserted';

/**
 * @typedef {{ref: string, available: 'available'|'unavailable'|'not_checked', kind: 'candidate'|'link', drift?: 'matches'|'differs'|'not_checked', drift_paths?: string[], same_tree_as?: string}} ReferenceResult
 * @typedef {{fact: string, trust: 'checked'|'asserted'}} SupportingFact
 * @typedef {{requirement: string, status: 'satisfied'|'not_satisfied'|'unknown', reason: string, facts: SupportingFact[]}} RequirementResult
 * @typedef {{refs?: Record<string, boolean>, files?: Record<string, boolean>, drift?: Record<string, string[]>, trees?: Record<string, string>}} Observations
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

  const drift = observations.drift ?? null;
  const trees = observations.trees ?? null;
  candidates.forEach((candidate, index) => {
    const ref = candidate.ref === undefined || candidate.ref === null ? '' : recordValueText(candidate.ref);
    if (ref === '') return;
    /** @type {ReferenceResult} */
    const result = { ref, kind: 'candidate', available: observed(refs, ref) };
    // Whether the working tree still holds the current snapshot: evidence
    // belongs to the bytes it ran on, and an edit after it leaves the record
    // describing a tree that is no longer there.
    if (index === candidates.length - 1 && ref.startsWith('tree:')) {
      if (drift === null || !Object.hasOwn(drift, ref)) {
        result.drift = 'not_checked';
      } else {
        result.drift = drift[ref].length === 0 ? 'matches' : 'differs';
        result.drift_paths = [...drift[ref]];
      }
    }
    if (trees !== null && Object.hasOwn(trees, ref)) {
      const tree = trees[ref].toLowerCase();
      // Only a well-formed snapshot that resolved here is compared, so a
      // prefix nobody checked can never name a match.
      const earlier = candidates.slice(0, index)
        .map((entry) => recordValueText(entry.ref ?? ''))
        .find((earlierRef) => {
          const sha = /^tree:([0-9a-f]{7,64})$/i.exec(earlierRef)?.[1];
          return sha !== undefined && refs !== null && refs[earlierRef] === true && tree.startsWith(sha.toLowerCase());
        });
      if (earlier !== undefined) result.same_tree_as = earlier;
    }
    out.push(result);
  });

  for (const entry of [...evidence, ...assessments]) {
    const link = entry.output ?? entry.findings;
    if (typeof link !== 'string' || !isRelativePath(link)) continue;
    out.push({
      ref: link,
      kind: 'link',
      available: observed(files, link),
    });
  }

  return out;
}

/**
 * Read one observation by a key the record supplied, as one of three states.
 *
 * A missing own property is `not_checked`, not `unavailable`: a gatherer that
 * skipped a path said nothing about it, and reporting it absent would be a
 * claim about a file the record does not own. `false` is the only thing that
 * means checked and absent.
 *
 * Every key here is a string a record chose, so `refs['__proto__']` on a plain
 * map answered from Object.prototype and reported an unresolvable reference as
 * available. Only an own property counts, which also keeps an ordinary object
 * literal from an external consumer safe.
 *
 * @param {Record<string, boolean>|null} map
 * @param {string} key
 * @returns {'available'|'unavailable'|'not_checked'}
 */
function observed(map, key) {
  if (map === null || !Object.hasOwn(map, key)) return 'not_checked';
  return map[key] === true ? 'available' : 'unavailable';
}

/**
 * A linked file, as opposed to a short inline string.
 *
 * A link is only ever resolved inside the checkout, so anything absolute or
 * traversing upward is not treated as a link at all. Reporting availability for
 * such a path would answer "does this file exist on your machine" for a path
 * the record chose, which is an external existence oracle, not evidence.
 *
 * @param {string} value
 */
export function isRelativePath(value) {
  if (value.includes('\n') || value.trim() === '') return false;
  if (value.startsWith('#')) return false;
  if (value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:/.test(value)) return false;
  const unified = value.replace(/\\/g, '/');
  if (unified.split('/').includes('..')) return false;
  return /^[.\w][\w./-]*\.[A-Za-z0-9]+$/.test(unified);
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
    if (recordValueText(entry.check) !== check) continue;
    if (recordValueText(entry.candidate) !== candidateRef) continue;
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
    if (recordValueText(entry.candidate) !== candidateRef) continue;
    const actor = entry.actor === undefined || entry.actor === null ? '' : recordValueText(entry.actor);
    const key = actor === '' ? `role:${recordValueText(entry.role)}` : `actor:${actor}`;
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/**
 * Facts naming each actor whose effective `accept` on a candidate replaced a
 * blocking verdict of its own. Changing one's verdict is allowed; the change
 * stays visible.
 * @param {import('./record.js').ParsedRecord} record
 * @param {string} candidateRef
 * @param {Record<string, unknown>[]} accepting effective accepting assessments
 * @returns {SupportingFact[]}
 */
function revisedVerdicts(record, candidateRef, accepting) {
  const { assessments } = recordEntries(record);
  /** @type {SupportingFact[]} */
  const facts = [];
  for (const entry of accepting) {
    if (!isIdentity(entry.actor)) continue;
    const actor = recordValueText(entry.actor).trim();
    const earlier = assessments.slice(0, assessments.indexOf(entry)).filter(
      (other) => recordValueText(other.candidate) === candidateRef && isIdentity(other.actor) && recordValueText(other.actor).trim() === actor && isBlockingVerdict(other.verdict),
    );
    if (earlier.length > 0) facts.push({ fact: `${actor} recorded ${recordValueText(earlier[earlier.length - 1].verdict)} earlier, then accept`, trust: ASSERTED });
  }
  return facts;
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

  const candidateRef = candidate && candidate.ref !== undefined && candidate.ref !== null ? recordValueText(candidate.ref) : null;

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
  const facts = [{ fact: `evidence for ${check} on ${candidateRef} is ${recordValueText(entry.result)}`, trust: ASSERTED }];
  if (entry.exit_code !== undefined && entry.exit_code !== null) {
    facts.push({ fact: `recorded exit_code ${recordValueText(entry.exit_code)}`, trust: ASSERTED });
  }
  if (recordValueText(entry.result) === 'pass') {
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
  const producers = identityList(candidate.producers);
  const effective = effectiveAssessments(record, candidateRef);
  const accepting = effective.filter((entry) => recordValueText(entry.verdict) === 'accept');

  if (accepting.length === 0) {
    const anyAssessment = effective.length > 0;
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

  const withActor = accepting.filter((entry) => isIdentity(entry.actor));
  if (withActor.length === 0) {
    return {
      requirement: name,
      status: 'unknown',
      reason: 'actor.missing',
      facts: [{ fact: 'every accepting assessment lacks an actor', trust: ASSERTED }],
    };
  }

  // A relevant actor is one who is not a producer of this candidate: only they
  // can make the review independent, and only they can block it. A producer
  // rejecting their own work says nothing about independence.
  const blocking = effective.filter(
    (entry) => isBlockingVerdict(entry.verdict) && isIdentity(entry.actor) && !producers.includes(recordValueText(entry.actor).trim()),
  );
  if (blocking.length > 0) {
    const actors = blocking.map(assessorName);
    return {
      requirement: name,
      status: 'not_satisfied',
      reason: 'assessment.rejected',
      facts: [
        { fact: `blocking independent actors: ${actors.join(', ')}`, trust: ASSERTED },
        { fact: `candidate producers ${producers.join(', ')}`, trust: ASSERTED },
        { fact: 'an effective reject or needs_revision from an independent actor blocks the requirement', trust: CHECKED },
      ],
    };
  }

  for (const entry of withActor) {
    const actor = recordValueText(entry.actor).trim();
    if (!producers.includes(actor)) {
      return {
        requirement: name,
        status: 'satisfied',
        reason: 'actor.independent',
        facts: [
          { fact: `accepting actor ${actor}`, trust: ASSERTED },
          { fact: `candidate producers ${producers.join(', ')}`, trust: ASSERTED },
          { fact: `${actor} is not among the producers`, trust: CHECKED },
          ...revisedVerdicts(record, candidateRef, [entry]),
        ],
      };
    }
  }

  const actors = withActor.map((entry) => recordValueText(entry.actor).trim());
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
 * The usable identities in a recorded list.
 *
 * An identity is a non-empty string. A blank entry, a null, or a number is not
 * somebody, so it cannot be compared against a reviewer, and a list that yields
 * none is missing rather than empty. `producers: [""]` therefore leaves
 * independence unknown instead of vacuously satisfying it.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function identityList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
}

/** @param {unknown} value */
export function isIdentity(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * A verdict that withholds the favorable outcome a requirement asks for.
 * @param {unknown} value
 */
function isBlockingVerdict(value) {
  const verdict = recordValueText(value);
  return verdict === 'reject' || verdict === 'needs_revision';
}

/**
 * Who to name for an assessment: its actor, or the role when none is recorded.
 * @param {Record<string, unknown>} entry
 */
function assessorName(entry) {
  return isIdentity(entry.actor) ? recordValueText(entry.actor).trim() : `${recordValueText(entry.role)} (no actor)`;
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
  const forRole = effectiveAssessments(record, candidateRef).filter((entry) => recordValueText(entry.role) === role);
  if (forRole.length === 0) {
    return { requirement: name, status: 'not_satisfied', reason: 'assessment.missing', facts: [] };
  }
  const verdicts = forRole.map((entry) => recordValueText(entry.verdict));
  /** @type {SupportingFact[]} */
  const facts = [{ fact: `effective ${role} verdicts: ${verdicts.join(', ')}`, trust: ASSERTED }];

  // `some(accept)` let one verifier overrule another: two effective
  // assessments, one accepting and one rejecting, reported satisfied. Every
  // actor holding the role is relevant, so one blocking verdict is enough.
  if (!forRole.some((entry) => recordValueText(entry.verdict) === 'accept')) {
    return { requirement: name, status: 'not_satisfied', reason: 'assessment.not_accepted', facts };
  }
  const blocking = forRole.filter((entry) => isBlockingVerdict(entry.verdict));
  if (blocking.length > 0) {
    facts.push({ fact: `blocking ${role} actors: ${blocking.map(assessorName).join(', ')}`, trust: ASSERTED });
    facts.push({ fact: 'an effective reject or needs_revision blocks the requirement', trust: CHECKED });
    return { requirement: name, status: 'not_satisfied', reason: 'assessment.rejected', facts };
  }
  facts.push(...revisedVerdicts(record, candidateRef, forRole));
  return { requirement: name, status: 'satisfied', reason: 'assessment.accepted', facts };
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
    if (id === undefined || id === null || recordValueText(id).trim() === '') return;
    const key = recordValueText(id);
    if (!byId.has(key)) byId.set(key, []);
    (byId.get(key) ?? []).push({ path: record.path, index });
  });

  /** @type {Map<string, import('./record.js').Diagnostic>} */
  const errors = new Map();
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const others = entries.filter((other) => other.index !== entry.index).map((other) => other.path ?? '<unknown>');
      errors.set(entry.path ?? recordValueText(entry.index), {
        code: 'id.duplicate',
        message: `duplicate task id ${id}, also declared by ${others.join(', ')}`,
        field: 'id',
      });
    }
  }
  return errors;
}

/**
 * Whether the record may claim `status: done`: structurally valid, with every
 * declared requirement satisfied. Structural diagnostics and blocking
 * requirements stay separate. This is write validation, not an authorization gate.
 * @param {import('./record.js').ParsedRecord} record
 * @param {Observations} [observations]
 */
export function mayBeDone(record, observations = {}) {
  const structural = structuralValidity(record);
  const results = requirementEvaluation(record, observations);
  const blocking = results.filter((result) => result.status !== 'satisfied');
  return { allowed: structural.valid && blocking.length === 0, structural, blocking };
}
