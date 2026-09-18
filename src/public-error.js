/**
 * An error whose message is meant for the person running the command.
 * Anything else is a bug and prints a stack under --debug.
 */
export class PublicError extends Error {
  /** @param {string} message @param {{exitCode?: number, hint?: string}} [options] */
  constructor(message, options = {}) {
    super(message);
    this.name = 'PublicError';
    this.exitCode = options.exitCode ?? 1;
    this.hint = options.hint ?? null;
  }
}

/** @param {string} message @param {{exitCode?: number, hint?: string}} [options] */
export function fail(message, options = {}) {
  throw new PublicError(message, options);
}
