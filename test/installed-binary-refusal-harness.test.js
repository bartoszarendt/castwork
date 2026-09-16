/**
 * Installed-binary refusals are deliberately exercised through a packed,
 * offline installation.  The catalog remains the accounting source of truth;
 * the registry records 48 installed-binary executions. Together with 5
 * pre-existing installed probes and 2 installed-module executions, the 88
 * retained hard-refusal targets partition into 24 genuinely unreachable public
 * surfaces and 16 harness-blocked routes. The separate session_reported row is
 * a warning-only non-refusal with an installed `task verify-return` proof.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HARD_REFUSAL_ALLOWLIST, REFUSAL_CLASSES } from '../src/refusal-classes.js';
import { captureActivationInput } from '../src/dispatch-envelope.js';
import { taskContractDigest } from '../src/task-contract-baseline.js';
import {
  activationGrantDigest,
  activationGrantSignaturePayload,
  OPERATOR_CONFIRMATION_PHRASE,
  taskActivationBindingDigest,
  taskActivationBindingSignaturePayload,
} from '../src/activation-grant.js';
import { activationPolicyPinPath } from '../src/activation-policy.js';
import { bindingRecordPath, grantRecordPath } from '../src/activation-store.js';
import { loadOperatorActivationKey } from '../src/activation-trust.js';
import { signHostPayload } from '../src/host-trust.js';
import { targetRepositoryIdentity } from '../src/host-trust.js';
import { createRoleReturn } from '../src/dispatch-envelope.js';
import { produceExecutionEvidence } from '../src/execution-evidence.js';
import { resolveCarrierLineage } from '../src/handoff-consumption.js';
import { createDispatchFixture, git, repositoryEvidence } from './helpers/dispatch-fixture.js';
import { protectedHostBoundary } from './helpers/host-trust-fixture.js';
import { fakeExecutableEnv, isolatedHomeEnv, sanitizedChildEnv, writeNodeBackedExecutable } from './helpers/hermetic-child-env.js';
import { runNpm } from './helpers/npm-runner.js';
import { runProcess } from './helpers/process-runner.js';
import { runCliInProcess, scriptedPromptFactory } from './helpers/run-cli.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRE_EXISTING_INSTALLED_PROBE_ROWS = new Set([
  'handoff.evidence.unauthenticated',
  'worktree.clean_gate.failed',
  'task.lifecycle.not_dispatchable',
  'task.contract.malformed',
  'task.body.identity',
]);

const INSTALLED_MODULE_ROWS = new Set([
  'projection.state.unexplained',
  'projection.fact.contradiction',
]);

const WARNING_ONLY_ROWS = new Set([
  'return.assurance.session_reported',
]);

// The named installed-binary probe proves only the warning boundary: a valid,
// receipt-less return is session-reported and its producer is not authenticated.
const SESSION_REPORTED_WARNING_PROOF = 'return.assurance.session_reported';

const NORMALIZED_PUBLIC_SURFACE_OBSTACLES = new Map([
  ['dispatch.attempt.final_slot_unacknowledged', 'the final-slot refusal has a real supported public trigger - task prepare-dispatch on the last attempt the budget allows - but a clean offline install cannot build the consumed-and-abandoned attempt history that reaches it. This is a harness limitation, not product unreachability: the executed proof is the public-CLI fixture in test/attempt-supersession.test.js.'],
  ['blocked_result.owner_mismatch', 'a schema-valid blocked return cannot pass the installed verifier: its packet carries the test-only signed adapter agenticloop.test.parser.v1, but the installed capability inventory does not expose that adapter and the verifier emits activation.capture.malformed before the blocked-result authority guard.'],
  ['blocked_result.redelegation_required', 'a schema-valid blocked return cannot pass the installed verifier: its packet carries the test-only signed adapter agenticloop.test.parser.v1, but the installed capability inventory does not expose that adapter and the verifier emits activation.capture.malformed before the blocked-result authority guard.'],
  ['blocked_result.redelegation_untrusted', 'a schema-valid blocked return cannot pass the installed verifier: its packet carries the test-only signed adapter agenticloop.test.parser.v1, but the installed capability inventory does not expose that adapter and the verifier emits activation.capture.malformed before the blocked-result authority guard.'],
  ['human_disposition.required', 'a schema-valid blocked return cannot pass the installed verifier: its packet carries the test-only signed adapter agenticloop.test.parser.v1, but the installed capability inventory does not expose that adapter and the verifier emits activation.capture.malformed before the blocked-result authority guard.'],
  ['human_disposition.untrusted', 'a schema-valid blocked return cannot pass the installed verifier: its packet carries the test-only signed adapter agenticloop.test.parser.v1, but the installed capability inventory does not expose that adapter and the verifier emits activation.capture.malformed before the blocked-result authority guard.'],
  ['execution_evidence.binding_mismatch', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before it can read execution evidence.'],
  ['execution_evidence.lineage_mismatch', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before it can read execution evidence.'],
  ['handoff.evidence.revalidation_failed', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before a stored return can exist.'],
  ['handoff.evidence.ambiguous_return', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before stored returns can compete.'],
  ['role_return.producer_mismatch', 'the installed verifier rejects the fixture authority at activation.capture.malformed before it can authenticate or compare host-signed producer receipt material.'],
  ['attempt_return_unbound', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before execution-attempt grouping.'],
  ['attempt_return_ambiguous', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before execution-attempt grouping.'],
  ['attempt_return_conflict', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before execution-attempt grouping.'],
  ['attempt_terminal_conflict', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before execution-attempt grouping.'],
  ['review.entry.persistence_conflict', 'an authentic return fixture requires a persisted verified return, but the installed verifier rejects its only supported test fixture authority at activation.capture.malformed before review-entry persistence.'],
]);

// This is intentionally a closed inventory rather than a fallback: these 24
// producers have no supported installed public trigger.  Each entry records
// the current public-surface obstacle without claiming that its typed producer
// was reached by the installed-binary run.
const CLOSED_PUBLIC_SURFACE_BLOCKERS = Object.freeze([
  {
    code: 'activation.capture.mismatch',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.capture.mismatch',
    obstacle: 'activation capture semantic mismatch collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.capture.mismatch, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.grant.repository_mismatch',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.grant.repository_mismatch',
    obstacle: 'activation grant repository mismatch collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.grant.repository_mismatch, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.grant.out_of_scope',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.grant.out_of_scope',
    obstacle: 'activation grant scope mismatch collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.grant.out_of_scope, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.binding.malformed',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.binding.malformed',
    obstacle: 'activation binding malformation collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.binding.malformed, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.binding.unauthenticated',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.binding.unauthenticated',
    obstacle: 'activation binding authentication failure collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.binding.unauthenticated, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.binding.task_mismatch',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.binding.task_mismatch',
    obstacle: 'activation binding task mismatch collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.binding.task_mismatch, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.binding.repository_mismatch',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.binding.repository_mismatch',
    obstacle: 'activation binding repository mismatch collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient; no supported public trigger exposes activation.binding.repository_mismatch, and this does not claim its typed producer was reached.',
  },
  {
    code: 'activation.identity.conflict',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.identity.conflict',
    obstacle: 'activation identity conflict collapses at the supported installed command surface into activation.binding.mismatch or activation.assurance.insufficient, or activation status succeeds with untyped reason text; no supported public trigger exposes activation.identity.conflict, and this does not claim its typed producer was reached.',
  },
  {
    code: 'scope.deviation.missing',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:scope.deviation.missing',
    obstacle: 'no supported public scope route produces scope.deviation.missing; public scope routes emit generic codes instead, and this does not claim the typed deviation producer was reached.',
  },
  {
    code: 'scope.deviation.malformed',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:scope.deviation.malformed',
    obstacle: 'no supported public scope route produces scope.deviation.malformed; public scope routes emit generic codes instead, and this does not claim the typed deviation producer was reached.',
  },
  {
    code: 'contract.baseline.stale',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:contract.baseline.stale',
    obstacle: 'the protected contract projection cannot be made stale through supported public inputs; no supported public trigger exposes contract.baseline.stale, and this does not claim its typed producer was reached.',
  },
  {
    code: 'task.body.utf8',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:task.body.utf8',
    obstacle: 'public task-body validation rejects malformed UTF-8 upstream before the task.body.utf8 typed producer; no supported public trigger reaches it, and this does not claim its typed producer was reached.',
  },
  {
    code: 'task.evidence.contract_drift',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:task.evidence.contract_drift',
    obstacle: 'valid structured evidence cannot alter the protected contract projection, so prospective-contract validation is unreachable through supported public inputs; this does not claim task.evidence.contract_drift was reached.',
  },
  {
    code: 'task.evidence.final_validation',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:task.evidence.final_validation',
    obstacle: 'the final-validation producer is unreachable at the installed surface without a valid armed lifecycle that supported public routes cannot produce; this does not claim task.evidence.final_validation was reached.',
  },
  {
    code: 'task.mutation.unresolved',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:task.mutation.unresolved',
    obstacle: 'unresolved mutation states cannot survive supported public pre-mutation validation; no supported public trigger exposes task.mutation.unresolved, and this does not claim its typed producer was reached.',
  },
  {
    code: 'dispatch.attempt.budget_exhausted',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:dispatch.attempt.budget_exhausted',
    obstacle: 'authentic exhausted attempt history still leaves public preflight green, so the budget check is unreachable through supported public inputs; this does not claim dispatch.attempt.budget_exhausted was reached.',
  },
  {
    code: 'capability.action.denied',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:capability.action.denied',
    obstacle: 'the installed capability inventory cannot present a deniable action through supported public activation; no supported public trigger exposes capability.action.denied, and this does not claim its typed producer was reached.',
  },
  {
    code: 'parallel_scan.inventory.incomplete',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:parallel_scan.inventory.incomplete',
    obstacle: 'no installed public files-route control produces an incomplete enumerator receipt; no supported public trigger exposes parallel_scan.inventory.incomplete, and this does not claim its typed producer was reached.',
  },
  {
    code: 'handoff.evidence.replayed',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:handoff.evidence.replayed',
    obstacle: 'replay states collapse during public handoff verification into generic mismatch codes; no supported public trigger exposes handoff.evidence.replayed, and this does not claim its typed producer was reached.',
  },
  {
    code: 'handoff.evidence.mismatched',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:handoff.evidence.mismatched',
    obstacle: 'this producer requires an installed-authentic successful stored verification, which the installed activation layer refuses for test-backed state; no supported public trigger reaches it, and this does not claim handoff.evidence.mismatched was reached.',
  },
  {
    code: 'return.lane.implementation_absent',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:return.lane.implementation_absent',
    obstacle: 'the installed child fails activation authentication before the lane guard; no supported public trigger exposes return.lane.implementation_absent, and this does not claim its typed producer was reached.',
  },
  {
    code: 'attribution.work_unit',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:attribution.work_unit',
    obstacle: 'the installed public surface has no work-unit-attribution trigger, so no supported public trigger exposes attribution.work_unit; this does not claim its typed producer was reached.',
  },
  {
    code: 'attribution.role',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:attribution.role',
    obstacle: 'the requested role is constrained to the installed canonical role enum, so no supported public trigger exposes attribution.role; this does not claim its typed producer was reached.',
  },
  {
    code: 'review.entry.fixup_invalid',
    status: 'blocked-by-public-surface',
    supportedPublicTrigger: false,
    proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:review.entry.fixup_invalid',
    obstacle: 'this producer requires an installed-authentic successful stored verification, which the installed activation layer refuses for test-backed state; no supported public trigger reaches it, and this does not claim review.entry.fixup_invalid was reached.',
  },
]);

const PERSISTED_RETURN_PUBLIC_SURFACE_ROWS = new Set([
  'execution_evidence.binding_mismatch', 'execution_evidence.lineage_mismatch',
  'handoff.evidence.revalidation_failed', 'handoff.evidence.ambiguous_return',
  'role_return.producer_mismatch',
  'attempt_return_unbound', 'attempt_return_ambiguous', 'attempt_return_conflict', 'attempt_terminal_conflict',
  'review.entry.persistence_conflict',
]);

const FIRST_BATCH_FAMILIES = Object.freeze([
  'activation', 'scope', 'task-contract', 'lifecycle', 'parallel-scan',
]);

const SECOND_BATCH_FAMILIES = Object.freeze([
  'review-prepare',
]);

const REVIEW_HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

let temp;
let installedBin;

function npm(args, options = {}) {
  return runNpm(args, { cache: join(temp, 'npm-cache'), ...options });
}

function installedRows() {
  const codes = HARD_REFUSAL_ALLOWLIST.map(row => row.code);
  assert.equal(codes.length, 95, 'warning-only session_reported is excluded from hard refusals');
  assert.equal(new Set(codes).size, codes.length, 'catalog rows must be unique');
  const rows = codes.filter(code => !PRE_EXISTING_INSTALLED_PROBE_ROWS.has(code) && !INSTALLED_MODULE_ROWS.has(code) && !WARNING_ONLY_ROWS.has(code));
  assert.equal(rows.length, 88, 'the installed-binary target must retain 88 hard-refusal catalog rows');
  return rows;
}

function collectCodes(value) {
  if (Array.isArray(value)) return value.flatMap(collectCodes);
  if (!value || typeof value !== 'object') return [];
  return [
    ...(typeof value.code === 'string' ? [value.code] : []),
    ...Object.values(value).flatMap(collectCodes),
  ];
}

function refusalCodes(result) {
  assert.notEqual(result.status, 0, `expected a refusal:\n${result.stdout}\n${result.stderr}`);
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    assert.fail(`installed refusal must render JSON:\n${result.stdout}\n${result.stderr}`);
  }
  return collectCodes(body);
}

function gitState(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=all']);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', `${message}\n\nTask: T-001\nAgent: maintainer`]);
}

function setTaskBody(fixture, transform, message) {
  const body = readFileSync(fixture.taskPath, 'utf8');
  writeFileSync(fixture.taskPath, transform(body), 'utf8');
  commit(fixture.root, message);
}

async function makeActivationFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-activation', { scaffold: true });
  return {
    fixture,
    args: ['task', 'new', 'must not exist', '--id', 'T-099', '--json', '--target', fixture.root],
    codes: ['activation.capture.missing'],
  };
}

async function makeActivationInputFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-activation-${kind}`);
  const capturePath = join(fixture.root, 'capture.json');
  writeFileSync(capturePath, `${JSON.stringify({
    ...captureActivationInput({ adapter: 'opencode.command.positional.v1' }),
    integrity: 'verified',
  })}\n`, 'utf8');
  commit(fixture.root, `add ${kind} activation capture`);
  return {
    fixture,
    args: [
      'task', 'new', 'must not exist', '--id', 'T-099', '--activation-input', 'capture.json', '--json', '--target', fixture.root,
    ],
    codes: [`activation.capture.${kind}`],
  };
}

async function makeScopeFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-scope');
  setTaskBody(fixture, body => body.replace('allowed_paths:\n  - src/**', '# allowed_paths:'), 'remove declared scope');
  return {
    fixture,
    args: [
      'task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root,
    ],
    codes: ['scope.declaration.missing'],
  };
}

async function makeScopeIntegrityFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-scope-integrity');
  setTaskBody(fixture, body => body.replace('allowed_paths:\n  - src/**', [
    'allowed_paths:', '  - src/**', '  - src/**', '  - absent/**', '  - docs/missing.md',
  ].join('\n')), 'make scope declarations inconsistent');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['scope.declaration.duplicate'],
  };
}

async function makeScopeInvalidFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-scope-invalid');
  setTaskBody(fixture, body => body
    .replace('allowed_paths:\n  - src/**', 'allowed_paths:\n  - ../outside')
    .replace('intended_creations:\n  - src/new.js', 'intended_creations:\n  - ../invalid\n  - docs/uncovered.md')
    .replace('risk_class: standard', 'risk_class: standard\ngenerated_paths: broken'), 'make scope declarations invalid');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['scope.declaration.invalid', 'scope.intent.invalid', 'scope.intended_creation.uncovered', 'generated.path.invalid'],
  };
}

async function makeTaskContractFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-contract');
  setTaskBody(fixture, () => '---\ntask_id: T-001\nstatus: agent-ready\n---\n\n# malformed\n', 'malform contract');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['task.contract.malformed'],
  };
}

async function makeContractBaselineFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-contract-baseline');
  rmSync(join(fixture.root, '.agenticloop', 'task-contract-history'), { recursive: true, force: true });
  commit(fixture.root, 'remove contract baseline');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['contract.baseline.invalid'],
  };
}


async function makeTaskIdentityFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-task-identity');
  setTaskBody(fixture, body => body.replace('task_id: T-001', 'task_id: T-999'), 'change task identity');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['task.record.identity_mismatch'],
  };
}

async function makeLifecycleFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-lifecycle');
  setTaskBody(fixture, body => body.replace(/^status: .*$/m, 'status: draft'), 'make task non-dispatchable');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['task.lifecycle.not_dispatchable'],
  };
}

async function makeParallelScanFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-parallel', {
    parallel: true, taskIds: ['T-001', 'T-002'],
  });
  rmSync(join(fixture.root, '.agenticloop', 'decompositions', 'T-001.json'), { force: true });
  commit(fixture.root, 'remove parallel decomposition');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--route', 'parallel', '--json', '--target', fixture.root],
    codes: ['parallel_scan.decomposition.invalid'],
  };
}

async function makeReadinessFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-readiness-${kind}`);
  if (kind === 'scope') {
    setTaskBody(fixture, body => body.replace('allowed_paths:\n  - src/**', [
      'allowed_paths:', '  - src/new.js', '  - src/missing.js', '  - absent/**',
    ].join('\n')), 'make review readiness scope incomplete');
  } else {
    setTaskBody(fixture, body => body.replace('backend: files', 'backend: files\ndepends_on:\n  - T-002'), 'add an unresolved dependency');
  }
  return {
    fixture,
    args: [
      'task-readiness', '--task', 'T-001', '--base', 'HEAD^{tree}', '--mode', 'review', '--json', '--target', fixture.root,
      ...(kind === 'dependency' ? ['--dependencies', 'dependencies.json'] : []),
    ],
    codes: kind === 'scope'
      ? ['scope.intended_creation.missing', 'scope.glob.unmatched']
      : ['dependency.unresolved'],
  };
}

async function makeCommitAttributionFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-attribution-trailer');
  const message = join(fixture.root, 'message-trailer.txt');
  writeFileSync(message, 'subject\n\nTask: OTHER\nAgent: maintainer\n', 'utf8');
  commit(fixture.root, 'add trailer attribution message');
  return {
    fixture,
    args: [
      'commit-attribution', 'check', '--task', 'T-001', '--message-file', message, '--json', '--target', fixture.root,
    ],
    codes: ['attribution.trailer'],
  };
}

async function makeActivationUnauthenticatedFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-activation-unauthenticated');
  return {
    fixture,
    args: ['activate', 'T-001', '--json', '--target', fixture.root],
    codes: ['activation.grant.unauthenticated'],
  };
}

async function makeTaskBodyFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-task-body-${kind}`);
  const fakeBin = writeFakeGh(join(temp, `fake-gh-task-body-${kind}`));
  const fakeGh = fakeGhEnvironment(fakeBin);
  const bodyPath = join(fixture.root, `task-body-${kind}.md`);
  writeFileSync(bodyPath, kind === 'utf8'
    ? Buffer.from([0xff])
    : kind === 'absent'
    ? ''
    : kind === 'invalid'
      ? '---\ntask_id: T-007\n---\n## Required Checks\n'
      : '---\ntask_id: T-007\n---\n# task\n', 'utf8');
  commit(fixture.root, `add ${kind} task body`);
  return {
    fixture,
    args: ['task-body', 'lint', '--issue', '7', '--body-file', bodyPath, '--json', '--target', fixture.root],
    env: fakeGh.env,
    fakeGhSentinel: fakeGh.sentinelPath,
    codes: [`task.${kind === 'absent' ? 'contract.absent' : kind === 'invalid' ? 'body.invalid' : kind === 'utf8' ? 'body.utf8' : 'body.attribution'}`],
  };
}

async function makeTaskEvidenceFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-evidence-lifecycle');
  return {
    fixture,
    args: [
      'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
      '--expect-digest', fixture.snapshot().digest, '--product-head', git(fixture.root, ['rev-parse', 'HEAD']),
      '--json', '--target', fixture.root,
    ],
    codes: ['task.evidence.not_in_progress'],
  };
}

/**
 * Installed binaries cannot receive a test adapter through an in-process
 * capability injection. Build the same external operator-confirmed authority
 * the consumer resolves, then point only the installed child at that isolated
 * home directory. The records remain target-local and are mutated only after
 * their producer has created an authentic baseline.
 */
