/**
 * Role levels.
 *
 * A level gives a role a variant for `simple` or `complex` assignments beside
 * the role itself, which is `standard`. It is configured per host and role in
 * `role_levels`, generated as a variant role file with the role's body and the
 * level's complete model settings, listed in the entry command and the
 * coordinator, and recorded on entries as an optional `level` that `report`
 * counts. A repository without levels gets no variants, level lists or level
 * lines.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CONFIG_FILE } from '../src/layout.js';
import { readConfig } from '../src/config.js';
import { generateAll } from '../src/adapter-generation.js';
import { setup, update } from '../src/setup.js';
import { validate } from '../src/validate.js';
import { entryFromPairs } from '../src/task-add.js';
import { parseRecord } from '../src/record.js';
import { deriveReport } from '../src/report.js';
import { renderReport } from '../src/report-text.js';

/** A target with `hosts` installed and `extra` merged into its config. */
function fixture(t, hosts, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'castwork-levels-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setup(root, { hosts });
  writeExtra(root, extra);
  return root;
}

/** @param {string} root @param {Record<string, unknown>} extra */
function writeExtra(root, extra) {
  const file = path.join(root, CONFIG_FILE);
  const config = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...extra };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** @param {string} root @param {string} relative */
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');
/** @param {string} root @param {string} relative */
const exists = (root, relative) => fs.existsSync(path.join(root, relative));

/** The refusal `readConfig` gives for `role_levels`. */
function refusal(t, levels) {
  const root = fixture(t, ['claude', 'codex', 'opencode', 'pi'], { role_levels: levels });
  try {
    readConfig(root);
  } catch (error) {
    return error;
  }
  assert.fail('role_levels was accepted');
}

