/**
 * One canonical derivation of a durable commit range.
 *
 * Every caller that needs commits, changed paths, or attribution between a
 * dispatched base and a returned head consumes this module. Reconstruction
 * proves contiguous ancestry first: `base..head` silently produces an empty or
 * partial range after a reset, rebase, or unrelated-history replacement, so an
 * ancestry proof is a precondition rather than an optional extra check.
 */

import { existsSync } from 'node:fs';

import { commitMessageProducerHint, commitTaskOwnership, evaluateCommitAttribution } from './commit-attribution.js';
import { isGitObjectId, sameGitObjectFormat } from './git-oid.js';
import { fileMatchesScopePattern } from './scope-matcher.js';

/**
 * A typed commit-range failure. `evidenceState` is classified at the origin of
 * the failure and is never re-derived from this error's prose.
 */
export class CommitRangeError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, evidenceState: string, disposition: string }} classification
   */
  constructor(message, { code, evidenceState, disposition }) {
    super(message);
    this.name = 'CommitRangeError';
    this.code = code;
    this.evidenceState = evidenceState;
    this.disposition = disposition;
  }
}

function malformed(message) {
  return { ok: false, code: 'role_return.invalid', evidenceState: 'malformed', disposition: 'rejected', message };
}

function stale(message) {
  return { ok: false, code: 'role_return.stale', evidenceState: 'stale', disposition: 'superseded', message };
}

function changed(message) {
  return { ok: false, code: 'role_return.stale', evidenceState: 'changed', disposition: 'superseded', message };
}

/**
 * Every Git question this module asks is an authority question, so none of them
 * may be answered from a rewritten object graph.
 *
 * `refs/replace/*` and grafts live inside the repository the party under
 * inspection can write. One `git replace` is enough to make an undeclared
 * commit look like an ancestor of the attempt's own start, which exempts it from
 * the scope gate entirely. The flag is applied here rather than left to callers
 * because a caller that forgets it disables the guarantee silently - and the
 * runner is injectable, so "the caller is trusted" is not an assumption this
 * module gets to make.
 */
function authoritative(runGit, args) {
  return runGit(['--no-replace-objects', ...args]);
}

/**
 * Legacy grafts are a second, independent rewrite channel, and
 * `--no-replace-objects` does not close it.
 *
 * Measured: with `$GIT_DIR/info/grafts` in place, `merge-base --is-ancestor`
 * reports an unrelated commit as an ancestor, and it reports it under
 * `--no-replace-objects` too. A grafts file therefore forges exactly the
 * ancestry this gate rests on, by a route the replacement-object flag never
 * touches.
 *
 * Git deprecates grafts but still honours them, so their presence is refused
 * rather than neutralised: a repository carrying one cannot be measured
 * truthfully here, and saying so is the honest outcome.
 */
function graftsFilePath(runGit) {
  // `--path-format` needs Git >= 2.31. An older Git, or any other failure here,
  // leaves the question unanswered - and an unanswered question about a rewrite
  // channel is not a negative answer, so the caller refuses rather than assumes.
  const located = authoritative(runGit, ['rev-parse', '--path-format=absolute', '--git-path', 'info/grafts']);
  if (!located || located.status !== 0) return undefined;
  const path = text(located);
  return path === '' ? null : path;
}

function graftedHistory(runGit) {
  const path = graftsFilePath(runGit);
  // `undefined` means the locate query failed; `null` means it answered with no
  // path. Only the second is evidence of absence.
  if (path === undefined) return true;
  if (path === null) return false;
  try {
    return existsSync(path);
  } catch {
    // An unreadable answer is not a negative answer.
    return true;
  }
}

function text(result) {
  return String(result?.stdout ?? '').trim();
}

function lines(result) {
  return text(result).split(/\r?\n/).filter(Boolean);
}

/**
 * A commit's parent identities, in order, or `null` when Git could not answer.
 *
 * Both enumerations below branch on this, and they branch differently for a
 * root commit than for a merge, so the distinction is derived once here rather
 * than inferred twice. `null` is not "no parents" - an unanswered question and
 * a parentless commit lead to opposite handling.
 */
function commitParents(runGit, commit) {
  const listed = authoritative(runGit, ['rev-list', '--parents', '-n', '1', commit]);
  if (!listed || listed.status !== 0) return null;
  return text(listed).split(/\s+/).filter(Boolean).slice(1);
}

