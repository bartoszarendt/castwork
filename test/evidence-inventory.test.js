/** Direct checks for the retained durable-evidence inventory. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  EVIDENCE_INVENTORY,
  INVENTORY_ROLES,
  STORAGE_CLASSES,
  evidenceVisibleToRole,
  validateEvidenceInventory,
} from '../src/evidence-inventory.js';
import { PERMITTED_SCRATCH_PREFIXES } from '../src/repository-state.js';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

/** Small source trace for target-local roots with exported production constants. */
function declaredStorageRoots() {
  const roots = new Set();
  for (const name of readdirSync(SRC_DIR).filter(file => file.endsWith('.js'))) {
    const source = readFileSync(join(SRC_DIR, name), 'utf8');
    for (const match of source.matchAll(/^export const [A-Z_]*ROOT = '(\.agenticloop\/[^']+)'/gm)) roots.add(match[1]);
  }
  return roots;
}

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
  it('accounts for every exported target-local storage root', () => {
    const inventoried = new Set(Object.values(EVIDENCE_INVENTORY).map(item => item.root));
    const unaccounted = [...declaredStorageRoots()].filter(root => !inventoried.has(root)).sort();
    assert.deepEqual(unaccounted, [], `these persisted roots have no inventory entry: ${unaccounted.join(', ')}`);
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

describe('each role receives a bounded projection', () => {
  it('keeps activation, audit, and closeout internals out of the Engineer view', () => {
    const engineer = evidenceVisibleToRole('engineer');
    for (const withheld of [
      'activation_grant', 'closeout_waiver', 'historical_adoption', 'return_verification',
      'task_contract_history', 'execution_attempt_abandonment', 'operator_activation_key',
    ]) assert.equal(engineer.includes(withheld), false, `engineer must not receive '${withheld}'`);
  });

  it('gives the Engineer exactly what implementation needs', () => {
    const engineer = evidenceVisibleToRole('engineer');
    for (const needed of ['task_record', 'dispatch_consumption', 'carrier_mutation_receipt', 'scratch']) {
      assert.ok(engineer.includes(needed), `engineer needs '${needed}'`);
    }
  });

  it('gives no workflow role the operator key material', () => {
    for (const role of INVENTORY_ROLES) assert.equal(evidenceVisibleToRole(role).includes('operator_activation_key'), false);
    assert.ok(EVIDENCE_INVENTORY.operator_activation_key.visibilityNote);
  });

  it('lets the Auditor see what it must audit without scratch decisions', () => {
    const auditor = evidenceVisibleToRole('auditor');
    assert.ok(auditor.includes('return_verification'));
    assert.ok(auditor.includes('task_contract_history'));
    assert.ok(auditor.includes('historical_adoption'));
    assert.equal(auditor.includes('activation_grant'), false);
  });

  it('rejects an unknown role rather than returning an empty projection', () => {
    assert.throws(() => evidenceVisibleToRole('enginer'), /unknown workflow role/);
  });

  it('gives every role a non-empty projection', () => {
    for (const role of INVENTORY_ROLES) assert.ok(evidenceVisibleToRole(role).length > 0, `${role} receives nothing`);
  });
});
