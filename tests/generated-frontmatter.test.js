import assert from 'node:assert/strict';
import test from 'node:test';

import { generateHost, readRoles, readSkills } from '../src/adapter-generation.js';
import { HOSTS } from '../src/layout.js';
import { parseYaml } from '../src/yaml.js';

/** Finding 3: generated frontmatter must be valid YAML for the host, not just for us. */
function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

for (const host of HOSTS.filter((name) => name !== 'codex')) {
  test(`3: every generated ${host} file has parseable frontmatter`, () => {
    const files = generateHost(host);
    let checked = 0;
    for (const file of files) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      checked += 1;
      const parsed = parseYaml(frontmatter);
      assert.equal(typeof parsed.name === 'string' || typeof parsed.description === 'string', true, `${file.path} has no usable frontmatter`);
    }
    assert.ok(checked > 0, `${host} produced no frontmatter to check`);
  });

  test(`3: the ${host} verifier description survives generation intact`, () => {
    const verifier = generateHost(host).find((file) => file.path.endsWith('verifier.md'));
    const parsed = parseYaml(frontmatterOf(verifier.content));
    const canonical = readRoles().find((role) => role.id === 'verifier');
    assert.equal(parsed.name, 'verifier');
    assert.equal(parsed.description, canonical.description);
    assert.match(parsed.description, /Read-only on the result: changes nothing/, 'the colon-bearing clause must survive');
  });

  test(`3: no generated ${host} frontmatter line carries a bare second colon`, () => {
    for (const file of generateHost(host)) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      for (const line of frontmatter.split('\n')) {
        const match = line.match(/^([A-Za-z_][\w-]*): (.*)$/);
        if (!match) continue;
        const value = match[2];
        if (value.startsWith('"') || value.startsWith("'")) continue;
        assert.ok(!/:\s/.test(value), `${file.path} emits an unquoted colon: ${line}`);
      }
    }
  });
}

test('3: a role or skill description containing a colon is quoted', () => {
  const withColon = [...readRoles(), ...readSkills()].filter((entry) => /:\s/.test(entry.description));
  assert.ok(withColon.length > 0, 'expected at least one colon-bearing description to exercise this');
  for (const host of HOSTS.filter((name) => name !== 'codex')) {
    for (const file of generateHost(host)) {
      const frontmatter = frontmatterOf(file.content);
      if (frontmatter === null) continue;
      const parsed = parseYaml(frontmatter);
      if (typeof parsed.description !== 'string') continue;
      assert.ok(!parsed.description.endsWith(':'), `${file.path} truncated a description`);
    }
  }
});