async function makeOperatorActivationFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-operator-${kind}`, { scaffold: true });
  const home = join(temp, `installed-refusal-operator-home-${kind}`);
  const operatorActivationRoot = join(home, '.agenticloop', 'operator-activation');
  const activated = await runCliInProcess([
    'activate', 'T-001', '--json', '--target', fixture.root,
  ], {
    isTTY: true,
    stdinIsTTY: true,
    ci: false,
    promptFactory: scriptedPromptFactory([OPERATOR_CONFIRMATION_PHRASE]),
    operatorActivationRoot,
  });
  assert.equal(activated.status, 0, `fixture activation failed:\n${activated.stdout}\n${activated.stderr}`);

  const grantPath = join(fixture.root, grantRecordPath(JSON.parse(activated.stdout).grantId));
  const bindingPath = join(fixture.root, bindingRecordPath('files', 'T-001'));
  const readGrant = () => JSON.parse(readFileSync(grantPath, 'utf8'));
  const readBinding = () => JSON.parse(readFileSync(bindingPath, 'utf8'));
  const writeGrant = grant => writeFileSync(grantPath, `${JSON.stringify(grant, null, 2)}\n`, 'utf8');
  const writeBinding = binding => writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  const operatorKey = loadOperatorActivationKey(fixture.root, { operatorActivationRoot });
  assert.equal(operatorKey.ok, true, `fixture operator signer failed: ${operatorKey.errors.join('; ')}`);
  const authenticateGrant = grant => {
    grant.digest = activationGrantDigest(grant);
    grant.authentication = {
      algorithm: 'ed25519', keyId: operatorKey.key.keyId,
      value: signHostPayload(activationGrantSignaturePayload(grant), operatorKey.key.privateKey),
    };
    return grant;
  };
  const authenticateBinding = binding => {
    binding.digest = taskActivationBindingDigest(binding);
    binding.authentication = {
      algorithm: 'ed25519', keyId: operatorKey.key.keyId,
      value: signHostPayload(taskActivationBindingSignaturePayload(binding), operatorKey.key.privateKey),
    };
    return binding;
  };
  const rewriteGrant = mutate => {
    const grant = authenticateGrant(mutate(readGrant()));
    writeGrant(grant);
    return grant;
  };
  const rewriteBinding = mutate => {
    writeBinding(authenticateBinding(mutate(readBinding())));
  };

  const rebindToGrant = grant => rewriteBinding(binding => ({
    ...binding,
    grantId: grant.grantId,
    grantDigest: grant.digest,
    ...(kind === 'grant-repository' ? { repositoryIdentity: grant.repositoryIdentity } : {}),
  }));

  if (kind === 'grant-malformed') writeFileSync(grantPath, '{}\n', 'utf8');
  if (kind === 'grant-revoked') rewriteGrant(grant => ({ ...grant, revocation: { ...grant.revocation, state: 'revoked' } }));
  if (kind === 'grant-repository') {
    rebindToGrant(rewriteGrant(grant => ({ ...grant, repositoryIdentity: 'file:/tmp/other-repository' })));
  }
  if (kind === 'grant-out-of-scope') rebindToGrant(rewriteGrant(grant => ({
    ...grant, scope: { ...grant.scope, taskIds: ['T-002'] },
  })));
  if (kind === 'binding-malformed') rewriteBinding(binding => ({
    ...binding, expiresAt: new Date(Date.parse(readGrant().expiresAt) + 1_000).toISOString(),
  }));
  if (kind === 'binding-unauthenticated') {
    const binding = readBinding();
    binding.authentication = null;
    writeBinding(binding);
  }
  if (kind === 'binding-mismatch') rewriteBinding(binding => ({
    ...binding, grantDigest: binding.grantDigest.replace(/[a-f0-9]{64}$/, 'f'.repeat(64)),
  }));
  if (kind === 'binding-task') rewriteBinding(binding => ({
    ...binding, taskId: 'T-002', carrier: '.agenticloop/tasks/T-002.md',
  }));
  if (kind === 'binding-repository') rewriteBinding(binding => ({
    ...binding, repositoryIdentity: 'file:/tmp/other-repository',
  }));
  if (kind === 'binding-stale-contract') rewriteBinding(binding => ({
    ...binding, taskContractDigest: `sha256:v1:${'0'.repeat(64)}`,
  }));
  if (kind === 'assurance-insufficient') {
    mkdirSync(operatorActivationRoot, { recursive: true });
    writeFileSync(activationPolicyPinPath(fixture.root, operatorActivationRoot), `${JSON.stringify({
      kind: 'agenticloop.activation-policy-pin', schemaVersion: 1,
      target: { repositoryIdentity: targetRepositoryIdentity(fixture.root) }, mode: 'hardened',
    })}\n`, 'utf8');
  }
  commit(fixture.root, `prepare ${kind} operator activation refusal`);
  const expected = {
    'grant-malformed': ['activation.grant.malformed'],
    'grant-revoked': ['activation.grant.revoked'],
    'grant-repository': ['activation.grant.repository_mismatch', 'activation.binding.repository_mismatch'],
    'grant-out-of-scope': ['activation.grant.out_of_scope'],
    'binding-malformed': ['activation.grant.malformed'],
    'binding-unauthenticated': ['activation.binding.unauthenticated'],
    'binding-mismatch': ['activation.binding.mismatch'],
    'binding-task': ['activation.binding.task_mismatch'],
    'binding-repository': ['activation.binding.repository_mismatch'],
    'binding-stale-contract': ['activation.binding.stale_contract'],
    'assurance-insufficient': ['activation.assurance.insufficient'],
  };
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    env: isolatedHomeEnv(home),
    codes: expected[kind],
  };
}

async function runInstalled(args, options = {}) {
  const { env, ...runOptions } = options;
  return runProcess(process.execPath, [installedBin, ...args], {
    ...runOptions,
    env: sanitizedChildEnv(env),
  });
}

function fakeGhExecutionEnv(fakeGh, overrides = {}) {
  const preloadOption = fakeGh.preload.replace(/\\/g, '/').replaceAll('"', '\\"');
  return fakeExecutableEnv(fakeGh.bin, {
    ...overrides,
    ...(process.platform === 'win32' ? {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require="${preloadOption}"`.trim(),
    } : {}),
  });
}

