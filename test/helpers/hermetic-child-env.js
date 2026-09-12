import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GITHUB_CREDENTIAL_KEY = /^(?:GH_TOKEN|GITHUB_TOKEN|GITHUB_.*)$/i;

export function sanitizedChildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of Object.keys(env)) {
    if (GITHUB_CREDENTIAL_KEY.test(key)) delete env[key];
  }
  return env;
}

export function fakeExecutableEnv(executableDir, overrides = {}) {
  return sanitizedChildEnv({ ...overrides, PATH: executableDir });
}

/**
 * Create a fixture-only executable that runs the supplied Node preload on POSIX
 * and is process-resolvable as an .exe on Windows.
 */
export function writeNodeBackedExecutable(executableDir, command, preloadPath) {
  mkdirSync(executableDir, { recursive: true });
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, join(executableDir, `${command}.exe`));
    return;
  }
  const script = join(executableDir, command);
  writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${preloadPath}" "$@"\n`, 'utf8');
  chmodSync(script, 0o755);
}
