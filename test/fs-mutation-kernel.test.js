/**
 * Direct filesystem mutation kernel tests.
 *
 * The kernel owns target-bound validation and rollback. These tests reproduce
 * every independently-confirmed defect and assert restored bytes and on-disk
 * structure — not just that rollbackErrors is an array.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { createHash } from 'node:crypto';

import {
  assertSafeRelativePath,
  executeMutationBatch,
  executeRenameMutation,
  fingerprintTargetPath,
  resolveTargetPath,
} from '../src/fs-mutation-kernel.js';

const IS_WINDOWS = platform() === 'win32';

let tmpBase;

before(() => {
  tmpBase = mkdtempSync(join(tmpdir(), 'al-fs-kernel-'));
});

after(() => {
  rmSync(tmpBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function target() {
  return mkdtempSync(join(tmpBase, 't-'));
}

function foreignizePrimaryLock(root, taskId) {
  const path = join(root, '.agenticloop', 'locks', 'lifecycle-authority', `${createHash('sha256').update(taskId).digest('hex')}.lock`);
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  owner.pid = process.pid + 100000;
  writeFileSync(path, `${JSON.stringify(owner)}\n`);
}

describe('kernel path validation', () => {
  it('rejects drive-qualified paths', () => {
    assert.throws(() => assertSafeRelativePath('C:/escape'), /drive-qualified/);
    assert.throws(() => assertSafeRelativePath('c:\\escape'), /backslash/);
  });

  it('rejects absolute paths', () => {
    assert.throws(() => assertSafeRelativePath('/etc/passwd'), /absolute/);
    assert.throws(() => assertSafeRelativePath('/x'), /absolute/);
  });

  it('rejects dot segments', () => {
    assert.throws(() => assertSafeRelativePath('./x'), /dot\/empty\/traversal/);
    assert.throws(() => assertSafeRelativePath('x/./y'), /dot\/empty\/traversal/);
  });

  it('rejects traversal segments', () => {
    assert.throws(() => assertSafeRelativePath('../escape'), /dot\/empty\/traversal/);
    assert.throws(() => assertSafeRelativePath('a/../../b'), /dot\/empty\/traversal/);
    assert.throws(() => assertSafeRelativePath('a/..'), /dot\/empty\/traversal/);
  });

  it('rejects empty segments', () => {
    assert.throws(() => assertSafeRelativePath('a//b'), /dot\/empty\/traversal/);
    assert.throws(() => assertSafeRelativePath(''), /non-empty/);
  });

  it('rejects backslash paths', () => {
    assert.throws(() => assertSafeRelativePath('a\\b'), /backslash/);
  });

  it('rejects NUL bytes', () => {
    assert.throws(() => assertSafeRelativePath('a\0b'), /NUL/);
  });

  it('accepts safe relative paths', () => {
    assert.equal(assertSafeRelativePath('a/b/c.txt'), 'a/b/c.txt');
    assert.equal(assertSafeRelativePath('file.txt'), 'file.txt');
  });

  it('executeMutationBatch cannot write outside targetRoot', () => {
    const t = target();
    const outsideSentinel = join(tmpBase, 'outside-sentinel.txt');
    writeFileSync(outsideSentinel, 'sentinel', 'utf-8');
    // Even if a caller tries an absolute escape, the kernel rejects it.
    const result = executeMutationBatch(t, [
      { type: 'write', path: outsideSentinel, content: 'overwritten' },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /unsafe planned path|escapes target|absolute/);
    assert.equal(readFileSync(outsideSentinel, 'utf-8'), 'sentinel');
    assert.equal(result.rollbackErrors.length, 0, 'validation failure must not attempt rollback');
  });

  it('executeMutationBatch rejects traversal to outside the target', () => {
    const t = target();
    const outsideSentinel = join(tmpBase, 'traversal-sentinel.txt');
    writeFileSync(outsideSentinel, 'sentinel', 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'write', path: '../traversal-sentinel.txt', content: 'overwritten' },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /dot\/empty\/traversal/);
    assert.equal(readFileSync(outsideSentinel, 'utf-8'), 'sentinel');
  });
});

describe('symlink / junction escape rejection', () => {
  it('rejects a mutation whose path crosses a symlinked ancestor outside the target', () => {
    const t = target();
    const outside = mkdtempSync(join(tmpBase, 'escape-'));
    const linkTarget = join(t, 'link');
    symlinkSync(outside, linkTarget, IS_WINDOWS ? 'junction' : undefined);
    const result = executeMutationBatch(t, [
      { type: 'write', path: 'link/escaped.txt', content: 'escaped' },
    ]);
    assert.equal(result.ok, false, 'must reject symlink escape');
    assert.match(result.errors[0], /symlink|junction|escapes target/);
    assert.equal(existsSync(join(outside, 'escaped.txt')), false, 'must not write through the symlink');
  });

  it('resolveTargetPath rejects a symlinked ancestor', () => {
    const t = target();
    const outside = mkdtempSync(join(tmpBase, 'escape-resolve-'));
    const linkTarget = join(t, 'evil');
    symlinkSync(outside, linkTarget, IS_WINDOWS ? 'junction' : undefined);
    assert.throws(() => resolveTargetPath(t, 'evil/file.txt'), /symlink|junction/);
  });
});

describe('created-file rollback', () => {
  it('removes a created file on rollback with no residue', () => {
    const t = target();
    const result = executeMutationBatch(t, [
      { type: 'write', path: 'created.txt', content: 'new' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(t, 'created.txt')), false, 'created file must be removed on rollback');
    assert.deepEqual(readdirSync(t), [], 'no residue after successful rollback');
  });
});

describe('overwritten-file byte-for-byte restoration', () => {
  it('restores exact prior bytes after a failed overwrite', () => {
    const t = target();
    const original = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x0a, 0x0d, 0xe2, 0x9c, 0x93]);
    writeFileSync(join(t, 'binary.bin'), original);
    const result = executeMutationBatch(t, [
      { type: 'write', path: 'binary.bin', content: 'overwritten' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    const restored = readFileSync(join(t, 'binary.bin'));
    assert.deepEqual(restored, original, 'exact bytes must be restored');
  });

  it('restores text byte-for-byte including unicode and CRLF', () => {
    const t = target();
    const original = 'line1\r\nline2 — unicode ✓\r\n';
    writeFileSync(join(t, 'text.txt'), original, 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'write', path: 'text.txt', content: 'changed' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(readFileSync(join(t, 'text.txt'), 'utf-8'), original);
  });
});

describe('removed-file restoration', () => {
  it('restores a removed file on rollback', () => {
    const t = target();
    writeFileSync(join(t, 'preexisting.txt'), 'keep me', 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'remove', path: 'preexisting.txt' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(t, 'preexisting.txt')), true, 'removed file must be restored');
    assert.equal(readFileSync(join(t, 'preexisting.txt'), 'utf-8'), 'keep me');
  });
});

describe('created-directory cleanup', () => {
  it('removes a transaction-created directory on rollback (no false error)', () => {
    const t = target();
    const result = executeMutationBatch(t, [
      { type: 'mkdir', path: 'freshdir' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(t, 'freshdir')), false, 'created dir must be cleaned up');
    // A created-directory cleanup must not produce a spurious rollback error.
    assert.equal(result.rollbackErrors.length, 0, () => `unexpected rollback errors: ${result.rollbackErrors.join('; ')}`);
  });

  it('removes nested transaction-created directories on rollback', () => {
    const t = target();
    const result = executeMutationBatch(t, [
      { type: 'mkdir', path: 'a/b/c' },
      { type: 'write', path: 'a/b/c/file.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(t, 'a')), false, 'nested created dirs must be cleaned up recursively');
    assert.deepEqual(readdirSync(t), [], 'no residue');
  });

  it('never removes a pre-existing directory during mkdir rollback (defect 5)', () => {
    const t = target();
    mkdirSync(join(t, 'preexisting-dir'));
    // A planned mkdir over a pre-existing directory followed by an unrelated
    // failure must NOT report a rollback error and must leave the directory.
    const result = executeMutationBatch(t, [
      { type: 'mkdir', path: 'preexisting-dir' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(t, 'preexisting-dir')), true, 'pre-existing dir must remain');
    // The snapshot state for the pre-existing directory is 'directory'; rollback
    // leaves it alone and produces no spurious rollback error.
    assert.equal(result.rollbackErrors.filter(e => e.includes('preexisting-dir')).length, 0,
      'pre-existing mkdir target must not produce a rollback error');
  });
});

describe('directory-removal rejection', () => {
  it('rejects a direct directory-removal mutation so a tree cannot be lost (defect 4)', () => {
    const t = target();
    mkdirSync(join(t, 'tree', 'nested'), { recursive: true });
    writeFileSync(join(t, 'tree', 'nested', 'file.txt'), 'important', 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'remove', path: 'tree' },
    ]);
    assert.equal(result.ok, false, 'directory removal must be rejected');
    assert.match(result.errors[0], /directory-removal/);
    // The tree must be entirely intact.
    assert.equal(existsSync(join(t, 'tree', 'nested', 'file.txt')), true);
    assert.equal(readFileSync(join(t, 'tree', 'nested', 'file.txt'), 'utf-8'), 'important');
    assert.equal(result.rollbackErrors.length, 0, 'rejected mutation must not roll back');
  });

  it('removes an explicitly planned empty directory without recursive deletion', () => {
    const t = target();
    mkdirSync(join(t, 'stale-empty'), { recursive: true });
    const result = executeMutationBatch(t, [
      { type: 'rmdir-empty', path: 'stale-empty' },
    ]);
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(existsSync(join(t, 'stale-empty')), false);
  });

  it('restores an empty directory when a later mutation in the batch fails', () => {
    const t = target();
    mkdirSync(join(t, 'stale-empty'), { recursive: true });
    const result = executeMutationBatch(t, [
      { type: 'rmdir-empty', path: 'stale-empty' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(existsSync(join(t, 'stale-empty')), true, 'removed directory must be recreated');
    assert.deepEqual(readdirSync(join(t, 'stale-empty')), []);
    assert.deepEqual(result.rollbackErrors, []);
  });

  it('refuses an explicit empty-directory removal when the directory is non-empty', () => {
    const t = target();
    mkdirSync(join(t, 'not-empty'), { recursive: true });
    writeFileSync(join(t, 'not-empty', 'owned.txt'), 'preserve', 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'rmdir-empty', path: 'not-empty' },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /non-empty directory/);
    assert.equal(readFileSync(join(t, 'not-empty', 'owned.txt'), 'utf-8'), 'preserve');
  });
});

describe('transactional rename segments', () => {
  it('removes destination parents created before an injected rename failure', () => {
    const t = target();
    writeFileSync(join(t, 'legacy.txt'), 'legacy', 'utf-8');
    const result = executeRenameMutation(t, {
      from: 'legacy.txt',
      to: 'fresh/nested/current.txt',
      fromBaseHash: fingerprintTargetPath(t, 'legacy.txt'),
      toBaseHash: null,
    }, {
      rename: () => {
        const error = new Error('injected rename failure');
        error.code = 'EBUSY';
        throw error;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.rolledBack, true);
    assert.match(result.errors[0], /EBUSY|injected rename failure/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(readFileSync(join(t, 'legacy.txt'), 'utf-8'), 'legacy');
    assert.equal(existsSync(join(t, 'fresh')), false, 'created destination parents must roll back');
  });
});

describe('primary errors versus rollback errors', () => {
  it('returns the primary failure separately from rollback failures', () => {
    const t = target();
    writeFileSync(join(t, 'victim.txt'), 'original', 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'write', path: 'victim.txt', content: 'changed' },
      { type: 'write', path: 'boom.txt', content: {} },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0, 'primary error must be present');
    // victim.txt was restorable, so rollbackErrors is clean here.
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(readFileSync(join(t, 'victim.txt'), 'utf-8'), 'original');
  });
});

describe('lifecycle authority locks', () => {
  it('serializes a competing lifecycle writer injected after the final verification', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    let contender;
    const started = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress',
      expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') ?? '0'.repeat(64),
    }], {
      lifecycleAuthorityTaskIds: ['T-001'],
      afterFinalVerification: () => {
        contender = executeMutationBatch(t, [{
          type: 'write', path: 'carrier.txt', content: 'accepted',
          expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') ?? '0'.repeat(64),
        }], { lifecycleAuthorityTaskIds: ['T-001'] });
      },
    });

    assert.equal(started.ok, true, started.errors.join('\n'));
    assert.equal(contender.ok, false);
    assert.match(contender.errors[0], /lifecycle authority 'T-001' is currently locked/);
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'in-progress');

    const terminal = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted',
      expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') ?? '0'.repeat(64),
    }], { lifecycleAuthorityTaskIds: ['T-001'] });
    assert.equal(terminal.ok, true, terminal.errors.join('\n'));
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
  });

  it('reclaims an interrupted lock owner and completes the next guarded mutation', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const expected = fingerprintTargetPath(t, 'carrier.txt');
    const interrupted = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file', expectedDigest: expected,
    }], {
      lifecycleAuthorityTaskIds: ['T-CRASH'],
      // Model SIGKILL after ownership was published: normal finally cleanup
      // cannot run, leaving an owner file whose PID is now reported dead.
      retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot',
    });
    assert.equal(interrupted.ok, true, interrupted.errors.join('\n'));
    foreignizePrimaryLock(t, 'T-CRASH');

    const reclaimed = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: ['T-CRASH'],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => false,
    });
    assert.equal(reclaimed.ok, true, reclaimed.errors.join('\n'));
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
  });

  it('reclaims dead reclaim claims interrupted throughout stale-lock handoff', () => {
    for (const phase of ['after-claim-publication', 'after-primary-lock-removal', 'after-handoff']) {
      const t = target();
      writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
      const expected = fingerprintTargetPath(t, 'carrier.txt');
      const held = executeMutationBatch(t, [{
        type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file', expectedDigest: expected,
      }], {
        lifecycleAuthorityTaskIds: [`T-RECLAIM-${phase}`],
        retainLifecycleAuthorityLocksForTest: true,
        lifecycleLockBootIdentity: () => 'test-boot',
      });
      assert.equal(held.ok, true, `${phase}: ${held.errors.join('\n')}`);
      foreignizePrimaryLock(t, `T-RECLAIM-${phase}`);

      const interrupted = executeMutationBatch(t, [{
        type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
        expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
      }], {
        lifecycleAuthorityTaskIds: [`T-RECLAIM-${phase}`],
        lifecycleLockBootIdentity: () => 'test-boot',
        lifecycleLockProcessInspector: () => false,
        lifecycleLockReclaimInterruptionForTest: phase,
      });
      assert.equal(interrupted.ok, false, `${phase}: interruption must leave no successful mutation`);

      const recovered = executeMutationBatch(t, [{
        type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
        expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
      }], {
        lifecycleAuthorityTaskIds: [`T-RECLAIM-${phase}`],
        lifecycleLockBootIdentity: () => 'test-boot',
        lifecycleLockProcessInspector: () => false,
      });
      assert.equal(recovered.ok, true, `${phase}: ${recovered.errors.join('\n')}`);
      assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
    }
  });

  it('does not unlink a live replacement claim when another reclaimer wins after its reread', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const taskId = 'T-RECLAIM-TOCTOU';
    let publishedByA;

    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    foreignizePrimaryLock(t, taskId);

    // Seed the dead R0 that reclaimer B will inspect and attempt to reclaim.
    const interruptedR0 = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => false,
      lifecycleLockReclaimInterruptionForTest: 'after-claim-publication',
    });
    assert.equal(interruptedR0.ok, false);

    const reclaimerB = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: (_pid, owner) => owner?.reclaimId === publishedByA,
      afterLifecycleReclaimClaimReadForTest: () => {
        // Reclaimer A removes B's observed dead R0 and publishes its live R1
        // before B performs its atomic ownership transfer.
        const reclaimerA = executeMutationBatch(t, [{
          type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
          expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
        }], {
          lifecycleAuthorityTaskIds: [taskId],
          lifecycleLockBootIdentity: () => 'test-boot',
          lifecycleLockProcessInspector: () => false,
          lifecycleLockReclaimInterruptionForTest: 'after-claim-publication',
        });
        assert.equal(reclaimerA.ok, false);
        const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
        const reclaimName = readdirSync(lockDir).find(name => name.endsWith('.lock.reclaim'));
        publishedByA = JSON.parse(readFileSync(join(lockDir, reclaimName), 'utf8')).reclaimId;
      },
    });

    assert.equal(reclaimerB.ok, false);
    assert.equal(reclaimerB.code, 'fs.lifecycle_lock.contended');
    const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
    const reclaimName = readdirSync(lockDir).find(name => name.endsWith('.lock.reclaim'));
    const surviving = JSON.parse(readFileSync(join(lockDir, reclaimName), 'utf8'));
    assert.equal(surviving.reclaimId, publishedByA, 'A\'s live R1 survives B\'s removal attempt');
    assert.equal(readdirSync(lockDir).some(name => name.includes('.lock.reclaim.reclaiming-')), false, 'B cleans its completed transfer entry');
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'in-progress');
  });

  it('restores a live replacement claim after interruption during its private transfer', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const taskId = 'T-RECLAIM-TRANSFER-INTERRUPTION';
    let publishedByA;

    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    foreignizePrimaryLock(t, taskId);

    const interruptedR0 = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => false,
      lifecycleLockReclaimInterruptionForTest: 'after-claim-publication',
    });
    assert.equal(interruptedR0.ok, false);

    const interruptedB = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: (_pid, owner) => owner?.reclaimId === publishedByA,
      afterLifecycleReclaimClaimReadForTest: () => {
        const reclaimerA = executeMutationBatch(t, [{
          type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
          expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
        }], {
          lifecycleAuthorityTaskIds: [taskId],
          lifecycleLockBootIdentity: () => 'test-boot',
          lifecycleLockProcessInspector: () => false,
          lifecycleLockReclaimInterruptionForTest: 'after-claim-publication',
        });
        assert.equal(reclaimerA.ok, false);
        const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
        const reclaimName = readdirSync(lockDir).find(name => name.endsWith('.lock.reclaim'));
        publishedByA = JSON.parse(readFileSync(join(lockDir, reclaimName), 'utf8')).reclaimId;
      },
      lifecycleLockReclaimInterruptionForTest: 'after-claim-transfer',
    });
    assert.equal(interruptedB.ok, false);
    assert.equal(interruptedB.code, 'fs.lifecycle_lock.contended');

    const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
    assert.equal(readdirSync(lockDir).some(name => name.includes('.lock.reclaim.reclaiming-')), true, 'B leaves A\'s live R1 discoverable at its transfer path');

    const recovered = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: (_pid, owner) => owner?.reclaimId === publishedByA || owner?.reclaimId === 'R2-concurrent',
      afterTransferredLifecycleClaimReadForTest: () => {
        writeFileSync(join(lockDir, `${createHash('sha256').update(taskId).digest('hex')}.lock.reclaim`), `${JSON.stringify({
          taskId, reclaimId: 'R2-concurrent', pid: 1003, bootIdentity: 'test-boot',
        })}\n`, { flag: 'wx' });
      },
    });
    assert.equal(recovered.ok, false);
    assert.equal(recovered.code, 'fs.lifecycle_lock.contended');
    const reclaimName = readdirSync(lockDir).find(name => name.endsWith('.lock.reclaim'));
    assert.equal(JSON.parse(readFileSync(join(lockDir, reclaimName), 'utf8')).reclaimId, 'R2-concurrent', 'recovery preserves the concurrently published live claim');
    assert.equal(readdirSync(lockDir).some(name => name.includes('.lock.reclaim.reclaiming-')), false, 'recovery leaves no orphaned transfer entry');
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'in-progress');
  });

  it('cleans an interrupted transfer once a newer live claim is authoritative', () => {
    const t = target();
    const taskId = 'T-RECLAIM-NEWER-AUTHORITATIVE';
    const token = createHash('sha256').update(taskId).digest('hex');
    const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
    const reclaimName = `${token}.lock.reclaim`;
    const reclaimPath = join(lockDir, reclaimName);
    const transferred = { taskId, reclaimId: 'R1-transferred', pid: 1001, bootIdentity: 'test-boot' };
    const authoritative = { taskId, reclaimId: 'R2-authoritative', pid: 1002, bootIdentity: 'test-boot' };
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(`${reclaimPath}.reclaiming-${transferred.reclaimId}-interrupted`, `${JSON.stringify(transferred)}\n`, 'utf8');
    writeFileSync(reclaimPath, `${JSON.stringify(authoritative)}\n`, 'utf8');

    const resumedB = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'absent',
    }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: (_pid, owner) => owner?.reclaimId === authoritative.reclaimId,
    });
    assert.equal(resumedB.ok, false);
    assert.equal(resumedB.code, 'fs.lifecycle_lock.contended');
    assert.equal(JSON.parse(readFileSync(reclaimPath, 'utf8')).reclaimId, authoritative.reclaimId);
    assert.equal(readdirSync(lockDir).some(name => name.includes('.lock.reclaim.reclaiming-')), false, 'the older private transfer is cleaned');
    assert.equal(existsSync(join(t, 'carrier.txt')), false);
  });

  it('refuses a live reclaim claim with the typed contention diagnostic', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const expected = fingerprintTargetPath(t, 'carrier.txt');
    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file', expectedDigest: expected,
    }], {
      lifecycleAuthorityTaskIds: ['T-RECLAIM-LIVE'],
      retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    foreignizePrimaryLock(t, 'T-RECLAIM-LIVE');

    const interrupted = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: ['T-RECLAIM-LIVE'],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => false,
      lifecycleLockReclaimInterruptionForTest: 'after-claim-publication',
    });
    assert.equal(interrupted.ok, false);

    const refused = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: ['T-RECLAIM-LIVE'],
      lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => true,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'fs.lifecycle_lock.contended');
    assert.match(refused.errors[0], /^fs\.lifecycle_lock\.contended:.*reclamation is owned by live process/);
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'in-progress');
  });

  it('refuses an active nested same-process lock without invoking an external inspector', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    let inspectorCalls = 0;
    let refused;
    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'outer',
      expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: ['T-LIVE'],
      lifecycleLockBootIdentity: () => 'test-boot',
      afterValidation: () => {
        refused = executeMutationBatch(t, [{
          type: 'write', path: 'carrier.txt', content: 'nested',
          expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
        }], {
          lifecycleAuthorityTaskIds: ['T-LIVE'],
          lifecycleLockBootIdentity: () => 'test-boot',
          lifecycleLockProcessInspector: () => { inspectorCalls += 1; throw new Error('same-PID inspector must not run'); },
          lifecycleLockProcessIdentity: () => { inspectorCalls += 1; throw new Error('same-PID identity inspector must not run'); },
        });
      },
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'fs.lifecycle_lock.contended');
    assert.match(refused.errors[0], /^fs\.lifecycle_lock\.contended:/);
    assert.equal(inspectorCalls, 0);
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'outer');
  });

  it('reclaims a stale same-PID lock when the process-start identity differs', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const taskId = 'T-SAME-PID-REUSE';
    const held = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot', lifecycleLockProcessIdentity: () => 'old-start',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    let inspectorCalls = 0;
    const reclaimed = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => { inspectorCalls += 1; return true; },
      lifecycleLockProcessIdentity: () => { inspectorCalls += 1; return 'new-start'; },
    });
    assert.equal(reclaimed.ok, true, reclaimed.errors.join('\n'));
    assert.equal(inspectorCalls > 0, true);
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
  });

  for (const lockId of [undefined, '']) {
    it(`refuses same-PID ownership with ${lockId === undefined ? 'missing' : 'malformed'} lockId`, () => {
      const t = target();
      const taskId = `T-BAD-LOCK-ID-${lockId === undefined ? 'MISSING' : 'EMPTY'}`;
      const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
      mkdirSync(lockDir, { recursive: true });
      const lockPath = join(lockDir, `${createHash('sha256').update(taskId).digest('hex')}.lock`);
      const owner = { taskId, pid: process.pid, bootIdentity: 'test-boot', processIdentity: 'old-start' };
      if (lockId !== undefined) owner.lockId = lockId;
      writeFileSync(lockPath, `${JSON.stringify(owner)}\n`);
      const refused = executeMutationBatch(t, [{ type: 'create', path: 'carrier.txt', content: 'accepted' }], {
        lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
        lifecycleLockProcessInspector: () => true, lifecycleLockProcessIdentity: () => 'new-start',
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'fs.lifecycle_lock.malformed');
      assert.equal(existsSync(lockPath), true);
    });
  }

  it('keeps a same-PID liveness-only historical lock fail-closed', () => {
    const t = target();
    const taskId = 'T-SAME-PID-LIVENESS-ONLY';
    const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, `${createHash('sha256').update(taskId).digest('hex')}.lock`);
    writeFileSync(lockPath, `${JSON.stringify({
      taskId, pid: process.pid, bootIdentity: 'test-boot', processIdentity: null,
      processIdentityAssurance: 'pid-liveness-only', lockId: 'historical-lock-id',
    })}\n`);
    let inspectorCalls = 0;
    const refused = executeMutationBatch(t, [{ type: 'create', path: 'carrier.txt', content: 'accepted' }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => { inspectorCalls += 1; return true; },
      lifecycleLockProcessIdentity: () => { throw new Error('historical liveness-only lock must not claim process-start evidence'); },
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'fs.lifecycle_lock.contended');
    assert.equal(inspectorCalls, 1);
    assert.equal(existsSync(lockPath), true);
  });

  it('reclaims a live recycled PID when its process-start identity differs', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const taskId = 'T-PID-REUSE';
    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId], retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot', lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    foreignizePrimaryLock(t, taskId);

    const reclaimed = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => true, lifecycleLockProcessIdentity: () => 'start-B',
    });
    assert.equal(reclaimed.ok, true, reclaimed.errors.join('\n'));
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
  });

  it('reclaims a prior-boot lock even if its former PID is reported live', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const taskId = 'T-REBOOT';
    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId], retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'prior-boot', lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));

    const reclaimed = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'current-boot',
      lifecycleLockProcessInspector: () => true, lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(reclaimed.ok, true, reclaimed.errors.join('\n'));
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
  });

  it('refuses malformed lock ownership without reclaiming it', () => {
    const t = target();
    const taskId = 'T-MALFORMED';
    const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
    mkdirSync(lockDir, { recursive: true });
    const lockName = `${createHash('sha256').update(taskId).digest('hex')}.lock`;
    writeFileSync(join(lockDir, lockName), 'not-json\n');
    const refused = executeMutationBatch(t, [{ type: 'create', path: 'carrier.txt', content: 'accepted' }], {
      lifecycleAuthorityTaskIds: [taskId],
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'fs.lifecycle_lock.malformed');
    assert.equal(readFileSync(join(lockDir, lockName), 'utf8'), 'not-json\n');
  });

  it('fails closed when a live owner has no inspectable process-start identity', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress', 'utf8');
    const taskId = 'T-IDENTITY-UNAVAILABLE';
    const held = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId], retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot', lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));

    const lockDir = join(t, '.agenticloop', 'locks', 'lifecycle-authority');
    const lockName = `${createHash('sha256').update(taskId).digest('hex')}.lock`;
    const lockPath = join(lockDir, lockName);
    const foreignOwner = JSON.parse(readFileSync(lockPath, 'utf8'));
    foreignOwner.pid = process.pid + 100000;
    writeFileSync(lockPath, `${JSON.stringify(foreignOwner)}\n`);

    const refused = executeMutationBatch(t, [{
      type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file',
      expectedDigest: fingerprintTargetPath(t, 'carrier.txt'),
    }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => true, lifecycleLockProcessIdentity: () => null,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'fs.lifecycle_lock.inspect_failed');
    assert.match(refused.errors[0], /manual recovery/);
  });

  it('retries transient foreign process inspection and fails closed after exhaustion', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress');
    const taskId = 'T-TRANSIENT-INSPECTION';
    const held = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot', lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    const lockPath = join(t, '.agenticloop', 'locks', 'lifecycle-authority', `${createHash('sha256').update(taskId).digest('hex')}.lock`);
    const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
    owner.pid = process.pid + 100000;
    writeFileSync(lockPath, `${JSON.stringify(owner)}\n`);

    let calls = 0;
    const eventuallyLive = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('busy'), { code: 'ETIMEDOUT' });
        return true;
      },
      lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(eventuallyLive.code, 'fs.lifecycle_lock.contended');
    assert.equal(calls, 3);

    calls = 0;
    const exhausted = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => { calls += 1; throw Object.assign(new Error('busy'), { code: 'ETIMEDOUT' }); },
      lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(exhausted.code, 'fs.lifecycle_lock.inspect_failed');
    assert.equal(calls, 3);
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'in-progress');
  });

  /**
   * The loaded-run instability. Liveness is a cheap `process.kill` probe, but
   * the process-start identity is an external query, and on a loaded Windows
   * host it is the one that stalls. A live owner then reported
   * `inspect_failed` instead of stable live contention: both refuse, so nothing
   * was unsafe, but the run reported a different reason each time, and
   * integrated acceptance cannot close on a diagnostic that moves.
   */
  it('absorbs a transient stall in the start-identity query and still fails closed when it persists', () => {
    const t = target();
    writeFileSync(join(t, 'carrier.txt'), 'in-progress');
    const taskId = 'T-TRANSIENT-IDENTITY';
    const held = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'in-progress', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], retainLifecycleAuthorityLocksForTest: true,
      lifecycleLockBootIdentity: () => 'test-boot', lifecycleLockProcessIdentity: () => 'start-A',
    });
    assert.equal(held.ok, true, held.errors.join('\n'));
    foreignizePrimaryLock(t, taskId);

    let identityCalls = 0;
    const stalled = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => true,
      lifecycleLockProcessIdentity: () => {
        identityCalls += 1;
        if (identityCalls < 3) throw Object.assign(new Error('host busy'), { code: 'ETIMEDOUT' });
        return 'start-A';
      },
    });
    assert.equal(stalled.code, 'fs.lifecycle_lock.contended',
      'a stalled identity query on a live owner resolves to the true refusal, not an inspection failure');
    assert.equal(identityCalls, 3);

    identityCalls = 0;
    const persistent = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'accepted', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId], lifecycleLockBootIdentity: () => 'test-boot',
      lifecycleLockProcessInspector: () => true,
      lifecycleLockProcessIdentity: () => { throw Object.assign(new Error('host busy'), { code: 'ETIMEDOUT' }); },
    });
    assert.equal(persistent.code, 'fs.lifecycle_lock.inspect_failed',
      'an inspection that never answers still fails closed rather than guessing the owner is gone');
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'in-progress',
      'neither path reclaims the lock or touches the carrier');
  });

  it('records and conservatively handles a current writer with unavailable start identity', () => {
    const t = target();
    const taskId = 'T-CURRENT-IDENTITY';
    const result = executeMutationBatch(t, [{ type: 'create', path: 'carrier.txt', content: 'accepted' }], {
      lifecycleAuthorityTaskIds: ['T-CURRENT-IDENTITY'],
      lifecycleLockProcessIdentity: () => null,
      retainLifecycleAuthorityLocksForTest: true,
    });
    assert.equal(result.ok, true, result.errors.join('\n'));
    const lockPath = join(t, '.agenticloop', 'locks', 'lifecycle-authority', `${createHash('sha256').update(taskId).digest('hex')}.lock`);
    const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(owner.processIdentity, null);
    assert.equal(owner.processIdentityAssurance, 'pid-liveness-only');
    foreignizePrimaryLock(t, taskId);
    const contender = executeMutationBatch(t, [{ type: 'write', path: 'carrier.txt', content: 'changed', expectedKind: 'file', expectedDigest: fingerprintTargetPath(t, 'carrier.txt') }], {
      lifecycleAuthorityTaskIds: [taskId],
      lifecycleLockProcessInspector: () => true,
    });
    assert.equal(contender.code, 'fs.lifecycle_lock.contended');
    assert.equal(readFileSync(join(t, 'carrier.txt'), 'utf8'), 'accepted');
  });

});