function fakeGhEnvironment(fakeGh) {
  const sentinelPath = join(temp, `fake-gh-sentinel-${Math.random().toString(16).slice(2)}.log`);
  return {
    sentinelPath,
    env: fakeGhExecutionEnv(fakeGh, { FAKE_GH_SENTINEL: sentinelPath }),
  };
}

function assertFakeGhSentinel(sentinelPath, scenario) {
  assert.ok(sentinelPath, `${scenario} must declare its fake-gh sentinel`);
  assert.ok(existsSync(sentinelPath), `${scenario} must reach its fake gh before completing`);
  assert.match(readFileSync(sentinelPath, 'utf8'), /\S/, `${scenario} fake-gh sentinel must record an invocation`);
}

async function startFixtureAttempt(fixture, label) {
  const packet = `.agenticloop/tmp/${label}-dispatch.json`;
  const options = {
    operatorTrustRoot: fixture.operatorTrustRoot,
    hostAuthority: protectedHostBoundary(fixture.trust),
  };
  const prepared = await runCliInProcess([
    'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer', '--output', packet, '--json', '--target', fixture.root,
  ], options);
  assert.equal(prepared.status, 0, `fixture prepare-dispatch failed:\n${prepared.stdout}\n${prepared.stderr}`);
  const started = await runCliInProcess([
    'task', 'role-start', 'T-001', '--packet', packet, '--json', '--target', fixture.root,
  ], options);
  assert.equal(started.status, 0, `fixture role-start failed:\n${started.stdout}\n${started.stderr}`);
  const attemptStatus = await runCliInProcess([
    'task', 'attempt-status', 'T-001', '--json', '--target', fixture.root,
  ], options);
  assert.equal(attemptStatus.status, 0, `fixture attempt-status failed:\n${attemptStatus.stdout}\n${attemptStatus.stderr}`);
  return {
    packet, digest: fixture.snapshot().digest,
    attemptId: JSON.parse(attemptStatus.stdout).liveAttempt.attemptId,
    options,
  };
}

