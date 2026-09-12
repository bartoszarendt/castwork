import { REFUSAL_CLASSES } from './refusal-classes.js';

/** Probe IDs are test adapters; code ownership is derived from the catalog. */
const PROBE_ID_BY_CODE = Object.freeze({
  'projection.fact.contradiction': 'projection-authoritative-contradiction',
});

export const F8_EXECUTABLE_PROOF_REGISTRY = Object.freeze(Object.entries(PROBE_ID_BY_CODE).map(([code, probeId]) =>
  Object.freeze({ code, probeId, factOwner: REFUSAL_CLASSES[code].factOwner })
));
