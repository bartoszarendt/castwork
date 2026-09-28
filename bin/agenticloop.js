#!/usr/bin/env node
import { main } from '../src/cli-main.js';

// A reader that stops early, as `snapshot | head -1` does, closes the pipe;
// the rest of the output has no one to read it. That is not a failure of the
// command, so it ends with the command's own exit code, without a stack trace.
process.stdout.on('error', (error) => {
  if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EPIPE') throw error;
  process.exit(process.exitCode ?? 0);
});

process.exitCode = main(process.argv.slice(2));
