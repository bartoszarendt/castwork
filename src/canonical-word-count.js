/**
 * Deterministic whitespace-word measurement shared by all budget surfaces.
 *
 * This is intentionally not a tokenizer estimate. `characters` counts Unicode
 * code points, while `utf8Bytes` counts the encoded payload actually supplied
 * to the transport.
 */
export function countCanonicalWords(text) {
  if (typeof text !== 'string') throw new TypeError('canonical word measurement requires text');
  return text.split(/\s+/).filter(Boolean).length;
}

export function measureCanonicalText(text) {
  return Object.freeze({
    canonicalWords: countCanonicalWords(text),
    utf8Bytes: Buffer.byteLength(text, 'utf8'),
    characters: Array.from(text).length,
    actualInputTokens: 'unavailable',
  });
}
