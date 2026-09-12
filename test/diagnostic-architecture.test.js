/**
 * Universal diagnostic-architecture enforcement: scans every runtime source
 * file with the TypeScript compiler API and rejects role routing in evaluator
 * diagnostics, protected constructor fields, role-prose concatenation, and
 * non-canonical diagnostic construction. Also validates role capability
 * bindings: coverage, duplicate primaries, unknown capabilities, and the
 * human-authority boundary.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readdirSync, readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

import {
  APPROVED_PRESENTATION_MODULES,
  CONSTRUCTOR_MODULES,
  discoverPublicCommandModules,
  collectDiagnosticCodeLiterals,
  collectDiagnosticEmissionSites,
  checkDiagnosticArchitecture,
} from './helpers/diagnostic-architecture-check.js';
import {
  HUMAN_AUTHORITY_BOUNDARY,
  getProjectRoleCapabilities,
  loadRoleCapabilities,
  validateProjectRoleCapabilities,
} from '../src/role-capabilities.js';
import { ESCALATION_KINDS, REPAIR_KINDS, REPAIR_POLICY, createDiagnostic, preflightDiagnosticCode } from '../src/repair-policy.js';
import { presentDiagnostic } from '../src/diagnostic-presentation.js';
import { commandFailure } from '../src/public-result.js';
import { PublicCommandError } from '../src/public-error.js';
import {
  ACCEPTED_REFUSAL_FAMILIES,
  DYNAMIC_DIAGNOSTIC_PRODUCERS,
  HARD_REFUSAL_ALLOWLIST,
  HISTORICAL_PRODUCER_EXCEPTIONS,
  REFUSAL_FAMILY_TALLY,
  REFUSAL_CLASSES,
  assertRefusalClassCatalog,
  repairPolicyViewFor,
  validateCatalog,
} from '../src/refusal-classes.js';
import { F6_EXECUTABLE_PROOF_REGISTRY, f6ExecutableProofRegistryFor } from '../src/f6-proof-registry.js';
import { F6_EXECUTABLE_PROBE_IDS, runF6ExecutableProbe } from './helpers/f6-executable-probes.js';
import { F7_EXECUTABLE_PROOF_REGISTRY } from '../src/f7-proof-registry.js';
import { F7_EXECUTABLE_PROBE_IDS, runF7ExecutableProbe } from './helpers/f7-executable-probes.js';
import { F8_EXECUTABLE_PROOF_REGISTRY } from '../src/f8-proof-registry.js';
import { F8_EXECUTABLE_PROBE_IDS, runF8ExecutableProbe } from './helpers/f8-executable-probes.js';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ts = createRequire(import.meta.url)('ts5');

const F5_F6_EVALUATOR_IMPORTS = new Map([
  ['./commit-attribution.js', new Map([
    ['evaluateWorkUnitCommitAttribution', ['attribution.work_unit']],
    ['evaluateCommitAttribution', ['attribution.trailer', 'attribution.role']],
  ])],
  ['./github-preflight.js', new Map([
    ['evaluatePreflight', [
      'preflight.attribution', 'preflight.review_checkpoint', 'preflight.review_history_invalid', 'preflight.revision_resolution',
      'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
      'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
      'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
      'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
    ]],
    // This live wrapper delegates its result through evaluatePreparationInput;
    // a data loader alone is deliberately not an F5 consumer.
    ['runPreflight', [
      'preflight.attribution', 'preflight.review_checkpoint', 'preflight.review_history_invalid', 'preflight.revision_resolution',
      'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
      'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
      'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
      'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
    ]],
  ])],
  ['./github-review-prepare.js', new Map([
    ['runGitHubReviewPrepare', [
      'review_prepare.workspace', 'review_prepare.stale_head', 'review_prepare.packet',
      'review_prepare.preflight_failed', 'review_prepare.independent_review_policy',
      'review_prepare.head_unavailable', 'review_prepare.head_malformed', 'review_prepare.head_refetch_failed',
    ]],
  ])],
  ['./github-ready.js', new Map([
    ['runGitHubReady', ['ready.preflight', 'ready.review_audit', 'ready.task_identity', 'ready.cross_gate_identity']],
  ])],
  ['./github-review-audit.js', new Map([
    ['runGitHubReviewAudit', ['review_audit.task_contract', 'review_audit.failure']],
  ])],
  ['./closeout.js', new Map([
    ['verifyCloseoutStatus', ['closeout.marker.stale']],
  ])],
  ['./closeout-waiver.js', new Map([
    ['verifyLegacyUnactivatedWaiver', ['compatibility.waiver_scope_retired']],
  ])],
  ['./repository-state.js', new Map([
    ['evaluateDispatchCleanState', ['worktree.clean_gate.failed']],
  ])],
  ['./task-readiness.js', new Map([
    ['evaluateTaskReadiness', ['readiness.mode.invalid']],
  ])],
]);
const F5_F6_EXPECTED_CONSUMER_CODES = Object.freeze([
  'attribution.work_unit', 'attribution.trailer', 'attribution.role', 'preflight.attribution',
  'closeout.marker.stale',
  'review_prepare.workspace', 'review_prepare.stale_head', 'review_prepare.packet',
  'review_prepare.preflight_failed', 'review_prepare.independent_review_policy',
  'review_prepare.head_unavailable', 'review_prepare.head_malformed', 'review_prepare.head_refetch_failed',
  'ready.preflight', 'ready.review_audit', 'ready.task_identity', 'ready.cross_gate_identity',
  'review_audit.task_contract', 'review_audit.failure',
  'preflight.review_checkpoint', 'preflight.review_history_invalid', 'preflight.revision_resolution',
  'readiness.mode.invalid',
  'preflight.head_identity', 'preflight.summary_shape', 'preflight.scope_deviations',
  'preflight.task_contract', 'preflight.path_intent', 'preflight.generated_paths',
  'preflight.dependencies', 'preflight.evidence', 'preflight.checks',
  'preflight.checks.task_contract', 'preflight.task_policy', 'preflight.other',
  'compatibility.waiver_scope_retired', 'worktree.clean_gate.failed',
]);
const F5_PREPARATION_HELPER = Object.freeze({
  module: './preparation-input.js',
  export: 'evaluatePreparationInput',
});

function f5F6CanonicalExport(moduleSpecifier, exportName, evaluatorImports = F5_F6_EVALUATOR_IMPORTS) {
  const evaluatorCodes = evaluatorImports.get(moduleSpecifier)?.get(exportName);
  if (evaluatorCodes) return { kind: 'evaluator', codes: evaluatorCodes };
  if (moduleSpecifier === F5_PREPARATION_HELPER.module && exportName === F5_PREPARATION_HELPER.export) {
    return { kind: 'preparation-helper' };
  }
  return null;
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
  }
  return [];
}

function createF5F6Scopes(source, evaluatorImports = F5_F6_EVALUATOR_IMPORTS) {
  const byNode = new WeakMap();
  const createScope = (node, parent, kind) => {
    const scope = { parent, kind, bindings: new Map() };
    byNode.set(node, scope);
    return scope;
  };
  const root = createScope(source, null, 'source');
  const visitScopes = (node, scope) => {
    let childScope = scope;
    if (node !== source && ts.isFunctionLike(node)) childScope = createScope(node, scope, 'function');
    else if (node !== source && ts.isBlock(node)) childScope = createScope(node, scope, 'block');
    else if (ts.isCatchClause(node)) childScope = createScope(node, scope, 'catch');
    ts.forEachChild(node, child => visitScopes(child, childScope));
  };
  visitScopes(source, root);

  const scopeFor = node => {
    for (let current = node; current; current = current.parent) {
      const scope = byNode.get(current);
      if (scope) return scope;
    }
    return root;
  };
  const functionScopeFor = scope => {
    for (let current = scope; current; current = current.parent) {
      if (current.kind === 'function' || current.kind === 'source') return current;
    }
    return root;
  };
  const bind = (scope, name, binding = { kind: 'local' }) => scope.bindings.set(name.text, binding);
  const bindNames = (scope, name, binding) => {
    for (const identifier of bindingNames(name)) bind(scope, identifier, binding);
  };

  // Register imports first, then local declarations. A malformed fixture that
  // duplicates a binding therefore fails closed as a local binding, rather than
  // being mistaken for a canonical import.
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) bind(root, clause.name);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      const exports = new Map();
      const evaluatorExports = evaluatorImports.get(statement.moduleSpecifier.text);
      for (const [name, codes] of evaluatorExports ?? []) exports.set(name, { kind: 'evaluator', codes });
      if (statement.moduleSpecifier.text === F5_PREPARATION_HELPER.module) {
        exports.set(F5_PREPARATION_HELPER.export, { kind: 'preparation-helper' });
      }
      bind(root, bindings.name, { kind: 'namespace', exports });
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        bind(root, specifier.name, f5F6CanonicalExport(
          statement.moduleSpecifier.text,
          specifier.propertyName?.text ?? specifier.name.text,
          evaluatorImports,
        ) ?? { kind: 'local' });
      }
    }
  }

  const visitBindings = node => {
    if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent;
      const declarationScope = declarationList.flags & ts.NodeFlags.BlockScoped
        ? scopeFor(node)
        : functionScopeFor(scopeFor(node));
      bindNames(declarationScope, node.name);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      bind(scopeFor(node.parent), node.name);
    } else if (ts.isClassDeclaration(node) && node.name) {
      bind(scopeFor(node.parent), node.name);
    }
    if (ts.isFunctionLike(node)) {
      const functionScope = byNode.get(node);
      for (const parameter of node.parameters) bindNames(functionScope, parameter.name);
      if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.name) bind(functionScope, node.name);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      bindNames(byNode.get(node), node.variableDeclaration.name);
    }
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(source);

  const resolveIdentifier = identifier => {
    for (let scope = scopeFor(identifier); scope; scope = scope.parent) {
      if (scope.bindings.has(identifier.text)) return scope.bindings.get(identifier.text);
    }
    return null;
  };
  const memberName = expression => {
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
      return expression.argumentExpression.text;
    }
    return null;
  };
  const resolveCanonicalBinding = expression => {
    if (ts.isIdentifier(expression)) return resolveIdentifier(expression);
    const name = memberName(expression);
    if (!name || (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression))) return null;
    const owner = resolveCanonicalBinding(expression.expression);
    return owner?.kind === 'namespace' ? owner.exports.get(name) ?? null : null;
  };
  return { resolveCanonicalBinding };
}

function astHasCall(source, predicate) {
  let found = false;
  const visit = node => {
    if (ts.isCallExpression(node) && predicate(node)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function discoverF5F6Consumers(entries = null, evaluatorImports = F5_F6_EVALUATOR_IMPORTS) {
  const sources = entries ?? readdirSync(join(REPO_ROOT, 'src'))
    .filter(entry => entry.endsWith('.js'))
    .map(entry => [`src/${entry}`, readFileSync(join(REPO_ROOT, 'src', entry), 'utf8')]);
  const consumers = new Map();
  for (const [relative, text] of sources) {
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const { resolveCanonicalBinding } = createF5F6Scopes(source, evaluatorImports);
    const invokedCodes = new Set();
    astHasCall(source, call => {
      const callee = resolveCanonicalBinding(call.expression);
      if (callee?.kind === 'evaluator') {
        for (const code of callee.codes) invokedCodes.add(code);
        return false;
      }
      // Count semantic delegation only through the imported canonical helper.
      // No value-flow inference is attempted: aliases, assignments, dynamic
      // members, and arbitrary wrapper functions are unresolved and fail closed.
      if (callee?.kind !== 'preparation-helper') return false;
      for (const argument of call.arguments) {
        const evaluator = resolveCanonicalBinding(argument);
        if (evaluator?.kind === 'evaluator') {
          for (const code of evaluator.codes) invokedCodes.add(code);
        }
      }
      return false;
    });
    for (const code of invokedCodes) {
      const paths = consumers.get(code) ?? new Set();
      paths.add(relative);
      consumers.set(code, paths);
    }
  }
  return consumers;
}

function assertF5F6ConsumerInventory(discovered, refusalClasses = REFUSAL_CLASSES) {
  for (const code of F5_F6_EXPECTED_CONSUMER_CODES) {
    const declared = refusalClasses[code].consumers ?? [];
    assert.ok(declared.length > 0, `${code} must name its actual consumers`);
    assert.deepEqual(
      [...(discovered.get(code) ?? [])].sort(),
      [...declared].sort(),
      `${code} consumer inventory must equal modules that invoke its canonical evaluator or result wrapper`,
    );
  }
}

function copyF5F6EvaluatorImports() {
  return new Map([...F5_F6_EVALUATOR_IMPORTS].map(([moduleSpecifier, exports]) => [
    moduleSpecifier,
    new Map([...exports].map(([exportName, codes]) => [exportName, [...codes]])),
  ]));
}

function assertPreflightDelegation(sourceText, functionName, expectedCallee, expectedArgument = null) {
  const source = ts.createSourceFile(`${functionName}.js`, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  let body = null;
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === functionName) body = statement.body;
  }
  assert.ok(body, `${functionName} must remain a declared canonical preflight wrapper`);
  assert.ok(astHasCall(body, call =>
    ts.isIdentifier(call.expression) && call.expression.text === expectedCallee &&
    (expectedArgument === null || call.arguments.some(argument => ts.isIdentifier(argument) && argument.text === expectedArgument))
  ), `${functionName} must invoke ${expectedCallee}${expectedArgument ? ` with ${expectedArgument}` : ''}`);
}

function assertLoopedEvaluatorCall(sourceText, iterableName, evaluatorName) {
  const source = ts.createSourceFile('consumer.js', sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  let found = false;
  const visit = node => {
    if (ts.isForOfStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === iterableName) {
      found ||= astHasCall(node.statement, call => ts.isIdentifier(call.expression) && call.expression.text === evaluatorName);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `${evaluatorName} must be called for every ${iterableName} entry`);
}

const F6_RUNTIME_SITES = Object.freeze({
  'audit.already_exists': ['src/audit-cli.js'],
  'closeout.marker.stale': ['src/closeout.js'],
  'review_prepare.workspace': ['src/github-review-prepare.js'],
  'review_prepare.stale_head': ['src/github-review-prepare.js'],
  'review_prepare.preflight_failed': ['src/github-review-prepare.js'],
  'review_prepare.independent_review_policy': ['src/github-review-prepare.js', 'src/task-cli.js'],
  'review_prepare.head_unavailable': ['src/github-review-prepare.js'],
  'review_prepare.head_malformed': ['src/github-review-prepare.js'],
  'review_prepare.head_refetch_failed': ['src/github-review-prepare.js'],
  'review_prepare.packet': ['src/github-review-prepare.js'],
  'ready.preflight': ['src/github-ready.js'],
  'ready.review_audit': ['src/github-ready.js'],
  'ready.task_identity': ['src/github-ready.js'],
  'ready.cross_gate_identity': ['src/github-ready.js'],
  'review_audit.task_contract': ['src/github-review-audit.js'],
  'review_audit.failure': ['src/github-review-audit.js'],
  'preflight.review_checkpoint': ['src/github-preflight.js'],
  'preflight.review_history_invalid': ['src/github-preflight.js'],
  'preflight.revision_resolution': ['src/github-preflight.js'],
  'review.entry.fixup_invalid': ['src/task-cli.js'],
  'review.entry.matrix_stale': ['src/task-cli.js'],
  'review.entry.persistence_conflict': ['src/task-cli.js'],
  'review.entry.persistence_carrier_changed': ['src/task-cli.js'],
  'review.entry.persistence_write_changed': ['src/task-cli.js'],
  'review.entry.persistence_refetch_changed': ['src/task-cli.js'],
});

describe('diagnostic architecture anti-bypass enforcement', () => {
  it('finds no routing bypasses in any runtime source file', () => {
    const violations = [];
    const entries = readdirSync(join(REPO_ROOT, 'src'), { recursive: true })
      .filter(entry => entry.endsWith('.js'))
      .map(entry => [`src/${entry}`, readFileSync(join(REPO_ROOT, 'src', entry), 'utf8')]);
    const discovery = discoverPublicCommandModules(
      entries,
      readFileSync(join(REPO_ROOT, 'bin', 'agenticloop.js'), 'utf8'),
    );
    assert.deepEqual(discovery.unresolvedImports, [], 'public command import graph must not silently omit an edge');
    assert.deepEqual(discovery.unresolvedBindings, [], 'public command dispatch bindings must not silently omit a handler');
    for (const path of ['src/cli-main.js', 'src/cli.js', 'src/task-cli.js']) {
      assert.ok(discovery.modules.has(path), `${path} must remain reachable from the binary command entry`);
    }
    for (const [relative, source] of entries) {
      for (const violation of checkDiagnosticArchitecture(source, {
        fileName: relative,
        presentation: APPROVED_PRESENTATION_MODULES.has(relative),
        constructorModule: CONSTRUCTOR_MODULES.has(relative),
        publicCommandModule: discovery.modules.has(relative),
      })) {
        violations.push(`${relative}:${violation.line} [${violation.rule}] ${violation.detail}`);
      }
    }
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('traverses static dispatch bindings to check nested cmd handlers and reports unresolved edges', () => {
    const entries = [
      ['src/cli-main.js', "import { dispatch } from './cli.js'; export function runCli() { return dispatch(); }"],
      ['src/cli.js', "import { cmdTask } from './task-cli.js'; const COMMAND_HANDLERS = { task: cmdTask }; export function dispatch() { return COMMAND_HANDLERS['task'](); }"],
      ['src/task-cli.js', 'export function cmdTask() { throw new Error(\'raw nested command error\'); }'],
    ];
    const discovery = discoverPublicCommandModules(entries, "import { runCli } from '../src/cli-main.js'; runCli();");
    assert.deepEqual([...discovery.modules].sort(), ['src/cli-main.js', 'src/cli.js', 'src/task-cli.js']);
    assert.deepEqual(discovery.unresolvedImports, []);
    assert.deepEqual(discovery.unresolvedBindings, []);
    assert.ok(checkDiagnosticArchitecture(entries[2][1], {
      fileName: 'src/task-cli.js', publicCommandModule: discovery.modules.has('src/task-cli.js'),
    }).some(violation => violation.rule === 'untyped-public-command-error'));

    const unresolved = discoverPublicCommandModules([
      ['src/cli-main.js', "import './missing-command.js'; export function run() {}"],
    ], "import { run } from '../src/cli-main.js'; run();");
    assert.deepEqual(unresolved.unresolvedImports, [{
      from: 'src/cli-main.js', specifier: './missing-command.js', resolved: 'src/missing-command.js',
    }]);

    const dynamic = discoverPublicCommandModules([
      ['src/cli-main.js', "import { dispatch } from './cli.js'; export function runCli() { return dispatch(); }"],
      ['src/cli.js', 'const HANDLERS = loadHandlers(); export function dispatch(command) { return HANDLERS[command](); }'],
    ], "import { runCli } from '../src/cli-main.js'; runCli();");
    assert.deepEqual(dynamic.unresolvedBindings, [{
      from: 'src/cli.js', binding: 'HANDLERS[command]', reason: 'dynamic-dispatch-lookup',
    }]);
  });

  it('rejects a hand-built role-directed diagnostic literal', () => {
    const violations = checkDiagnosticArchitecture(
      `const diagnostic = { message: 'scope broken', category: 'scope_deviations', owner: 'engineer', nextAction: 'Engineer must repair the scope' };`,
    );
    assert.ok(violations.some(item => item.rule === 'routing-fields-in-diagnostic'));
  });

  it('rejects protected routing fields supplied to the canonical constructor', () => {
    const violations = checkDiagnosticArchitecture(
      `createDiagnostic({ code: 'scope.deviation.missing', message: 'x', owner: 'engineer' });`,
    );
    assert.ok(violations.some(item => item.rule === 'protected-field-to-constructor'));
  });

  it('rejects role-name prose concatenated into diagnostic messages', () => {
    const violations = checkDiagnosticArchitecture(
      `const warning = 'task-readiness warning requires Maintainer correction before agent-ready: ' + detail;\nconst diagnostic = { code: 'scope.deviation.missing', level: 'error', message: warning };`,
    );
    assert.ok(violations.some(item => item.rule === 'role-prose-in-diagnostic-message'));
  });

  it('rejects diagnostic facts constructed without the canonical constructor', () => {
    const violations = checkDiagnosticArchitecture(
      `const fact = { level: 'error', code: 'scope.deviation.missing', message: 'hand built fact' };`,
    );
    assert.ok(violations.some(item => item.rule === 'non-canonical-diagnostic-construction'));
  });

  it('rejects raw built-in errors in a public command path', () => {
    const violations = checkDiagnosticArchitecture(
      `function command() { throw new Error('private implementation detail'); }`,
      { publicCommandModule: true },
    );
    assert.ok(violations.some(item => item.rule === 'untyped-public-command-error'));
  });

  it('allows classified public command errors', () => {
    const violations = checkDiagnosticArchitecture(
      `function command() { throw new VerificationContextError('missing task body'); }`,
      { publicCommandModule: true },
    );
    assert.deepEqual(violations, []);
  });

  it('allows factual diagnostics and legitimate ownership vocabulary', () => {
    const violations = checkDiagnosticArchitecture(`
      createDiagnostic({ code: 'scope.deviation.missing', message: 'unexpected file has no declaration' });
      const attribution = { contentOwnerRole: 'engineer', repairOperator: 'maintainer' };
      const event = { type: 'status', role: 'maintainer' };
    `);
    assert.deepEqual(violations, []);
  });

  it('overwrites injected routing for a known diagnostic code', () => {
    const capabilities = getProjectRoleCapabilities(REPO_ROOT);
    const presented = presentDiagnostic({
      code: 'scope.deviation.missing',
      message: 'scope broken',
      owner: 'orchestrator',
      nextAction: 'bypass capability routing',
    }, capabilities);
    assert.equal(presented.owner, capabilities.primaryOwnerByRepairKind.declare_exact_deviation);
    assert.notEqual(presented.nextAction, 'bypass capability routing');
  });
});

describe('refusal classification ratchet', () => {
  const HARD_CLASSES = new Set(['retained_hard_refusal', 'material_human_decision']);
  const ACCEPTED_FAMILIES = new Set(ACCEPTED_REFUSAL_FAMILIES);

  function scannedDiagnosticEmissions(sources = null) {
    const emittedByCode = new Map();
    const dynamicByModule = new Map();
    const entries = sources ?? readdirSync(join(REPO_ROOT, 'src'))
        .filter(entry => entry.endsWith('.js') && !['repair-policy.js', 'refusal-classes.js', 'f6-proof-registry.js', 'f7-proof-registry.js', 'f8-proof-registry.js'].includes(entry))
      .map(entry => [`src/${entry}`, readFileSync(join(REPO_ROOT, 'src', entry), 'utf8')]);
    for (const [relative, source] of entries) {
      const sites = collectDiagnosticEmissionSites(source, relative);
      for (const found of sites.codes) {
        if (!ACCEPTED_FAMILIES.has(REFUSAL_CLASSES[found.code]?.family)) continue;
        const producers = emittedByCode.get(found.code) ?? new Set();
        producers.add(relative);
        emittedByCode.set(found.code, producers);
      }
      for (const site of sites.dynamic) {
        const acceptedCodes = site.possibleCodes.filter(code => ACCEPTED_FAMILIES.has(REFUSAL_CLASSES[code]?.family));
        // A caller-supplied code can be a runtime refusal even when this scan
        // cannot enumerate its values. It must stay observable as `external`;
        // otherwise an undeclared emitter can evade the ratchet entirely.
        if (acceptedCodes.length === 0 && site.possibleCodes.length > 0) continue;
        const dynamic = dynamicByModule.get(relative) ?? [];
        dynamic.push({ ...site, acceptedCodes });
        dynamicByModule.set(relative, dynamic);
        for (const code of acceptedCodes) {
          const producers = emittedByCode.get(code) ?? new Set();
          producers.add(relative);
          emittedByCode.set(code, producers);
        }
      }
    }
    return { emittedByCode, dynamicByModule };
  }

  function assertHistoricalCodesHaveNoLiveEmitters(emittedByCode) {
    for (const [code] of Object.entries(HISTORICAL_PRODUCER_EXCEPTIONS)) {
      assert.equal(emittedByCode.get(code)?.size ?? 0, 0, `${code} removal row has a live runtime emitter`);
    }
  }

  it('classifies every registered code exactly once and exhausts accepted hard boundaries', () => {
    assert.equal(validateCatalog(), true);
    assert.deepEqual(Object.keys(REFUSAL_CLASSES).sort(), Object.keys(REPAIR_POLICY).sort());
    for (const [code, entry] of Object.entries(REFUSAL_CLASSES)) {
      if (!ACCEPTED_FAMILIES.has(entry.family)) continue;
      assert.notEqual(entry.refusalClass, 'pending_classification', `${code} must be classified`);
       assert.ok(entry.factOwner, `${code} requires a fact owner`);
       assert.ok(entry.rationale, `${code} requires an assurance rationale`);
       assert.ok(entry.repairClass, `${code} requires a repair class`);
       assert.equal(entry.repairPolicy, REPAIR_POLICY[code], `${code} must carry its repair policy in the diagnostic definition`);
      assert.ok(Array.isArray(entry.producers) || entry.producers === null, `${code} requires producers or a historical marker`);
      if (['F5', 'F6', 'F7', 'F8'].includes(entry.family) && entry.producers !== null) {
        assert.ok(Array.isArray(entry.evaluationSurfaces) && entry.evaluationSurfaces.length > 0, `${code} requires evaluation surfaces`);
      }
       assert.ok(entry.derivedNarrative?.semanticInvalidator, `${code} requires a derived semantic description`);
       assert.ok(entry.derivedNarrative?.description, `${code} requires a derived classification description`);
    }
    for (const entry of Object.values(REFUSAL_CLASSES).filter(item => item.refusalClass === 'pending_classification')) {
      assert.ok(entry.pendingSurfaces.length > 0, `${entry.code} requires a known pending evaluation surface`);
       assert.equal(entry.derivedNarrative.description, `pending_wu_b2:${entry.family}`, `${entry.code} must name its completing slice`);
    }
    assert.deepEqual(
      HARD_REFUSAL_ALLOWLIST.map(entry => entry.code).sort(),
      Object.values(REFUSAL_CLASSES)
        .filter(entry => HARD_CLASSES.has(entry.refusalClass))
        .map(entry => entry.code)
        .sort(),
    );
  });

  it('derives the accepted-family tally from the canonical accepted-family set', () => {
    assert.deepEqual(ACCEPTED_REFUSAL_FAMILIES, ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
    assert.equal(Object.keys(REFUSAL_CLASSES).length, 197);
    assert.deepEqual(Object.fromEntries(
      Object.entries(REFUSAL_FAMILY_TALLY).map(([family, { total }]) => [family, total]),
    ), { F1: 23, F2: 50, F3: 35, F4: 27, F5: 4, F6: 26, F7: 5, F8: 27 });
    assert.deepEqual(REFUSAL_FAMILY_TALLY.F5, { total: 4, pending: 0 });
    assert.deepEqual(REFUSAL_FAMILY_TALLY.F6, { total: 26, pending: 0 });
    assert.deepEqual(REFUSAL_FAMILY_TALLY.F7, { total: 5, pending: 0 });
    assert.deepEqual(REFUSAL_FAMILY_TALLY.F8, { total: 27, pending: 0 });
  });

  it('labels row-derived prose as derived narrative rather than proof', () => {
    const rows = Object.values(REFUSAL_CLASSES);
    const derivedOnly = rows.filter(entry => !entry.semanticEvidence);
    assert.equal(derivedOnly.length, 158, 'P36F-05-C4 reclassifies the former templated proof/invalidator rows');
    for (const entry of derivedOnly) {
      assert.equal(Object.hasOwn(entry, 'proof'), false, `${entry.code} must not label row-derived prose as proof`);
      assert.ok(entry.derivedNarrative.description);
      assert.ok(entry.derivedNarrative.semanticInvalidator);
    }
  });

  it('permits semantic evidence only as an executable reference or precise disposition', () => {
    for (const entry of Object.values(REFUSAL_CLASSES)) {
      if (!entry.semanticEvidence) continue;
      assert.match(entry.semanticEvidence,
        /(?:\btest\/[a-z0-9_./-]+\.test\.[cm]?js\b|\bF[5-8] executable probe\b|^disposition: [a-z][a-z0-9-]*; \S.+)/i,
        `${entry.code} semantic evidence must be executable or an honest precise disposition`);
    }
    assert.throws(() => assertRefusalClassCatalog({
      classifications: {
        ...REFUSAL_CLASSES,
        'execution_evidence.stale_version': {
          ...REFUSAL_CLASSES['execution_evidence.stale_version'], semanticEvidence: 'unratcheted prose only',
        },
      },
    }), /semantic evidence lacks an executable reference or precise disposition/);
  });

  it('derives repair-policy consumers from the diagnostic definitions', () => {
    assert.deepEqual(REPAIR_POLICY, repairPolicyViewFor(REFUSAL_CLASSES));
    const code = 'activation.capture.missing';
    const definitions = {
      ...REFUSAL_CLASSES,
      [code]: {
        ...REFUSAL_CLASSES[code],
        repairPolicy: { ...REFUSAL_CLASSES[code].repairPolicy, description: 'definition-only policy mutation' },
      },
    };
    assert.equal(repairPolicyViewFor(definitions)[code].description, 'definition-only policy mutation');
    assert.notEqual(REPAIR_POLICY[code].description, 'definition-only policy mutation');
  });

  it('rejects a scratch one-row catalog removal even when the policy is removed with it', () => {
    const removedCode = Object.keys(REFUSAL_CLASSES)[0];
    const classifications = { ...REFUSAL_CLASSES };
    const policy = { ...REPAIR_POLICY };
    delete classifications[removedCode];
    delete policy[removedCode];
    assert.throws(
      () => assertRefusalClassCatalog({ classifications, policy }),
      /refusal catalog row count changed: expected 197, received 196/,
    );
  });

  it('keeps --version import-safe while validation rejects a genuinely inconsistent imported fixture', () => {
    const fixture = mkdtempSync(join(REPO_ROOT, '.catalog-fixture-'));
    cpSync(join(REPO_ROOT, 'src'), join(fixture, 'src'), { recursive: true });
    mkdirSync(join(fixture, 'bin'));
    writeFileSync(join(fixture, 'bin', 'agenticloop.js'), [
      "import { REFUSAL_CLASSES } from '../src/refusal-classes.js';",
      "if (!process.argv.includes('--version')) process.exit(2);",
      "console.log('agenticloop fixture');",
      'void REFUSAL_CLASSES;',
    ].join('\n'));
    const fixtureCatalog = join(fixture, 'src', 'refusal-classes.js');
    writeFileSync(fixtureCatalog, readFileSync(fixtureCatalog, 'utf8').replace(
      'const catalog = [...F1, ...F2, ...F3, ...F4, ...F5, ...F6, ...F7, ...F8];',
      'const catalog = [...F1, ...F2, ...F3, ...F4, ...F5, ...F6, ...F7, ...F8, F1[0]];',
    ));
    const version = spawnSync(process.execPath, [join(fixture, 'bin', 'agenticloop.js'), '--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, `${version.stdout}\n${version.stderr}`);
    const validation = spawnSync(process.execPath, ['--input-type=module', '--eval',
      `import { validateCatalog } from ${JSON.stringify(new URL(`file://${fixtureCatalog}`).href)}; validateCatalog();`,
    ], { encoding: 'utf8' });
    rmSync(fixture, { recursive: true, force: true });
    assert.notEqual(validation.status, 0);
    assert.match(validation.stderr, /duplicate refusal classification: activation\.capture\.missing/);
    const classifications = {
      ...REFUSAL_CLASSES,
      'bogus.catalog.row': { ...REFUSAL_CLASSES['activation.capture.missing'], code: 'bogus.catalog.row' },
    };
    assert.throws(
      () => assertRefusalClassCatalog({ classifications }),
      /refusal catalog row count changed: expected 197, received 198/,
    );
  });

  it('rejects non-registered, duplicate, and registry-removed allowlist entries', () => {
    assert.throws(
      () => assertRefusalClassCatalog({
        allowlist: [...HARD_REFUSAL_ALLOWLIST, {
          code: 'unregistered.refusal', factOwner: 'test', rationale: 'test', repairClass: 'test',
        }],
      }),
      /hard-refusal allowlist has no registered diagnostic: unregistered\.refusal/,
    );
    assert.throws(
      () => assertRefusalClassCatalog({ allowlist: [...HARD_REFUSAL_ALLOWLIST, HARD_REFUSAL_ALLOWLIST[0]] }),
      /hard-refusal allowlist has duplicate diagnostic/,
    );
    const withoutNegativeProof = { ...HARD_REFUSAL_ALLOWLIST[0] };
    delete withoutNegativeProof.negativeProof;
    assert.throws(
      () => assertRefusalClassCatalog({ allowlist: [withoutNegativeProof, ...HARD_REFUSAL_ALLOWLIST.slice(1)] }),
      /hard-refusal allowlist lacks metadata/,
    );
    const duplicateProof = { ...HARD_REFUSAL_ALLOWLIST[1], negativeProof: HARD_REFUSAL_ALLOWLIST[0].negativeProof };
    assert.throws(
      () => assertRefusalClassCatalog({ allowlist: [HARD_REFUSAL_ALLOWLIST[0], duplicateProof, ...HARD_REFUSAL_ALLOWLIST.slice(2)] }),
      /hard-refusal allowlist has duplicate negative proof/,
    );
    const missingScenario = { ...HARD_REFUSAL_ALLOWLIST[0], negativeProof: 'Material fact: a test fixture does not name an adversarial scenario.' };
    assert.throws(
      () => assertRefusalClassCatalog({ allowlist: [missingScenario, ...HARD_REFUSAL_ALLOWLIST.slice(1)] }),
      /negative proof lacks an adversarial scenario/,
    );
    const removedPolicy = { ...REPAIR_POLICY };
    delete removedPolicy[HARD_REFUSAL_ALLOWLIST[0].code];
    assert.throws(
      () => assertRefusalClassCatalog({ policy: removedPolicy }),
      /registered diagnostic codes and refusal classifications differ/,
    );
  });

  it('rejects a bare scenario marker in a hard-refusal negative proof', () => {
    const emptyScenario = { ...HARD_REFUSAL_ALLOWLIST[0], negativeProof: 'Material fact: a test fixture names no adversarial scenario. scenario:   ' };
    assert.throws(
      () => assertRefusalClassCatalog({ allowlist: [emptyScenario, ...HARD_REFUSAL_ALLOWLIST.slice(1)] }),
      /negative proof lacks an adversarial scenario/,
    );
  });

  it('requires code-specific adversarial negative proof for every hard boundary', () => {
    const proofs = HARD_REFUSAL_ALLOWLIST.map(entry => entry.negativeProof);
    assert.equal(new Set(proofs).size, proofs.length, 'negative proof text must not be boilerplate');
    for (const entry of HARD_REFUSAL_ALLOWLIST) {
      assert.match(entry.negativeProof, /Material fact:/);
      assert.match(entry.negativeProof, /scenario:/i);
    }
  });

  it('executes every F6 material-boundary probe through its real production path', async () => {
    const expected = Object.values(REFUSAL_CLASSES)
      .filter(entry => entry.family === 'F6' && HARD_CLASSES.has(entry.refusalClass))
      .map(entry => entry.code).sort();
    const registeredCodes = F6_EXECUTABLE_PROOF_REGISTRY.map(entry => entry.code);
    const registeredProbeIds = F6_EXECUTABLE_PROOF_REGISTRY.map(entry => entry.probeId);
    assert.deepEqual([...registeredCodes].sort(), expected, 'missing or unknown F6 hard/material probe registration');
    assert.equal(new Set(registeredCodes).size, registeredCodes.length, 'duplicate F6 code registration');
    assert.equal(new Set(registeredProbeIds).size, registeredProbeIds.length, 'duplicate F6 probe registration');
    assert.deepEqual([...registeredProbeIds].sort(), [...F6_EXECUTABLE_PROBE_IDS].sort(), 'nonexecuted or unknown F6 probe ID');
    for (const binding of F6_EXECUTABLE_PROOF_REGISTRY) {
      const observed = await runF6ExecutableProbe(binding.probeId);
      const codes = observed.diagnostics.map(item => item?.code);
      const f6Codes = codes.filter(code => REFUSAL_CLASSES[code]?.family === 'F6');
      const expectedCodes = binding.probeId === 'review-audit-task-contract'
        ? [binding.code, 'review_audit.failure']
        : [binding.code];
      assert.deepEqual([...new Set(f6Codes)].sort(), expectedCodes.sort(), `${binding.probeId} must emit its exact public F6 code plus any live-candidate drift refusal`);
      assert.equal(REFUSAL_CLASSES[binding.code].factOwner, binding.factOwner, `${binding.probeId} fact binding drifted`);
    }
  });

  it('derives F6 fact owners from the catalog rather than probe bindings', () => {
    const code = F6_EXECUTABLE_PROOF_REGISTRY[0].code;
    const factOwner = 'catalog-only-fact-owner-mutation';
    const definitions = {
      ...REFUSAL_CLASSES,
      [code]: { ...REFUSAL_CLASSES[code], factOwner },
    };
    assert.equal(
      f6ExecutableProofRegistryFor(definitions).find(binding => binding.code === code).factOwner,
      factOwner,
    );
    assert.notEqual(F6_EXECUTABLE_PROOF_REGISTRY.find(binding => binding.code === code).factOwner, factOwner);
  });

  it('executes every F7 material-boundary probe through its real production path', async () => {
    const expected = Object.values(REFUSAL_CLASSES)
      .filter(entry => entry.family === 'F7' && HARD_CLASSES.has(entry.refusalClass))
      .map(entry => entry.code).sort();
    const registeredCodes = F7_EXECUTABLE_PROOF_REGISTRY.map(entry => entry.code);
    const registeredProbeIds = F7_EXECUTABLE_PROOF_REGISTRY.map(entry => entry.probeId);
    assert.deepEqual([...registeredCodes].sort(), expected, 'missing or unknown F7 hard/material probe registration');
    assert.equal(new Set(registeredCodes).size, registeredCodes.length, 'duplicate F7 code registration');
    assert.equal(new Set(registeredProbeIds).size, registeredProbeIds.length, 'duplicate F7 probe registration');
    assert.deepEqual([...registeredProbeIds].sort(), [...F7_EXECUTABLE_PROBE_IDS].sort(), 'nonexecuted or unknown F7 probe ID');
    for (const binding of F7_EXECUTABLE_PROOF_REGISTRY) {
      const observed = await runF7ExecutableProbe(binding.probeId);
      const codes = observed.diagnostics.map(item => item?.code);
      const f7Codes = codes.filter(code => REFUSAL_CLASSES[code]?.family === 'F7');
      assert.deepEqual([...new Set(f7Codes)], [binding.code], `${binding.probeId} must emit only its exact public F7 code`);
      assert.equal(REFUSAL_CLASSES[binding.code].factOwner, binding.factOwner, `${binding.probeId} fact binding drifted`);
    }
  });

  it('executes every F8 material-boundary probe through its real production path', async () => {
    const expected = Object.values(REFUSAL_CLASSES)
      .filter(entry => entry.family === 'F8' && HARD_CLASSES.has(entry.refusalClass))
      .map(entry => entry.code).sort();
    const registeredCodes = F8_EXECUTABLE_PROOF_REGISTRY.map(entry => entry.code);
    const registeredProbeIds = F8_EXECUTABLE_PROOF_REGISTRY.map(entry => entry.probeId);
    assert.deepEqual([...registeredCodes].sort(), expected, 'missing or unknown F8 hard/material probe registration');
    assert.equal(new Set(registeredCodes).size, registeredCodes.length, 'duplicate F8 code registration');
    assert.equal(new Set(registeredProbeIds).size, registeredProbeIds.length, 'duplicate F8 probe registration');
    assert.deepEqual([...registeredProbeIds].sort(), [...F8_EXECUTABLE_PROBE_IDS].sort(), 'nonexecuted or unknown F8 probe ID');
    for (const binding of F8_EXECUTABLE_PROOF_REGISTRY) {
      const observed = await runF8ExecutableProbe(binding.probeId);
      const codes = observed.diagnostics.map(item => item?.code);
      const f8Codes = codes.filter(code => REFUSAL_CLASSES[code]?.family === 'F8');
      assert.deepEqual([...new Set(f8Codes)], [binding.code], `${binding.probeId} must emit only its exact public F8 code`);
      assert.equal(REFUSAL_CLASSES[binding.code].factOwner, binding.factOwner, `${binding.probeId} fact binding drifted`);
    }
  });

  it('keeps non-allowlisted diagnostics out of a hard-refusal presentation mapping', () => {
    assert.equal(REFUSAL_CLASSES['return.assurance.session_reported'].refusalClass, 'advisory_diagnostic',
      'P36F-05-C5 classifies receipt-less return reporting as warning-only');
    assert.equal(HARD_REFUSAL_ALLOWLIST.some(entry => entry.code === 'return.assurance.session_reported'), false);
    const nonAllowlisted = Object.values(REFUSAL_CLASSES)
      .filter(entry => !HARD_REFUSAL_ALLOWLIST.some(item => item.code === entry.code));
    assert.ok(nonAllowlisted.length > 0);
    for (const entry of nonAllowlisted) assert.ok(!HARD_CLASSES.has(entry.refusalClass), entry.code);

    // Presentation presently routes repair ownership only; it has no separate
    // hard-refusal flag or escalation map.  This assertion is the mechanically
    // checkable boundary until later work gives presentation a disposition field.
    const capabilities = getProjectRoleCapabilities(REPO_ROOT);
    const presented = presentDiagnostic(createDiagnostic({ code: nonAllowlisted[0].code }), capabilities);
    assert.equal(Object.hasOwn(presented, 'hardRefusal'), false);
    assert.equal(Object.hasOwn(presented, 'refusalClass'), false);
  });

  it('binds accepted producers bidirectionally and records every dynamic selection explicitly', () => {
    const { emittedByCode, dynamicByModule } = scannedDiagnosticEmissions();
    for (const [code, classification] of Object.entries(REFUSAL_CLASSES)) {
      if (!ACCEPTED_FAMILIES.has(classification.family)) continue;
      if (classification.producers === null) {
        assert.ok(HISTORICAL_PRODUCER_EXCEPTIONS[code], `${code} must declare its historical absence`);
        assert.match(classification.derivedNarrative.description, /historical_no_live_producer/);
        continue;
      }
      for (const emittedBy of emittedByCode.get(code) ?? []) {
        assert.ok(classification.producers.includes(emittedBy), `${code} emitter ${emittedBy} is missing from catalog producers`);
      }
      for (const producer of classification.producers) {
        const source = readFileSync(join(REPO_ROOT, producer), 'utf8');
        const dynamicDeclaration = DYNAMIC_DIAGNOSTIC_PRODUCERS[producer];
        const declaredDynamicCodes = dynamicDeclaration?.codes === 'external'
          ? dynamicDeclaration.knownCodes ?? []
          : dynamicDeclaration?.codes ?? [];
        assert.ok(
          source.includes(code) || declaredDynamicCodes.includes(code),
          `${code} named producer no longer references its diagnostic or declares its dynamic selection`,
        );
      }
    }
    assertHistoricalCodesHaveNoLiveEmitters(emittedByCode);
    assert.deepEqual([...dynamicByModule.keys()].sort(), Object.keys(DYNAMIC_DIAGNOSTIC_PRODUCERS).sort());
    for (const [surface, declaration] of Object.entries(DYNAMIC_DIAGNOSTIC_PRODUCERS)) {
      const emittedSites = dynamicByModule.get(surface);
      const emitted = new Set(emittedSites.flatMap(site => site.acceptedCodes));
      const external = emittedSites.some(site => site.hasUnresolved);
      const codes = declaration.codes === 'external' ? declaration.knownCodes ?? [] : declaration.codes;
      assert.equal(external, declaration.codes === 'external', `${surface} external dynamic producer declaration is incomplete`);
      for (const code of codes.filter(code => ACCEPTED_FAMILIES.has(REFUSAL_CLASSES[code]?.family))) {
        assert.ok(emitted.has(code), `${surface} dynamic producer does not enumerate ${code}`);
        assert.ok(REFUSAL_CLASSES[code].producers.includes(surface), `${code} omits dynamic producer ${surface}`);
      }
      assert.deepEqual(
        [...emitted].sort(),
        codes.filter(code => ACCEPTED_FAMILIES.has(REFUSAL_CLASSES[code]?.family)).sort(),
        `${surface} dynamic producer inventory is incomplete`,
      );
    }
  });

  it('registers and traces every F6 runtime refusal site without a deferred escape hatch', () => {
    assert.deepEqual(
      [...Object.keys(F6_RUNTIME_SITES), 'preflight.review_provenance'].sort(),
      Object.values(REFUSAL_CLASSES).filter(entry => entry.family === 'F6').map(entry => entry.code).sort(),
    );
    assert.equal(REFUSAL_CLASSES['preflight.review_provenance'].producers, null);
    for (const [code, surfaces] of Object.entries(F6_RUNTIME_SITES)) {
      assert.ok(Object.hasOwn(REPAIR_POLICY, code), `${code} must be publicly registered`);
      const entry = REFUSAL_CLASSES[code];
      assert.deepEqual(entry.evaluationSurfaces, surfaces, `${code} evaluation surface must be exact`);
      for (const surface of surfaces) {
        const source = readFileSync(join(REPO_ROOT, surface), 'utf8');
        assert.ok(source.includes(code), `${code} must remain observable at ${surface}`);
      }
    }
  });

  it('registers and traces every F7 runtime refusal site without a deferred escape hatch', () => {
    const runtimeSites = {
      'compatibility.waiver_scope_retired': ['src/closeout-waiver.js'],
      'check.aggregate.git_probe_failed': ['src/task-cli.js'],
      'worktree.clean_gate.failed': ['src/dispatch-eligibility.js', 'src/repository-state.js'],
      'state.host_local': ['src/projection-reconciliation.js'],
      'projection.state.unexplained': ['src/projection-reconciliation.js'],
    };
    assert.deepEqual(
      Object.keys(runtimeSites).sort(),
      Object.values(REFUSAL_CLASSES).filter(entry => entry.family === 'F7').map(entry => entry.code).sort(),
    );
    for (const [code, surfaces] of Object.entries(runtimeSites)) {
      const entry = REFUSAL_CLASSES[code];
      assert.ok(Object.hasOwn(REPAIR_POLICY, code), `${code} must be publicly registered`);
      assert.deepEqual(entry.evaluationSurfaces, surfaces, `${code} evaluation surfaces must be exact`);
      assert.deepEqual(entry.producers, surfaces, `${code} producers must be exact`);
      for (const surface of surfaces) {
        assert.ok(readFileSync(join(REPO_ROOT, surface), 'utf8').includes(code), `${code} must remain observable at ${surface}`);
      }
    }
  });

  it('registers and traces every F8 runtime refusal site without a deferred escape hatch', () => {
    const runtimeSites = {
      'readiness.mode.invalid': ['src/task-readiness.js'],
      'preflight.head_identity': ['src/github-preflight.js'],
      'preflight.summary_shape': ['src/github-preflight.js'],
      'preflight.scope_deviations': ['src/github-preflight.js'],
      'preflight.task_contract': ['src/github-preflight.js'],
      'preflight.path_intent': ['src/github-preflight.js'],
      'preflight.generated_paths': ['src/github-preflight.js'],
      'preflight.dependencies': ['src/github-preflight.js'],
      'preflight.evidence': ['src/github-preflight.js'],
      'preflight.checks': ['src/github-preflight.js'],
      'preflight.checks.task_contract': ['src/github-preflight.js'],
      'preflight.task_policy': ['src/github-preflight.js', 'src/pr-body.js'],
      'preflight.other': ['src/github-preflight.js'],
      'pr_body.structural': ['src/pr-body.js'],
      'pr_body.input': ['src/preparation-input.js', 'src/cli.js'],
      'pr_body.snapshot': ['src/pr-body-context.js'],
      'pr_body.deprecation': ['src/cli.js'],
      'pr_body.local_file': ['src/cli.js'],
      'pr_body.input_format': ['src/cli.js'],
      'cli.usage': ['src/cli-main.js', 'src/cli-io.js', 'src/github-task-body.js'],
      'cli.operational': ['src/cli.js', 'src/closeout-cli.js'],
      'cli.unexpected': ['src/cli-main.js', 'src/diagnostic-presentation.js'],
      'projection.observation.invalid': ['src/projection-reconciliation.js'],
      'projection.carrier.not_applicable': ['src/projection-reconciliation.js'],
      'projection.evidence.superseded': ['src/projection-reconciliation.js'],
      'projection.fact.contradiction': ['src/projection-reconciliation.js'],
      'projection.authority.untyped': ['src/projection-reconciliation.js'],
    };
    assert.deepEqual(
      Object.keys(runtimeSites).sort(),
      Object.values(REFUSAL_CLASSES).filter(entry => entry.family === 'F8').map(entry => entry.code).sort(),
    );
    for (const [code, surfaces] of Object.entries(runtimeSites)) {
      const entry = REFUSAL_CLASSES[code];
      assert.ok(Object.hasOwn(REPAIR_POLICY, code), `${code} must be publicly registered`);
      assert.deepEqual(entry.evaluationSurfaces, surfaces, `${code} evaluation surfaces must be exact`);
      assert.deepEqual(entry.producers, surfaces, `${code} producers must be exact`);
      for (const surface of surfaces) {
        const dynamic = DYNAMIC_DIAGNOSTIC_PRODUCERS[surface];
        const declaredCodes = dynamic?.codes === 'external' ? dynamic.knownCodes ?? [] : dynamic?.codes ?? [];
        assert.ok(
          readFileSync(join(REPO_ROOT, surface), 'utf8').includes(code) || declaredCodes.includes(code),
          `${code} must remain observable or declared as dynamic at ${surface}`,
        );
      }
    }
  });

  it('detects default-parameter emissions and rejects their unregistered literals', () => {
    const source = `const DEFAULT_CODE = 'activation.binding.mismatch';\nfunction emit(message, code = DEFAULT_CODE) {}\nemit('default');`;
    assert.deepEqual(collectDiagnosticCodeLiterals(source).map(item => item.code), ['activation.binding.mismatch']);
    const unknown = collectDiagnosticCodeLiterals(`function emit(message, code = 'unregistered.default_parameter') {}\nemit('default');`)
      .filter(found => !Object.hasOwn(REPAIR_POLICY, found.code));
    assert.deepEqual(unknown.map(found => found.code), ['unregistered.default_parameter']);
  });

  it('rejects an undeclared dynamic diagnostic producer', () => {
    const { dynamicByModule } = scannedDiagnosticEmissions([
      ['src/undeclared-dynamic.js', `function emit(message, code) {}\nconst lookup = { active: 'activation.capture.missing' };\nemit('x', lookup[state]);`],
    ]);
    assert.throws(
      () => assert.deepEqual([...dynamicByModule.keys()].sort(), Object.keys(DYNAMIC_DIAGNOSTIC_PRODUCERS).sort()),
      /src\/undeclared-dynamic\.js/,
    );
  });

  it('rejects an undeclared dynamic producer whose code cannot be statically resolved', () => {
    const { dynamicByModule } = scannedDiagnosticEmissions([
      ['src/undeclared-external-dynamic.js', `function emit(message, code) { return createDiagnostic({ message, code }); }\nconst externalCode = input.code;\nemit('x', externalCode);`],
    ]);
    assert.throws(
      () => assert.deepEqual([...dynamicByModule.keys()].sort(), Object.keys(DYNAMIC_DIAGNOSTIC_PRODUCERS).sort()),
      /src\/undeclared-external-dynamic\.js/,
    );
  });

  it('rejects an undeclared mixed known and external dynamic producer', () => {
    const { dynamicByModule } = scannedDiagnosticEmissions([
      ['src/undeclared-mixed-dynamic.js', `function emit(message, code) { return createDiagnostic({ message, code }); }\nconst externalCode = input.code;\nemit('x', state ? 'activation.capture.missing' : externalCode);`],
    ]);
    const [site] = dynamicByModule.get('src/undeclared-mixed-dynamic.js');
    assert.deepEqual(site.acceptedCodes, ['activation.capture.missing']);
    assert.equal(site.hasUnresolved, true);
    assert.throws(
      () => assert.deepEqual([...dynamicByModule.keys()].sort(), Object.keys(DYNAMIC_DIAGNOSTIC_PRODUCERS).sort()),
      /src\/undeclared-mixed-dynamic\.js/,
    );
  });

  it('observes every direct conditional constructor branch so an unregistered branch fails', () => {
    const source = `createDiagnostic({ code: condition ? 'activation.capture.missing' : 'unregistered.direct', message: 'x' });`;
    const sites = collectDiagnosticEmissionSites(source, 'src/undeclared-direct-conditional.js');
    assert.deepEqual(sites.codes.map(site => site.code).sort(), ['activation.capture.missing', 'unregistered.direct']);
    assert.throws(
      () => assert.deepEqual(
        sites.codes.filter(site => !Object.hasOwn(REPAIR_POLICY, site.code)).map(site => site.code),
        [],
      ),
      /unregistered\.direct/,
    );
  });

  it('requires a declaration for a direct constructor code property read', () => {
    const { dynamicByModule } = scannedDiagnosticEmissions([
      ['src/undeclared-direct-property.js', `createDiagnostic({ code: input.code, message: 'x' });`],
    ]);
    const [site] = dynamicByModule.get('src/undeclared-direct-property.js');
    assert.equal(site.hasUnresolved, true);
    assert.throws(
      () => assert.deepEqual([...dynamicByModule.keys()].sort(), Object.keys(DYNAMIC_DIAGNOSTIC_PRODUCERS).sort()),
      /src\/undeclared-direct-property\.js/,
    );
  });

  it('observes an unregistered literal embedded in a typed error class', () => {
    const sites = collectDiagnosticEmissionSites(
      `class DirectRefusal extends Error { code = 'unregistered.typed_direct'; }`,
      'src/undeclared-typed-error.js',
    );
    assert.throws(
      () => assert.deepEqual(
        sites.codes.filter(site => !Object.hasOwn(REPAIR_POLICY, site.code)).map(site => site.code),
        [],
      ),
      /unregistered\.typed_direct/,
    );
  });

  it('treats an explicit null code argument as a non-emission', () => {
    const sites = collectDiagnosticEmissionSites(
      `function emit(message, code) { return createDiagnostic({ message, code }); }\nemit('no diagnostic', null);`,
    );
    assert.deepEqual(sites, { codes: [], dynamic: [] });
  });

  it('keeps C7 compatibility-only defensive codes typed without an installed-public claim', () => {
    for (const code of ['scope.existing_path.missing', 'preflight.review_provenance']) {
      assert.equal(REFUSAL_CLASSES[code].producers, null, `${code} must have no direct public producer claim`);
      assert.ok(HISTORICAL_PRODUCER_EXCEPTIONS[code], `${code} must retain an explicit internal-only disposition`);
      assert.equal(HARD_REFUSAL_ALLOWLIST.some(entry => entry.code === code), false, `${code} must not claim installed hard-refusal coverage`);
    }
    const scope = createDiagnostic({ code: 'scope.existing_path.missing', evidence: { paths: ['missing.md'] } });
    const provenance = createDiagnostic({ code: preflightDiagnosticCode('review_provenance') });
    assert.equal(scope.category, 'path_intent');
    assert.match(scope.message, /missing\.md/);
    assert.equal(provenance.category, 'review_provenance');
    assert.throws(() => createDiagnostic({ code: provenance.code, category: 'forged' }), /cannot be evaluator-supplied/);
  });

  it('keeps non-F5/F6/F7/F8 split consumers present without treating them as emitters', () => {
    for (const entry of Object.values(REFUSAL_CLASSES).filter(item => !['F5', 'F6', 'F7', 'F8'].includes(item.family) && ACCEPTED_FAMILIES.has(item.family) && item.consumers)) {
      for (const consumer of entry.consumers) assert.ok(readFileSync(join(REPO_ROOT, consumer), 'utf8'));
    }
  });

  it('binds F5/F6/F7/F8 consumers bidirectionally to canonical evaluator calls and excludes loaders', () => {
    const discovered = discoverF5F6Consumers();
    assertF5F6ConsumerInventory(discovered);

    const preflightSource = readFileSync(join(REPO_ROOT, 'src/github-preflight.js'), 'utf8');
    const preparationSource = readFileSync(join(REPO_ROOT, 'src/preparation-input.js'), 'utf8');
    assertPreflightDelegation(preflightSource, 'runPreflight', 'evaluatePreparationInput', 'evaluatePreflight');
    assertPreflightDelegation(preparationSource, 'evaluatePreparationInput', 'evaluator');

    const loaderOnly = discoverF5F6Consumers([
      ['src/loader-only.js', "import { loadPreflightInput } from './github-preflight.js';\nloadPreflightInput({ pr: 1 });"],
      ['src/waiver-loader-only.js', "import { verifyLegacyUnactivatedWaiver } from './closeout-waiver.js';\nconst verifier = verifyLegacyUnactivatedWaiver;"],
    ]);
    assert.equal(loaderOnly.size, 0, 'loading a canonical evaluator without invoking it is not diagnostic consumption');
  });

  it('fails the F6 review-preparation head ratchet for every omitted evaluator mapping or CLI consumer edge', () => {
    const headCodes = [
      'review_prepare.head_unavailable',
      'review_prepare.head_malformed',
      'review_prepare.head_refetch_failed',
    ];
    for (const code of headCodes) {
      const missingMapping = copyF5F6EvaluatorImports();
      const evaluatorCodes = missingMapping.get('./github-review-prepare.js').get('runGitHubReviewPrepare');
      missingMapping.get('./github-review-prepare.js').set(
        'runGitHubReviewPrepare',
        evaluatorCodes.filter(item => item !== code),
      );
      assert.throws(
        () => assertF5F6ConsumerInventory(discoverF5F6Consumers(null, missingMapping)),
        new RegExp(`${code} consumer inventory`),
        `omitting ${code} from its canonical evaluator mapping must fail the ratchet`,
      );

      const missingCliConsumer = {
        ...REFUSAL_CLASSES,
        [code]: {
          ...REFUSAL_CLASSES[code],
          consumers: REFUSAL_CLASSES[code].consumers.filter(consumer => consumer !== 'src/cli.js'),
        },
      };
      assert.throws(
        () => assertF5F6ConsumerInventory(discoverF5F6Consumers(), missingCliConsumer),
        new RegExp(`${code} (must name|consumer inventory)`),
        `omitting ${code}'s src/cli.js consumer edge must fail the ratchet`,
      );
    }
  });

  it('resolves F5/F6/F7 evaluator and preparation-helper bindings before counting consumers', () => {
    const discovered = discoverF5F6Consumers([
      ['src/renamed-evaluator.js', `
        import { evaluateCommitAttribution as inspectAttribution } from './commit-attribution.js';
        inspectAttribution({ message: 'x' });
      `],
      ['src/namespace-evaluator.js', `
        import * as attribution from './commit-attribution.js';
        attribution.evaluateWorkUnitCommitAttribution({ message: 'x' });
      `],
      ['src/namespace-preparation.js', `
        import * as preflight from './github-preflight.js';
        import * as preparation from './preparation-input.js';
        preparation.evaluatePreparationInput({}, preflight.evaluatePreflight);
      `],
      ['src/renamed-preparation.js', `
        import { evaluatePreflight as inspectPreflight } from './github-preflight.js';
        import { evaluatePreparationInput as prepare } from './preparation-input.js';
        prepare({}, inspectPreflight);
      `],
      ['src/local-evaluator-shadow.js', `
        import { evaluateCommitAttribution as inspectAttribution } from './commit-attribution.js';
        function inspectLocal(inspectAttribution) { inspectAttribution({ message: 'x' }); }
      `],
      ['src/local-helper-shadow.js', `
        import { evaluatePreflight as inspectPreflight } from './github-preflight.js';
        function prepareLocally(evaluatePreparationInput) { evaluatePreparationInput({}, inspectPreflight); }
      `],
      ['src/reassigned-indirection.js', `
        import { evaluatePreflight as inspectPreflight } from './github-preflight.js';
        import { evaluatePreparationInput as prepare } from './preparation-input.js';
        let delegated = inspectPreflight;
        delegated = () => ({ ok: true });
        prepare({}, delegated);
      `],
      ['src/fake-delegation.js', `
        import { evaluatePreflight as inspectPreflight } from './github-preflight.js';
        function pretendPreparation(input, evaluator) { return evaluator(input); }
        pretendPreparation({}, inspectPreflight);
      `],
      ['src/renamed-review-audit.js', `
        import { runGitHubReviewAudit as audit } from './github-review-audit.js';
        audit({ pr: 1 });
      `],
      ['src/namespace-ready.js', `
        import * as ready from './github-ready.js';
        ready['runGitHubReady']({ pr: 1 });
      `],
      ['src/local-ready-shadow.js', `
        import { runGitHubReady } from './github-ready.js';
        function wrapper(runGitHubReady) { runGitHubReady({ pr: 1 }); }
      `],
      ['src/renamed-waiver-verifier.js', `
        import { verifyLegacyUnactivatedWaiver as verifyWaiver } from './closeout-waiver.js';
        verifyWaiver({}, {});
      `],
      ['src/namespace-clean-state.js', `
        import * as repositoryState from './repository-state.js';
        repositoryState['evaluateDispatchCleanState']({});
      `],
      ['src/local-clean-state-shadow.js', `
        import { evaluateDispatchCleanState } from './repository-state.js';
        function wrapper(evaluateDispatchCleanState) { evaluateDispatchCleanState({}); }
      `],
      ['src/reassigned-waiver-indirection.js', `
        import { verifyLegacyUnactivatedWaiver } from './closeout-waiver.js';
        let verifier = verifyLegacyUnactivatedWaiver;
        verifier = () => ({ ok: true });
        verifier({}, {});
      `],
    ]);
    const pathsFor = code => [...(discovered.get(code) ?? [])].sort();

    assert.deepEqual(pathsFor('attribution.work_unit'), ['src/namespace-evaluator.js']);
    assert.deepEqual(pathsFor('attribution.trailer'), ['src/renamed-evaluator.js']);
    assert.deepEqual(pathsFor('attribution.role'), ['src/renamed-evaluator.js']);
    assert.deepEqual(pathsFor('preflight.attribution'), [
      'src/namespace-preparation.js',
      'src/renamed-preparation.js',
    ]);
    assert.deepEqual(pathsFor('review_audit.failure'), ['src/renamed-review-audit.js']);
    assert.deepEqual(pathsFor('review_audit.task_contract'), ['src/renamed-review-audit.js']);
    assert.deepEqual(pathsFor('ready.preflight'), ['src/namespace-ready.js']);
    assert.equal(pathsFor('ready.review_audit').includes('src/local-ready-shadow.js'), false);
    assert.deepEqual(pathsFor('compatibility.waiver_scope_retired'), ['src/renamed-waiver-verifier.js']);
    assert.deepEqual(pathsFor('worktree.clean_gate.failed'), ['src/namespace-clean-state.js']);
    assert.equal(pathsFor('worktree.clean_gate.failed').includes('src/local-clean-state-shadow.js'), false);
  });

  it('structurally binds the F5 receipt consumer to canonical attribution across its full commit inventory', () => {
    const receiptSource = readFileSync(join(REPO_ROOT, 'src/review-entry-receipt.js'), 'utf8');
    assertLoopedEvaluatorCall(receiptSource, 'normalized', 'evaluateCommitAttribution');
    for (const code of ['attribution.trailer', 'attribution.role']) {
      assert.ok(REFUSAL_CLASSES[code].consumers.includes('src/review-entry-receipt.js'), `${code} must bind its indirect receipt consumer`);
    }
  });

  it('finds no unregistered runtime refusal in accepted slices with an AST structural scan', () => {
    const unknown = [];
    for (const entry of readdirSync(join(REPO_ROOT, 'src'))) {
      if (!entry.endsWith('.js') || ['repair-policy.js', 'refusal-classes.js'].includes(entry)) continue;
      for (const found of collectDiagnosticCodeLiterals(readFileSync(join(REPO_ROOT, 'src', entry), 'utf8'), `src/${entry}`)) {
        if (!Object.hasOwn(REPAIR_POLICY, found.code)) {
          unknown.push(`src/${entry}:${found.line}: ${found.code}`);
        }
      }
    }
    assert.deepEqual(unknown, [], unknown.join('\n'));
  });

  it('detects positional and typed-error unregistered refusal emitters', () => {
    assert.deepEqual(
      collectDiagnosticCodeLiterals(`function fail(message, code) {}\nfail('x', 'unregistered.refusal');`)
        .map(item => item.code),
      ['unregistered.refusal'],
    );
    assert.deepEqual(
      collectDiagnosticCodeLiterals(`class Refusal extends Error { constructor() { super(); this.code = 'unregistered.refusal'; } }`)
        .map(item => item.code),
      ['unregistered.refusal'],
    );
  });

  it('presents and normalizes every code registered by this classification slice', () => {
    const registeredHere = [
      'activation.policy.invalid', 'task.evidence.product_head',
      'execution_evidence.malformed_input', 'execution_evidence.stale_version',
      'execution_evidence.binding_mismatch', 'execution_evidence.lineage_mismatch',
      'return.lane.implementation_absent', 'attempt_return_unbound', 'attempt_return_ambiguous',
      'attempt_return_conflict', 'attempt_terminal_conflict', 'task.role_start.check_evidence_missing',
      'task.role_start.check_evidence_mismatch', 'tooling_failure_input_invalid',
      'tooling_failure_evidence_conflict', 'tooling_failure_write_failed', 'tooling_failure_admission_conflict',
       'handoff.evidence.freshness_expired', 'handoff.evidence.schema_retired',
       'handoff.evidence.revalidation_failed', 'handoff.evidence.ambiguous_return',
       'review.entry.fixup_invalid', 'review.entry.matrix_stale',
        'review.entry.persistence_conflict', 'review.entry.persistence_carrier_changed',
        'review.entry.persistence_write_changed', 'review.entry.persistence_refetch_changed',
        'compatibility.waiver_scope_retired', 'check.aggregate.git_probe_failed',
        'worktree.clean_gate.failed', 'state.host_local', 'projection.state.unexplained',
    ];
    const capabilities = getProjectRoleCapabilities(REPO_ROOT);
    for (const code of registeredHere) {
      const classification = REFUSAL_CLASSES[code];
      assert.ok(classification.rationale && classification.repairClass, `${code} has C1 metadata`);
      const fact = createDiagnostic({ code });
      const presented = presentDiagnostic(fact, capabilities);
      assert.ok(presented.owner, `${code} presents an owner`);
      const normalized = commandFailure('diagnostic test', new PublicCommandError('registered diagnostic', { code }), 'operational_error', {}, REPO_ROOT);
      assert.equal(normalized.diagnostics[0].code, code, `${code} must not normalize as an unregistered fallback`);
    }
  });
});

describe('role capability bindings', () => {
  function fixture(bindings) {
    const dir = mkdtempSync(join(tmpdir(), 'al-capabilities-'));
    for (const [role, frontmatter] of Object.entries(bindings)) {
      writeFileSync(join(dir, `${role}.md`), `---\nname: ${role}\n${frontmatter}---\n\n# ${role}\n`, 'utf8');
    }
    return dir;
  }

  const COMPLETE = {
    maintainer: `primary_repair_capabilities:\n${REPAIR_KINDS.filter(kind => !['resolve_dependency'].includes(kind)).map(kind => `  - ${kind}\n`).join('')}`,
    orchestrator: 'primary_repair_capabilities:\n  - resolve_dependency\nescalation_capabilities:\n  - dependency_escalation\n',
    engineer: '',
    auditor: '',
  };

  it('resolves the canonical repository bindings with full coverage', () => {
    const capabilities = getProjectRoleCapabilities(REPO_ROOT);
    for (const kind of REPAIR_KINDS) assert.ok(capabilities.primaryOwnerByRepairKind[kind], `${kind} has a primary owner`);
    assert.equal(capabilities.escalationOwnerByKind.none, null);
    for (const kind of ESCALATION_KINDS.filter(item => item.startsWith('human_authority'))) {
      assert.equal(capabilities.escalationOwnerByKind[kind], HUMAN_AUTHORITY_BOUNDARY);
    }
  });

  it('fails when a repair kind has no primary owner', () => {
    const dir = fixture({
      ...COMPLETE,
      engineer: '',
      orchestrator: '', // resolve_dependency loses its only claimant
    });
    try {
      const result = loadRoleCapabilities(dir);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), /repair kind 'resolve_dependency' has no primary owner/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when multiple roles claim the same primary capability', () => {
    const dir = fixture({
      ...COMPLETE,
      engineer: 'primary_repair_capabilities:\n  - resolve_dependency\n',
    });
    try {
      const result = loadRoleCapabilities(dir);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), /repair kind 'resolve_dependency' has multiple primary owners/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a role declares an unknown capability', () => {
    const dir = fixture({
      ...COMPLETE,
      engineer: 'primary_repair_capabilities:\n  - invent_features\n',
    });
    try {
      const result = loadRoleCapabilities(dir);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), /unknown primary repair capability 'invent_features'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a catalog escalation kind cannot be resolved', () => {
    const dir = fixture({
      ...COMPLETE,
      orchestrator: 'primary_repair_capabilities:\n  - resolve_dependency\n', // drops dependency_escalation
    });
    try {
      const result = loadRoleCapabilities(dir);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), /escalation kind 'dependency_escalation' cannot be resolved/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves overlapping escalation claims by registry precedence, not caller order', () => {
    const dir = fixture({
      ...COMPLETE,
      maintainer: `${COMPLETE.maintainer}escalation_capabilities:\n  - dependency_escalation\n`,
    });
    try {
      const canonical = loadRoleCapabilities(dir);
      const shuffled = loadRoleCapabilities(dir, {
        roles: ['auditor', 'engineer', 'maintainer', 'orchestrator'],
      });
      assert.equal(canonical.escalationOwnerByKind.dependency_escalation, 'orchestrator');
      assert.equal(shuffled.escalationOwnerByKind.dependency_escalation, 'orchestrator');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires agent frontmatter identity to match the registry role ID', () => {
    const dir = fixture(COMPLETE);
    try {
      const path = join(dir, 'maintainer.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('name: maintainer', 'name: release-steward'), 'utf8');
      const result = loadRoleCapabilities(dir);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), /frontmatter name must equal roleId 'maintainer'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('models human authority as a boundary no role may claim', () => {
    const dir = fixture({
      ...COMPLETE,
      engineer: 'escalation_capabilities:\n  - human_authority_review\n',
    });
    try {
      const result = loadRoleCapabilities(dir);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('\n'), /unknown escalation capability 'human_authority_review'/);
      assert.equal(result.escalationOwnerByKind.human_authority_review, HUMAN_AUTHORITY_BOUNDARY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('memoizes bindings per directory instead of re-reading role Markdown', () => {
    const first = getProjectRoleCapabilities(REPO_ROOT);
    const second = getProjectRoleCapabilities(REPO_ROOT);
    assert.equal(first, second);
  });

  it('uses bundled bindings with a migration warning for fully legacy installed roles', () => {
    const target = mkdtempSync(join(tmpdir(), 'al-legacy-capabilities-'));
    const agentsDir = join(target, 'agenticloop', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    for (const role of ['maintainer', 'orchestrator', 'engineer', 'auditor']) {
      writeFileSync(join(agentsDir, `${role}.md`), `---\nname: ${role}\n---\n\n# ${role}\n`, 'utf8');
    }
    try {
      const capabilities = getProjectRoleCapabilities(target);
      assert.match(capabilities.warnings.join('\n'), /predate capability bindings/);
      for (const kind of REPAIR_KINDS) assert.ok(capabilities.primaryOwnerByRepairKind[kind]);
      const validation = validateProjectRoleCapabilities(target);
      assert.deepEqual(validation.errors, []);
      assert.match(validation.warnings.join('\n'), /predate capability bindings/);
      assert.equal(validation.usingBundledFallback, true);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('fails validation for partial installed capability declarations', () => {
    const target = mkdtempSync(join(tmpdir(), 'al-partial-capabilities-'));
    const agentsDir = join(target, 'agenticloop', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    for (const role of ['maintainer', 'orchestrator', 'engineer', 'auditor']) {
      const declaration = role === 'maintainer'
        ? 'primary_repair_capabilities:\n  - repair_task_contract\n'
        : '';
      writeFileSync(join(agentsDir, `${role}.md`), `---\nname: ${role}\n${declaration}---\n\n# ${role}\n`, 'utf8');
    }
    try {
      const validation = validateProjectRoleCapabilities(target);
      assert.ok(validation.errors.length > 0);
      assert.equal(validation.warnings.length, 0);
      assert.throws(() => getProjectRoleCapabilities(target), /invalid role capability bindings/);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
