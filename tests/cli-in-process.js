/**
 * Run the CLI in the test's own process and capture what it prints. A child
 * process costs a quarter of a second or more on every call; tests that need
 * the real entry point (its exit wiring, a pipe, or its environment) spawn
 * bin/castwork.js instead.
 *
 * Capturing replaces the process-wide stdout and stderr writers, so it holds
 * only for a synchronous command, and two captures must never overlap. Every
 * command is synchronous today; one that awaited would print outside it.
 */

import { main } from '../src/cli-main.js';

/**
 * @param {string} cwd the project root the command runs in
 * @param {...string} args
 * @returns {{code: number, out: string, err: string}}
 */
export function runCli(cwd, ...args) {
  let out = '';
  let err = '';
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  process.stdout.write = (chunk) => { out += chunk; return true; };
  process.stderr.write = (chunk) => { err += chunk; return true; };
  try {
    const code = main(args, { cwd });
    return { code, out, err };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}
