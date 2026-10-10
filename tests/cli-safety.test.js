/**
 * CLI safety and generator identity: how a command was typed is checked before
 * anything is read or written, usage errors exit 2, and the manifest records
 * which build generated it, so an older copy refuses to write over a newer
 * one's output and `doctor` points at the copy to run.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareVersions, packageVersion, sourceDigest, toolkitRoot } from '../src/adapter-generation.js';
import { COMMAND_PATHS, FLAGS, GLOBAL_FLAGS, checkUsage, parseArgs } from '../src/cli-main.js';
import { GENERATED_MANIFEST, PROJECT_FILE } from '../src/layout.js';
import { doctor, setup, update } from '../src/setup.js';
import { runCli as cli } from './cli-in-process.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'castwork.js');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-safety-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Run the real entry point in `cwd`, as an agent would; the other tests run the CLI in process. */
function entryPoint(cwd, ...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

/** Every file under root with its bytes, so "nothing was written" is checked, not assumed. */
function tree(root) {
  /** @type {Record<string, string>} */
  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(root);
  return files;
}

/** @param {string} root @param {(manifest: Record<string, unknown>) => void} change */
function editManifest(root, change) {
  const file = path.join(root, GENERATED_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(manifest);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

test('update --chek is refused with the usage exit code and changes no file', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex', 'opencode'] });
  // Make the installation behind, so a plain update would have written.
  const stale = path.join(root, '.opencode', 'agents', 'worker.md');
  fs.rmSync(stale);
  const before = tree(root);

  const result = entryPoint(root, 'update', '--chek');
  assert.equal(result.code, 2);
  assert.match(result.err, /unknown flag --chek/);
  assert.match(result.err, /--check/, 'the accepted flags are listed');
  assert.deepEqual(tree(root), before, 'no file was written');
  assert.equal(fs.existsSync(stale), false);
});

test('switches with a value, single-dash options, and stray arguments are refused before a write', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  fs.rmSync(path.join(root, '.codex', 'agents', 'worker.toml'));
  const before = tree(root);
  for (const args of [['update', '--check=yes'], ['update', '-check'], ['update', 'check'], ['setup', '--json=1']]) {
    const result = cli(root, ...args);
    assert.equal(result.code, 2, args.join(' '));
    assert.deepEqual(tree(root), before, `${args.join(' ')} wrote nothing`);
  }
});

test('a flag where a value belongs is refused as a missing value, not read as the value', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const before = tree(root);
  for (const args of [['update', '--force-generated', '--check'], ['setup', '--host', '--json'], ['setup', '--host', '-x']]) {
    const result = cli(root, ...args);
    assert.equal(result.code, 2, args.join(' '));
    assert.match(result.err, new RegExp(`${args[1]} needs a value, not ${args[2]}`), args.join(' '));
    assert.match(result.err, /goes after =/, args.join(' '));
    assert.deepEqual(tree(root), before, `${args.join(' ')} wrote nothing`);
  }
  assert.deepEqual(parseArgs(['update', '--force-generated=-x']).force, ['-x'], 'after =, a value may start with a dash');
});

test('a flag given to a command that does not take it is refused, naming the flag and the accepted ones', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const before = tree(root);
  for (const [args, flag] of [
    [['doctor', '--check'], '--check'],
    [['task', 'lint', '--host', 'codex'], '--host'],
    [['setup', '--check'], '--check'],
    [['remove', '--force-generated', 'x.md'], '--force-generated'],
    [['task', 'set', 'T-001', 'status', 'done', '--json'], '--json'],
  ]) {
    const result = cli(root, ...args);
    assert.equal(result.code, 2, args.join(' '));
    assert.match(result.err, new RegExp(`does not take ${flag}`), args.join(' '));
    assert.match(result.err, /accepts .*--help/, 'the accepted flags are listed');
    assert.deepEqual(tree(root), before, `${args.join(' ')} wrote nothing`);
  }
});

test('--help prints the list whatever command it is given to', (t) => {
  const root = fixture(t);
  const result = cli(root, 'update', '--help');
  assert.equal(result.code, 0);
  assert.match(result.out, /Commands:/);
});

test('every accepted flag is one the CLI knows, and help lists each command\'s flags', (t) => {
  for (const entry of COMMAND_PATHS) {
    for (const flag of entry.flags) assert.ok(Object.hasOwn(FLAGS, flag), `${entry.path} lists unknown ${flag}`);
    assert.doesNotThrow(() => checkUsage(entry.path.split(' '), [...entry.flags, ...GLOBAL_FLAGS.filter((flag) => flag !== 'help')]), entry.path);
  }
  const root = fixture(t);
  const help = cli(root, 'help').out;
  assert.match(help, /update +Regenerate[^\n]*\n +flags: --check, --force-generated <path>, --json/);
  assert.match(help, /setup +Install[^\n]*\n +flags: --host <name>, --force-generated <path>, --json/);
  assert.match(help, /npx --no castwork help/);
});