async function makeSessionReportedWarningFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-session-reported-warning', {
    scaffold: true,
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const home = join(temp, 'installed-session-reported-warning-home');
  const operatorActivationRoot = join(home, '.agenticloop', 'operator-activation');
  const activated = await runCliInProcess([
    'activate', 'T-001', '--json', '--target', fixture.root,
  ], {
    isTTY: true,
    stdinIsTTY: true,
    ci: false,
    promptFactory: scriptedPromptFactory([OPERATOR_CONFIRMATION_PHRASE]),
    operatorActivationRoot,
  });
  assert.equal(activated.status, 0, `fixture activation failed:\n${activated.stdout}\n${activated.stderr}`);
  commit(fixture.root, 'activate the receipt-less return fixture');

  const env = isolatedHomeEnv(home);
  const packet = '.agenticloop/tmp/session-reported-dispatch.json';
  const checks = '.agenticloop/tmp/T-001-checks.json';
  const roleReturn = '.agenticloop/tmp/session-reported-return.json';
  const installed = async (args, label) => {
    const result = await runInstalled(args, { env });
    assert.equal(result.status, 0, `${label} failed:\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  await installed([
    'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer',
    '--output', packet, '--json', '--target', fixture.root,
  ], 'installed prepare-dispatch');
  await installed([
    'task', 'role-start', 'T-001', '--packet', packet, '--json', '--target', fixture.root,
  ], 'installed role-start');
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', 'start receipt-less return fixture work\n\nTask: T-001\nAgent: engineer']);

  writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const current = "session-reported";\n', 'utf8');
  git(fixture.root, ['add', 'src/existing.js']);
  git(fixture.root, ['commit', '-m', 'implement receipt-less return fixture\n\nTask: T-001\nAgent: engineer']);
  const carrierDigest = () => fixture.snapshot().digest;
  const productHead = git(fixture.root, ['rev-parse', 'HEAD']);
  await installed([
    'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
    '--expect-digest', carrierDigest(), '--product-head', productHead, '--json', '--target', fixture.root,
  ], 'installed implementation artifact evidence');
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', 'record receipt-less return fixture artifact\n\nTask: T-001\nAgent: engineer']);
  await installed([
    'task', 'evidence', 'T-001', '--class', 'implementation_summary_evidence',
    '--expect-digest', carrierDigest(), '--summary', 'Receipt-less return fixture complete.',
    '--check-evidence', checks, '--json', '--target', fixture.root,
  ], 'installed implementation summary evidence');
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', 'record receipt-less return fixture summary\n\nTask: T-001\nAgent: engineer']);
  await installed([
    'task', 'evidence', 'T-001', '--class', 'implementation_outcome_evidence',
    '--expect-digest', carrierDigest(), '--outcome', 'implementation_ready_for_review', '--json', '--target', fixture.root,
  ], 'installed implementation outcome evidence');
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs']);
  git(fixture.root, ['commit', '-m', 'record receipt-less return fixture outcome\n\nTask: T-001\nAgent: engineer']);

  for (const check of JSON.parse(readFileSync(join(fixture.root, checks), 'utf8'))) {
    await installed([
      'task', 'check-evidence-update', 'T-001', '--packet', packet, '--input', checks, '--output', checks,
      '--check', check.id, '--outcome', 'passed', '--evidence', `${check.id} passed`, '--json', '--target', fixture.root,
    ], `installed required check ${check.id}`);
  }
  git(fixture.root, ['add', '.agenticloop/checks']);
  git(fixture.root, ['commit', '-m', 'record receipt-less return fixture checks\n\nTask: T-001\nAgent: engineer']);
  await installed([
    'task', 'prepare-return', 'T-001', '--packet', packet, '--check-evidence', checks,
    '--outcome', 'implementation_ready_for_review', '--output', roleReturn, '--json', '--target', fixture.root,
  ], 'installed prepare-return');
  return { fixture, env, packet, roleReturn };
}

async function makeCarrierArmedFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-carrier-armed', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, 'carrier-armed');
  return {
    fixture,
    args: [
      'task', 'status', 'T-001', 'blocked', '--block-category', 'workflow', '--note', 'must wait',
      '--expect-digest', attempt.digest, '--json', '--target', fixture.root,
    ],
    codes: ['task.carrier.armed'],
  };
}

async function makeEvidenceProvenanceFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-evidence-provenance', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, 'evidence-provenance');
  const input = '.agenticloop/tmp/mismatched-evidence.json';
  writeFileSync(join(fixture.root, input), `${JSON.stringify({
    kind: 'agenticloop.task-evidence-input', schemaVersion: 1, actorRole: 'engineer',
    provenance: {
      workflowRole: 'engineer', invocationId: 'invocation-for-another-dispatch',
      taskContractDigest: taskContractDigest(readFileSync(fixture.taskPath, 'utf8')).digest,
      attemptId: attempt.attemptId,
    },
    sections: {
      scopeCompleted: [], evidence: [], deviations: [], knownGaps: [], verificationAttempts: [],
      maintainerTriage: [], retryAuthorization: [], revisionResolution: [],
    },
  })}\n`, 'utf8');
  return {
    fixture,
    args: [
      'task', 'evidence', 'T-001', '--class', 'structured_task_evidence', '--input', input,
      '--expect-digest', attempt.digest, '--json', '--target', fixture.root,
    ],
    codes: ['task.evidence.provenance_mismatch'],
  };
}

async function makeProductHeadFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-product-head', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, 'product-head');
  return {
    fixture,
    args: [
      'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
      '--expect-digest', attempt.digest, '--product-head', '0'.repeat(40), '--json', '--target', fixture.root,
    ],
    codes: ['task.evidence.product_head'],
  };
}

async function makeEvidenceLineageFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-evidence-lineage', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, 'evidence-lineage');
  return {
    fixture,
    args: [
      'task', 'evidence', 'T-001', '--class', 'implementation_summary_evidence',
      '--expect-digest', attempt.digest, '--summary', 'out of order', '--check-evidence', 'not yet',
      '--json', '--target', fixture.root,
    ],
    codes: ['task.evidence.lineage'],
  };
}

async function makeInvalidRoleReturnFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-role-return-invalid', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, 'role-return-invalid');
  const roleReturn = '.agenticloop/tmp/invalid-role-return.json';
  writeFileSync(join(fixture.root, roleReturn), '{}\n', 'utf8');
  return {
    fixture,
    args: [
      'task', 'verify-return', 'T-001', '--packet', attempt.packet, '--return', roleReturn,
      '--from-current-repository', '--json', '--target', fixture.root,
    ],
    codes: ['role_return.invalid'],
  };
}

async function makePacketConservationFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-packet-conservation', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, 'packet-conservation');
  writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const current = false;\n', 'utf8');
  commit(fixture.root, 'record task-owned product work');
  const artifact = await runCliInProcess([
    'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
    '--expect-digest', attempt.digest, '--product-head', git(fixture.root, ['rev-parse', 'HEAD']),
    '--json', '--target', fixture.root,
  ], attempt.options);
  assert.equal(artifact.status, 0, `fixture artifact evidence failed:\n${artifact.stdout}\n${artifact.stderr}`);
  return {
    fixture,
    args: [
      'task', 'prepare-dispatch', 'T-001', '--host', 'opencode', '--role', 'engineer', '--json', '--target', fixture.root,
    ],
    codes: ['dispatch.packet.conserved'],
  };
}

async function makeAttemptHistoryFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-attempt-history', {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  await startFixtureAttempt(fixture, 'attempt-history');
  git(fixture.root, ['add', '.agenticloop/tasks', '.agenticloop/handoffs/dispatch']);
  git(fixture.root, ['commit', '-m', 'record the history-bound attempt start\n\nTask: T-001\nAgent: maintainer']);
  const head = git(fixture.root, ['rev-parse', 'HEAD']);
  const replacement = git(fixture.root, ['rev-parse', 'HEAD~1']);
  git(fixture.root, ['replace', head, replacement]);
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--host', 'opencode', '--host-trust-store', fixture.trustStorePath, '--json', '--target', fixture.root],
    codes: ['dispatch.attempt.history_rewritten'],
  };
}

async function makeReturnAssuranceFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-return-assurance');
  writeFileSync(join(fixture.root, 'agenticloop.json'), `${JSON.stringify({ activation: { mode: 'hardened' } })}\n`, 'utf8');
  commit(fixture.root, 'require hardened return assurance');
  return {
    fixture,
    args: ['task', 'handoff-preflight', 'T-001', '--json', '--target', fixture.root],
    codes: ['return.assurance.insufficient'],
  };
}

async function makeEvidenceNegativeFixture() {
  const fixture = await createDispatchFixture(temp, 'installed-refusal-evidence-negative', { scaffold: true });
  return {
    fixture,
    args: [
      'closeout', 'prepare', '--work-unit', 'milestone:M00',
      '--artifact', `commit:${git(fixture.root, ['rev-parse', 'HEAD'])}`,
      '--output', 'outside-closeout-scratch.json', '--json', '--target', fixture.root,
    ],
    codes: ['evidence.negative'],
  };
}

/**
 * Build the ordinary return through the real files CLI first.  The exceptional
 * blocked-result rows then replace only the producer-owned outcome envelope;
 * the installed binary still rederives the packet, check, Git, and carrier
 * facts before it reaches the authority guard being measured.
 */
async function makeBlockedReturnFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-blocked-${kind}`, {
    requiredChecksText: '- [RC-1] command: `node --version`',
  });
  const attempt = await startFixtureAttempt(fixture, `blocked-${kind}`);
  writeFileSync(join(fixture.root, 'src', 'existing.js'), 'export const current = "blocked-return";\n', 'utf8');
  git(fixture.root, ['add', 'src/existing.js']);
  git(fixture.root, ['commit', '-m', 'record blocked-return product work\n\nTask: T-001\nAgent: engineer']);
  const artifact = await runCliInProcess([
    'task', 'evidence', 'T-001', '--class', 'implementation_artifact_evidence',
    '--expect-digest', attempt.digest, '--product-head', git(fixture.root, ['rev-parse', 'HEAD']),
    '--json', '--target', fixture.root,
  ], attempt.options);
  assert.equal(artifact.status, 0, `fixture artifact evidence failed:\n${artifact.stdout}\n${artifact.stderr}`);
  const packet = JSON.parse(readFileSync(join(fixture.root, attempt.packet), 'utf8'));
  const productHead = git(fixture.root, ['rev-parse', 'HEAD']);
  const currentCarrierDigest = fixture.snapshot().digest;
  const lineage = resolveCarrierLineage(fixture.root, 'T-001', {
    backend: 'files', taskContractDigest: packet.task.taskContractDigest,
    boundary: 'engineer_return', currentCarrierDigest,
  });
  assert.equal(lineage.ok, true, `fixture carrier lineage failed: ${lineage.errors?.join('; ')}`);
  const evidence = repositoryEvidence(packet, { head: productHead, changedPaths: ['src/existing.js'] });
  evidence.workflowHead = productHead;
  evidence.productChangedPaths = ['src/existing.js'];
  evidence.workflowChangedPaths = [];
  evidence.productAttribution = {
    range: { base: packet.repository.head, head: productHead },
    commits: git(fixture.root, ['rev-list', '--reverse', `${packet.repository.head}..${productHead}`]).split(/\r?\n/).filter(Boolean),
  };
  evidence.task.currentCarrierDigest = currentCarrierDigest;
  evidence.carrierLineage = {
    dispatchConsumptionDigest: lineage.dispatchConsumption.digest,
    evidenceMutationReceiptDigests: lineage.receipts.map(receipt => receipt.digest),
  };
  const commandCheck = evidence.checks.find(check => check.kind === 'command');
  assert.ok(commandCheck, 'fixture requires one command check');
  const [command, ...commandArgs] = commandCheck.command.split(' ');
  const execution = produceExecutionEvidence({
    checkId: commandCheck.id, instruction: commandCheck.command, command, args: commandArgs,
    carrierRoot: fixture.root, artifactWorktreeRoot: fixture.root, workingDirectory: fixture.root,
    projectScratchRoot: join(fixture.root, '.agenticloop', 'tmp'),
    binding: {
      packetId: packet.packetId, packetDigest: packet.digest, invocationId: packet.assignment.invocationId,
      taskId: 'T-001', taskContractDigest: evidence.task.taskContractDigest,
      currentCarrierDigest, repositoryHead: productHead, productHead,
    },
  }, { run: () => ({ exitCode: 0, stdout: 'vfixture', stderr: '' }) });
  const executionPath = `.agenticloop/checks/T-001/${commandCheck.id}.execution.json`;
  mkdirSync(join(fixture.root, '.agenticloop', 'checks', 'T-001'), { recursive: true });
  writeFileSync(join(fixture.root, executionPath), `${JSON.stringify(execution, null, 2)}\n`, 'utf8');
  const raw = createRoleReturn({
    producerRole: 'engineer', packet: { packetId: packet.packetId, digest: packet.digest },
    task: { backend: packet.backend, ...evidence.task }, worktree: evidence.worktree, branch: evidence.branch,
    productBaseHead: evidence.productBaseHead, productHead: evidence.productHead, workflowHead: evidence.workflowHead,
    candidateHead: evidence.candidateHead, productChangedPaths: evidence.productChangedPaths,
    workflowChangedPaths: evidence.workflowChangedPaths,
    checks: evidence.checks.map(check => check.id === commandCheck.id
      ? { ...check, executionEvidence: { path: executionPath, digest: execution.digest } }
      : { ...check, executionEvidence: null }),
    productAttribution: evidence.productAttribution, carrierLineage: evidence.carrierLineage, pr: evidence.pr,
    outcome: { kind: 'implementation_ready_for_review', completion: false, authority: 'non_authoritative_role_outcome' },
    disposition: 'proceed', blocker: null,
    freshness: { invalidatedBy: [
      'task_or_contract_changes', 'packet_or_assignment_changes', 'branch_or_head_changes',
      'check_or_transport_evidence_changes', 'initial_repository_state_changes',
    ] },
  });
  const blocked = createRoleReturn({
    ...raw,
    outcome: { kind: 'implementation_blocked', completion: false, authority: 'non_authoritative_role_outcome' },
    disposition: 'blocked',
    blocker: {
      category: 'host_state',
      evidence: { kind: 'command_failure', detail: 'fixture host mount is read-only' },
      resumeOwner: 'engineer',
      resumeTransition: 'implementation_resume',
      resumePreconditions: { items: ['Restore the exact fixture worktree write mount.'], justification: null },
    },
  });
  const blockedReturn = '.agenticloop/tmp/blocked-return.json';
  writeFileSync(join(fixture.root, blockedReturn), `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');
  const args = [
    'task', 'verify-return', 'T-001', '--packet', attempt.packet, '--return', blockedReturn,
    '--from-current-repository', '--json', '--target', fixture.root,
  ];
  if (kind === 'owner-mismatch') args.push('--resume-owner', 'not_a_role');
  if (kind === 'redelegation-required') args.push('--resume-owner', 'maintainer');
  if (kind === 'human-required') {
    const recovery = '.agenticloop/tmp/recovery.json';
    writeFileSync(join(fixture.root, recovery), `${JSON.stringify({
      identity: 'repair:fixture-worktree-mount', class: 'host_state_repair', scope: [],
      hostState: [`worktree:${fixture.root}:write-mount`],
    }, null, 2)}\n`, 'utf8');
    args.push('--recovery-request', recovery);
  }
  const codes = {
    'owner-mismatch': ['blocked_result.owner_mismatch'],
    'redelegation-required': ['blocked_result.redelegation_required'],
    'human-required': ['human_disposition.required'],
  };
  return { fixture, args, codes: codes[kind] };
}

function reviewPrBody({ evidence = true } = {}) {
  return [
    '## Scope Completed', 'Completed.', '', '## Artifacts', `Current implementation artifact: commit:${REVIEW_HEAD}`, '',
    '## Evidence', evidence ? `Current PR head: ${REVIEW_HEAD}` : '',
    ...(evidence ? ['- Required check: [RC-1] `npm test`', '  Verdict: passed', '  Evidence: tests passed (exit 0)'] : []),
    '', '## Deviations', 'None.', '', '## Known Gaps', 'None.', '', '## Follow-Ups', 'None.', '', '[[agent: engineer]]',
  ].join('\n');
}

function reviewIssueBody({ invalidPolicy = false } = {}) {
  return [
    '---', 'task_id: T-007', 'independent_review_required: false', '---', '# T', '',
    '## Required Checks', '- [RC-1] `npm test`',
    ...(invalidPolicy ? ['AGENT_INDEPENDENT_REVIEW_REQUIRED: true'] : []),
  ].join('\n');
}

function writeFakeGh(root, {
  evidence = true, invalidPolicy = false, commitAgent = 'engineer', duplicateTask = false, auditHead = REVIEW_HEAD,
  malformedReviewHistory = false, prHead = REVIEW_HEAD, reviewComments = [],
} = {}) {
  const bin = join(root, 'fake-bin');
  const pr = {
    number: 42, headRefOid: prHead, baseRefOid: 'c'.repeat(40), body: reviewPrBody({ evidence }).replaceAll(REVIEW_HEAD, prHead),
    files: [{ path: 'src/x.js' }], closingIssuesReferences: [{ number: 7 }], statusCheckRollup: [],
    commits: [{ oid: prHead, message: `implementation\n\nTask: T-007\nAgent: ${commitAgent}` }],
    comments: malformedReviewHistory ? [{
      body: `AGENT_REVIEW_STATUS: needs_revision\nAGENT_REVIEW_MODE: host_subagent\nAGENT_REVIEW_ARTIFACT: ${REVIEW_HEAD}\n[[agent: maintainer]]`,
      author: { login: 'loop-bot', type: 'User' },
    }] : [], reviews: [],
  };
  const issue = { number: 7, title: 'T-007', body: reviewIssueBody({ invalidPolicy }), comments: [] };
  const issues = duplicateTask
    ? [issue, { number: 8, title: 'T-007', body: reviewIssueBody({ invalidPolicy }), comments: [] }]
    : [issue];
  const auditPr = { ...pr, headRefOid: auditHead };
  const historyPages = reviewComments.length > 0
    ? [reviewComments]
    : malformedReviewHistory
    ? [[{
      body: `AGENT_REVIEW_STATUS: needs_revision\nAGENT_REVIEW_MODE: host_subagent\nAGENT_REVIEW_ARTIFACT: ${REVIEW_HEAD}\n[[agent: maintainer]]`,
      author: { login: 'loop-bot', type: 'User' },
    }]]
    : [[]];
  const fixturePath = join(root, 'fixture.json');
  const preload = join(root, 'fake-gh.cjs');
  mkdirSync(root, { recursive: true });
  writeFileSync(fixturePath, JSON.stringify({ pr, issue, issues, auditPr, historyPages, prHead }), 'utf8');
  writeFileSync(preload, `
const fs = require('fs');
const path = require('path');
const isMain = require.main === module;
const isGhBinary = /gh(\\.exe)?$/i.test(path.basename(process.execPath));
if (isMain || isGhBinary) {
  if (!process.env.FAKE_GH_SENTINEL) {
    process.stderr.write('fake gh sentinel is required');
    process.exit(97);
  }
  const args = process.argv.slice(isMain ? 2 : 1);
  if (!isMain && args.length > 0 && path.isAbsolute(args[0])) args[0] = path.basename(args[0]);
  fs.appendFileSync(process.env.FAKE_GH_SENTINEL, JSON.stringify(args) + '\\n');
  const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));
  const out = value => { process.stdout.write(JSON.stringify(value) + '\\n'); process.exit(0); };
  const fail = message => { process.stderr.write(message); process.exit(1); };
  if (args[0] === 'pr' && args[1] === 'view') {
    const jsonFields = args[args.indexOf('--json') + 1] ?? '';
    if (jsonFields === 'headRefOid') out({ headRefOid: fixture.prHead });
    if (jsonFields.includes('body')) out(fixture.pr);
    out(fixture.auditPr);
  }
  if (args[0] === 'issue' && args[1] === 'view') out(fixture.issue);
  if (args[0] === 'issue' && args[1] === 'list') out(fixture.issues);
  if (args[0] === 'repo' && args[1] === 'view') out({ nameWithOwner: 'example/repo' });
  if (args[0] === 'api') {
    if (args[1] === 'user') out({ login: 'loop-bot', type: 'User' });
    const endpoint = args.find(item => typeof item === 'string' && item.startsWith('repos/')) || '';
    if (endpoint.includes('git/trees/')) out({ tree: [] });
    if (endpoint.includes('issues/42/comments')) out(fixture.historyPages);
    out([[]]);
  }
  fail('unexpected gh invocation: ' + args.join(' '));
}
`, 'utf8');
  writeNodeBackedExecutable(bin, 'gh', preload);
  return { bin, preload };
}

async function makeGitHubGateFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-${kind}`);
  const command = kind.startsWith('github-ready') ? 'github-ready'
    : kind.startsWith('github-review-audit') ? 'github-review-audit'
      : 'github-preflight';
  const reviewHead = kind === 'github-preflight-checkpoint' ? 'b'.repeat(40) : REVIEW_HEAD;
  const reviewComments = kind === 'github-preflight-checkpoint'
    ? [1, 2, 3, 4, 5].map(() => ({
      body: `AGENT_REVIEW_STATUS: needs_revision\nAGENT_REVIEW_MODE: host_subagent\nAGENT_REVIEW_ARTIFACT: ${REVIEW_HEAD}\n\n[[agent: maintainer]]`,
      user: { login: 'loop-bot', type: 'User' },
    }))
    : kind === 'github-preflight-resolution'
      ? [{
        body: `AGENT_REVIEW_STATUS: needs_revision\nAGENT_REVIEW_MODE: host_subagent\nAGENT_REVIEW_ARTIFACT: ${REVIEW_HEAD}\nAGENT_REVIEW_FINDINGS: F-1\n\n[[agent: maintainer]]`,
        user: { login: 'loop-bot', type: 'User' },
      }]
      : [];
  const fakeBin = writeFakeGh(join(temp, `fake-gh-${kind}`), {
    evidence: kind !== 'github-ready-preflight',
    invalidPolicy: kind === 'github-review-audit-contract',
    duplicateTask: kind === 'github-ready-task-identity',
    auditHead: kind === 'github-ready-cross-gate' ? 'b'.repeat(40) : REVIEW_HEAD,
    malformedReviewHistory: kind === 'github-preflight-review-history',
    commitAgent: kind === 'github-preflight' ? 'maintainer' : 'engineer',
    prHead: reviewHead,
    reviewComments,
  });
  const fakeGh = fakeGhEnvironment(fakeBin);
  const packet = join(temp, `${kind}-invalid-review-packet.json`);
  if (kind !== 'github-preflight') writeFileSync(packet, '{}', 'utf8');
  return {
    fixture,
    args: [
      command, '--pr', '42', '--repo', 'example/repo',
      ...(command === 'github-preflight' ? [] : ['--review-packet', packet]), '--json',
    ],
    env: fakeGh.env,
    fakeGhSentinel: fakeGh.sentinelPath,
    codes: [kind === 'github-preflight'
      ? 'preflight.attribution'
      : kind === 'github-preflight-checkpoint'
        ? 'preflight.review_checkpoint'
        : kind === 'github-preflight-resolution'
          ? 'preflight.revision_resolution'
        : kind === 'github-preflight-review-history'
          ? 'preflight.review_history_invalid'
        : kind === 'github-review-audit-contract'
          ? 'review_audit.task_contract'
          : kind === 'github-ready-preflight'
            ? 'ready.preflight'
            : kind === 'github-ready-task-identity'
              ? 'ready.task_identity'
              : kind === 'github-ready-cross-gate'
                ? 'ready.cross_gate_identity'
      : kind === 'github-review-audit'
        ? 'review_audit.failure'
        : 'ready.review_audit'],
  };
}

