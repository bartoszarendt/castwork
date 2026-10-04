/**
 * Third review round, findings 5 and 6: observations that resolved by spelling
 * and observation maps that answered from Object.prototype.
 *
 * Fourth review round, finding 1: a skipped observation was read as `false` and
 * reported `unavailable`, which conflates "not checked" with "checked and
 * absent". A skipped path now reports `not_checked`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { referenceAvailability } from '../src/checks.js';
import { observe } from '../src/observations.js';
import { parseRecord } from '../src/record.js';

function tmp(t, label) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `castwork-${label}-`)));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A real git repository, so a candidate ref is actually checked. */
function repository(t, label) {
  const root = tmp(t, label);
  execFileSync('git', ['-C', root, 'init', '--quiet'], { stdio: ['ignore', 'ignore', 'ignore'] });
  return root;
}

function link(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code}`);
    return false;
  }
}

/** @param {string} frontmatter */
function record(frontmatter) {
  return parseRecord(`---\nschema: 1\nid: T-001\ntitle: t\nstatus: draft\n${frontmatter}---\n\n## Intent\nx\n`);
}

function availability(results, ref) {
  const found = results.find((result) => result.ref === ref);
  return found ? found.available : null;
}

const LINKED = 'candidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass, output: logs/known.txt }\n';

/**
 * Finding 5: `logs` linked outside the checkout made `logs/known.txt` resolve
 * by spelling and be reported available, which is an existence oracle for a
 * file the record chose on a machine it does not own.
 */
for (const type of ['junction', 'dir']) {
  test(`5: a link through a ${type} pointing outside the checkout is skipped`, (t) => {
    const root = tmp(t, `obs-${type}`);
    const outside = tmp(t, `obsout-${type}`);
    fs.writeFileSync(path.join(outside, 'known.txt'), 'secret\n', 'utf8');
    if (!link(t, outside, path.join(root, 'logs'), type)) return;

    const parsed = record(LINKED);
    const observations = observe(parsed, root);
    assert.equal(Object.hasOwn(observations.files, 'logs/known.txt'), false, 'the escaping link must not be observed at all');
    assert.equal(
      availability(referenceAvailability(parsed, observations), 'logs/known.txt'),
      'not_checked',
      'a path that was skipped was not checked, so it is not absent either',
    );
  });

  test(`5: an absent link under a ${type} pointing outside the checkout is skipped`, (t) => {
    const root = tmp(t, `obsa-${type}`);
    const outside = tmp(t, `obsaout-${type}`);
    if (!link(t, outside, path.join(root, 'logs'), type)) return;

    const parsed = record(LINKED);
    assert.equal(Object.hasOwn(observe(parsed, root).files, 'logs/known.txt'), false);
  });
}

test('5: a link that is itself a symlink to an outside file is skipped', (t) => {
  const root = tmp(t, 'obsfile');
  const outside = tmp(t, 'obsfileout');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'secret\n', 'utf8');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  if (!link(t, victim, path.join(root, 'logs', 'known.txt'), 'file')) return;

  const parsed = record(LINKED);
  assert.equal(Object.hasOwn(observe(parsed, root).files, 'logs/known.txt'), false);
});

test('5: an ordinary file inside the checkout is still reported available', (t) => {
  const root = tmp(t, 'obsok');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'known.txt'), 'output\n', 'utf8');
  const parsed = record(LINKED);
  const observations = observe(parsed, root);
  assert.equal(observations.files['logs/known.txt'], true);
  assert.equal(availability(referenceAvailability(parsed, observations), 'logs/known.txt'), 'available');
});

test('5: an ordinary absent file inside the checkout is reported unavailable', (t) => {
  const root = tmp(t, 'obsmiss');
  const parsed = record(LINKED);
  const observations = observe(parsed, root);
  assert.equal(observations.files['logs/known.txt'], false);
  assert.equal(availability(referenceAvailability(parsed, observations), 'logs/known.txt'), 'unavailable');
});

/**
 * Finding 6: the observation maps were plain objects, so a candidate ref named
 * `__proto__` was answered by the prototype chain and reported available.
 */
const PROTOTYPE_NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'];

for (const name of PROTOTYPE_NAMES) {
  test(`6: a candidate ref named ${name} is unavailable after observation`, (t) => {
    const root = repository(t, 'proto');
    const parsed = record(`candidates:\n  - ref: "${name}"\n`);
    const observations = observe(parsed, root);
    assert.equal(availability(referenceAvailability(parsed, observations), name), 'unavailable');
  });

  // Round four changed the expected value in the next two cases from
  // `unavailable` to `not_checked`: an empty map lists nothing, so nothing
  // about these keys was checked. What finding 6 is about is that a prototype
  // name never comes back `available`, which all three cases still assert.
  test(`6: a candidate ref named ${name} is not available against a map that does not list it`, () => {
    const parsed = record(`candidates:\n  - ref: "${name}"\n`);
    assert.equal(availability(referenceAvailability(parsed, { refs: {}, files: {} }), name), 'not_checked');
  });

  test(`6: a link named ${name}.txt is not available against a map that does not list it`, () => {
    const parsed = record(`candidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass, output: "${name}.txt" }\n`);
    assert.equal(availability(referenceAvailability(parsed, { refs: {}, files: {} }), `${name}.txt`), 'not_checked');
  });

  test(`6: a candidate ref named ${name} listed as false is unavailable`, () => {
    const parsed = record(`candidates:\n  - ref: "${name}"\n`);
    const refs = Object.create(null);
    refs[name] = false;
    assert.equal(availability(referenceAvailability(parsed, { refs, files: {} }), name), 'unavailable');
  });
}

