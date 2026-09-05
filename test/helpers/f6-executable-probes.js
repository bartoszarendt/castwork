/** Real, synthetic F6 refusal probes. Each callable reaches its named public
 * production path and returns that path's actual result/diagnostics. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGitHubReviewPrepare, verifyReviewPacket } from '../../src/github-review-prepare.js';
import { runGitHubReady } from '../../src/github-ready.js';
import { evaluateGitHubReviewAudit } from '../../src/github-review-audit.js';
import { evaluatePreflight } from '../../src/github-preflight.js';
import { reviewEntryPersistenceFailure, reviewEntryPreparationFailure } from '../../src/task-cli.js';

const HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const OTHER_HEAD = 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const LOOP_ACCOUNT = { login: 'loop-bot', type: 'User' };
const verificationContext = { projectFacts: [], decisionExists: () => false, taskExists: () => false };

function prBody(head = HEAD, { evidence = true } = {}) {
  return [
    '## Scope Completed', 'Completed.', '', '## Artifacts', `Current implementation artifact: commit:${head}`, '',
    '## Evidence', evidence ? `Current PR head: ${head}` : '',
    ...(evidence ? ['- Required check: [RC-1] `npm test`', '  Verdict: passed', '  Evidence: tests passed (exit 0)'] : []),
    '', '## Deviations', 'None.', '', '## Known Gaps', 'None.', '', '## Follow-Ups', 'None.', '', '[[agent: engineer]]',
  ].join('\n');
}

function taskBody(extra = '') {
  return `---\ntask_id: T-007${extra}\n---\n# T\n\n## Required Checks\n- [RC-1] \`npm test\`\n`;
}

function marker(head = HEAD) {
  return { body: `AGENT_REVIEW_STATUS: accepted\nAGENT_REVIEW_MODE: host_subagent\nAGENT_REVIEW_ARTIFACT: ${head}\n[[agent: maintainer]]`, author: LOOP_ACCOUNT };
}

function githubRunner({ body = prBody(), issue = taskBody(), finalIssue = issue, refetchHead = HEAD, comments = [marker()], issues } = {}) {
  const pr = {
    number: 42, headRefOid: HEAD, baseRefOid: 'c'.repeat(40), body,
    files: [{ path: 'src/x.js' }], closingIssuesReferences: [{ number: 7 }], statusCheckRollup: [],
    commits: [{ oid: HEAD, message: 'implementation\n\nTask: T-007\nAgent: engineer' }], comments, reviews: [],
  };
  let issueReads = 0;
  return (_command, args) => {
    if (args[0] === 'api' && args[1] === 'user') return { status: 0, stdout: JSON.stringify(LOOP_ACCOUNT), stderr: '' };
    if (args[0] === 'api' && args.includes('--paginate')) return { status: 0, stdout: JSON.stringify([[]]), stderr: '' };
    if (args[0] === 'pr' && args[1] === 'view') {
      const fields = args[args.indexOf('--json') + 1] ?? '';
      return { status: 0, stdout: JSON.stringify(fields === 'headRefOid' ? { headRefOid: refetchHead } : pr), stderr: '' };
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      const issueData = { number: 7, body: issueReads++ === 0 ? issue : finalIssue, title: 'T-007', comments: [] };
      return { status: 0, stdout: JSON.stringify(issueData), stderr: '' };
    }
    if (args[0] === 'issue' && args[1] === 'list') return { status: 0, stdout: JSON.stringify(issues ?? [{ number: 7, state: 'OPEN', title: 'T-007', body: issue }]), stderr: '' };
    if (args[0] === 'repo' && args[1] === 'view') return { status: 0, stdout: JSON.stringify({ nameWithOwner: 'o/r' }), stderr: '' };
    if (args[0] === 'api' && /git\/trees\//.test(args[1] ?? '')) return { status: 0, stdout: JSON.stringify({ tree: [] }), stderr: '' };
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
}

function directPreflight({ reviewOutcomes = [], reviewHistory, head = HEAD, reviewBudget, comments, reviews } = {}) {
  return evaluatePreflight({
    prData: {
      number: 42, headRefOid: head, body: prBody(head), files: [], statusCheckRollup: [],
      ...(comments === undefined ? {} : { comments }),
      ...(reviews === undefined ? {} : { reviews }),
    },
    issueData: { number: 7, body: taskBody(), comments: [] }, reviewOutcomes, reviewHistory,
    reviewBudget,
  });
}

function auditData({ issue = '', comments = [marker()] } = {}) {
  return {
    prData: { number: 42, headRefOid: HEAD, closingIssuesReferences: [{ number: 7 }], comments, reviews: [] },
    issueData: { number: 7, body: issue }, expectedAccount: LOOP_ACCOUNT,
  };
}

const PROBES = Object.freeze({
  'review-prepare-workspace': async () => runGitHubReviewPrepare({ pr: 42, workspace: 'missing-f6-workspace', commandRunner: githubRunner(), verificationContext }),
  'review-prepare-packet': async () => {
    const directory = mkdtempSync(join(tmpdir(), 'f6-packet-'));
    try {
      const packet = join(directory, 'broken.json');
      writeFileSync(packet, '{not json', 'utf8');
      return verifyReviewPacket({ pr: 42, packet, commandRunner: githubRunner() });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  },
  'review-prepare-preflight-failure': async () => runGitHubReviewPrepare({ pr: 42, commandRunner: githubRunner({ body: prBody(HEAD, { evidence: false }) }), verificationContext }),
  'review-prepare-policy': async () => runGitHubReviewPrepare({
    pr: 42,
    commandRunner: githubRunner({
      issue: taskBody('\nindependent_review_required: false'),
      finalIssue: `${taskBody('\nindependent_review_required: false')}\nAGENT_INDEPENDENT_REVIEW_REQUIRED: true`,
    }),
    verificationContext,
  }),
  'github-ready-preflight': async () => runGitHubReady({ pr: 42, commandRunner: githubRunner({ body: '## Scope Completed\nNo evidence.\n\nCloses #7' }) }),
  'github-ready-review-audit': async () => runGitHubReady({ pr: 42, commandRunner: githubRunner({ comments: [marker(OTHER_HEAD)] }) }),
  'github-ready-task-identity': async () => runGitHubReady({ pr: 42, commandRunner: githubRunner({ issues: [{ number: 7, state: 'OPEN', title: 'T-007' }, { number: 21, state: 'CLOSED', body: '---\ntask_id: T-007\n---\n' }] }) }),
  'github-ready-cross-gate': async () => {
    const runner = githubRunner();
    return runGitHubReady({ pr: 42, commandRunner: (command, args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        const fields = args[args.indexOf('--json') + 1] ?? '';
        const head = fields.includes('statusCheckRollup') ? HEAD : OTHER_HEAD;
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 42, headRefOid: head, baseRefOid: 'c'.repeat(40), body: prBody(head), files: [{ path: 'src/x.js' }],
            closingIssuesReferences: [{ number: 7 }], statusCheckRollup: [],
            commits: [{ oid: head, message: 'implementation\n\nTask: T-007\nAgent: engineer' }], comments: [marker(head)], reviews: [],
          }),
          stderr: '',
        };
      }
      return runner(command, args);
    } });
  },
  'review-audit-task-contract': async () => evaluateGitHubReviewAudit(auditData({ issue: 'AGENT_INDEPENDENT_REVIEW_REQUIRED: invalid' })),
  'review-audit-provenance': async () => evaluateGitHubReviewAudit(auditData({ comments: [marker(OTHER_HEAD)] })),
  'preflight-review-checkpoint': async () => directPreflight({
    head: 'c'.repeat(40), reviewBudget: 1,
    reviewHistory: {
      events: [
        { type: 'outcome', status: 'needs_revision', artifact: HEAD, sourceOrder: 0 },
        {
          type: 'checkpoint', direction: 'targeted_revision', cause: 'implementation_defect', reviewCount: 1,
          artifact: HEAD, target: 'repair F-1', orchestratorAttribution: LOOP_ACCOUNT.login,
          roleId: 'orchestrator', roleCarrierSchemaVersion: 1, sourceOrder: 1,
        },
        { type: 'outcome', status: 'needs_revision', artifact: OTHER_HEAD, sourceOrder: 2 },
      ],
      errors: [],
    },
  }),
  'preflight-review-history': async () => directPreflight({
    reviewHistory: { events: [{ type: 'outcome', status: 'needs_revision', artifact: HEAD }], errors: [] },
    comments: [], reviews: [],
  }),
  'preflight-revision-resolution': async () => directPreflight({ reviewOutcomes: [{ status: 'needs_revision', artifact: HEAD, findingIds: ['F-1'] }] }),
  'review-entry-fixup': async () => ({ diagnostics: [reviewEntryPreparationFailure('fixup')] }),
  'review-entry-persistence-conflict': async () => ({ diagnostics: [reviewEntryPersistenceFailure('conflict')] }),
});

export const F6_EXECUTABLE_PROBE_IDS = Object.freeze(Object.keys(PROBES));

export async function runF6ExecutableProbe(probeId) {
  const probe = PROBES[probeId];
  if (!probe) throw new Error(`unknown F6 executable probe '${probeId}'`);
  const result = await probe();
  return { probeId, result, diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : [] };
}
