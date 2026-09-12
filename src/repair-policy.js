/**
 * Stable diagnostic fact catalog.
 *
 * The catalog maps each diagnostic code to factual metadata only: category,
 * repair kind, escalation kind, and a default factual description. It never
 * names a workflow role. Role routing is derived exclusively by the
 * presentation layer from role capability bindings (`agents/*.md`
 * frontmatter), never by evaluators.
 */

/**
 * Policy names are protocol-neutral: evaluators only report facts and never
 * select a workflow transition, invoke a role, or mutate a workflow artifact.
 */
import { DIAGNOSTIC_DEFINITIONS, repairPolicyViewFor } from './refusal-classes.js';

export const REPAIR_POLICY = repairPolicyViewFor(DIAGNOSTIC_DEFINITIONS);

export function repairPolicyFor(code) {
  const entry = REPAIR_POLICY[code];
  if (!entry) throw new Error(`diagnostic code lacks repair policy: ${code}`);
  return entry;
}

export function assertDiagnosticPolicy(code) {
  const entry = repairPolicyFor(code);
  if (!entry.description) throw new Error(`diagnostic code lacks renderable description: ${code}`);
  if (!entry.repairKind) throw new Error(`diagnostic code lacks a repair kind: ${code}`);
  if (!entry.escalationKind) throw new Error(`diagnostic code lacks an escalation kind: ${code}`);
  return entry;
}

/** Every repair kind an actionable diagnostic can require. */
export const REPAIR_KINDS = Object.freeze([...new Set(Object.values(REPAIR_POLICY).map(entry => entry.repairKind))]);

/** Every escalation kind an actionable diagnostic can require. */
export const ESCALATION_KINDS = Object.freeze([...new Set(Object.values(REPAIR_POLICY).map(entry => entry.escalationKind))]);

/** Escalation kinds with this prefix resolve to the human authority boundary, never to an agent role. */
export const HUMAN_AUTHORITY_ESCALATION_PREFIX = 'human_authority';

/**
 * Canonical diagnostic fact constructor. Evaluator facts carry level, code,
 * category, repairKind, escalationKind, evidence, a factual message, and
 * domain-specific factual metadata only; routing fields are rejected here
 * and derived later by the presentation layer.
 *
 * @param {{ level?: string, code: string, evidence?: object, message?: string|null, repairHint?: string } & object} fact
 */
export function createDiagnostic({ level = 'error', code, evidence = {}, message = null, ...details } = {}) {
  const entry = assertDiagnosticPolicy(code);
  const protectedFields = ['category', 'repairKind', 'escalationKind', 'owner', 'escalationOwner', 'ownerRouting', 'nextAction', 'firstSafeRepair', 'dependsOn'];
  for (const field of protectedFields) {
    if (Object.hasOwn(details, field)) throw new Error(`diagnostic policy field '${field}' cannot be evaluator-supplied`);
  }
  if (details.diagnosticPrerequisites !== undefined &&
      (!Array.isArray(details.diagnosticPrerequisites) ||
       !details.diagnosticPrerequisites.every(item => typeof item === 'string' && item))) {
    throw new Error('diagnosticPrerequisites must be an array of non-empty strings');
  }
  return {
    ...details,
    level,
    code,
    category: entry.category,
    message: message ?? renderDiagnosticMessage(code, evidence),
    evidence,
    repairKind: entry.repairKind,
    escalationKind: entry.escalationKind,
  };
}

/** Render facts supplied as structured evidence without embedding policy in gates. */
export function renderDiagnosticMessage(code, evidence = {}) {
  const path = Array.isArray(evidence.paths) ? evidence.paths[0] : null;
  switch (code) {
    case 'scope.declaration.duplicate':
      return `duplicate ${evidence.field ?? 'scope'} entry '${path ?? ''}'`;
    case 'scope.declaration.invalid':
      return evidence.reason ?? `'${evidence.field ?? 'scope'}' must be a YAML list of repo-relative paths`;
    case 'scope.existing_path.missing':
      return `literal allowed path '${path ?? ''}' is absent from the base tree`;
    case 'scope.intended_creation.missing':
      return `literal allowed path '${path ?? ''}' is absent from the base tree and is not declared as an intended creation or generated output`;
    case 'scope.intended_creation.uncovered':
      return `intended_creation '${path ?? ''}' is not covered by allowed_paths`;
    case 'scope.intent.invalid':
      return `intended_creation '${path ?? ''}' must be an exact safe repo-relative path`;
    case 'scope.glob.unmatched':
      return `scope glob '${path ?? ''}' matches no base-tree paths and is not creation-capable`;
    case 'scope.deviation.missing':
      return `unexpected file '${path ?? ''}' has no declaration in ## Deviations`;
    case 'scope.deviation.malformed':
      if (Array.isArray(evidence.errors) && evidence.errors.length) return evidence.errors[0];
      if (evidence.kind === 'stale') return `deviation declared for '${path ?? ''}' but the file is not in the current PR`;
      if (evidence.kind === 'in_scope') return `deviation declared for '${path ?? ''}' but the file is already covered by allowed_paths`;
      return repairPolicyFor(code).description;
    case 'generated.path.invalid':
      if (evidence.reason === 'invalid_path') return `generated path '${path ?? ''}' must be an exact repo-relative path`;
      return `generated path '${path ?? ''}' requires generator, source, and verification (parity or regeneration)`;
    case 'readiness.mode.invalid':
      return "mode must be explicitly 'authoring' or 'review'";
    default:
      return repairPolicyFor(code).description;
  }
}

export function preflightDiagnosticCode(category) {
  return `preflight.${String(category ?? 'other')}`;
}
