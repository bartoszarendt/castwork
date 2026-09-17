/**
 * A green preflight is a claim about a sequence.
 *
 * In the field, `task handoff-preflight` returned `ok: true` at 19:27:16. At
 * 19:28:44 the required next action - abandoning the dead attempt - wrote an
 * untracked receipt, and at 19:28:47 `prepare-dispatch` refused with
 * `worktree.clean_gate.failed`. The same shape recurred an hour later with
 * `dispatch.packet.stale` after role start legitimately mutated the carrier.
 *
 * Neither refusal is wrong in isolation. But preflight's whole purpose is that
 * one green implies dispatch and role start will succeed, and a green that does
 * not survive its own prescribed next action is a false green. So the verdict
 * now carries the ordered sequence it is predicting, including the commits each
 * step forces.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveHandoffSequence, renderHandoffSequence } from '../src/handoff-sequence.js';

const LIVE_ATTEMPT = { attemptId: `attempt:${'a'.repeat(32)}` };

describe('the preflight sequence names every step without role-authored bookkeeping', () => {
  it('puts CLI-committed abandonment before the packet it unblocks', () => {
    const sequence = deriveHandoffSequence({
      taskId: 'T-018', host: 'opencode', liveAttempt: LIVE_ATTEMPT, newPacketPermitted: false,
    });
    const first = sequence.steps[0];
    assert.match(first.command, /task abandon-attempt T-018 --attempt attempt:a{32}/);
    assert.equal(first.commitRequired, false, 'the protected command commits its receipt');
    assert.equal(first.gate, 'worktree.clean_gate.failed', 'the sequence names the gate that would otherwise refuse');
    assert.deepEqual(first.writes, ['.agenticloop/handoffs/attempts/T-018/']);
    assert.match(sequence.steps[1].command, /task prepare-dispatch T-018 --host opencode/);
  });

  it('states that role start mutates the carrier the packet bound', () => {
    // The second field failure: a packet minted before role start and consumed
    // after it is stale, because role start legitimately changed the digest.
    const sequence = deriveHandoffSequence({ taskId: 'T-018', host: 'opencode' });
    const roleStart = sequence.steps.find(item => /task role-start T-018/.test(item.command));
    assert.ok(roleStart, 'role start is part of the sequence preflight is predicting');
    assert.equal(roleStart.commitRequired, false);
    assert.equal(roleStart.gate, 'handoff.evidence.mismatched');
    assert.equal(roleStart.commitReason, null);
    assert.ok(roleStart.writes.includes('.agenticloop/tasks/T-018.md'));
  });

  it('omits the abandonment when no attempt is conserved', () => {
    const sequence = deriveHandoffSequence({ taskId: 'T-018', host: 'opencode' });
    assert.ok(!sequence.steps.some(item => /abandon-attempt/.test(item.command)));
    assert.match(sequence.steps[0].command, /task prepare-dispatch/);
  });

  it('reports zero role-authored bookkeeping commits', () => {
    const sequence = deriveHandoffSequence({
      taskId: 'T-018', host: 'opencode', liveAttempt: LIVE_ATTEMPT, newPacketPermitted: false,
    });
    assert.equal(sequence.commitCount, sequence.steps.filter(item => item.commitRequired).length);
    assert.equal(sequence.commitCount, 0);
    const rendered = renderHandoffSequence(sequence).join('\n');
    assert.match(rendered, /next ordered sequence \(\d+ steps, 0 role-authored commits required\)/);
    assert.doesNotMatch(rendered, /commit \.agenticloop\/handoffs\/attempts\/T-018\/ before the next step/);
  });
});
