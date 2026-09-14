import { canonicalSha256 } from './canonical-json.js';

export const PROTECTED_INPUT_CLASSIFICATIONS = Object.freeze([
  'authoritative_protected_input',
  'derived_recomputable_projection',
  'post_transition_output',
  'advisory_diagnostic',
  'removed_legacy_representation',
]);

const authoritative = (name, description) => Object.freeze({
  name, classification: 'authoritative_protected_input', description,
});
const derived = (name, description) => Object.freeze({
  name, classification: 'derived_recomputable_projection', description,
});
const output = (name, description) => Object.freeze({
  name, classification: 'post_transition_output', description,
});
const advisory = (name, description) => Object.freeze({
  name, classification: 'advisory_diagnostic', description,
});
const removed = (name, description) => Object.freeze({
  name, classification: 'removed_legacy_representation', description,
});

function transition(actionId, attemptScope, consultedValues) {
  const protectedInputFields = consultedValues
    .filter(value => value.classification === 'authoritative_protected_input')
    .map(value => value.name);
  return Object.freeze({
    actionId,
    attemptScope,
    consultedValues: Object.freeze(consultedValues),
    protectedInputFields: Object.freeze(protectedInputFields),
    protectedInputDigestDefinition: Object.freeze({
      algorithm: 'sha256(canonicalJson({ actionId, protectedInputs }))',
      source: 'only authoritative_protected_input values in protectedInputFields',
    }),
  });
}

/**
 * Protected-transition characterization input contract. This is a tracked baseline definition,
 * not a lifecycle evaluator or a compatibility shim.
 */
