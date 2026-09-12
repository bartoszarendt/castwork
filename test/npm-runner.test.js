import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveNpmLaunch } from './helpers/npm-runner.js';

describe('portable npm runner', () => {
  it('uses Node to launch npm_execpath instead of a platform npm executable', () => {
    const launch = resolveNpmLaunch(['pack', '--dry-run'], '/fixture/npm-cli.js');
    assert.deepEqual(launch, {
      command: process.execPath,
      args: ['/fixture/npm-cli.js', 'pack', '--dry-run'],
    });
  });
});