describe('Windows EPERM behavior', { skip: !IS_WINDOWS }, () => {
  it('rolls back and reports EPERM on a read-only rename target', () => {
    const t = target();
    const protectedPath = join(t, 'protected.txt');
    writeFileSync(protectedPath, 'original', 'utf-8');
    chmodSync(protectedPath, 0o444);
    try {
      const result = executeMutationBatch(t, [
        { type: 'write', path: 'other.txt', content: 'other' },
        { type: 'write', path: 'protected.txt', content: 'updated' },
      ]);
      assert.equal(result.ok, false);
      assert.match(result.errors[0], /EPERM|operation not permitted/i);
      assert.equal(existsSync(join(t, 'other.txt')), false);
      assert.equal(readFileSync(protectedPath, 'utf-8'), 'original');
    } finally {
      chmodSync(protectedPath, 0o666);
    }
  });
});

describe('successful batch commits and cleans empty parents', () => {
  it('writes files and returns committed relative paths', () => {
    const t = target();
    const result = executeMutationBatch(t, [
      { type: 'write', path: 'a/b/file.txt', content: 'hello' },
      { type: 'mkdir', path: 'newdir' },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.writtenFiles, ['a/b/file.txt']);
    assert.ok(result.committedPaths.includes('a/b/file.txt'));
    assert.ok(result.committedPaths.includes('newdir'));
    assert.equal(readFileSync(join(t, 'a/b/file.txt'), 'utf-8'), 'hello');
    assert.equal(statSync(join(t, 'newdir')).isDirectory(), true);
  });

  it('removes a file and cleans up the resulting empty directory', () => {
    const t = target();
    mkdirSync(join(t, 'lonely'), { recursive: true });
    writeFileSync(join(t, 'lonely', 'file.txt'), 'x', 'utf-8');
    const result = executeMutationBatch(t, [
      { type: 'remove', path: 'lonely/file.txt' },
    ]);
    assert.equal(result.ok, true);
    assert.equal(existsSync(join(t, 'lonely')), false, 'empty parent must be cleaned');
  });
});
