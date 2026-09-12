/** Presentation metadata lookup; it never evaluates protected-action legality. */
import { refusalClassFor } from './refusal-classes.js';

/** Coded reasons retain the catalog's canonical fact owner. */
export function explainReasonFactOwner(policyCode, uncodedOwner) {
  return policyCode === null || policyCode === undefined
    ? uncodedOwner
    : refusalClassFor(policyCode).factOwner;
}