async function makeReviewPrepareFixture(kind) {
  const fixture = await createDispatchFixture(temp, `installed-refusal-review-${kind}`);
  const fakeBin = writeFakeGh(join(temp, `fake-gh-${kind}`), {
    evidence: kind !== 'preflight', invalidPolicy: kind === 'policy',
  });
  const fakeGh = fakeGhEnvironment(fakeBin);
  if (kind === 'packet') {
    mkdirSync(join(fixture.root, '.agenticloop', 'tmp'), { recursive: true });
    writeFileSync(join(fixture.root, '.agenticloop', 'tmp', 'broken-review-packet.json'), '{not json', 'utf8');
  }
  return {
    fixture,
    args: [
      'github-review-prepare', '--pr', '42', '--repo', 'example/repo', '--json', '--target', fixture.root,
      ...(kind === 'packet' ? ['--packet', join(fixture.root, '.agenticloop/tmp/broken-review-packet.json')] : []),
      ...(kind === 'workspace' ? ['--workspace', 'missing-workspace-for-installed-refusal'] : []),
    ],
    env: fakeGh.env,
    fakeGhSentinel: kind === 'packet' ? null : fakeGh.sentinelPath,
    codes: [`review_prepare.${kind === 'preflight' ? 'preflight_failed' : kind === 'policy' ? 'independent_review_policy' : kind}`],
  };
}