test('parseArgs records the flags named, in order', () => {
  const parsed = parseArgs(['update', '--json', '--check']);
  assert.deepEqual(parsed.named, ['json', 'check']);
  assert.throws(() => parseArgs(['--nope']), (error) => error.exitCode === 2 && /unknown flag --nope/.test(error.message));
});

test('the manifest carries a source_digest, stable across runs and installations', (t) => {
  const first = fixture(t);
  const second = fixture(t);
  setup(first, { hosts: ['codex'] });
  setup(second, { hosts: ['claude'] });
  const read = (root) => JSON.parse(fs.readFileSync(path.join(root, GENERATED_MANIFEST), 'utf8'));
  assert.match(read(first).source_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(read(first).source_digest, read(second).source_digest);
  assert.equal(read(first).source_digest, sourceDigest());
  assert.equal(read(first).version, packageVersion());

  const again = spawnSync(process.execPath, ['--input-type=module', '-e', `import { sourceDigest } from ${JSON.stringify(new URL('../src/adapter-generation.js', import.meta.url).href)}; process.stdout.write(sourceDigest());`], { encoding: 'utf8' });
  assert.equal(again.stdout, sourceDigest(), 'a separate process computes the same digest');
});

test('an older manifest without a source_digest gets one on update, without counting as behind', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  editManifest(root, (manifest) => { delete manifest.source_digest; });
  const { plan } = update(root, { check: true });
  assert.equal(plan.current, true, 'identity alone is not behind');
  assert.equal(plan.identity_changed, true);
  assert.equal(cli(root, 'update', '--check').code, 0);
  assert.match(cli(root, 'update', '--check').out, /a different build wrote the manifest/);

  assert.equal(update(root).manifest, 'changed', 'update records this build');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, GENERATED_MANIFEST), 'utf8')).source_digest, sourceDigest());
  assert.equal(update(root).manifest, null, 'and then has nothing to do');
});

test('a manifest written by a newer version makes setup and update refuse and write nothing', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  editManifest(root, (manifest) => { manifest.version = '9.9.9'; });
  fs.rmSync(path.join(root, '.codex', 'agents', 'worker.toml'));
  const before = tree(root);

  for (const attempt of [() => update(root), () => setup(root, { hosts: ['claude'] })]) {
    assert.throws(attempt, (error) => error.message.includes('9.9.9')
      && error.message.includes(packageVersion())
      && error.message.includes(toolkitRoot())
      && /newer copy/.test(error.hint));
  }
  assert.deepEqual(tree(root), before, 'nothing was written');

  const check = cli(root, 'update', '--check');
  assert.equal(check.code, 1);
  assert.match(check.out, /blocked .*generated\.json \(written by castwork 9\.9\.9, newer than this copy\)/);
  assert.equal(JSON.parse(cli(root, 'update', '--check', '--json').out).downgrade, true);
  assert.deepEqual(tree(root), before, '--check wrote nothing');
});

test('doctor reports the running identity and the manifest identity, and warns when they differ', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const report = doctor(root);
  assert.equal(report.toolkit_version, packageVersion());
  assert.equal(report.toolkit_location, toolkitRoot());
  assert.equal(report.toolkit_source_digest, sourceDigest());
  assert.equal(report.source_digest, sourceDigest());
  assert.ok(!report.findings.some((finding) => /castwork/.test(finding.message) && /written by/.test(finding.message)));

  const printed = cli(root, 'doctor').out;
  assert.ok(printed.includes(`running: castwork ${packageVersion()} at ${toolkitRoot()} (${sourceDigest()})`));
  assert.ok(printed.includes(`manifest: castwork ${packageVersion()} (${sourceDigest()})`));

  editManifest(root, (manifest) => { manifest.source_digest = `sha256:${'0'.repeat(64)}`; });
  assert.ok(doctor(root).findings.some((finding) => finding.level === 'warn' && /different build/.test(finding.message)));

  editManifest(root, (manifest) => { manifest.version = '9.9.9'; });
  const newer = doctor(root).findings.find((finding) => /newer than the copy running now/.test(finding.message));
  assert.ok(newer, 'a newer manifest is named');
  assert.match(newer.next, /refuse/);
});

test('doctor says a hand edit to a generated file is overwritten by update and read only by a new session', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['opencode'] });
  fs.appendFileSync(path.join(root, '.opencode', 'agents', 'worker.md'), '\nhand edit\n');
  const finding = doctor(root).findings.find((entry) => /modified locally/.test(entry.message));
  assert.ok(finding);
  assert.match(finding.next, /overwrites the edit/);
  assert.match(finding.next, /only in a new session/);
});

