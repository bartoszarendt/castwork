#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../src/canonical-json.js';
import { measureCanonicalText } from '../src/canonical-word-count.js';

const DISPATCH_CONTEXT_MEASUREMENT_METHOD = 'agenticloop.dispatch-context/v3';
const CANONICAL_TEXT_MEASUREMENT_METHOD = measureCanonicalText('').method;

function usage() {
  return [
    'Usage: node scripts/measure-dispatch-context.mjs',
    '  --packet <packet.json>',
    '  --role-wrapper <generated-role-file>',
    '  --activation-wrapper <generated-activation-file>',
    '  [--reference <canonical-file>]...',
  ].join(' ');
}

function parseArgs(argv) {
  const result = { references: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`${flag ?? 'argument'} requires a value`);
    if (flag === '--packet') result.packet = value;
    else if (flag === '--role-wrapper') result.roleWrapper = value;
    else if (flag === '--activation-wrapper') result.activationWrapper = value;
    else if (flag === '--reference') result.references.push(value);
    else throw new Error(`unknown option '${flag}'`);
  }
  for (const key of ['packet', 'roleWrapper', 'activationWrapper']) {
    if (!result[key]) throw new Error(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required`);
  }
  return result;
}

function component(kind, path, text) {
  const measurement = measureCanonicalText(text);
  // Schema v1 exposed `bytes`; retain it while adding the more specific name.
  return { kind, path: path.replaceAll('\\', '/'), bytes: measurement.utf8Bytes, ...measurement };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const packetPath = resolve(options.packet);
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const components = [
    component('canonical_packet', packetPath, canonicalJson(packet)),
    component('generated_role_wrapper', resolve(options.roleWrapper), readFileSync(resolve(options.roleWrapper), 'utf8')),
    component('generated_activation_wrapper', resolve(options.activationWrapper), readFileSync(resolve(options.activationWrapper), 'utf8')),
    ...options.references.map(reference => component(
      'canonical_reference', resolve(reference), readFileSync(resolve(reference), 'utf8')
    )),
  ];
  const uniquePaths = new Set(components.map(component => component.path));
  if (uniquePaths.size !== components.length) throw new Error('the same context component was supplied more than once');
  const totalUtf8Bytes = components.reduce((total, item) => total + item.utf8Bytes, 0);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 3,
    measurementMethod: DISPATCH_CONTEXT_MEASUREMENT_METHOD,
    canonicalTextMethod: CANONICAL_TEXT_MEASUREMENT_METHOD,
    normalization: { lineEndings: 'LF', pathSeparators: '/' },
    intendedPlatformComponents: [],
    encoding: 'utf8',
    packetSerialization: 'canonicalJson',
    components,
    totalCanonicalWords: components.reduce((total, item) => total + item.canonicalWords, 0),
    totalUtf8Bytes,
    // Retained for callers of schema version 1; it is exactly totalUtf8Bytes.
    totalBytes: totalUtf8Bytes,
    totalCharacters: components.reduce((total, item) => total + item.characters, 0),
    actualInputTokens: 'unavailable',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 2;
}