const FIRST_BATCH_SCENARIOS = Object.freeze([
  { family: 'activation', build: makeActivationFixture },
  { family: 'scope', build: makeScopeFixture },
  { family: 'scope', build: makeScopeIntegrityFixture },
  { family: 'scope', build: makeScopeInvalidFixture },
  { family: 'task-contract', build: makeTaskContractFixture },
  { family: 'task-contract', build: makeContractBaselineFixture },
  { family: 'lifecycle', build: makeLifecycleFixture },
  { family: 'parallel-scan', build: makeParallelScanFixture },
]);

const FIRST_BATCH_ROWS = Object.freeze([
  'activation.capture.missing',
  'scope.declaration.missing',
  'scope.declaration.duplicate',
  'scope.declaration.invalid',
  'scope.intent.invalid',
  'scope.intended_creation.uncovered',
  'generated.path.invalid',
  'contract.baseline.invalid',
  'parallel_scan.decomposition.invalid',
]);

const SECOND_BATCH_SCENARIOS = Object.freeze([
  { family: 'review-prepare', build: () => makeReviewPrepareFixture('workspace') },
  { family: 'review-prepare', build: () => makeReviewPrepareFixture('packet') },
  { family: 'review-prepare', build: () => makeReviewPrepareFixture('preflight') },
  { family: 'review-prepare', build: () => makeReviewPrepareFixture('policy') },
]);

const SECOND_BATCH_ROWS = Object.freeze([
  'review_prepare.workspace',
  'review_prepare.packet',
  'review_prepare.preflight_failed',
  'review_prepare.independent_review_policy',
]);

const THIRD_BATCH_SCENARIOS = Object.freeze([
  { family: 'scope', build: () => makeReadinessFixture('scope') },
  { family: 'dependency', build: () => makeReadinessFixture('dependency') },
  { family: 'commit-attribution', build: makeCommitAttributionFixture },
  { family: 'task-body', build: () => makeTaskBodyFixture('absent') },
  { family: 'task-body', build: () => makeTaskBodyFixture('attribution') },
  { family: 'task-body', build: () => makeTaskBodyFixture('invalid') },
  { family: 'task-evidence', build: makeTaskEvidenceFixture },
  { family: 'preflight', build: () => makeGitHubGateFixture('github-preflight') },
  { family: 'review-audit', build: () => makeGitHubGateFixture('github-review-audit') },
  { family: 'ready', build: () => makeGitHubGateFixture('github-ready') },
]);

const THIRD_BATCH_ROWS = Object.freeze([
  'scope.intended_creation.missing',
  'scope.glob.unmatched',
  'dependency.unresolved',
  'attribution.trailer',
  'task.contract.absent',
  'task.body.attribution',
  'task.body.invalid',
  'task.evidence.not_in_progress',
  'preflight.attribution',
  'review_audit.failure',
  'ready.review_audit',
]);

const FOURTH_BATCH_SCENARIOS = Object.freeze([
  { family: 'activation', build: () => makeActivationInputFixture('malformed') },
  { family: 'activation', build: makeActivationUnauthenticatedFixture },
  { family: 'task-contract', build: makeTaskIdentityFixture },
  { family: 'return-assurance', build: makeReturnAssuranceFixture },
  { family: 'ready', build: () => makeGitHubGateFixture('github-ready-preflight') },
  { family: 'ready', build: () => makeGitHubGateFixture('github-ready-task-identity') },
  { family: 'ready', build: () => makeGitHubGateFixture('github-ready-cross-gate') },
  { family: 'review-audit', build: () => makeGitHubGateFixture('github-review-audit-contract') },
  { family: 'preflight', build: () => makeGitHubGateFixture('github-preflight-review-history') },
]);

const FOURTH_BATCH_ROWS = Object.freeze([
  'activation.capture.malformed',
  'activation.grant.unauthenticated',
  'task.record.identity_mismatch',
  'return.assurance.insufficient',
  'ready.preflight',
  'ready.task_identity',
  'ready.cross_gate_identity',
  'review_audit.task_contract',
  'preflight.review_history_invalid',
]);

const FIFTH_BATCH_SCENARIOS = Object.freeze([
  { family: 'task-evidence', build: makeCarrierArmedFixture },
  { family: 'task-evidence', build: makeEvidenceProvenanceFixture },
  { family: 'task-evidence', build: makeProductHeadFixture },
  { family: 'task-evidence', build: makeEvidenceLineageFixture },
  { family: 'return', build: makeInvalidRoleReturnFixture },
  { family: 'dispatch', build: makePacketConservationFixture },
]);

const FIFTH_BATCH_ROWS = Object.freeze([
  'task.carrier.armed',
  'task.evidence.provenance_mismatch',
  'task.evidence.product_head',
  'task.evidence.lineage',
  'role_return.invalid',
  'dispatch.packet.conserved',
]);

const SIXTH_BATCH_SCENARIOS = Object.freeze([
  { family: 'activation-grant', build: () => makeOperatorActivationFixture('grant-malformed') },
  { family: 'activation-grant', build: () => makeOperatorActivationFixture('grant-revoked') },
  { family: 'activation-binding', build: () => makeOperatorActivationFixture('binding-mismatch') },
  { family: 'activation-binding', build: () => makeOperatorActivationFixture('binding-stale-contract') },
  { family: 'activation-policy', build: () => makeOperatorActivationFixture('assurance-insufficient') },
]);

const SIXTH_BATCH_ROWS = Object.freeze([
  'activation.grant.malformed',
  'activation.grant.revoked',
  'activation.binding.mismatch',
  'activation.binding.stale_contract',
  'activation.assurance.insufficient',
]);

const SEVENTH_BATCH_SCENARIOS = Object.freeze([
  { family: 'attempt-history', build: makeAttemptHistoryFixture },
]);

const SEVENTH_BATCH_ROWS = Object.freeze([
  'dispatch.attempt.history_rewritten',
]);

const BLOCKED_RETURN_PUBLIC_SURFACE_SCENARIOS = Object.freeze([
  {
    family: 'blocked-result-public-surface',
    build: () => makeBlockedReturnFixture('owner-mismatch'),
    observedCodes: ['activation.capture.malformed'],
  },
]);

const DISCOVERED_PUBLIC_SURFACE_SCENARIOS = Object.freeze([
  { family: 'preflight-public-route', build: () => makeGitHubGateFixture('github-preflight-checkpoint') },
  { family: 'preflight-public-route', build: () => makeGitHubGateFixture('github-preflight-resolution') },
]);

// The installed artifact has no public supported activation adapter: shipped
// adapters are deliberately fail-closed and dynamic supported adapters are
// rejected at the public boundary. These fixtures build the real return shape
// up to that boundary, then prove that each persisted-return-dependent refusal
// is unreachable without changing that public surface.
const PERSISTED_RETURN_PUBLIC_SURFACE_SCENARIOS = Object.freeze(
  [...PERSISTED_RETURN_PUBLIC_SURFACE_ROWS].map(code => ({
    family: `persisted-return-public-surface:${code}`,
    build: async () => ({
      ...(await makeBlockedReturnFixture('owner-mismatch')),
      observedCodes: ['activation.capture.malformed'],
    }),
  }))
);

const EVIDENCE_NEGATIVE_PUBLIC_ROUTE_SCENARIO = Object.freeze({
  family: 'evidence-negative-public-route',
  build: makeEvidenceNegativeFixture,
});

const CORRECTED_PUBLIC_ROUTE_ROWS = Object.freeze([
  'preflight.review_checkpoint', 'preflight.revision_resolution', 'evidence.negative',
]);