export const PROTECTED_TRANSITION_INPUTS = Object.freeze([
  transition('authorize', 'none', [
    authoritative('repositoryIdentity', 'target repository bound by owner authorization'),
    authoritative('taskId', 'authorized task identity'),
    authoritative('protectedContract', 'content-addressed intent, scope, risk, and checkpoints'),
    authoritative('authorizationDecision', 'owner authorization or revocation decision'),
    derived('readiness', 'current readiness projection recomputed from canonical authorization facts'),
    output('authorizationRecord', 'atomic authorization result'),
    advisory('diagnosticPresentation', 'human-readable refusal or warning rendering'),
    removed('authorizationExpiresAt', 'wall-clock expiry is not an authorization input'),
  ]),
  transition('revoke', 'none', [
    authoritative('repositoryIdentity', 'target repository bound by the authorization'),
    authoritative('taskId', 'authorized task identity'),
    authoritative('authorizationDecision', 'owner revocation decision'),
    derived('currentAuthorizationProjection', 'recomputed authorization rendering'),
    output('revocationRecord', 'atomic revocation result'),
    advisory('diagnosticPresentation', 'human-readable revocation explanation'),
    removed('authorizationAge', 'elapsed time is not a revocation input'),
  ]),
  transition('dispatch', 'none', [
    authoritative('factShape', 'exact dispatch fact domain selected by the protected evaluator'),
    authoritative('snapshot', 'fresh task snapshot supplied to evaluateDispatchEligibility'),
    authoritative('activationEvidence', 'fresh activation evidence supplied to evaluateDispatchEligibility'),
    authoritative('readiness', 'fresh readiness facts supplied to evaluateDispatchEligibility'),
    authoritative('repository', 'fresh repository facts supplied to evaluateDispatchEligibility'),
    authoritative('decomposition', 'fresh decomposition facts supplied to evaluateDispatchEligibility'),
    authoritative('parallelRequested', 'explicit serial or parallel dispatch route supplied to evaluateDispatchEligibility'),
    authoritative('routeAgreementRequested', 'explicit serial route requires any available decomposition artifact to agree before dispatch'),
    authoritative('parallelScanInventory', 'fresh parallel-scan inventory supplied to evaluateDispatchEligibility'),
    authoritative('assignment', 'bound role assignment supplied to evaluateDispatchEligibility'),
    authoritative('policy', 'resolved assurance policy supplied to evaluateDispatchEligibility'),
    authoritative('returnAdapter', 'selected return adapter supplied to evaluateDispatchEligibility'),
    authoritative('cleanStateObservation', 'fresh initial-state observation supplied to evaluateDispatchEligibility'),
    authoritative('inventoryRecheck', 'fresh parallel inventory recheck supplied to evaluateDispatchEligibility'),
    authoritative('authority', 'complete evaluator authority context; callable verifiers are mechanisms, while their data inventories are digest-bound'),
    authoritative('now', 'single live-clock instant resolved before evaluateDispatchEligibility'),
    output('preparedPacket', 'immutable dispatch packet emitted by preparation'),
    advisory('preflightDiagnostics', 'non-authoritative diagnostic rendering'),
    removed('verifyActivationSignature', 'external verifier executable is an evaluator mechanism, not canonicalizable input data'),
    removed('inventoryRecheck.runGit', 'Git runner executable is an evaluator mechanism, not canonicalizable input data'),
  ]),
  transition('role_start', 'dispatch_consumption', [
    authoritative('transition', 'protected handoff transition selected by recognizeHandoff'),
    authoritative('expectation', 'exact role-start expectation supplied to recognizeHandoff'),
    authoritative('preparedDispatch', 'exact parsed dispatch packet supplied to recognizeHandoff'),
    authoritative('consumedPacketIds', 'exact durable consumption inventory supplied to recognizeHandoff'),
    authoritative('observations', 'explicit non-authoritative observations graded by recognizeHandoff'),
    authoritative('now', 'single live-clock instant resolved before recognizeHandoff'),
    derived('candidateDigest', 'candidate identity does not exist before start'),
    output('dispatchConsumption', 'immutable consumed packet and deterministic attempt identity'),
    output('roleStartResult', 'atomic accepted or refused transition result'),
    advisory('preflightDiagnostics', 'presentation of validation findings'),
    removed('packetWholeEquality', 'ten-field-plus-readiness broad packet equality is replaced by this action digest'),
    removed('carrierByteDigest', 'mutable carrier rendering cannot supersede start'),
  ]),
  transition('adopt_product_work', 'active', [
    authoritative('repositoryIdentity', 'current target repository'),
    authoritative('taskId', 'task receiving the adoption'),
    authoritative('protectedContract', 'scope and attribution requirements'),
    authoritative('productLineage', 'reachable commit range and attribution'),
    authoritative('changedPaths', 'scope-checked product paths'),
    derived('priorCertification', 'certification projection to invalidate if affected'),
    output('adoptionRecord', 'atomic adoption and certification invalidation result'),
    advisory('diagnosticPresentation', 'adoption explanation'),
    removed('ancestryOnlyAdoption', 'ancestry without attribution and scope proof is not sufficient'),
  ]),
  transition('prepare_return', 'active', [
    authoritative('taskId', 'requested task identity supplied to return validation'),
    authoritative('packet', 'exact parsed dispatch packet supplied to return validation'),
    authoritative('capabilities', 'resolved activation capability inventory supplied to return validation'),
    authoritative('hostRoleCapabilities', 'resolved host-role capability inventory supplied to return validation'),
    authoritative('assurancePolicy', 'resolved assurance policy supplied to return validation'),
    authoritative('now', 'single live-clock instant resolved before validateDispatchPreparation'),
    derived('readiness', 'recomputed return readiness projection'),
    output('candidateIdentity', 'exact candidate and raw return result'),
    advisory('diagnosticPresentation', 'return blockers and next-step rendering'),
    removed('wholeCarrierDigest', 'mutable workflow projection is not candidate lineage'),
  ]),
  transition('review', 'candidate', [
    authoritative('repositoryIdentity', 'candidate repository identity'),
    authoritative('taskId', 'reviewed task identity'),
    authoritative('candidateIdentity', 'exact candidate under review'),
    authoritative('reviewerIndependence', 'independent Maintainer identity and authority'),
    authoritative('requiredCheckEvidence', 'candidate-bound checks'),
    derived('reviewReadiness', 'recomputed entry projection'),
    output('reviewRecord', 'exact-candidate review result'),
    advisory('diagnosticPresentation', 'review finding presentation'),
    removed('staleReviewReceipt', 'a receipt for another candidate is not review input'),
  ]),
  transition('audit', 'reviewed', [
    authoritative('repositoryIdentity', 'candidate repository identity'),
    authoritative('taskId', 'audited task identity'),
    authoritative('candidateIdentity', 'exact candidate under audit'),
    authoritative('reviewRecord', 'required independent review for that candidate'),
    authoritative('auditorIndependence', 'fresh Auditor identity and authority'),
    derived('auditReadiness', 'recomputed audit entry projection'),
    output('auditRecord', 'exact-candidate audit result'),
    advisory('diagnosticPresentation', 'audit finding presentation'),
    removed('auditAgeWindow', 'age does not replace exact-candidate revalidation'),
  ]),
  transition('close', 'audited', [
    authoritative('repositoryIdentity', 'candidate repository identity'),
    authoritative('taskId', 'task to close'),
    authoritative('candidateIdentity', 'exact candidate to close'),
    authoritative('requiredCheckEvidence', 'candidate-bound required checks'),
    authoritative('reviewRecord', 'required independent review result'),
    authoritative('auditRecord', 'required audit result when applicable'),
    authoritative('closeoutAuthority', 'owner closeout authority'),
    derived('closeoutReadiness', 'recomputed terminal readiness projection'),
    output('closeoutRecord', 'atomic terminal closeout result'),
    advisory('diagnosticPresentation', 'closeout explanation'),
    removed('commentDigest', 'mutable comments cannot independently close a task'),
  ]),
]);