test('doctor warns while project.md is still the scaffold, and stops once it is filled in', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const scaffold = (report) => report.findings.find((finding) => /still the scaffold/.test(finding.message));
  assert.ok(scaffold(doctor(root)), 'a fresh project.md is the scaffold');
  assert.equal(doctor(root).ok, true, 'a warning, not an error');

  const file = path.join(root, PROJECT_FILE);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
  assert.ok(scaffold(doctor(root)), 'line endings do not hide the scaffold');

  fs.appendFileSync(file, '\nThis project sells tea.\n');
  assert.equal(scaffold(doctor(root)), undefined);
});

test('doctor warns about a project.md that is missing, empty, or only partly written', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const file = path.join(root, PROJECT_FILE);
  const project = (report) => report.findings.find((finding) => finding.message.startsWith(PROJECT_FILE));
  const scaffold = fs.readFileSync(file, 'utf8');

  fs.appendFileSync(file, '\nThis project sells tea.\n');
  const partial = project(doctor(root));
  assert.match(partial.message, /sections still as setup wrote them, or empty: What this project is, Working policy, Checks, Setup facts$/);
  assert.equal(partial.level, 'warn');

  fs.writeFileSync(file, scaffold.replace('One or two sentences: what it does and who uses it.', 'A tea shop.'), 'utf8');
  assert.doesNotMatch(project(doctor(root)).message, /What this project is/, 'a written section is not listed');

  fs.writeFileSync(file, '# Project\n\n## What this project is\n\nA tea shop.\n\n## Documents\n\n', 'utf8');
  assert.match(project(doctor(root)).message, /or empty: Documents$/, 'an empty section is listed; a removed one is not');

  fs.writeFileSync(file, '# Tea\n\nA tea shop. Run `npm test`.\n', 'utf8');
  assert.equal(project(doctor(root)), undefined, 'headings of its own are not compared');

  fs.writeFileSync(file, ' \n\n', 'utf8');
  assert.match(project(doctor(root)).message, /is empty$/);

  fs.rmSync(file);
  assert.match(project(doctor(root)).message, /is missing$/);
  assert.equal(doctor(root).ok, true, 'warnings, not errors');
});

test('compareVersions orders versions, prereleases before releases, and refuses what is not one', () => {
  assert.equal(compareVersions('0.5.1', '0.5.0'), 1);
  assert.equal(compareVersions('0.5.0', '0.5.1'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareVersions('1.0.0+build', '1.0.0'), 0);
  assert.equal(compareVersions('', '0.5.0'), null);
  assert.equal(compareVersions('main', '0.5.0'), null);
});

test('after a bare --, every token is an argument, so a title may start with a dash', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const created = cli(root, 'task', 'new', '--', '-x title');
  assert.equal(created.code, 0, created.err);
  const record = fs.readFileSync(path.join(root, '.castwork', 'tasks', 'T-001.md'), 'utf8');
  assert.match(record, /^title: "?-x title"?$/m);
  assert.deepEqual(parseArgs(['task', 'new', '--', '--json', '-x']).positionals, ['task', 'new', '--json', '-x']);
  assert.deepEqual(parseArgs(['task', 'new', '--', '--json']).named, [], 'a flag after -- is not a flag');

  const debug = cli(root, 'task', 'new', '--', '--debug');
  assert.equal(debug.code, 0, debug.err);
  assert.match(fs.readFileSync(path.join(root, '.castwork', 'tasks', 'T-002.md'), 'utf8'), /^title: "?--debug"?$/m);
});

test('a refused dash-leading token names -- in its hint', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  for (const args of [['task', 'new', '-x title'], ['task', 'new', '--x-title']]) {
    const result = cli(root, ...args);
    assert.equal(result.code, 2, args.join(' '));
    assert.match(result.err, /goes after --, as in: task new -- "-x title"/, args.join(' '));
  }
});

test('task show without an id is a usage error, exit 2', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  const result = cli(root, 'task', 'show');
  assert.equal(result.code, 2);
  assert.match(result.err, /task show needs a task id/);
});

test('doctor tells an older copy to run the newer one, not to update or force', (t) => {
  const root = fixture(t);
  setup(root, { hosts: ['codex'] });
  editManifest(root, (manifest) => { manifest.version = '9.9.9'; });
  // A stale file, a hand edit, and a file of the user's where one is generated.
  fs.rmSync(path.join(root, '.codex', 'agents', 'worker.toml'));
  fs.appendFileSync(path.join(root, '.codex', 'agents', 'thinker.toml'), '\n# edit\n');
  const findings = doctor(root).findings.filter((finding) => finding.next);
  assert.ok(findings.length >= 3);
  for (const finding of findings) {
    assert.doesNotMatch(finding.next, /--force-generated|Run update|run update --check/, finding.message);
  }
  for (const finding of findings.filter((entry) => /modified locally|differ from/.test(entry.message))) {
    assert.match(finding.next, /Run the newer copy, castwork 9\.9\.9/, finding.message);
  }
  assert.match(doctor(root).findings.find((finding) => /newer than the copy running now/.test(finding.message)).next, /Run the newer copy, castwork 9\.9\.9/);
});