/**
 * The paths a commit authored, for the question "must this commit carry
 * canonical trailers".
 *
 * A merge that resolved nothing authored nothing, which is what the combined
 * `<commit>^!` diff reports - and that is the right answer, because demanding
 * trailers of a clean merge fails the whole range as malformed.
 *
 * A *root* commit is the exception that made `^!` unsafe: with no parent to
 * diff against, Git compares it to the working tree instead. A merged orphan
 * root could therefore report paths it never authored and omit the ones it did,
 * and where the reported set matched no declared path the trailer demand was
 * skipped entirely. Root commits are compared against the empty tree, which is
 * what they actually introduced, and no enumeration here consults the worktree
 * or the index.
 */
function commitAuthoredPaths(runGit, commit, parents) {
  // Unknown parentage cannot fall through to `^!`: on a root commit that is the
  // worktree diff this function exists to avoid, so an unanswered question is
  // answered as unanswered.
  if (parents === null) return null;
  if (parents.length === 0) {
    const root = authoritative(runGit, ['diff-tree', '--root', '-r', '--name-only', '--no-commit-id', commit]);
    return root && root.status === 0 ? lines(root) : null;
  }
  const combined = authoritative(runGit, ['diff', '--name-only', '--no-renames', `${commit}^!`]);
  return combined && combined.status === 0 ? lines(combined) : null;
}

/**
 * The paths a commit put into this line of history, for the ownership inventory.
 * Taken against the first parent, which for a merge is what it brought onto the
 * line it was merged into. A root commit introduces its whole tree, measured
 * against the empty tree rather than the worktree.
 */
function commitIntroducedPaths(runGit, commit, parents) {
  if (parents === null) return null;
  if (parents.length === 0) {
    const root = authoritative(runGit, ['diff-tree', '--root', '-r', '--name-only', '--no-commit-id', commit]);
    return root && root.status === 0 ? lines(root) : null;
  }
  const diff = authoritative(runGit, ['diff', '--name-only', '--no-renames', parents[0], commit]);
  return diff && diff.status === 0 ? lines(diff) : null;
}

/**
 * Derive the exact commit identities, changed paths, and canonical attribution
 * between two full Git identities.
 *
 * @param {{
 *   runGit: (args: string[]) => { status: number, stdout?: string, stderr?: string },
 *   baseHead: string,
 *   head: string,
 *   taskId?: string|null,
 *   roleId?: string|null,
 *   requireAttribution?: boolean,
 *   allowedPaths?: string[]|null,
 *   attemptStartProductHead?: string|null,
 * }} input
 * @returns {{ ok: true, range: { base: string, head: string }, commits: string[], changedPaths: string[],
 *     taskAuthoredChangedPaths: string[]|null }
 *   | { ok: false, code: string, evidenceState: string, disposition: string, message: string }}
 */
