import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countCanonicalWords, measureCanonicalText } from '../src/canonical-word-count.js';

describe('canonical word measurement', () => {
  it('uses the deterministic whitespace rule and reports non-token transport measures', () => {
    assert.equal(countCanonicalWords('  alpha\n beta\t\tγamma  '), 3);
    assert.deepEqual(measureCanonicalText('żółć\r\n'), {
      method: 'agenticloop.canonical-text/v2',
      canonicalWords: 1,
      utf8Bytes: 9,
      characters: 5,
      actualInputTokens: 'unavailable',
    });
  });
});