test('6: the observation maps carry no prototype', (t) => {
  const root = repository(t, 'protomap');
  const observations = observe(record('candidates:\n  - ref: aaa\n'), root);
  assert.equal(Object.getPrototypeOf(observations.refs), null);
  assert.equal(Object.getPrototypeOf(observations.files), null);
});

test('6: a link whose value is a bare prototype name is not treated as a link', () => {
  const parsed = record('candidates:\n  - ref: aaa\nevidence:\n  - { check: test, candidate: aaa, result: pass, output: "__proto__" }\n');
  const results = referenceAvailability(parsed, { refs: {}, files: {} });
  assert.deepEqual(results.filter((result) => result.kind === 'link'), []);
});

test('6: observing a record naming prototype keys throws nothing', (t) => {
  const root = repository(t, 'protothrow');
  const parsed = record('candidates:\n  - ref: "__proto__"\n  - ref: "constructor"\nevidence:\n  - { check: test, candidate: "__proto__", result: pass, output: "constructor.txt" }\n');
  assert.doesNotThrow(() => observe(parsed, root));
  assert.doesNotThrow(() => referenceAvailability(parsed, observe(parsed, root)));
});

/* ------------------------------------------------------------------ */
/* Fourth review round, finding 1: three states from one lookup        */
/* ------------------------------------------------------------------ */

test('r4-1: an existing in-repo link is available', (t) => {
  const root = repository(t, 'r4ok');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'known.txt'), 'output\n', 'utf8');
  const parsed = record(LINKED);
  assert.equal(availability(referenceAvailability(parsed, observe(parsed, root)), 'logs/known.txt'), 'available');
});

test('r4-1: a missing in-repo link is unavailable', (t) => {
  const root = repository(t, 'r4miss');
  const parsed = record(LINKED);
  assert.equal(availability(referenceAvailability(parsed, observe(parsed, root)), 'logs/known.txt'), 'unavailable');
});

for (const type of ['junction', 'dir']) {
  test(`r4-1: a link through a ${type} escaping the checkout is not_checked, not unavailable`, (t) => {
    const root = repository(t, `r4esc-${type}`);
    const outside = tmp(t, `r4escout-${type}`);
    fs.writeFileSync(path.join(outside, 'known.txt'), 'secret\n', 'utf8');
    if (!link(t, outside, path.join(root, 'logs'), type)) return;

    const parsed = record(LINKED);
    assert.equal(availability(referenceAvailability(parsed, observe(parsed, root)), 'logs/known.txt'), 'not_checked');
  });
}

test('r4-1: a candidate ref in a directory that is not a repository is not_checked', (t) => {
  const root = tmp(t, 'r4norepo');
  const parsed = record('candidates:\n  - ref: aaa\n');
  const observations = observe(parsed, root);
  assert.equal(Object.hasOwn(observations.refs, 'aaa'), false, 'nothing was checked, so nothing is recorded');
  assert.equal(availability(referenceAvailability(parsed, observations), 'aaa'), 'not_checked');
});

test('r4-1: a candidate ref that does not resolve in a repository is unavailable', (t) => {
  const root = repository(t, 'r4repo');
  const parsed = record('candidates:\n  - ref: aaa\n');
  const observations = observe(parsed, root);
  assert.equal(observations.refs.aaa, false);
  assert.equal(availability(referenceAvailability(parsed, observations), 'aaa'), 'unavailable');
});

test('r4-1: an absent observation map still reports not_checked for everything', () => {
  const parsed = record(LINKED);
  for (const result of referenceAvailability(parsed)) assert.equal(result.available, 'not_checked');
  for (const result of referenceAvailability(parsed, {})) assert.equal(result.available, 'not_checked');
});

test('r4-1: a plain object literal passed by an external consumer still works', () => {
  const parsed = record(LINKED);
  const results = referenceAvailability(parsed, { refs: { aaa: true }, files: { 'logs/known.txt': false } });
  assert.equal(availability(results, 'aaa'), 'available');
  assert.equal(availability(results, 'logs/known.txt'), 'unavailable');

  const partial = referenceAvailability(parsed, { refs: { aaa: false }, files: {} });
  assert.equal(availability(partial, 'aaa'), 'unavailable');
  assert.equal(availability(partial, 'logs/known.txt'), 'not_checked');
});