export function deriveCommitRange(input = {}) {
  const {
    runGit, baseHead, head, taskId = null, roleId = null,
    requireAttribution = true, allowedPaths = null, attemptStartProductHead = null,
  } = input;
  if (typeof runGit !== 'function') {
    throw new TypeError('deriveCommitRange requires a runGit function');
  }
  if (!isGitObjectId(baseHead) || !isGitObjectId(head)) {
    return malformed('commit range requires full lowercase 40- or 64-character Git identities for both endpoints');
  }
  // One repository has exactly one object format: a mixed-length range cannot
  // describe contiguous durable history and is rejected rather than resolved.
  if (!sameGitObjectFormat([baseHead, head])) {
    return malformed('commit range endpoints must share one Git object format');
  }

  // Missing objects are a repository-state fact, not a schema fault: a rewritten
  // or garbage-collected base is stale evidence about a range that once existed.
  for (const [label, identity] of [['base', baseHead], ['head', head]]) {
    const present = authoritative(runGit, ['cat-file', '-e', `${identity}^{commit}`]);
    if (!present || present.status !== 0) {
      return stale(`commit range ${label} ${identity} is not a reachable commit object in this repository`);
    }
  }

  // Contiguity proof. Without it a reset, rebase, force-rewrite, or unrelated
  // history yields a range that does not describe the work being returned.
  if (graftedHistory(runGit)) {
    return malformed(
      'this repository carries a legacy $GIT_DIR/info/grafts file, which rewrites the ancestry this ' +
      'range is derived from and is not disabled by --no-replace-objects; remove it, or convert it ' +
      "with git replace --convert-graft-file, before a return can be verified here"
    );
  }
  const ancestor = authoritative(runGit, ['merge-base', '--is-ancestor', baseHead, head]);
  if (!ancestor || ancestor.status !== 0) {
    return changed(
      `commit range base ${baseHead} is not an ancestor of head ${head}; the branch was reset, rebased, ` +
      'force-rewritten, or replaced with unrelated history'
    );
  }

  const listed = authoritative(runGit, ['rev-list', '--reverse', `${baseHead}..${head}`]);
  if (!listed || listed.status !== 0) {
    return stale(`unable to list the durable commit range ${baseHead}..${head}`);
  }
  const commits = lines(listed);
  if (commits.some(commit => !isGitObjectId(commit))) {
    return malformed('durable commit range contains an abbreviated or non-full commit identity');
  }
  if (!sameGitObjectFormat([baseHead, head, ...commits])) {
    return malformed('durable commit range mixes Git object formats');
  }

  // The task-scoped half of the range inventory. Every path in the range is
  // still reported below; this records only which of them this task's own work
  // produced, so the scope gate stops re-asking the whole-repository question
  // the attribution exemption immediately below deliberately removed.
  const taskAuthoredPaths = new Set();
  let ownershipComplete = requireAttribution;

  if (requireAttribution) {
    // Attribution binds the commits that carry the task's work. A range in a
    // repository other people also commit to holds commits that are not the
    // loop's and never claimed to be: a toolkit update the operator ran, a
    // merge, a lockfile refresh. Requiring canonical trailers on those made one
    // untrailered commit inside the window poison the range permanently - and
    // in the field that same commit was the bound artifact, so `prepare-return`
    // refused it while `task evidence` refused every move away from it. Where
    // the task declares no surface the range is validated whole, exactly as
    // before.
    const patterns = (Array.isArray(allowedPaths) ? allowedPaths : [])
      .filter(pattern => typeof pattern === 'string' && pattern);
    for (const commit of commits) {
      // Two questions are asked of every commit, and they do not take the same
      // diff. Answering both from one enumeration is what made merges wrong in
      // both directions.
      //
      // "Did this commit author content that must carry canonical trailers?"
      // `<commit>^!` is a combined diff, so a clean merge reports nothing - and
      // that is the right answer: a clean merge authored nothing of its own, and
      // demanding trailers of it fails the entire range as malformed, which is
      // the untrailered-commit poisoning this gate exists to remove.
      //
      // "What did this commit put into this line of history?" A merge puts its
      // side branch's paths onto the first parent. Answered with the combined
      // diff, those paths report as nothing and vanish from the ownership set -
      // and where the side commits are themselves exempt, the merge is the only
      // place they could ever have been attributed.
      const parents = commitParents(runGit, commit);
      // An unreadable diff is not evidence of an empty commit. It leaves both
      // questions below undecidable, and both then fail toward the task.
      const authoredPaths = commitAuthoredPaths(runGit, commit, parents);
      const introducedPaths = commitIntroducedPaths(runGit, commit, parents);
      const carriesTaskWork = patterns.length === 0 || authoredPaths === null ||
        authoredPaths.some(path => patterns.some(pattern => fileMatchesScopePattern(path, pattern)));

      const shown = authoritative(runGit, ['show', '-s', '--format=%B', commit]);
      if (!shown || shown.status !== 0) {
        return stale(`unable to read durable commit message ${commit}`);
      }
      const message = String(shown.stdout ?? '');
      let ownership = commitTaskOwnership(message, taskId);
      // A trailer is a voluntary declaration, so its absence cannot by itself
      // mean "not this task's work". Read that way it let an attempt put an
      // out-of-scope edit beyond every gate simply by not declaring it: the
      // attribution exemption below skips commits touching no allowed path, and
      // an unclaimed commit contributed no paths here, so a commit touching
      // *only* out-of-scope paths was invisible to both.
      //
      // The discriminator is the attempt's own starting point as an immutable
      // Git identity: `packet.repository.head` from the validated dispatch
      // packet for this attempt. It is deliberately not taken from the persisted
      // dispatch consumption, whose digest is unkeyed; see the TRUST ANCHOR block
      // in `src/dispatch-envelope.js` for what does and does not authenticate it.
      // A commit reachable from that
      // identity was already in history when the attempt opened, and is what
      // this range has always exempted - a toolkit update the operator ran, a
      // merge, a lockfile refresh, from before this attempt existed. Anything
      // not reachable from it either landed during the attempt or cannot be
      // placed, and both answer to the task.
      //
      // Ancestry is used rather than the committer timestamp because a
      // timestamp asks the commit under suspicion to date itself.
      // `GIT_COMMITTER_DATE` is caller-settable, so a backdated commit exempted
      // itself - the same voluntary-declaration weakness that made the trailer
      // untrustworthy here. Reachability cannot be forged by the commit being
      // judged, and needs no clock, resolution, or skew reasoning at all.
      //
      // There is no per-commit product receipt to appeal to instead:
      // `task prepare-product-commit` writes a scratch message file and
      // persists nothing. So separately-owned maintenance committed after the
      // attempt started, on a product-classified path, is refused rather than
      // exempted. That is the fail-closed direction and a recoverable one -
      // commit maintenance before dispatch, or attribute it - where a silent
      // scope escape is not detectable at all.
      if (ownership === 'other') {
        if (attemptStartProductHead === null) {
          // No attempt start means this commit cannot be placed relative to the
          // attempt at all. That is not the same as proving it separately owned,
          // and treating it as such silently dropped its paths from the
          // inventory while the result still claimed to be complete - a scope
          // escape with nothing to show for it. An unplaceable commit leaves
          // ownership underived, exactly as an unreadable diff does, so the
          // caller asks its question of the whole range instead of a narrower
          // one it has no basis for.
          ownershipComplete = false;
        } else {
          // Exit 0 proves reachability (and is reflexive, so the start commit
          // itself is pre-attempt). Exit 1 disproves it. Anything else is an
          // unanswered question, and an unanswered question is not a proof.
          const reachable = authoritative(runGit, ['merge-base', '--is-ancestor', commit, attemptStartProductHead]);
          if (!reachable || reachable.status !== 0) ownership = 'ambiguous';
        }
      }
      if (ownership !== 'other') {
        // The commit is this task's own work, so the paths it introduced are
        // the task's to answer for. An unreadable diff cannot be enumerated, so
        // the whole inventory stays in scope rather than silently shrinking.
        if (introducedPaths === null) ownershipComplete = false;
        else for (const path of introducedPaths) taskAuthoredPaths.add(path);
      }
      if (!carriesTaskWork) continue;
      const attribution = evaluateCommitAttribution({ message, taskId, role: roleId });
      if (!attribution.ok) {
        // The trailer grammar is almost never got wrong on purpose: `git commit
        // -m … -m …` inserts a blank line between every `-m` and strands
        // `Task:` outside the final contiguous block. Name the producer here,
        // where the defect is reported, rather than leaving each role to
        // rediscover the mechanism.
        return malformed(
          `commit ${commit} has no valid canonical Task:/Agent: trailers: ${attribution.errors.join('; ')}. ` +
          commitMessageProducerHint(taskId ?? '<task-id>')
        );
      }
    }
  }

  const diff = authoritative(runGit, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${baseHead}..${head}`]);
  if (!diff || diff.status !== 0) {
    return stale(`unable to derive changed paths for ${baseHead}..${head}`);
  }

  return {
    ok: true,
    range: { base: baseHead, head },
    commits,
    changedPaths: lines(diff).sort(),
    // `null` means ownership was not determined here, not that this task
    // authored nothing. A caller that cannot tell the two apart must ask its
    // question of the whole range.
    taskAuthoredChangedPaths: ownershipComplete ? [...taskAuthoredPaths].sort() : null,
  };
}

/**
 * Throwing wrapper for callers that treat an underivable range as a hard stop.
 * The thrown error carries the same origin classification as the typed result.
 */
export function requireCommitRange(input = {}) {
  const derived = deriveCommitRange(input);
  if (derived.ok) return derived;
  throw new CommitRangeError(derived.message, {
    code: derived.code,
    evidenceState: derived.evidenceState,
    disposition: derived.disposition,
  });
}
