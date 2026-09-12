import { dirname, join } from 'node:path';

import { runProcess } from './process-runner.js';

export function resolveNpmLaunch(args, npmExecPath = process.env.npm_execpath) {
  const npmCli = npmExecPath ?? (process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null);
  return npmCli
    ? { command: process.execPath, args: [npmCli, ...args] }
    : { command: 'npm', args };
}

export function runNpm(args, { cache, ...options } = {}) {
  const launch = resolveNpmLaunch(args);
  return runProcess(launch.command, launch.args, {
    timeout: 300000,
    ...options,
    env: { ...process.env, npm_config_cache: cache, ...options.env },
  });
}
