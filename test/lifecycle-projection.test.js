import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createReadOnlyLifecycleProjection } from '../src/lifecycle-projection.js';

const action = {
  id: 'prepare_dispatch', applicability: 'applicable', facts: [], prerequisites: [], reasons: [], verdict: 'unknown',
};

describe('shared read-only lifecycle projection', () => {
  it('is derived, non-persistent, non-authoritative, and preserves evaluator output', () => {
    const projection = createReadOnlyLifecycleProjection({ task: { id: 'T-001' }, actions: [action] });
    assert.deepEqual(projection, {
      derived: true, persisted: false, authority: 'none', task: { id: 'T-001' }, actions: [action],
    });
  });

  it('rejects incomplete action shapes rather than inventing a verdict', () => {
    assert.throws(
      () => createReadOnlyLifecycleProjection({ task: {}, actions: [{ id: 'prepare_dispatch' }] }),
      /shared fact\/verdict shape/
    );
  });
});