/**
 * Bind the exact, canonicalizable input projection immediately before its
 * authoritative evaluator runs. This binding seam neither persists nor branches
 * on the digest; role-start persists it, derives its transition key from it,
 * and keyed retry resolution branches on that key.
 */
export function bindProtectedTransitionEvaluation(actionId, values) {
  const transitionDefinition = PROTECTED_TRANSITION_INPUTS.find(item => item.actionId === actionId);
  if (!transitionDefinition) throw new TypeError(`unknown protected transition '${actionId}'`);
  const expected = [...transitionDefinition.protectedInputFields].sort();
  const actual = Object.keys(values ?? {}).sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new TypeError(
      `protected transition '${actionId}' inputs must exactly match its evaluator contract: expected ${expected.join(', ')}, received ${actual.join(', ')}`
    );
  }
  const protectedInputs = Object.freeze(Object.fromEntries(expected.map(field => [field, values[field]])));
  return Object.freeze({
    actionId,
    protectedInputs,
    digest: protectedInputDigest(actionId, protectedInputs),
  });
}

function digestableProtectedInput(value) {
  if (value === undefined) return null;
  if (typeof value === 'function') return '[evaluator mechanism]';
  if (Array.isArray(value)) return value.map(digestableProtectedInput);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, digestableProtectedInput(item)]));
  }
  return value;
}

export function protectedInputDigest(actionId, values) {
  const transitionDefinition = PROTECTED_TRANSITION_INPUTS.find(item => item.actionId === actionId);
  if (!transitionDefinition) throw new TypeError(`unknown protected transition '${actionId}'`);
  const protectedInputs = Object.fromEntries(transitionDefinition.protectedInputFields.map(field => {
    if (!(field in values)) throw new TypeError(`missing protected input '${field}' for '${actionId}'`);
    return [field, values[field]];
  }));
  return canonicalSha256({ actionId, protectedInputs: digestableProtectedInput(protectedInputs) });
}
