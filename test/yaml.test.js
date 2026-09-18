import assert from 'node:assert/strict';
import test from 'node:test';

import { parseYaml, YamlError } from '../src/yaml.js';

/**
 * Parsed maps have a null prototype, which deepEqual will not match against an
 * object literal. Compare structure rather than prototype.
 * @param {unknown} value
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('parses scalars, lists, and nested maps', () => {
  const value = plain(parseYaml('a: 1\nb: true\nc: hello\nd: [x, y]\ne:\n  f: 2\n'));
  assert.deepEqual(value, { a: 1, b: true, c: 'hello', d: ['x', 'y'], e: { f: 2 } });
});

test('parses flow mappings inside a sequence', () => {
  const value = plain(parseYaml('items:\n  - { k: v, n: 3 }\n  - { k: w }\n'));
  assert.deepEqual(value, { items: [{ k: 'v', n: 3 }, { k: 'w' }] });
});

test('parses block sequence entries with nested lists', () => {
  const value = plain(parseYaml('candidates:\n  - ref: abc\n    producers: [one, two]\n'));
  assert.deepEqual(value, { candidates: [{ ref: 'abc', producers: ['one', 'two'] }] });
});

test('keeps quoted strings intact, including colons and hashes', () => {
  const value = plain(parseYaml('a: "x: y"\nb: \'it\'\'s\'\nc: "a # b"\n'));
  assert.deepEqual(value, { a: 'x: y', b: "it's", c: 'a # b' });
});

test('strips comments outside quotes', () => {
  const value = plain(parseYaml('# leading\na: 1 # trailing\n'));
  assert.deepEqual(value, { a: 1 });
});

test('rejects a duplicate key', () => {
  assert.throws(() => parseYaml('a: 1\na: 2\n'), YamlError);
});

test('rejects an unterminated quoted string', () => {
  assert.throws(() => parseYaml('a: "oops\n'), YamlError);
});

test('an empty document is an empty mapping', () => {
  assert.deepEqual(plain(parseYaml('')), {});
});
