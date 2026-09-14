/** Direct checks for the retained durable-evidence inventory. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_INVENTORY,
  STORAGE_CLASSES,
  validateEvidenceInventory,
} from './helpers/evidence-inventory.js';
import { DEFAULT_GENERATED_ARTIFACTS_PATH, LOCAL_GENERATED_ARTIFACTS_PATH } from '../src/generated-artifacts.js';
import { OPERATOR_TRUST_DIRECTORY } from '../src/host-trust.js';
import { LOCAL_CONFIG_RELATIVE_PATH } from '../src/hydration.js';
import {
  AUDITS_DIRECTORY_RELATIVE_PATH,
  CHECK_EVIDENCE_DIRECTORY_RELATIVE_PATH,
  FILES_TASK_CONTRACT_HISTORY_DIRECTORY,
  IMPROVEMENTS_DIRECTORY_RELATIVE_PATH,
  LOGS_DIRECTORY_RELATIVE_PATH,
  PROJECT_MAP_RELATIVE_PATH,
  TASKS_DIRECTORY_RELATIVE_PATH,
} from '../src/layout.js';
import { PERMITTED_SCRATCH_PREFIXES } from '../src/repository-state.js';
import { WORKTREE_PARENT } from '../src/worktree.js';


describe('the inventory satisfies its own contract', () => {
  it('gives every class a producer, consumer, decision, retention, storage class, and projection', () => {
    const checked = validateEvidenceInventory();
    assert.equal(checked.ok, true, checked.errors.join('\n'));
  });

  it('makes every class name a real storage class', () => {
    for (const [name, item] of Object.entries(EVIDENCE_INVENTORY)) {
      assert.ok(Object.hasOwn(STORAGE_CLASSES, item.storageClass), `${name}: ${item.storageClass}`);
    }
  });

  it('requires a derivable class to justify being persisted at all', () => {
    const speculative = {
      root: '.agenticloop/speculative', producer: 'nobody', consumer: 'nobody', decision: 'none',
      derivable: true, retention: 'forever', storageClass: 'durable_project_evidence', visibleTo: [],
    };
    const checked = validateEvidenceInventory({ speculative });
    assert.equal(checked.ok, false);
    assert.match(checked.errors.join('; '), /justify why it is persisted/);
    assert.match(checked.errors.join('; '), /visible to no role must state why/);
  });

  it('records the cache reclassification honestly', () => {
    const cache = EVIDENCE_INVENTORY.handoff_derived_evidence;
    assert.match(cache.decision, /none that is authoritative/);
    assert.match(cache.reviewDisposition, /^resolved: /);
  });

  it('names only the two derivable persisted classes', () => {
    const derivable = Object.entries(EVIDENCE_INVENTORY)
      .filter(([, item]) => item.derivable)
      .map(([name]) => name)
      .sort();
    assert.deepEqual(derivable, ['handoff_derived_evidence', 'scratch']);
  });
});

describe('the inventory traces retained product storage directly', () => {
  it('accounts for the canonical writer and consumer paths', () => {
    const inventoried = new Set(Object.values(EVIDENCE_INVENTORY).map(item => item.root));
    const authorities = [
      PROJECT_MAP_RELATIVE_PATH,
      TASKS_DIRECTORY_RELATIVE_PATH,
      FILES_TASK_CONTRACT_HISTORY_DIRECTORY,
      AUDITS_DIRECTORY_RELATIVE_PATH,
      IMPROVEMENTS_DIRECTORY_RELATIVE_PATH,
      LOGS_DIRECTORY_RELATIVE_PATH,
      CHECK_EVIDENCE_DIRECTORY_RELATIVE_PATH,
      DEFAULT_GENERATED_ARTIFACTS_PATH,
      LOCAL_GENERATED_ARTIFACTS_PATH,
      LOCAL_CONFIG_RELATIVE_PATH,
      `~/${OPERATOR_TRUST_DIRECTORY}`,
      WORKTREE_PARENT,
      '.agenticloop/reviews/entries',
    ];
    assert.deepEqual(authorities.filter(root => !inventoried.has(root)), []);
  });

  it('keeps the lifecycle writer roots visible in the inventory', () => {
    const inventoried = new Set(Object.values(EVIDENCE_INVENTORY).map(item => item.root));
    for (const root of [
      '.agenticloop/tasks', '.agenticloop/task-contract-history', '.agenticloop/decompositions',
      '.agenticloop/activations', '.agenticloop/handoffs/dispatch', '.agenticloop/handoffs/task-mutations',
      '.agenticloop/handoffs/attempts', '.agenticloop/returns/verifications', '.agenticloop/adoptions',
    ]) assert.ok(inventoried.has(root), `${root} is not inventoried`);
  });

  it('keeps commit adoption distinct from historical adoption and does not retain remediation state', () => {
    const commit = EVIDENCE_INVENTORY.commit_adoption;
    const historical = EVIDENCE_INVENTORY.historical_adoption;
    assert.notEqual(commit.root, historical.root);
    assert.match(commit.decision, /non_authenticated_claim/);
    assert.match(commit.consumer, /independently derives attribution/);
    assert.match(commit.consumer, /no consumer uses the claim for permission, origin, or certification/);
    assert.doesNotMatch(JSON.stringify(EVIDENCE_INVENTORY), /remediation-authority/i);
  });

  it('records corrected producer and machine-local workspace semantics', () => {
    assert.match(EVIDENCE_INVENTORY.review_entry_receipt.producer, /review-prepare/);
    assert.match(EVIDENCE_INVENTORY.review_entry_receipt.producer, /review-attach-outcome/);
    assert.equal(EVIDENCE_INVENTORY.local_hydration_configuration.producer, 'operator or local configuration author');
    assert.equal(EVIDENCE_INVENTORY.local_hydration_configuration.consumer, 'hydration and configuration resolution');
    assert.equal(EVIDENCE_INVENTORY.worktree_summary, undefined);
    assert.match(EVIDENCE_INVENTORY.worktree_workspace_state.decision, /machine-local task workspaces/);
    assert.equal(EVIDENCE_INVENTORY.repository_host_trust_manifest, undefined);
  });

  it('keeps an artifact kind only where its inventory row explains its durable storage', () => {
    for (const [name, item] of Object.entries(EVIDENCE_INVENTORY)) {
      if (!item.artifactKind) continue;
      assert.match(item.artifactKind, /^agenticloop\.[a-z0-9-]+$/);
      assert.match(item.root, /\S/, `${name} must name its storage root`);
      assert.match(item.producer, /\S/, `${name} must name its writer`);
      assert.match(item.consumer, /\S/, `${name} must name its reader`);
    }
  });

  it('agrees with the clean gate about scratch', () => {
    const scratch = STORAGE_CLASSES.transient_scratch;
    assert.equal(scratch.cleanGate, 'excluded');
    assert.ok(PERMITTED_SCRATCH_PREFIXES.includes(scratch.location));
  });

  it('states that durable evidence fails closed until committed', () => {
    assert.equal(STORAGE_CLASSES.durable_project_evidence.cleanGate, 'fails_closed_until_committed');
    assert.equal(STORAGE_CLASSES.durable_project_evidence.committed, true);
  });

  it('classifies recovery intent as material transient transaction state', () => {
    const transaction = STORAGE_CLASSES.material_transient_transaction_state;
    assert.equal(EVIDENCE_INVENTORY.role_start_recovery_intent.storageClass, transaction.id);
    assert.equal(transaction.committed, false);
    assert.equal(transaction.cleanGate, 'fails_closed_until_resolved');
  });

  it('keeps operator material outside every repository', () => {
    const operator = STORAGE_CLASSES.operator_owned_authenticated_state;
    assert.equal(operator.committed, false);
    assert.match(operator.location, /outside every target repository/);
    assert.equal(EVIDENCE_INVENTORY.operator_activation_key.storageClass, operator.id);
  });
});

describe('inventory visibility metadata', () => {
  it('documents audiences without pretending to enforce runtime projection', () => {
    assert.ok(EVIDENCE_INVENTORY.operator_activation_key.visibilityNote);
    assert.deepEqual(EVIDENCE_INVENTORY.operator_activation_key.visibleTo, []);
    assert.match(STORAGE_CLASSES.operator_owned_authenticated_state.rule, /never inside a target repository/i);
  });
});
