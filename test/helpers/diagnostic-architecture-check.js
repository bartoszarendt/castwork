/**
 * AST-based diagnostic-architecture enforcement, built on the TypeScript
 * compiler API. Evaluators report diagnostic facts only; role routing exists
 * solely in approved presentation modules. This checker rejects:
 *
 * 1. Diagnostic-shaped object literals with routing fields (owner,
 *    escalationOwner, ownerRouting, nextAction, firstSafeRepair) outside
 *    approved presentation modules.
 * 2. createDiagnostic calls that supply protected fields.
 * 3. Role-name prose concatenated into diagnostic messages.
 * 4. Diagnostic construction that bypasses the canonical fact constructor.
 * 5. Raw built-in errors thrown from public command modules instead of a
 *    classified PublicCommandError subtype.
 *
 * Legitimate non-diagnostic ownership fields (event roles, attribution
 * contracts, adapter generation) are unaffected: a literal is only
 * diagnostic-shaped when it also carries message/category/code/level shape.
 */

import { createRequire } from 'node:module';

// The classic TypeScript compiler API (installed as the `ts5` alias; the
// native `typescript` v7 package no longer exposes createSourceFile).
const ts = createRequire(import.meta.url)('ts5');

export const APPROVED_PRESENTATION_MODULES = new Set([
  'src/diagnostic-presentation.js',
  // Closeout reason packets are durable workflow contracts, not evaluator
  // diagnostics.
  'src/closeout.js',
]);

/** The canonical fact constructor module itself may build fact literals. */
export const CONSTRUCTOR_MODULES = new Set(['src/repair-policy.js']);

const ROUTING_FIELDS = new Set(['owner', 'escalationOwner', 'ownerRouting', 'nextAction', 'firstSafeRepair']);
const PROTECTED_CONSTRUCTOR_FIELDS = new Set(['category', 'repairKind', 'escalationKind', ...ROUTING_FIELDS]);
const DIAGNOSTIC_SHAPE_FIELDS = new Set(['message', 'category', 'code', 'level']);
const ROLE_WORDS_RE = /\b(?:orchestrator|maintainer|engineer|auditor)\b/i;

/**
 * Discover command-facing modules by following the binary's invoked imports,
 * then the static dispatch bindings they invoke. A dispatch lookup over a
 * literal handler map follows every handler; a lookup without a resolvable map
 * is reported rather than silently omitting that command surface.
 */