const LEVELS = {
  claude: { worker: { complex: { model: 'claude-strong', effort: 'high' }, simple: { model: 'claude-fast', effort: 'low' } } },
  codex: { verifier: { complex: { model: 'gpt-strong', model_reasoning_effort: 'high' } } },
  opencode: { thinker: { complex: { model: 'openai/strong', variant: 'high' } } },
  pi: { worker: { complex: { model: 'provider/strong:high' } } },
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

test('role_levels is read per host, role and level', (t) => {
  const root = fixture(t, ['claude', 'codex'], { role_levels: LEVELS });
  const config = readConfig(root);
  assert.deepEqual(config.role_levels.claude.worker.complex, { model: 'claude-strong', effort: 'high' });
  assert.deepEqual(config.role_levels.codex.verifier.complex, { model: 'gpt-strong', model_reasoning_effort: 'high' });
});

test('a configuration without role_levels has none', (t) => {
  assert.deepEqual(readConfig(fixture(t, ['claude'])).role_levels, {});
});

for (const [name, levels, pattern, hint] of [
  ['standard is the role binding', { claude: { worker: { standard: { model: 'm' } } } }, /standard is the role's own binding/, /role_settings\.claude\.worker/],
  ['the coordinator has no levels', { claude: { coordinator: { complex: { model: 'm' } } } }, /cannot configure the coordinator/, /thinker, worker, verifier/],
  ['an unknown level', { claude: { worker: { hard: { model: 'm' } } } }, /unknown level hard/, /simple, complex/],
  ['an unknown role', { claude: { reviewer: { complex: { model: 'm' } } } }, /unknown role reviewer/, /thinker, worker, verifier/],
  ['an unknown host', { cursor: { worker: { complex: { model: 'm' } } } }, /unknown host cursor/, /Known hosts/],
  ['a permission setting', { claude: { worker: { complex: { model: 'm', permission_mode: 'acceptEdits' } } } }, /does not set permissions/, /takes permission_mode from role_settings/],
  ['a setting the host lacks', { codex: { worker: { complex: { model: 'm', effort: 'high' } } } }, /host codex has no setting effort/, /model, model_reasoning_effort/],
  ['a level without a model', { claude: { worker: { complex: { effort: 'high' } } } }, /sets no model/, /complete setting set/],
  ['a non-string value', { claude: { worker: { complex: { model: 'm', effort: 3 } } } }, /must be a string/, /passed to the host as written/],
  ['an inline OpenCode variant', { opencode: { worker: { complex: { model: 'openai/m#high' } } } }, /contains an inline variant/, /separate settings/],
  ['a level that is not a map', { claude: { worker: { complex: 'claude-strong' } } }, /must be a map of setting to value/, null],
]) {
  test(`role_levels refuses ${name}, with a hint`, (t) => {
    const error = refusal(t, levels);
    assert.match(error.message, pattern);
    if (hint) assert.match(error.hint, hint);
  });
}

/* ------------------------------------------------------------------ */
/* Compatibility                                                       */
/* ------------------------------------------------------------------ */

test('without levels there are no variants, level lists or level lines, and an empty map generates what no map does', () => {
  const hosts = ['claude', 'codex', 'opencode', 'pi'];
  const options = { roleRoutes: { verifier: 'codex' }, roleSettings: { codex: { verifier: { model: 'gpt-x' } } } };
  const without = generateAll(hosts, options);
  assert.deepEqual(generateAll(hosts, { ...options, roleLevels: {} }), without);
  for (const file of without) {
    assert.doesNotMatch(file.path, /_(simple|complex)\./, file.path);
    assert.doesNotMatch(file.content, /Levels on this host|you run at the `/, file.path);
  }
});

test('levels on one host change nothing generated for another', () => {
  const plain = generateAll(['codex'], {});
  const levelled = generateAll(['claude', 'codex'], { roleLevels: { claude: LEVELS.claude } }).filter((file) => file.path.startsWith('.codex/') || file.path.startsWith('.agents/'));
  assert.deepEqual(levelled, plain);
});

/* ------------------------------------------------------------------ */
/* Variant role files                                                  */
/* ------------------------------------------------------------------ */

test('each level generates a variant beside the role on every host', () => {
  const files = generateAll(['claude', 'codex', 'opencode', 'pi'], { roleLevels: LEVELS });
  const paths = files.map((file) => file.path);
  for (const expected of [
    '.claude/agents/worker_simple.md',
    '.claude/agents/worker_complex.md',
    '.codex/agents/verifier_complex.toml',
    '.opencode/agents/thinker_complex.md',
    '.pi/agents/worker_complex.md',
  ]) assert.ok(paths.includes(expected), expected);
  assert.ok(!paths.some((file) => /coordinator_/.test(file)));
  assert.ok(!paths.includes('.claude/agents/thinker_complex.md'), 'only configured levels are generated');
});

test('a variant carries the level settings and the role permissions, never the role model', () => {
  const files = generateAll(['claude'], {
    roleSettings: { claude: { worker: { model: 'claude-base', effort: 'medium', permission_mode: 'acceptEdits' } } },
    roleLevels: { claude: { worker: { simple: { model: 'claude-fast' } } } },
  });
  const variant = files.find((file) => file.path === '.claude/agents/worker_simple.md').content;
  assert.match(variant, /^name: worker_simple$/m);
  assert.match(variant, /^model: claude-fast$/m);
  assert.match(variant, /^permissionMode: acceptEdits$/m);
  assert.doesNotMatch(variant, /claude-base|^effort:/m);
  const base = files.find((file) => file.path === '.claude/agents/worker.md').content;
  assert.match(base, /^model: claude-base$/m);
  assert.match(base, /^effort: medium$/m);
});

test('a Codex variant is a TOML agent of its own with the level settings', () => {
  const variant = generateAll(['codex'], { roleLevels: { codex: LEVELS.codex } })
    .find((file) => file.path === '.codex/agents/verifier_complex.toml').content;
  assert.match(variant, /^name = "verifier_complex"$/m);
  assert.match(variant, /^model = "gpt-strong"$/m);
  assert.match(variant, /^model_reasoning_effort = "high"$/m);
  assert.match(variant, /developer_instructions = """\n# Verifier\n\nLaunched as `verifier_complex`, or as a fresh routed process given this file and the settings its route lists, you run at the `complex` level/);
});

test('an OpenCode variant keeps the delegated frontmatter and its own model and variant', () => {
  const variant = generateAll(['opencode'], { roleLevels: { opencode: LEVELS.opencode } })
    .find((file) => file.path === '.opencode/agents/thinker_complex.md').content;
  assert.match(variant, /^model: openai\/strong$/m);
  assert.match(variant, /^variant: high$/m);
  assert.match(variant, /^mode: all$/m);
  assert.match(variant, /castwork: deny/);
});

test('a variant keeps the role body and names its level and its actor under the title', () => {
  const files = generateAll(['claude'], { roleLevels: { claude: LEVELS.claude } });
  const base = files.find((file) => file.path === '.claude/agents/worker.md').content;
  const variant = files.find((file) => file.path === '.claude/agents/worker_complex.md').content;
  const read = 'Reading this file in a session already running applies none of its settings and establishes no level: then record none\\.';
  const launched = (/** @type {string} */ agent) => `Launched as \`${agent}\`, or as a fresh routed process given this file and the settings its route lists`;
  assert.match(variant, new RegExp(`# Worker\\n\\n${launched('worker_complex')}, you run at the \`complex\` level: .*Record \`level: complex\` on the entries you write\\. Your actor names your role, or the specialist name you were given, never \`worker_complex\`\\. ${read}\\n\\nYou do the work\\.`));
  assert.match(base, new RegExp(`# Worker\\n\\n${launched('worker')}, you run at the \`standard\` level: this role with its own model settings\\. Record \`level: standard\` on the entries you write\\. ${read}\\n\\nYou do the work\\.`));
  const strip = (/** @type {string} */ content) => content.slice(content.indexOf('# Worker')).replace(/\n\nLaunched as [^\n]*/, '');
  assert.equal(strip(variant), strip(base));
  const verifier = files.find((file) => file.path === '.claude/agents/verifier.md').content;
  assert.doesNotMatch(verifier, /you run at the/, 'a role without levels carries no level line');
});

/* ------------------------------------------------------------------ */
/* Entry command, coordinator and routes                               */
/* ------------------------------------------------------------------ */

test('a routed delegate given a level file and its settings records that level; one only reading it records none', () => {
  const files = generateAll(['claude', 'pi'], { roleRoutes: { worker: 'pi' }, roleLevels: { pi: LEVELS.pi } });
  const entry = files.find((file) => file.path === '.claude/skills/castwork/SKILL.md').content;
  assert.match(entry, /Levels: `complex`: role file `\.pi\/agents\/worker_complex\.md`, model `provider\/strong:high`\./);
  const variant = files.find((file) => file.path === '.pi/agents/worker_complex.md').content;
  assert.match(variant, /or as a fresh routed process given this file and the settings its route lists, you run at the `complex` level/);
  assert.match(variant, /Reading this file in a session already running applies none of its settings and establishes no level: then record none\./);
});

test('the entry command lists the host levels after its routes', () => {
  for (const [host, entry] of [['claude', '.claude/skills/castwork/SKILL.md'], ['pi', '.pi/prompts/castwork.md'], ['opencode', '.opencode/commands/castwork.md']]) {
    const content = generateAll([host], { roleLevels: { [host]: LEVELS[host] } }).find((file) => file.path === entry).content;
    const routes = content.indexOf('### Routes from this host');
    const levels = content.indexOf('### Levels on this host');
    assert.ok(routes >= 0 && levels > routes, `${host} lists levels after routes`);
    assert.match(content, /## Levels\n/, `${host} carries the procedure`);
  }
  const claude = generateAll(['claude'], { roleLevels: { claude: LEVELS.claude } })
    .find((file) => file.path === '.claude/skills/castwork/SKILL.md').content;
  assert.match(claude, /- `worker`: `simple` is `worker_simple` \(model `claude-fast`, effort `low`\); `complex` is `worker_complex` \(model `claude-strong`, effort `high`\)\. `standard` is `worker` itself\./);
});

test('the generated coordinator closes with the levels and points to the procedure', () => {
  const files = generateAll(['claude'], { roleLevels: { claude: LEVELS.claude } });
  const coordinator = files.find((file) => file.path === '.claude/agents/coordinator.md').content;
  assert.match(coordinator, /## Levels on this host\n\nThese roles have variants for other assignments\. Before starting one, read\nthe `## Levels` section of `\.claude\/skills\/castwork\/SKILL\.md`/);
  assert.match(coordinator, /`complex` is `worker_complex`/);
});

test('a route lists the role file and settings of each level its host configures', () => {
  const files = generateAll(['claude', 'codex'], { roleRoutes: { verifier: 'codex' }, roleLevels: { codex: LEVELS.codex } });
  const entry = files.find((file) => file.path === '.claude/skills/castwork/SKILL.md').content;
  assert.match(entry, /`verifier` runs in Codex \(`codex`\)\. Role file: `\.codex\/agents\/verifier\.toml`\. Actor: `verifier@codex`\. Settings: the host's own defaults\. Levels: `complex`: role file `\.codex\/agents\/verifier_complex\.toml`, model `gpt-strong`, model_reasoning_effort `high`\./);
  assert.doesNotMatch(entry, /### Levels on this host/, 'the routing host has no levels of its own');
});

test('a level value cannot carry a dollar sign into a Pi command', () => {
  assert.throws(() => generateAll(['pi'], { roleLevels: { pi: { worker: { complex: { model: 'provider/$HOME' } } } } }),
    /cannot carry a dollar sign from castwork\.json role_levels\.pi\.worker\.complex\.model/);
});

/* ------------------------------------------------------------------ */
/* setup, update, validate                                             */
/* ------------------------------------------------------------------ */

test('update writes variants and removes the one a level no longer configures', (t) => {
  const root = fixture(t, ['claude'], { role_levels: { claude: LEVELS.claude } });
  update(root);
  assert.ok(exists(root, '.claude/agents/worker_complex.md'));
  assert.ok(exists(root, '.claude/agents/worker_simple.md'));
  writeExtra(root, { role_levels: { claude: { worker: { complex: LEVELS.claude.worker.complex } } } });
  update(root);
  assert.ok(exists(root, '.claude/agents/worker_complex.md'));
  assert.ok(!exists(root, '.claude/agents/worker_simple.md'));
  writeExtra(root, { role_levels: undefined });
  update(root);
  assert.ok(!exists(root, '.claude/agents/worker_complex.md'));
  assert.doesNotMatch(read(root, '.claude/agents/worker.md'), /you run at the/);
});

test('validate accepts generated levels and warns when a level leaves its effort to the host', (t) => {
  const root = fixture(t, ['claude', 'codex', 'opencode'], {
    role_levels: {
      codex: { worker: { complex: { model: 'gpt-strong' } } },
      claude: { worker: { complex: { model: 'claude-strong', effort: 'high' } } },
      opencode: { worker: { complex: { model: 'openai/strong' } } },
    },
  });
  update(root);
  const findings = validate(root).findings.filter((finding) => finding.where === CONFIG_FILE);
  assert.deepEqual(findings.map((finding) => finding.message), [
    "role_levels.codex.worker.complex sets no model_reasoning_effort; codex fills it from its own configuration, which may not suit this level's model",
  ]);
  assert.ok(validate(root).ok);
});

/* ------------------------------------------------------------------ */
/* Records, task add and report                                        */
/* ------------------------------------------------------------------ */

test('task add takes level on every entry kind and refuses an unknown one', () => {
  assert.equal(entryFromPairs('candidate', ['ref=0123456', 'level=complex']).level, 'complex');
  assert.equal(entryFromPairs('evidence', ['check=test', 'candidate=0123456', 'result=pass', 'level=simple']).level, 'simple');
  assert.equal(entryFromPairs('assessment', ['candidate=0123456', 'role=verifier', 'verdict=accept', 'level=standard']).level, 'standard');
  assert.throws(() => entryFromPairs('candidate', ['ref=0123456', 'level=hard']), /level hard is not one of simple, standard, complex/);
});

const front = (data) => Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
const task = (data) => ({ kind: 'task', body_line: 10, record: parseRecord(`---\n${front({ schema: 1, id: 'A', title: 'Example', status: 'in_review', ...data })}\n---\n`, { path: '.castwork/tasks/A.md' }) });

test('report counts entries by kind and recorded level, keeping unrecorded apart, without changing rounds', () => {
  const report = deriveReport([task({
    candidates: [{ ref: 'abc1234', level: 'simple' }, { ref: 'abc1234', level: 'complex' }, { ref: 'def5678' }],
    evidence: [{ check: 'test', candidate: 'abc1234', result: 'pass', level: 'complex' }],
    assessments: [{ candidate: 'abc1234', role: 'verifier', actor: 'verifier@claude', verdict: 'accept', level: 'hard' }],
  })], { project: 'example' });
  assert.deepEqual(report.quality.levels, {
    candidates: { simple: 1, standard: 0, complex: 1, unrecorded: 1, unrecognized: 0 },
    evidence: { simple: 0, standard: 0, complex: 1, unrecorded: 0, unrecognized: 0 },
    assessments: { simple: 0, standard: 0, complex: 0, unrecorded: 0, unrecognized: 1 },
  });
  assert.equal(report.totals.distinct_refs, 2, 'two entries for one ref stay one round');
  const text = [renderReport(report)].flat().join('\n');
  assert.match(text.replace(/\s+/g, ' '), /Levels candidates simple 1, complex 1, unrecorded 1 · evidence complex 1, unrecorded 0 · assessments unrecognized 1, unrecorded 0/);
});

test('report counts a level written as a list or a mapping as unrecognized, never as a level or as missing', () => {
  const report = deriveReport([task({
    candidates: [{ ref: 'abc1234', level: ['complex'] }, { ref: 'abc1234', level: [] }, { ref: 'abc1234', level: { value: 'simple' } },
      { ref: 'abc1234', level: 3 }, { ref: 'abc1234', level: ' complex ' }, { ref: 'abc1234', level: '' }],
  })], { project: 'example' });
  assert.deepEqual(report.quality.levels.candidates, { simple: 0, standard: 0, complex: 1, unrecorded: 1, unrecognized: 4 });
});

test('report shows no level line when no entry records a level', () => {
  const report = deriveReport([task({ candidates: [{ ref: 'abc1234' }] })], { project: 'example' });
  assert.doesNotMatch([renderReport(report)].flat().join('\n'), /^Levels/m);
});