const RESIDUE_TABLE_START = '<!-- installed-refusal-residue:start -->';
const RESIDUE_TABLE_END = '<!-- installed-refusal-residue:end -->';

function executedInstalledBinaryRows() {
  return [
    ...FIRST_BATCH_ROWS, ...SECOND_BATCH_ROWS, ...THIRD_BATCH_ROWS, ...FOURTH_BATCH_ROWS,
    ...FIFTH_BATCH_ROWS, ...SIXTH_BATCH_ROWS, ...SEVENTH_BATCH_ROWS, ...CORRECTED_PUBLIC_ROUTE_ROWS,
  ];
}

function executedRowReference(code) {
  const batches = [
    ['FIRST_BATCH_ROWS', FIRST_BATCH_ROWS], ['SECOND_BATCH_ROWS', SECOND_BATCH_ROWS],
    ['THIRD_BATCH_ROWS', THIRD_BATCH_ROWS], ['FOURTH_BATCH_ROWS', FOURTH_BATCH_ROWS],
    ['FIFTH_BATCH_ROWS', FIFTH_BATCH_ROWS], ['SIXTH_BATCH_ROWS', SIXTH_BATCH_ROWS],
    ['SEVENTH_BATCH_ROWS', SEVENTH_BATCH_ROWS], ['CORRECTED_PUBLIC_ROUTE_ROWS', CORRECTED_PUBLIC_ROUTE_ROWS],
  ];
  const batch = batches.find(([, rows]) => rows.includes(code));
  return batch ? `test/installed-binary-refusal-harness.test.js#${batch[0]}:${code}` : null;
}

function closedPublicSurfaceBlockers(catalog = HARD_REFUSAL_ALLOWLIST, inventory = CLOSED_PUBLIC_SURFACE_BLOCKERS) {
  const inventoryCodes = inventory.map(row => row.code);
  assert.equal(inventoryCodes.length, 24, 'the closed public-surface blocker inventory must retain exactly 24 rows');
  assert.equal(new Set(inventoryCodes).size, inventoryCodes.length, 'the closed public-surface blocker inventory may not duplicate rows');
  const fallbackCodes = catalog
    .map(row => row.code)
    .filter(code => !PRE_EXISTING_INSTALLED_PROBE_ROWS.has(code)
      && !INSTALLED_MODULE_ROWS.has(code)
      && !WARNING_ONLY_ROWS.has(code)
      && !executedInstalledBinaryRows().includes(code)
      && !NORMALIZED_PUBLIC_SURFACE_OBSTACLES.has(code));
  assert.deepEqual([...inventoryCodes].sort(), [...fallbackCodes].sort(),
    'every otherwise-unclassified catalog row must have one closed public-surface blocker, and unsupported blocked classifications must fail');
  for (const blocker of inventory) {
    assert.equal(blocker.status, 'blocked-by-public-surface',
      `${blocker.code} must retain its explicit blocked-by-public-surface status`);
    assert.equal(blocker.supportedPublicTrigger, false,
      `${blocker.code} must explicitly record the absence of a supported public trigger`);
    assert.equal(blocker.proof, `test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:${blocker.code}`,
      `${blocker.code} must retain its candidate-bound proof reference`);
    assert.doesNotMatch(blocker.obstacle, /exhaustive candidate-bound non-execution disposition/i,
      `${blocker.code} may not use the generic public-surface rationale`);
    assert.match(blocker.obstacle, /no supported public (trigger|scope route|files-route control)|unreachable through supported public inputs|supported public routes cannot produce|through supported public activation/i,
      `${blocker.code} must name its concrete public-surface obstacle`);
    assert.match(blocker.obstacle, /does not claim .* was reached/i,
      `${blocker.code} must preserve no-overclaim semantics`);
  }
  return new Map(inventory.map(blocker => [blocker.code, blocker]));
}

function residueRows(catalog = HARD_REFUSAL_ALLOWLIST, inventory = CLOSED_PUBLIC_SURFACE_BLOCKERS) {
  const blockers = closedPublicSurfaceBlockers(catalog, inventory);
  const executedBinary = new Set(executedInstalledBinaryRows());
  return catalog.map(({ code }) => {
    if (PRE_EXISTING_INSTALLED_PROBE_ROWS.has(code)) return { code, status: 'pre-existing-installed-probe', disposition: 'executed', proof: `test/packed-package.test.js#INSTALLED_CLI_NEGATIVE_PROBE_CODES:${code}`, obstacle: 'n/a' };
    if (INSTALLED_MODULE_ROWS.has(code)) return { code, status: 'executed-installed-module', disposition: 'module-only', proof: `test/packed-package.test.js#INSTALLED_MODULE_NEGATIVE_PROBE_CODES:${code}`, obstacle: 'n/a' };
    if (executedBinary.has(code)) return { code, status: 'executed-installed-binary', disposition: 'executed', proof: executedRowReference(code), obstacle: 'n/a' };
    if (WARNING_ONLY_ROWS.has(code)) return {
      code, status: 'warning-only/non-refusal',
      disposition: 'warning-only',
      proof: `test/installed-binary-refusal-harness.test.js#SESSION_REPORTED_WARNING_PROOF:${SESSION_REPORTED_WARNING_PROOF}`,
      obstacle: 'warning-only/non-refusal: packed clean-installed task verify-return proves the warning, producerAuthenticated false, and no authenticated overclaim.',
    };
    if (NORMALIZED_PUBLIC_SURFACE_OBSTACLES.has(code)) return {
      code, status: 'harness-blocked',
      disposition: 'harness-blocked',
      proof: `test/installed-binary-refusal-harness.test.js#${PERSISTED_RETURN_PUBLIC_SURFACE_ROWS.has(code) ? 'PERSISTED_RETURN_PUBLIC_SURFACE_SCENARIOS' : code.startsWith('blocked_result.') || code.startsWith('human_disposition.') ? 'BLOCKED_RETURN_PUBLIC_SURFACE_SCENARIOS' : 'NORMALIZED_PUBLIC_SURFACE_ROWS'}:${code}`,
      obstacle: `blocked-by-public-surface: ${NORMALIZED_PUBLIC_SURFACE_OBSTACLES.get(code)}`,
    };
    const blocker = blockers.get(code);
    assert.ok(blocker, `${code} is unclassified and may not default to blocked-by-public-surface`);
    return {
      code,
      status: 'unreachable-through-supported-public-surface',
      disposition: 'unreachable-through-supported-public-surface',
      proof: blocker.proof,
      obstacle: `blocked-by-public-surface: ${blocker.obstacle}`,
    };
  });
}

function parseResidueTable(document) {
  const start = document.indexOf(RESIDUE_TABLE_START);
  const end = document.indexOf(RESIDUE_TABLE_END);
  assert.ok(start >= 0 && end > start, 'integrated proof must retain one bounded installed-refusal residue table');
  const lines = document.slice(start + RESIDUE_TABLE_START.length, end).trim().split('\n');
  assert.equal(lines[0], '| Code | Current status | Proof reference | Current obstacle |', 'residue table header drifted');
  assert.equal(lines[1], '|---|---|---|---|', 'residue table separator drifted');
  return lines.slice(2).filter(Boolean).map(line => {
    const columns = line.split('|').slice(1, -1).map(column => column.trim());
    assert.equal(columns.length, 4, `residue row must contain four columns: ${line}`);
    return { code: columns[0], status: columns[1], proof: columns[2], obstacle: columns[3] };
  });
}

function assertResidueLedger(document) {
  const parsed = parseResidueTable(document);
  const expected = residueRows();
  const warning = parsed.filter(row => row.status === 'warning-only/non-refusal');
  const hardParsed = parsed.filter(row => row.status !== 'warning-only/non-refusal');
  assert.equal(hardParsed.length, HARD_REFUSAL_ALLOWLIST.length, 'hard residue ledger row count must equal the catalog');
  assert.equal(warning.length, 1, 'session_reported must remain the one warning-only non-refusal');
  assert.equal(new Set(parsed.map(row => row.code)).size, parsed.length, 'residue ledger may not duplicate catalog rows');
  assert.deepEqual([...hardParsed.map(row => row.code)].sort(), [...HARD_REFUSAL_ALLOWLIST.map(row => row.code)].sort(), 'residue ledger must contain every hard catalog row exactly once');
  const byCode = rows => Object.fromEntries(rows.map(row => [row.code, row]));
  assert.deepEqual(byCode(hardParsed), byCode(expected.map(({ disposition, ...row }) => row)), 'residue ledger must be generated from the catalog and executed-row registry');
  const executedBinary = new Set(executedInstalledBinaryRows());
  for (const row of parsed) {
    if (executedBinary.has(row.code)) {
      assert.equal(row.status, 'executed-installed-binary', `${row.code} must remain installed-binary execution`);
      assert.equal(row.proof, executedRowReference(row.code), `${row.code} must retain its installed-binary proof reference`);
    }
  }
  assert.equal(NORMALIZED_PUBLIC_SURFACE_OBSTACLES.size, 16, 'the harness-blocked partition contains 16 rows');
  assert.equal(CLOSED_PUBLIC_SURFACE_BLOCKERS.length, 24, 'the explicit public-surface inventory must remain closed at 24 rows');
  assert.equal(parsed.filter(row => row.status === 'harness-blocked').length, 16,
    'harness limits must remain separate from product-surface unreachability');
  assert.equal(parsed.filter(row => row.status === 'unreachable-through-supported-public-surface').length, 24,
    'only the closed public inventory may claim product-surface unreachability');
  const partition = expected.reduce((counts, row) => {
    counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(partition, {
    executed: 53,
    'module-only': 2,
    'harness-blocked': 16,
    'unreachable-through-supported-public-surface': 24,
  }, 'harness limitations must not be ratcheted as product unreachability');
}

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'agenticloop-installed-refusals-'));
  const packDir = join(temp, 'pack');
  mkdirSync(packDir, { recursive: true });
  const packed = await npm(['pack', '--pack-destination', packDir], { cwd: REPO_ROOT });
  assert.equal(packed.status, 0, `npm pack failed:\n${packed.stdout}\n${packed.stderr}`);
  const archive = join(packDir, readdirSync(packDir).find(path => path.endsWith('.tgz')));
  const prefix = join(temp, 'prefix');
  const installed = await npm(['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', archive]);
  assert.equal(installed.status, 0, `npm install failed:\n${installed.stdout}\n${installed.stderr}`);
  installedBin = join(prefix, 'node_modules', 'agenticloop', 'bin', 'agenticloop.js');
}, { timeout: 300000 });

