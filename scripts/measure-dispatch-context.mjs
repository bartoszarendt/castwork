#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../src/canonical-json.js';
import { measureCanonicalText } from './canonical-word-count.mjs';
import { opencodeShellOperatingFact } from '../src/adapters/opencode.js';

const DISPATCH_CONTEXT_MEASUREMENT_METHOD = 'agenticloop.dispatch-context/v5';
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

function roleWrapperMeasurement(path) {
  const text = readFileSync(path, 'utf8');
  const facts = [
    ['win32', opencodeShellOperatingFact('win32')],
    ['posix', opencodeShellOperatingFact('linux')],
  ];
  const matched = facts.find(([, fact]) => text.includes(fact));
  if (!matched) return { common: component('generated_role_wrapper', path, text), intended: [] };
  const [platformShape, fact] = matched;
  return {
    common: component('generated_role_wrapper', path, text.replace(fact, '')),
    intended: [{
      ...component('shell_operating_fact', path, fact),
      intendedPlatformSpecific: true,
      platformShape,
    }],
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const packetPath = resolve(options.packet);
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const roleWrapper = roleWrapperMeasurement(resolve(options.roleWrapper));
  const components = [
    component('canonical_packet', packetPath, canonicalJson(packet)),
    roleWrapper.common,
    component('generated_activation_wrapper', resolve(options.activationWrapper), readFileSync(resolve(options.activationWrapper), 'utf8')),
    ...options.references.map(reference => component(
      'canonical_reference', resolve(reference), readFileSync(resolve(reference), 'utf8')
    )),
  ];
  const uniquePaths = new Set(components.map(component => component.path));
  if (uniquePaths.size !== components.length) throw new Error('the same context component was supplied more than once');
  const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
  const intendedPlatformComponents = roleWrapper.intended;
  const commonCanonicalWords = sum(components, 'canonicalWords');
  const commonUtf8Bytes = sum(components, 'utf8Bytes');
  const commonCharacters = sum(components, 'characters');
  const intendedPlatformCanonicalWords = sum(intendedPlatformComponents, 'canonicalWords');
  const intendedPlatformUtf8Bytes = sum(intendedPlatformComponents, 'utf8Bytes');
  const intendedPlatformCharacters = sum(intendedPlatformComponents, 'characters');
  const completeCanonicalWords = commonCanonicalWords + intendedPlatformCanonicalWords;
  const completeUtf8Bytes = commonUtf8Bytes + intendedPlatformUtf8Bytes;
  const completeCharacters = commonCharacters + intendedPlatformCharacters;
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 5,
    measurementMethod: DISPATCH_CONTEXT_MEASUREMENT_METHOD,
    canonicalTextMethod: CANONICAL_TEXT_MEASUREMENT_METHOD,
    normalization: { lineEndings: 'LF', pathSeparators: '/' },
    intendedPlatformComponents,
    encoding: 'utf8',
    packetSerialization: 'canonicalJson',
    components,
    commonCanonicalWords,
    commonUtf8Bytes,
    commonBytes: commonUtf8Bytes,
    commonCharacters,
    intendedPlatformCanonicalWords,
    intendedPlatformUtf8Bytes,
    intendedPlatformBytes: intendedPlatformUtf8Bytes,
    intendedPlatformCharacters,
    completeCanonicalWords,
    completeUtf8Bytes,
    completeBytes: completeUtf8Bytes,
    completeCharacters,
    // Legacy totals now mean the complete context actually delivered.
    totalCanonicalWords: completeCanonicalWords,
    totalUtf8Bytes: completeUtf8Bytes,
    totalBytes: completeUtf8Bytes,
    totalCharacters: completeCharacters,
    actualInputTokens: 'unavailable',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 2;
}
