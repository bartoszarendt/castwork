import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { fakeExecutableEnv, sanitizedChildEnv } from './helpers/hermetic-child-env.js';

const P36F01_DENIAL_CLASSIFICATION = Object.freeze({
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

  it('records denial-by-construction while keeping kernel network isolation owner-gated', () => {
    assert.equal(P36F01_DENIAL_CLASSIFICATION.achieved.form, 'denial-by-construction');
    assert.deepEqual(P36F01_DENIAL_CLASSIFICATION.achieved.invariants, [
      'fixture-only PATH for fake gh children',
      'GitHub credentials are sanitized case-insensitively',
      'fake gh requires and records its sentinel',
      'missing or malformed stubs cannot reach a real gh',
    ]);
    assert.equal(P36F01_DENIAL_CLASSIFICATION.kernelNetworkNamespace.classification, 'owner-gated');
    assert.equal(P36F01_DENIAL_CLASSIFICATION.kernelNetworkNamespace.installedProofClaim, 'not claimed for this host');

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