export function discoverPublicCommandModules(entries, binarySource) {
  const byPath = new Map(entries);
  const parse = (fileName, text) => ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const binary = parse('bin/agenticloop.js', binarySource);
  const sources = new Map([...byPath].map(([path, text]) => [path, parse(path, text)]));
  /** @type {{ from: string, specifier: string, resolved: string }[]} */
  const unresolvedImports = [];
  const resolveRelativeImport = (from, specifier) => {
    const parts = from.split('/').slice(0, -1);
    for (const part of specifier.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  };
  const bindingsFor = (source, from) => {
    const imports = new Map();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;
      const sibling = resolveRelativeImport(from, specifier);
      if (!byPath.has(sibling)) {
        unresolvedImports.push({ from, specifier, resolved: sibling });
        continue;
      }
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) imports.set(clause.name.text, { target: sibling, exported: 'default' });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) {
          imports.set(item.name.text, { target: sibling, exported: item.propertyName?.text ?? item.name.text });
        }
      }
    }
    return imports;
  };
  const exportsFor = source => {
    const exports = new Map();
    for (const statement of source.statements) {
      const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        exports.set(statement.name.text, statement.name.text);
      }
      if (exported && ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exports.set(declaration.name.text, declaration.name.text);
        }
      }
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) exports.set(item.name.text, item.propertyName?.text ?? item.name.text);
      }
    }
    return exports;
  };
  const moduleInfo = new Map([...sources].map(([path, source]) => [path, {
    source,
    imports: bindingsFor(source, path),
    exports: exportsFor(source),
  }]));
  const binaryImports = bindingsFor(binary, 'bin/agenticloop.js');
  const calledBinaryImports = new Set();
  const collectBinaryCalls = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && binaryImports.has(node.expression.text)) {
      calledBinaryImports.add(node.expression.text);
    }
    ts.forEachChild(node, collectBinaryCalls);
  };
  collectBinaryCalls(binary);
  const modules = new Set();
  /** @type {{ from: string, binding: string, reason: string }[]} */
  const unresolvedBindings = [];
  /** @type {{ target: string, exported: string }[]} */
  const pending = [];
  const visitedBindings = new Set();
  const enqueueImport = binding => pending.push(binding);
  for (const local of calledBinaryImports) enqueueImport(binaryImports.get(local));
  const localFunctions = source => {
    const functions = new Map();
    /** @type {Map<string, string[]>} */
    const handlerMaps = new Map();
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer &&
              (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            functions.set(declaration.name.text, declaration.initializer);
          }
          const object = ts.isIdentifier(declaration.name) && ts.isObjectLiteralExpression(declaration.initializer)
            ? declaration.initializer
            : null;
          if (object) {
            const handlers = object.properties
              .filter(ts.isPropertyAssignment)
              .map(property => property.initializer)
              .filter(ts.isIdentifier)
              .map(identifier => identifier.text);
            if (handlers.length > 0) handlerMaps.set(declaration.name.text, handlers);
          }
        }
      }
    }
    return { functions, handlerMaps };
  };
  while (pending.length > 0) {
    const { target, exported } = pending.pop();
    const info = moduleInfo.get(target);
    const local = info?.exports.get(exported);
    const key = `${target}:${exported}`;
    if (visitedBindings.has(key)) continue;
    visitedBindings.add(key);
    if (!info || !local) {
      unresolvedBindings.push({ from: target, binding: exported, reason: 'unresolved-export' });
      continue;
    }
    modules.add(target);
    const { functions, handlerMaps } = localFunctions(info.source);
    const visitBinding = (name, { handler = false } = {}) => {
      const imported = info.imports.get(name);
      if (imported && (handler || /^(?:run|dispatch|cmd)/.test(name))) enqueueImport(imported);
    };
    const visit = node => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) visitBinding(node.expression.text);
        if (ts.isElementAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
          const handlers = handlerMaps.get(node.expression.expression.text);
          if (handlers) handlers.forEach(name => visitBinding(name, { handler: true }));
          else unresolvedBindings.push({
            from: target,
            binding: node.expression.getText(info.source),
            reason: 'dynamic-dispatch-lookup',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    const functionNode = functions.get(local);
    if (functionNode) visit(functionNode.body);
  }
  return {
    modules,
    unresolvedImports,
    unresolvedBindings,
  };
}

function propertyName(node) {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

function isCreateDiagnosticCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  return (ts.isIdentifier(expression) && expression.text === 'createDiagnostic') ||
    (ts.isPropertyAccessExpression(expression) && expression.name.text === 'createDiagnostic');
}

/**
 * Return stable diagnostic/error code literals from object-shaped constructor
 * inputs. This AST walk intentionally does not use a raw source regex: it
 * ignores prose, paths, and protocol names, and reports only a `code` property
 * whose value is a dotted diagnostic identifier. Callers use it to make a
 * missing registration at a runtime refusal site observable.
 */
export function collectDiagnosticEmissionSites(sourceText, fileName = 'fixture.js') {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const codes = [];
  const dynamic = [];
  const isCode = value => /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(value);
  const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const add = (node, code) => { if (isCode(code)) codes.push({ code, line: lineOf(node) }); };
  const emitterCodeParameters = new Map();
  const codeConstants = new Map();
  const codeProperties = new Map();
  const codeMaps = new Map();
  const codeSelections = new Map();
  const functionReturnCodes = new Map();
  const functionCodeSelections = new Map();
  const knownCodeEmitters = new Map([['FindingSet', 0]]);
  const isModuleLevel = node => node.parent?.parent?.parent === source;
  const isExplicitNull = node => node?.kind === ts.SyntaxKind.NullKeyword;
  const selection = (codes = [], hasUnresolved = false) => ({
    possibleCodes: [...new Set(codes)],
    hasUnresolved,
  });
  const mergeSelections = selections => selection(
    selections.flatMap(item => item.possibleCodes),
    selections.some(item => item.hasUnresolved),
  );
  const functionNameOf = node => {
    for (let current = node; current && current !== source; current = current.parent) {
      if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.text;
      if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
          ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
        return current.parent.name.text;
      }
    }
    return null;
  };
  const literalCode = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return isCode(node.text) ? node.text : null;
    if (ts.isIdentifier(node)) return codeConstants.get(node.text) ?? null;
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'code') return codeProperties.get(node.getText(source)) ?? null;
    return null;
  };
  const selectedCodes = node => {
    // An explicit null means this call deliberately emits no diagnostic. It is
    // neither a dynamically supplied code nor an unresolved diagnostic path.
    if (!node || isExplicitNull(node)) return selection();
    const literal = literalCode(node);
    if (literal) return selection([literal]);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return selection([], true);
    if (ts.isIdentifier(node)) {
      const signature = emitterCodeParameters.get(functionNameOf(node));
      if (signature?.parameterName === node.text) {
        return functionCodeSelections.get(functionNameOf(node)) ?? selection();
      }
      return codeSelections.get(node.text) ?? functionReturnCodes.get(node.text) ?? selection([], true);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) return functionReturnCodes.get(node.expression.text) ?? selection([], true);
    if (ts.isConditionalExpression(node)) {
      return mergeSelections([selectedCodes(node.whenTrue), selectedCodes(node.whenFalse)]);
    }
    if (ts.isBinaryExpression(node)) {
      return mergeSelections([selectedCodes(node.left), selectedCodes(node.right)]);
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) return codeMaps.get(node.expression.text) ?? selection([], true);
    return selection([], true);
  };
  const returnCodes = node => {
    const selected = [];
    const visitReturn = child => {
      if (ts.isReturnStatement(child) && child.expression) selected.push(selectedCodes(child.expression));
      else if (!ts.isFunctionLike(child) || child === node) ts.forEachChild(child, visitReturn);
    };
    ts.forEachChild(node.body, visitReturn);
    return mergeSelections(selected);
  };
  const collectEmitterSignature = node => {
    const codeParameter = parameters => {
      const direct = parameters.findIndex(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === 'code');
      if (direct >= 0) return { index: direct, parameterName: 'code', propertyName: null, initializer: parameters[direct].initializer };
      const objectIndex = parameters.findIndex(parameter => ts.isObjectBindingPattern(parameter.name) &&
        parameter.name.elements.some(element => element.propertyName?.getText(source) === 'code' || element.name.getText(source) === 'code'));
      if (objectIndex < 0) return null;
      const element = parameters[objectIndex].name.elements.find(item =>
        item.propertyName?.getText(source) === 'code' || item.name.getText(source) === 'code');
      return {
        index: objectIndex,
        parameterName: element.name.getText(source),
        propertyName: 'code',
        initializer: element.initializer,
      };
    };
    const register = (name, parameters, body) => {
      if (body) functionReturnCodes.set(name, returnCodes({ body }));
      const code = codeParameter(parameters);
      if (!code) return;
      emitterCodeParameters.set(name, {
        ...code,
        defaultCode: code.initializer ? literalCode(code.initializer) : null,
      });
    };
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && node.name) {
      register(node.name.text, node.parameters, node.body);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      register(node.name.text, node.initializer.parameters, node.initializer.body);
    }
    if (ts.isVariableDeclaration(node) && isModuleLevel(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) && isCode(node.initializer.text)) {
      codeConstants.set(node.name.text, node.initializer.text);
    }
    const objectInitializer = ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)
      ? node.initializer
      : ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
          ts.isPropertyAccessExpression(node.initializer.expression) && node.initializer.expression.getText(source) === 'Object.freeze' &&
          ts.isObjectLiteralExpression(node.initializer.arguments[0])
        ? node.initializer.arguments[0]
        : null;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && objectInitializer) {
      const selections = objectInitializer.properties
        .filter(property => ts.isPropertyAssignment(property) && property.initializer)
        .map(property => selectedCodes(property.initializer));
      if (selections.length > 0) codeMaps.set(node.name.text, mergeSelections(selections));
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isConditionalExpression(node.initializer) || ts.isBinaryExpression(node.initializer) ||
          ts.isElementAccessExpression(node.initializer) || isExplicitNull(node.initializer))) {
      const selections = selectedCodes(node.initializer);
      codeSelections.set(node.name.text, selections);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'code' &&
        (ts.isStringLiteral(node.right) || ts.isNoSubstitutionTemplateLiteral(node.right)) && isCode(node.right.text)) {
      codeProperties.set(node.left.getText(source), node.right.text);
    }
    ts.forEachChild(node, collectEmitterSignature);
  };
  collectEmitterSignature(source);
  // Revisit maps after all module constants and return selections are known;
  // a map may be declared before a constant or helper it references.
  const refreshCodeMaps = node => {
    const objectInitializer = ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)
      ? node.initializer
      : ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
          ts.isPropertyAccessExpression(node.initializer.expression) && node.initializer.expression.getText(source) === 'Object.freeze' &&
          ts.isObjectLiteralExpression(node.initializer.arguments[0])
        ? node.initializer.arguments[0]
        : null;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && objectInitializer) {
      const selections = objectInitializer.properties
        .filter(property => ts.isPropertyAssignment(property) && property.initializer)
        .map(property => selectedCodes(property.initializer));
      if (selections.length > 0) codeMaps.set(node.name.text, mergeSelections(selections));
    }
    ts.forEachChild(node, refreshCodeMaps);
  };
  refreshCodeMaps(source);
  const codeArgument = (node, signature) => {
    const supplied = node.arguments[signature.index];
    if (!supplied) return { node: null, selected: signature.defaultCode ? selection([signature.defaultCode]) : selection() };
    if (!signature.propertyName) return { node: supplied, selected: selectedCodes(supplied) };
    if (!ts.isObjectLiteralExpression(supplied)) return { node: supplied, selected: selection([], true) };
    const property = supplied.properties.find(item => ts.isPropertyAssignment(item) && propertyName(item) === signature.propertyName);
    return property
      ? { node: property.initializer, selected: selectedCodes(property.initializer) }
      : { node: supplied, selected: signature.defaultCode ? selection([signature.defaultCode]) : selection() };
  };
  const collectFunctionCodeSelections = node => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
      const signature = emitterCodeParameters.get(node.expression.text);
      if (signature) {
        const found = codeArgument(node, signature).selected;
        if (found.possibleCodes.length > 0 || found.hasUnresolved) {
          const previous = functionCodeSelections.get(node.expression.text) ?? selection();
          functionCodeSelections.set(node.expression.text, mergeSelections([previous, found]));
        }
      }
    }
    ts.forEachChild(node, collectFunctionCodeSelections);
  };
  // Local diagnostic wrappers commonly forward code through one or more helper
  // parameters. Repeating the bounded source walk resolves those local chains
  // while preserving an unresolved branch at every hop.
  for (let pass = 0; pass < 4; pass += 1) collectFunctionCodeSelections(source);
  const addDynamic = (node, emitter, selected) => {
    if (selected.possibleCodes.length === 0 && !selected.hasUnresolved) return;
    dynamic.push({
      fileName,
      line: lineOf(node),
      emitter,
      possibleCodes: selected.possibleCodes,
      hasUnresolved: selected.hasUnresolved,
    });
  };
  const recordSelection = (node, emitter, { dynamic = false } = {}) => {
    const selected = selectedCodes(node);
    for (const code of selected.possibleCodes) add(node, code);
    if (dynamic) addDynamic(node, emitter, selected);
  };
  const isTypedErrorClass = node => {
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) return false;
    const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword);
    const base = heritage?.types[0]?.expression;
    const name = ts.isIdentifier(base) ? base.text : ts.isPropertyAccessExpression(base) ? base.name.text : '';
    return /Error$/.test(name);
  };
  const typedErrorClassOf = node => {
    for (let current = node.parent; current && current !== source; current = current.parent) {
      if ((ts.isClassDeclaration(current) || ts.isClassExpression(current)) && isTypedErrorClass(current)) return current;
    }
    return null;
  };
  const isCodeAssignment = node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword && node.left.name.text === 'code';
  const isCodeField = node => ts.isPropertyDeclaration(node) && propertyName(node) === 'code' && node.initializer;
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && ts.isCallExpression(node.parent) &&
        node.parent.arguments[0] === node && isCreateDiagnosticCall(node.parent)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property) === 'code') {
          recordSelection(property.initializer, 'createDiagnostic code property', {
            dynamic: !literalCode(property.initializer) && !isExplicitNull(property.initializer),
          });
        }
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'code') {
          recordSelection(property.name, 'createDiagnostic code property', { dynamic: true });
        }
      }
    }
    // Preserve the existing wrapper coverage: local helpers may first build a
    // code-shaped object and pass it through to the canonical constructor.
    // Direct constructor inputs use the broader selection analysis above.
    if (ts.isObjectLiteralExpression(node) &&
        !(ts.isCallExpression(node.parent) && node.parent.arguments[0] === node && isCreateDiagnosticCall(node.parent))) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property) === 'code') {
          if (ts.isStringLiteral(property.initializer)) add(property.initializer, property.initializer.text);
          if (ts.isIdentifier(property.initializer) && codeConstants.has(property.initializer.text)) {
            add(property.initializer, codeConstants.get(property.initializer.text));
          }
          if (ts.isIdentifier(property.initializer) && codeSelections.has(property.initializer.text)) {
            addDynamic(property.initializer, 'object code property', codeSelections.get(property.initializer.text));
          }
        }
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'code' && codeSelections.has('code')) {
          addDynamic(property, 'object code property', codeSelections.get('code'));
        }
      }
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
      const signature = emitterCodeParameters.get(node.expression.text);
      const index = signature?.index ?? knownCodeEmitters.get(node.expression.text);
      const supplied = signature ? codeArgument(node, signature) : { node: index === undefined ? null : node.arguments[index], selected: null };
      const argument = supplied.node;
      const resolved = argument ? literalCode(argument) : signature?.defaultCode ?? supplied.selected?.possibleCodes?.[0] ?? null;
      if (resolved) add(argument ?? node, resolved);
      else if (argument && index !== undefined && !isExplicitNull(argument)) {
        addDynamic(argument, node.expression.text, supplied.selected ?? selectedCodes(argument));
      }
    }
    if ((isCodeAssignment(node) || isCodeField(node)) && typedErrorClassOf(node)) {
      const value = isCodeAssignment(node) ? node.right : node.initializer;
      recordSelection(value, 'typed error code field', {
        dynamic: !literalCode(value) && !isExplicitNull(value),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { codes, dynamic };
}

export function collectDiagnosticCodeLiterals(sourceText, fileName = 'fixture.js') {
  return collectDiagnosticEmissionSites(sourceText, fileName).codes;
}

/** String content of a message-ish expression, if it is composed from parts. */
function composedStringHasRoleProse(node) {
  if (!node) return false;
  if (ts.isTemplateExpression(node)) {
    return ROLE_WORDS_RE.test(node.head.text) || node.templateSpans.some(span => ROLE_WORDS_RE.test(span.literal.text));
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const textOf = side => (ts.isStringLiteral(side) || ts.isNoSubstitutionTemplateLiteral(side) ? side.text : '');
    return ROLE_WORDS_RE.test(textOf(node.left)) || ROLE_WORDS_RE.test(textOf(node.right)) ||
      composedStringHasRoleProse(node.left) || composedStringHasRoleProse(node.right);
  }
  return false;
}

/**
 * Inspect one source file and return a list of violations:
 * `{ rule, line, detail }`.
 */
export function checkDiagnosticArchitecture(sourceText, {
  fileName = 'fixture.js',
  presentation = false,
  constructorModule = false,
  publicCommandModule = false,
} = {}) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const violations = [];
  const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literalFields = node => new Set(node.properties.map(propertyName).filter(Boolean));

  const visit = node => {
    if (publicCommandModule && ts.isThrowStatement(node) && ts.isNewExpression(node.expression)) {
      const thrownType = ts.isIdentifier(node.expression.expression) ? node.expression.expression.text : null;
      if (['Error', 'TypeError', 'RangeError'].includes(thrownType)) {
        violations.push({
          rule: 'untyped-public-command-error',
          line: lineOf(node),
          detail: `public command throws raw ${thrownType}; use CliUsageError or a PublicCommandError subtype`,
        });
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const fields = literalFields(node);
      const routing = [...fields].filter(field => ROUTING_FIELDS.has(field));
      const shape = [...fields].filter(field => DIAGNOSTIC_SHAPE_FIELDS.has(field));
      if (!presentation && routing.length > 0 && shape.length > 0) {
        violations.push({
          rule: 'routing-fields-in-diagnostic',
          line: lineOf(node),
          detail: `diagnostic-shaped literal carries routing field(s): ${routing.join(', ')}`,
        });
      }
      if (!presentation && !constructorModule && routing.length === 0 && fields.has('code') && fields.has('message') &&
        (fields.has('level') || fields.has('category') || fields.has('repairKind'))) {
        const parent = node.parent;
        const isConstructorArg = ts.isCallExpression(parent) && isCreateDiagnosticCall(parent) && parent.arguments[0] === node;
        if (!isConstructorArg) {
          violations.push({
            rule: 'non-canonical-diagnostic-construction',
            line: lineOf(node),
            detail: 'diagnostic fact literal bypasses createDiagnostic',
          });
        }
      }
      if (!presentation) {
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyName(property);
          if ((name === 'message' || name === 'warning') && composedStringHasRoleProse(property.initializer) &&
            (fields.has('code') || fields.has('category') || fields.has('level'))) {
            violations.push({
              rule: 'role-prose-in-diagnostic-message',
              line: lineOf(property),
              detail: `role-name prose concatenated into diagnostic '${name}'`,
            });
          }
        }
      }
    }
    if (!presentation && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      /message|warning|diagnostic/i.test(node.name.text) && composedStringHasRoleProse(node.initializer)) {
      violations.push({
        rule: 'role-prose-in-diagnostic-message',
        line: lineOf(node),
        detail: `role-name prose concatenated into '${node.name.text}'`,
      });
    }
    if (isCreateDiagnosticCall(node)) {
      const [argument] = node.arguments;
      if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          const name = propertyName(property);
          if (name && PROTECTED_CONSTRUCTOR_FIELDS.has(name)) {
            violations.push({
              rule: 'protected-field-to-constructor',
              line: lineOf(property),
              detail: `createDiagnostic argument supplies protected field '${name}'`,
            });
          }
          if (name === 'message' && ts.isPropertyAssignment(property) && composedStringHasRoleProse(property.initializer)) {
            violations.push({
              rule: 'role-prose-in-diagnostic-message',
              line: lineOf(property),
              detail: 'role-name prose concatenated into a createDiagnostic message',
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}