after(() => rmSync(temp, { recursive: true, force: true }));

describe('installed-binary refusal harness', () => {
  it('binds the installed-refusal residue table to the catalog and executed-row registry', () => {
    const document = readFileSync(join(REPO_ROOT, 'docs', 'integrated-proof.md'), 'utf8');
    assertResidueLedger(document);

    const first = residueRows()[0];
    const removed = document.replace(`| ${first.code} | ${first.status} | ${first.proof} | ${first.obstacle} |\n`, '');
    assert.throws(() => assertResidueLedger(removed), /row count|contain every catalog row/, 'removing a residue row must fail accounting');

    assert.throws(() => closedPublicSurfaceBlockers(HARD_REFUSAL_ALLOWLIST, CLOSED_PUBLIC_SURFACE_BLOCKERS.slice(1)),
      /exactly 24 rows|one closed public-surface blocker/,
      'removing a closed-inventory row must fail candidate-bound accounting');
    const substituted = CLOSED_PUBLIC_SURFACE_BLOCKERS.map((blocker, index) => index === 0
      ? { ...blocker, code: 'activation.capture.missing', proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:activation.capture.missing' }
      : blocker);
    assert.throws(() => closedPublicSurfaceBlockers(HARD_REFUSAL_ALLOWLIST, substituted),
      /one closed public-surface blocker|unsupported blocked classifications/,
      'substituting a catalog identity into the closed inventory must fail');
    const genericRationale = CLOSED_PUBLIC_SURFACE_BLOCKERS.map((blocker, index) => index === 0
      ? { ...blocker, obstacle: 'exhaustive candidate-bound non-execution disposition.' }
      : blocker);
    assert.throws(() => closedPublicSurfaceBlockers(HARD_REFUSAL_ALLOWLIST, genericRationale),
      /may not use the generic public-surface rationale/,
      'a generic closed-inventory rationale must fail');
    const unsupportedBlocked = CLOSED_PUBLIC_SURFACE_BLOCKERS.map((blocker, index) => index === 0
      ? { ...blocker, code: 'task.contract.absent', proof: 'test/installed-binary-refusal-harness.test.js#CLOSED_PUBLIC_SURFACE_BLOCKERS:task.contract.absent' }
      : blocker);
    assert.throws(() => closedPublicSurfaceBlockers(HARD_REFUSAL_ALLOWLIST, unsupportedBlocked),
      /unsupported blocked classifications/,
      'classifying an executed catalog row as blocked-by-public-surface must fail');
    assert.throws(() => residueRows([...HARD_REFUSAL_ALLOWLIST, { code: 'unknown.unclassified.row' }]),
      /one closed public-surface blocker|unsupported blocked classifications/,
      'an unknown or unclassified catalog row must fail rather than default to blocked-by-public-surface');

    const executed = residueRows().find(row => row.status === 'executed-installed-binary');
    const statusDrift = document.replace(
      `| ${executed.code} | executed-installed-binary | ${executed.proof} | ${executed.obstacle} |`,
      `| ${executed.code} | pending-disposition | ${executed.proof} | ${executed.obstacle} |`,
    );
    assert.throws(() => assertResidueLedger(statusDrift), /generated from the catalog and executed-row registry/, 'altering a residue status must fail accounting');

    const blocked = residueRows().find(row => row.status === 'unreachable-through-supported-public-surface');
    const fabricatedExecution = document.replace(
      `| ${blocked.code} | unreachable-through-supported-public-surface | ${blocked.proof} | ${blocked.obstacle} |`,
      `| ${blocked.code} | executed-installed-binary | ${blocked.proof} | n/a |`,
    );
    assert.throws(() => assertResidueLedger(fabricatedExecution), /generated from the catalog and executed-row registry/, 'a fabricated installed execution must fail accounting');
  });

  it('keeps the 88-row hard-refusal target partition explicit', () => {
    const target = installedRows();
    const executedRows = executedInstalledBinaryRows();
    assert.equal(new Set(executedRows).size, executedRows.length, 'a batch row may not be counted twice');
    assert.ok(executedRows.every(code => target.includes(code)), 'batch rows must belong to the 88-row target');
    assert.equal(FIRST_BATCH_ROWS.length, 9, 'the first executable slice must name each target row once');
    assert.equal(SECOND_BATCH_ROWS.length, 4, 'the second executable slice must name each target row once');
    assert.equal(THIRD_BATCH_ROWS.length, 11, 'the third executable slice must name each target row once');
    assert.equal(FOURTH_BATCH_ROWS.length, 9, 'the fourth executable slice must name each target row once');
    assert.equal(FIFTH_BATCH_ROWS.length, 6, 'the fifth executable slice must name each target row once');
    assert.equal(SIXTH_BATCH_ROWS.length, 5, 'the sixth executable slice must name each target row once');
    assert.equal(SEVENTH_BATCH_ROWS.length, 1, 'the seventh executable slice must name each target row once');
    assert.equal(CORRECTED_PUBLIC_ROUTE_ROWS.length, 3, 'the authorized public-route correction slice must name exactly three rows');
    assert.equal(executedRows.length, 48, 'the installed-binary registry must retain 48 executed hard-refusal rows');
    assert.equal(target.length - executedRows.length, 40, 'blocked public-surface hard-refusal rows must stay explicit');
    assert.deepEqual([...new Set(FIRST_BATCH_SCENARIOS.map(row => row.family))], FIRST_BATCH_FAMILIES);
    assert.deepEqual([...new Set(SECOND_BATCH_SCENARIOS.map(row => row.family))], SECOND_BATCH_FAMILIES);

    assert.throws(() => {
      const missing = HARD_REFUSAL_ALLOWLIST.slice(1).map(row => row.code);
      assert.equal(missing.length, 95, 'the catalog must retain all hard-refusal rows');
    }, /must retain all hard-refusal rows/, 'removing a catalog row must make accounting fail');
  });

  it('emits the receipt-less return warning through installed task verify-return without authenticated overclaim', async () => {
    const { fixture, env, packet, roleReturn } = await makeSessionReportedWarningFixture();
    const result = await runInstalled([
      'task', 'verify-return', 'T-001', '--packet', packet, '--return', roleReturn,
      '--from-current-repository', '--json', '--target', fixture.root,
    ], { env });
    assert.equal(result.status, 0, `installed verify-return failed:\n${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    const verified = JSON.parse(result.stdout);
    assert.ok(collectCodes(verified).includes(SESSION_REPORTED_WARNING_PROOF),
      `installed verify-return must emit ${SESSION_REPORTED_WARNING_PROOF}:\n${output}`);
    const warning = verified.warningDiagnostics.find(item => item.code === SESSION_REPORTED_WARNING_PROOF);
    assert.equal(warning?.evidence?.producerAuthenticated, false,
      `installed verify-return must report an unauthenticated producer:\n${output}`);
    assert.doesNotMatch(output, /producerAuthenticated"\s*:\s*true|cryptographically host-authenticated(?!\.)|authenticated producer identity/i,
      `installed verify-return must never overclaim authenticated producer identity:\n${output}`);
  });

  it('fails locally when the fake gh stub is absent and cannot reach a fallback CLI', async () => {
    const fixture = await createDispatchFixture(temp, 'installed-refusal-missing-fake-gh');
    const missingBin = join(temp, 'missing-fake-gh-bin');
    mkdirSync(missingBin, { recursive: true });
    const fallbackSentinel = join(temp, 'real-gh-fallback-must-not-run.log');
    const result = await runInstalled([
      'github-preflight', '--pr', '42', '--repo', 'example/repo', '--json', '--target', fixture.root,
    ], { env: fakeExecutableEnv(missingBin, { FAKE_GH_SENTINEL: fallbackSentinel }) });
    assert.notEqual(result.status, 0, `missing fake gh must fail locally:\n${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(fallbackSentinel), false, 'a missing fake gh must not execute any fallback CLI');
  });

  it('fails locally when the fake gh stub is malformed and cannot reach a fallback CLI', async () => {
    const fixture = await createDispatchFixture(temp, 'installed-refusal-malformed-fake-gh');
    const fakeBin = writeFakeGh(join(temp, 'malformed-fake-gh'));
    const fallbackSentinel = join(temp, 'malformed-real-gh-fallback-must-not-run.log');
    const result = await runInstalled([
      'github-preflight', '--pr', '42', '--repo', 'example/repo', '--json', '--target', fixture.root,
    ], { env: fakeGhExecutionEnv(fakeBin, { FAKE_GH_FALLBACK_SENTINEL: fallbackSentinel }) });
    assert.notEqual(result.status, 0, `malformed fake gh must fail locally:\n${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(fallbackSentinel), false, 'a malformed fake gh must not execute any fallback CLI');
  });

  for (const scenario of [...FIRST_BATCH_SCENARIOS, ...SECOND_BATCH_SCENARIOS, ...THIRD_BATCH_SCENARIOS, ...FOURTH_BATCH_SCENARIOS, ...FIFTH_BATCH_SCENARIOS, ...SIXTH_BATCH_SCENARIOS, ...SEVENTH_BATCH_SCENARIOS, ...DISCOVERED_PUBLIC_SURFACE_SCENARIOS, ...BLOCKED_RETURN_PUBLIC_SURFACE_SCENARIOS, ...PERSISTED_RETURN_PUBLIC_SURFACE_SCENARIOS, EVIDENCE_NEGATIVE_PUBLIC_ROUTE_SCENARIO]) {
    it(`refuses the ${scenario.family} fixture through the installed binary without mutation`, async () => {
      const { fixture, args, env, fakeGhSentinel, codes: expectedCodes, observedCodes } = await scenario.build();
      const before = gitState(fixture.root);
      const result = await runInstalled(args, { env });
      const codes = refusalCodes(result);
      const expected = observedCodes ?? scenario.observedCodes ?? expectedCodes;
      for (const code of expected) {
        assert.ok(codes.includes(code), `${scenario.family} must expose ${code}; received ${codes.join(', ')}\n${result.stdout}`);
      }
      if (fakeGhSentinel) assertFakeGhSentinel(fakeGhSentinel, scenario.family);
      assert.equal(gitState(fixture.root), before, `${scenario.family} refusal must not mutate target state`);
    });
  }
});
