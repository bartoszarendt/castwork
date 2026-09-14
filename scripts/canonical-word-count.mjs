/**
 * Deterministic whitespace-word measurement for repository-owned tooling.
 *
 * This is intentionally not a tokenizer estimate. Measurements canonicalize
 * line endings so a checked-out text file has the same result on supported
 * platforms. `characters` counts Unicode code points and `utf8Bytes` counts
 * the canonical UTF-8 payload; actual host input tokens remain unavailable
 * unless a supported host boundary measures them.
 */
const CANONICAL_TEXT_MEASUREMENT_METHOD = 'agenticloop.canonical-text/v2';

function normalizeCanonicalText(text) {
  if (typeof text !== 'string') throw new TypeError('canonical word measurement requires text');
  return text.replace(/\r\n?/g, '\n');
}

export function countCanonicalWords(text) {
  return normalizeCanonicalText(text).split(/\s+/).filter(Boolean).length;
}

export function measureCanonicalText(text) {
  const canonical = normalizeCanonicalText(text);
  return Object.freeze({
    method: CANONICAL_TEXT_MEASUREMENT_METHOD,
    canonicalWords: countCanonicalWords(canonical),
    utf8Bytes: Buffer.byteLength(canonical, 'utf8'),
    characters: Array.from(canonical).length,
    actualInputTokens: 'unavailable',
  });
}
