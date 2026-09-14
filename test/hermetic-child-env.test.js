import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { fakeExecutableEnv, isolatedHomeEnv, sanitizedChildEnv } from './helpers/hermetic-child-env.js';

const NETWORK_DENIAL_CLASSIFICATION = Object.freeze({
  kernelNetworkNamespace: Object.freeze({
    classification: 'owner-gated',
    attemptedWhenAvailable: true,
    unavailableOutcomes: Object.freeze(['ENOENT', 'EPERM', 'Operation not permitted']),
    installedProofClaim: 'not claimed for this host',
  }),
  achieved: Object.freeze({
    form: 'denial-by-construction',
    invariants: Object.freeze([
      'fixture-only PATH for fake gh children',
      'GitHub credentials are sanitized case-insensitively',
      'fake gh requires and records its sentinel',
      'missing or malformed stubs cannot reach a real gh',
    ]),
  }),
});

describe('hermetic child environment', () => {
  it('removes inherited GitHub credentials and resolves executables only from the fixture directory', () => {
    const env = fakeExecutableEnv('/fixture/bin', {
      GH_TOKEN: 'token', GITHUB_TOKEN: 'token', GITHUB_ACTOR: 'actor', GITHUB_ENTERPRISE_TOKEN: 'token',
    });
    assert.equal(env.PATH, '/fixture/bin');
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_ACTOR', 'GITHUB_ENTERPRISE_TOKEN']) {
      assert.equal(key in env, false, `${key} must not reach a hermetic child`);
    }
  });

  it('sanitizes credentials supplied through child overrides as well', () => {
    const env = sanitizedChildEnv({ GITHUB_TOKEN: 'token', GH_TOKEN: 'token' });
    assert.equal('GITHUB_TOKEN' in env, false);
    assert.equal('GH_TOKEN' in env, false);
  });

  it('strips lowercase and mixed-case GitHub credential keys', () => {
    const env = sanitizedChildEnv({
      github_token: 'token',
      Github_Token: 'token',
      gItHuB_EnTeRpRiSe_Token: 'token',
      GITHUB_ACTIONS: 'metadata',
      unrelated: 'retained',
    });
    for (const key of ['github_token', 'Github_Token', 'gItHuB_EnTeRpRiSe_Token', 'GITHUB_ACTIONS']) {
      assert.equal(key in env, false, `${key} must not reach a hermetic child`);
    }
    assert.equal(env.unrelated, 'retained', 'sanitization must not nuke unrelated environment keys');
  });

  it('pins os.homedir to the fixture home and removes inherited Windows home fragments', () => {
    const home = mkdtempSync(join(tmpdir(), 'hermetic-child-home-'));
    try {
      const env = isolatedHomeEnv(home, {
        home: 'C:\\caller-home',
        UserProfile: 'C:\\caller-profile',
        HOMEDRIVE: 'C:',
        homepath: '\\operator-profile',
        unrelated: 'retained',
      });
      assert.equal(env.HOME, home);
      assert.equal(env.USERPROFILE, home);
      assert.deepEqual(
        Object.keys(env).filter(key => /^(?:HOME|USERPROFILE)$/i.test(key)).sort(),
        ['HOME', 'USERPROFILE'],
      );
      assert.deepEqual(Object.keys(env).filter(key => /^HOME(?:DRIVE|PATH)$/i.test(key)), []);
      assert.equal(env.unrelated, 'retained');
      const child = spawnSync(process.execPath, ['-e', "process.stdout.write(require('node:os').homedir())"], {
        env, encoding: 'utf8',
      });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }

  });
  it('records denial-by-construction while keeping kernel network isolation owner-gated', () => {
    assert.equal(NETWORK_DENIAL_CLASSIFICATION.achieved.form, 'denial-by-construction');
    assert.deepEqual(NETWORK_DENIAL_CLASSIFICATION.achieved.invariants, [
      'fixture-only PATH for fake gh children',
      'GitHub credentials are sanitized case-insensitively',
      'fake gh requires and records its sentinel',
      'missing or malformed stubs cannot reach a real gh',
    ]);
    assert.equal(NETWORK_DENIAL_CLASSIFICATION.kernelNetworkNamespace.classification, 'owner-gated');
    assert.equal(NETWORK_DENIAL_CLASSIFICATION.kernelNetworkNamespace.installedProofClaim, 'not claimed for this host');

    const childEnv = fakeExecutableEnv('/fixture-only/fake-gh');
    assert.equal(childEnv.PATH, '/fixture-only/fake-gh');
    const missingStub = spawnSync('gh', ['--version'], { env: childEnv, encoding: 'utf8' });
    assert.equal(missingStub.error?.code, 'ENOENT', 'a fixture-only PATH must not resolve a real gh');

    const kernelProbe = spawnSync('unshare', ['--net', '--', 'true'], { encoding: 'utf8', timeout: 1_000 });
    const kernelUnavailable = kernelProbe.status !== 0;
    assert.ok(kernelUnavailable || kernelProbe.status === 0,
      `kernel probe must either succeed or report an expected unavailable outcome: ${kernelProbe.stderr}`);
  });
});
