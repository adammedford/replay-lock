import ts from "typescript";
import { typescriptScriptKind } from "./typescript-script-kind.js";

export const EFFECT_ANALYZER_VERSION = "1" as const;

/**
 * Version the allow-list independently from the implementation.  An
 * assumption is evidence about the analyzer's current decision surface, so a
 * catalog edit must make previously reviewed assumptions stale even when the
 * analyzer's code version was not otherwise changed.
 */
export const INTRINSIC_CATALOG_VERSION = "1" as const;

export const DETERMINISTIC_INTRINSICS: ReadonlySet<string> = new Set([
  "Array.isArray",
  "Math.abs", "Math.acos", "Math.acosh", "Math.asin", "Math.asinh", "Math.atan", "Math.atan2",
  "Math.atanh", "Math.cbrt", "Math.ceil", "Math.clz32", "Math.cos", "Math.cosh", "Math.exp",
  "Math.expm1", "Math.floor", "Math.fround", "Math.hypot", "Math.imul", "Math.log", "Math.log10",
  "Math.log1p", "Math.log2", "Math.max", "Math.min", "Math.pow", "Math.round", "Math.sign",
  "Math.sin", "Math.sinh", "Math.sqrt", "Math.tan", "Math.tanh", "Math.trunc",
  "Number.isFinite", "Number.isInteger", "Number.isNaN", "Number.isSafeInteger",
  "Number.parseFloat", "Number.parseInt", "Object.is", "String.fromCharCode", "String.fromCodePoint",
]);

export type DirectEffectReasonCode =
  | "ARGUMENT_MUTATION"
  | "RECEIVER_DEPENDENCE"
  | "AMBIENT_MUTATION"
  | "CLOCK_ACCESS"
  | "RANDOMNESS"
  | "IO"
  | "ENVIRONMENT_DEPENDENCE"
  | "LOCALE_DEPENDENCE"
  | "LOGGING"
  | "DYNAMIC_EVALUATION"
  | "EFFECTFUL_INITIALIZATION";

export interface EffectSourceLocation {
  source: string;
  line: number;
  column: number;
}

export interface DirectEffectFinding extends EffectSourceLocation {
  code: DirectEffectReasonCode;
  message: string;
}

export type DirectEffectAnalysis =
  | {
      verdict: "likely-safe";
      analyzerVersion: typeof EFFECT_ANALYZER_VERSION;
      findings: readonly DirectEffectFinding[];
    }
  | {
      verdict: "refuted";
      analyzerVersion: typeof EFFECT_ANALYZER_VERSION;
      findings: readonly DirectEffectFinding[];
    };

export interface AnalyzeDirectEffectsOptions {
  source: string;
  sourceFile: ts.SourceFile;
  callable: ts.FunctionLikeDeclaration;
}

/**
 * Reports only effects established directly by authored syntax. Calls that are
 * not in the intrinsic/effect catalogs are deliberately left for the
 * transitive analyzer rather than guessed safe or effectful here.
 */
export function analyzeDirectEffects({
  source,
  sourceFile,
  callable,
}: AnalyzeDirectEffectsOptions): DirectEffectAnalysis {
  const findings: DirectEffectFinding[] = [];
  const parameters = collectBindingNames(callable.parameters.map((parameter) => parameter.name));
  const localBindings = collectCallableBindings(callable);
  const moduleBindings = collectModuleBindings(sourceFile);
  const parameterAliases = collectAliases(callable, parameters);
  const ambientAliases = collectAliases(callable, moduleBindings);
  const freshLocals = collectFreshLiteralBindings(callable);
  const primitiveParameterPaths = collectPrimitiveParameterPaths(callable);
  const freshExternalLocals = collectFreshExternalBindings(callable, parameters, parameterAliases, primitiveParameterPaths);
  const knownEffectAliases = collectKnownEffectAliases(callable, sourceFile);
  const ambientReadAliases = collectAmbientReadAliases(callable, sourceFile);

  const report = (code: DirectEffectReasonCode, node: ts.Node, message: string): void => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ code, source, line: start.line + 1, column: start.character + 1, message });
  };

  for (const initialization of effectfulModuleInitializations(sourceFile)) {
    report(
      "EFFECTFUL_INITIALIZATION",
      initialization,
      "module initialization executes an effect before the callable is invoked",
    );
  }

  const visit = (node: ts.Node): void => {
    if (node !== callable && isFunctionLike(node)) return;
    if (node !== callable && (ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
      visitClassRuntime(node, visit);
      return;
    }

    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      report("RECEIVER_DEPENDENCE", node, "callable depends on receiver state");
    }

    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      classifyWrite(node.left, node, parameters, parameterAliases, ambientAliases, localBindings, freshLocals, freshExternalLocals, moduleBindings, report);
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        classifyWrite(node.operand, node, parameters, parameterAliases, ambientAliases, localBindings, freshLocals, freshExternalLocals, moduleBindings, report);
      }
    } else if (ts.isDeleteExpression(node)) {
      classifyWrite(node.expression, node, parameters, parameterAliases, ambientAliases, localBindings, freshLocals, freshExternalLocals, moduleBindings, report);
    } else if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      if (!ts.isVariableDeclarationList(node.initializer)) {
        classifyWrite(node.initializer, node, parameters, parameterAliases, ambientAliases, localBindings, freshLocals, freshExternalLocals, moduleBindings, report);
      }
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      classifyInvocation(
        node,
        parameters,
        parameterAliases,
        ambientAliases,
        localBindings,
        freshLocals,
        freshExternalLocals,
        moduleBindings,
        knownEffectAliases,
        report,
      );
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      classifyAmbientRead(node, ambientReadAliases, report);
    }

    ts.forEachChild(node, visit);
  };

  for (const parameter of callable.parameters) visit(parameter);
  if (callable.body) visit(callable.body);

  const stableFindings = deduplicateAndSort(findings);
  if (stableFindings.length === 0) {
    return Object.freeze({
      verdict: "likely-safe",
      analyzerVersion: EFFECT_ANALYZER_VERSION,
      findings: Object.freeze([]),
    });
  }
  return Object.freeze({
    verdict: "refuted",
    analyzerVersion: EFFECT_ANALYZER_VERSION,
    findings: Object.freeze(stableFindings.map((finding) => Object.freeze(finding))),
  });
}

function visitClassRuntime(node: ts.ClassDeclaration | ts.ClassExpression, visit: (node: ts.Node) => void): void {
  if (node.heritageClauses) {
    for (const heritage of node.heritageClauses) visit(heritage);
  }
  for (const member of node.members) {
    if (ts.isClassStaticBlockDeclaration(member)) visit(member);
    else if (ts.isPropertyDeclaration(member)) {
      if (member.name && ts.isComputedPropertyName(member.name)) visit(member.name.expression);
      if (hasStaticModifier(member) && member.initializer) visit(member.initializer);
    } else if (member.name && ts.isComputedPropertyName(member.name)) {
      visit(member.name.expression);
    }
  }
}

export function findExportedCallable(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.FunctionLikeDeclaration | undefined {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === exportName &&
      hasExportModifier(statement)
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === exportName &&
          declaration.initializer &&
          (ts.isFunctionExpression(declaration.initializer) || ts.isArrowFunction(declaration.initializer))
        ) {
          return declaration.initializer;
        }
      }
    }
  }
  return undefined;
}

export function parseAndAnalyzeDirectEffects(
  sourceText: string,
  source: string,
  exportName: string,
): DirectEffectAnalysis {
  const sourceFile = ts.createSourceFile(source, sourceText, ts.ScriptTarget.Latest, true, typescriptScriptKind(source));
  const callable = findExportedCallable(sourceFile, exportName);
  if (!callable) throw new Error(`Exported callable ${JSON.stringify(exportName)} was not found`);
  return analyzeDirectEffects({ source, sourceFile, callable });
}

/**
 * Analyze the executable portion of a module which runs before its exports
 * can be invoked.  The call-graph analyzer uses this for imported modules
 * that do not expose a callable of their own.  Initialization is deliberately
 * fail-closed: an authored call, assignment, await, yield, or delete is
 * evidence that the module is not a passive value declaration.
 */
export function analyzeModuleInitialization({
  source,
  sourceFile,
}: {
  source: string;
  sourceFile: ts.SourceFile;
}): DirectEffectAnalysis {
  const findings: DirectEffectFinding[] = [];
  for (const initialization of effectfulModuleInitializations(sourceFile)) {
    const start = sourceFile.getLineAndCharacterOfPosition(initialization.getStart(sourceFile));
    findings.push({
      code: "EFFECTFUL_INITIALIZATION",
      source,
      line: start.line + 1,
      column: start.character + 1,
      message: "module initialization executes an effect before a callable is invoked",
    });
  }
  const stableFindings = deduplicateAndSort(findings);
  return stableFindings.length === 0
    ? Object.freeze({ verdict: "likely-safe", analyzerVersion: EFFECT_ANALYZER_VERSION, findings: Object.freeze([]) })
    : Object.freeze({
        verdict: "refuted",
        analyzerVersion: EFFECT_ANALYZER_VERSION,
        findings: Object.freeze(stableFindings.map((finding) => Object.freeze(finding))),
      });
}

function classifyWrite(
  target: ts.Expression,
  evidenceNode: ts.Node,
  parameters: ReadonlySet<string>,
  parameterAliases: ReadonlySet<string>,
  ambientAliases: ReadonlySet<string>,
  localBindings: ReadonlySet<string>,
  freshLocals: ReadonlySet<string>,
  freshExternalLocals: ReadonlySet<string>,
  moduleBindings: ReadonlySet<string>,
  report: (code: DirectEffectReasonCode, node: ts.Node, message: string) => void,
): void {
  const root = rootIdentifier(target);
  if (!root) {
    for (const nestedTarget of destructuringWriteTargets(target)) {
      classifyWrite(
        nestedTarget,
        evidenceNode,
        parameters,
        parameterAliases,
        ambientAliases,
        localBindings,
        freshLocals,
        freshExternalLocals,
        moduleBindings,
        report,
      );
    }
    if (containsThis(target)) report("RECEIVER_DEPENDENCE", evidenceNode, "callable mutates receiver state");
    else if (containsSuper(target)) report("RECEIVER_DEPENDENCE", evidenceNode, "callable mutates receiver state");
    return;
  }
  if (root === "this" || containsSuper(target)) {
    report("RECEIVER_DEPENDENCE", evidenceNode, "callable mutates receiver state");
    return;
  }
  if (parameters.has(root) || parameterAliases.has(root)) {
    if (!ts.isIdentifier(target)) {
      report("ARGUMENT_MUTATION", evidenceNode, `callable mutates argument ${JSON.stringify(root)}`);
    }
    return;
  }
  if (freshLocals.has(root)) {
    if (freshExternalLocals.has(root) && propertyDepth(target) > 1) {
      report("ARGUMENT_MUTATION", evidenceNode, `callable mutates argument reachable through ${JSON.stringify(root)}`);
    }
    return;
  }
  if (moduleBindings.has(root) || ambientAliases.has(root) || !localBindings.has(root)) {
    report("AMBIENT_MUTATION", evidenceNode, `callable mutates ambient binding ${JSON.stringify(root)}`);
  }
}

function destructuringWriteTargets(target: ts.Expression): ts.Expression[] {
  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.flatMap((element) =>
      ts.isSpreadElement(element) ? destructuringWriteTargets(element.expression) : [element],
    );
  }
  if (ts.isObjectLiteralExpression(target)) {
    const targets: ts.Expression[] = [];
    for (const property of target.properties) {
      if (ts.isPropertyAssignment(property)) targets.push(property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) targets.push(property.name);
      else if (ts.isSpreadAssignment(property)) targets.push(property.expression);
    }
    return targets;
  }
  return [];
}

function classifyInvocation(
  node: ts.CallExpression | ts.NewExpression,
  parameters: ReadonlySet<string>,
  parameterAliases: ReadonlySet<string>,
  ambientAliases: ReadonlySet<string>,
  localBindings: ReadonlySet<string>,
  freshLocals: ReadonlySet<string>,
  freshExternalLocals: ReadonlySet<string>,
  moduleBindings: ReadonlySet<string>,
  knownEffectAliases: ReadonlyMap<string, DirectEffectReasonCode>,
  report: (code: DirectEffectReasonCode, node: ts.Node, message: string) => void,
): void {
  const callee = node.expression;
  const name = expressionPath(callee);
  const root = rootIdentifier(callee);
  const directEffect =
    (callee.kind === ts.SyntaxKind.ImportKeyword ? "DYNAMIC_EVALUATION" : undefined) ??
    classifyKnownInvocation(name) ??
    (ts.isIdentifier(callee) ? knownEffectAliases.get(callee.text) : undefined);

  const firstArgument = node.arguments?.[0];
  if (
    firstArgument &&
    isDirectMutationApi(name, callee)
  ) {
    const targetRoot = rootIdentifier(firstArgument);
    if (targetRoot && (parameters.has(targetRoot) || parameterAliases.has(targetRoot))) {
      report("ARGUMENT_MUTATION", callee, `callable mutates argument ${JSON.stringify(targetRoot)}`);
      return;
    }
    if (targetRoot === "this" || containsSuper(firstArgument)) {
      report("RECEIVER_DEPENDENCE", callee, "callable mutates receiver state");
      return;
    }
    if (targetRoot && (moduleBindings.has(targetRoot) || ambientAliases.has(targetRoot) || !localBindings.has(targetRoot))) {
      report("AMBIENT_MUTATION", callee, `callable mutates ambient binding ${JSON.stringify(targetRoot)}`);
      return;
    }
  }

  if (directEffect === "DYNAMIC_EVALUATION") {
    report("DYNAMIC_EVALUATION", callee, "callable performs dynamic code evaluation");
    return;
  }
  if (directEffect === "CLOCK_ACCESS") {
    report("CLOCK_ACCESS", callee, "callable reads an ambient clock");
    return;
  }
  if (directEffect === "RANDOMNESS") {
    report("RANDOMNESS", callee, "callable obtains ambient randomness");
    return;
  }
  if (directEffect === "LOGGING") {
    report("LOGGING", callee, "callable writes to a logging sink");
    return;
  }
  if (directEffect === "IO") {
    report("IO", callee, "callable performs input/output");
    return;
  }
  if (directEffect === "LOCALE_DEPENDENCE") {
    report("LOCALE_DEPENDENCE", callee, "callable depends on ambient locale data");
    return;
  }

  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    if (root && (parameters.has(root) || parameterAliases.has(root)) && isMutatingMethod(propertyName(callee))) {
      report("ARGUMENT_MUTATION", callee, `callable mutates argument ${JSON.stringify(root)}`);
    } else if (root === "this") {
      report("RECEIVER_DEPENDENCE", callee, "callable invokes a receiver operation");
    } else if (root && (moduleBindings.has(root) || ambientAliases.has(root) || !localBindings.has(root)) && isMutatingMethod(propertyName(callee))) {
      report("AMBIENT_MUTATION", callee, `callable mutates ambient binding ${JSON.stringify(root)}`);
    } else if (root && freshExternalLocals.has(root) && propertyDepth(callee) > 1 && isMutatingMethod(propertyName(callee))) {
      report("ARGUMENT_MUTATION", callee, `callable mutates argument reachable through ${JSON.stringify(root)}`);
    } else if (root && freshLocals.has(root) && isMutatingMethod(propertyName(callee))) {
      // Mutation is confined to a fresh literal allocated during this invocation.
    }
  }
}

function classifyAmbientRead(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  ambientReadAliases: ReadonlySet<string>,
  report: (code: DirectEffectReasonCode, node: ts.Node, message: string) => void,
): void {
  const name = expressionPath(node);
  const root = rootIdentifier(node);
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node &&
    isAmbientReadPath(expressionPath(parent))
  ) return;
  if (isProcessEnvironmentPath(name) || (root && ambientReadAliases.has(root))) {
    report("ENVIRONMENT_DEPENDENCE", node, "callable reads the process environment");
  } else if (name === "import.meta.env" || name?.startsWith("import.meta.env.")) {
    report("ENVIRONMENT_DEPENDENCE", node, "callable reads the build environment");
  } else if (name === "navigator.language" || name === "navigator.languages" || name?.startsWith("navigator.language.") || name?.startsWith("navigator.languages.")) {
    report("LOCALE_DEPENDENCE", node, "callable reads the ambient locale");
  }
}

function isAmbientReadPath(name: string | undefined): boolean {
  return isEnvironmentReadPath(name) || name === "navigator.language" || name === "navigator.languages" || !!name?.startsWith("navigator.language.") || !!name?.startsWith("navigator.languages.");
}

function isEnvironmentReadPath(name: string | undefined): boolean {
  return isProcessEnvironmentPath(name) || !!name?.startsWith("import.meta.env.") || name === "import.meta.env";
}

function isProcessEnvironmentPath(name: string | undefined): boolean {
  return name === "process.env" || !!name?.startsWith("process.env.") || name === "Deno.env" || !!name?.startsWith("Deno.env.");
}

function effectfulModuleInitializations(sourceFile: ts.SourceFile): ts.Node[] {
  const effects: ts.Node[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
    visitInitializationNode(statement, effects);
  }
  return effects;
}

function visitInitializationNode(node: ts.Node, effects: ts.Node[]): void {
  if (isFunctionLike(node)) return;
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    for (const member of node.members) {
      if (ts.isClassStaticBlockDeclaration(member)) visitInitializationNode(member, effects);
      else if (ts.isPropertyDeclaration(member) && hasStaticModifier(member) && member.initializer) {
        visitInitializationNode(member.initializer, effects);
      }
    }
    return;
  }
  if (isInitializationEffect(node)) {
    effects.push(node);
    return;
  }
  ts.forEachChild(node, (child) => visitInitializationNode(child, effects));
}

function isInitializationEffect(node: ts.Node): boolean {
  if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && !isDeterministicIntrinsicInvocation(node)) return true;
  return (
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isDeleteExpression(node) ||
    ts.isPostfixUnaryExpression(node) ||
    (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) ||
    (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind))
  );
}

function isDeterministicIntrinsicInvocation(node: ts.CallExpression | ts.NewExpression): boolean {
  const name = expressionPath(node.expression);
  return name !== undefined && DETERMINISTIC_INTRINSICS.has(name);
}

function collectCallableBindings(callable: ts.FunctionLikeDeclaration): Set<string> {
  const bindings = collectBindingNames(callable.parameters.map((parameter) => parameter.name));
  const visit = (node: ts.Node): void => {
    if (node !== callable && isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node)) addBindingNames(node.name, bindings);
    else if (ts.isFunctionDeclaration(node) && node.name) bindings.add(node.name.text);
    else if (ts.isClassDeclaration(node) && node.name) bindings.add(node.name.text);
    else if (ts.isCatchClause(node) && node.variableDeclaration) addBindingNames(node.variableDeclaration.name, bindings);
    ts.forEachChild(node, visit);
  };
  if (callable.body) visit(callable.body);
  return bindings;
}

function collectFreshLiteralBindings(callable: ts.FunctionLikeDeclaration): Set<string> {
  const fresh = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== callable && isFunctionLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrayLiteralExpression(node.initializer) || ts.isObjectLiteralExpression(node.initializer))
    ) {
      fresh.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  if (callable.body) visit(callable.body);
  return fresh;
}

function collectFreshExternalBindings(
  callable: ts.FunctionLikeDeclaration,
  parameters: ReadonlySet<string>,
  parameterAliases: ReadonlySet<string>,
  primitiveParameterPaths: ReadonlySet<string>,
): Set<string> {
  const external = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== callable && isFunctionLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrayLiteralExpression(node.initializer) || ts.isObjectLiteralExpression(node.initializer))
    ) {
      let referencesParameter = false;
      const inspect = (child: ts.Node): void => {
        if (referencesParameter || (child !== node.initializer && isFunctionLike(child))) return;
        if (
          ts.isIdentifier(child) &&
          (parameters.has(child.text) || parameterAliases.has(child.text)) &&
          !isPrimitiveParameterRead(child, primitiveParameterPaths)
        ) {
          referencesParameter = true;
          return;
        }
        ts.forEachChild(child, inspect);
      };
      inspect(node.initializer);
      if (referencesParameter) external.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  if (callable.body) visit(callable.body);
  return external;
}

function collectPrimitiveParameterPaths(callable: ts.FunctionLikeDeclaration): Set<string> {
  const paths = new Set<string>();
  for (const parameter of callable.parameters) {
    if (!ts.isIdentifier(parameter.name) || !parameter.type) continue;
    if (isPrimitiveType(parameter.type)) {
      paths.add(parameter.name.text);
      continue;
    }
    if (!ts.isTypeLiteralNode(parameter.type)) continue;
    for (const member of parameter.type.members) {
      if (!ts.isPropertySignature(member) || !member.name || !member.type || !isPrimitiveType(member.type)) continue;
      const property = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)
        ? member.name.text
        : undefined;
      if (property !== undefined) paths.add(`${parameter.name.text}.${property}`);
    }
  }
  return paths;
}

function isPrimitiveType(type: ts.TypeNode): boolean {
  if (
    type.kind === ts.SyntaxKind.StringKeyword ||
    type.kind === ts.SyntaxKind.NumberKeyword ||
    type.kind === ts.SyntaxKind.BooleanKeyword ||
    type.kind === ts.SyntaxKind.BigIntKeyword ||
    type.kind === ts.SyntaxKind.NullKeyword ||
    type.kind === ts.SyntaxKind.UndefinedKeyword ||
    ts.isLiteralTypeNode(type)
  ) return true;
  return ts.isUnionTypeNode(type) && type.types.every(isPrimitiveType);
}

function isPrimitiveParameterRead(identifier: ts.Identifier, primitivePaths: ReadonlySet<string>): boolean {
  if (primitivePaths.has(identifier.text)) return true;
  const parent = identifier.parent;
  if (!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent)) return false;
  const path = expressionPath(parent);
  if (!path) return false;
  for (const primitivePath of primitivePaths) {
    if (path === primitivePath || path.startsWith(`${primitivePath}.`)) return true;
  }
  return false;
}

function collectAliases(callable: ts.FunctionLikeDeclaration, origins: ReadonlySet<string>): Set<string> {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (node !== callable && isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const root = rootIdentifier(node.initializer);
        if (root && (origins.has(root) || aliases.has(root)) && !aliases.has(node.name.text)) {
          aliases.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    if (callable.body) visit(callable.body);
  }
  return aliases;
}

function collectModuleBindings(sourceFile: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) addBindingNames(declaration.name, bindings);
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      bindings.add(statement.name.text);
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      if (statement.importClause.name) bindings.add(statement.importClause.name.text);
      const named = statement.importClause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.add(named.name.text);
      else if (named) for (const element of named.elements) bindings.add(element.name.text);
    }
  }
  return bindings;
}

function collectBindingNames(names: readonly ts.BindingName[]): Set<string> {
  const result = new Set<string>();
  for (const name of names) addBindingNames(name, result);
  return result;
}

function addBindingNames(name: ts.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) target.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBindingNames(element.name, target);
}

function rootIdentifier(expression: ts.Expression): string | undefined {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) return current.text;
  if (current.kind === ts.SyntaxKind.ThisKeyword) return "this";
  return undefined;
}

function propertyDepth(expression: ts.Expression): number {
  let depth = 0;
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    depth += 1;
    current = current.expression;
  }
  return depth;
}

function containsThis(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (child.kind === ts.SyntaxKind.ThisKeyword) found = true;
    else if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function containsSuper(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (child.kind === ts.SyntaxKind.SuperKeyword) found = true;
    else if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function expressionPath(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isMetaProperty(expression)) return `${expression.keywordToken === ts.SyntaxKind.ImportKeyword ? "import" : "new"}.${expression.name.text}`;
  if (ts.isPropertyAccessExpression(expression)) {
    const base = expressionPath(expression.expression);
    return base ? `${base}.${expression.name.text}` : undefined;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && (ts.isStringLiteral(expression.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))) {
    const base = expressionPath(expression.expression);
    return base ? `${base}.${expression.argumentExpression.text}` : undefined;
  }
  return undefined;
}

function propertyName(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? argument.text : undefined;
}

function isMutatingMethod(name: string | undefined): boolean {
  return name !== undefined && new Set(["copyWithin", "fill", "pop", "push", "reverse", "set", "shift", "sort", "splice", "unshift", "add", "clear", "delete"]).has(name);
}

function isDirectMutationApi(name: string | undefined, callee: ts.Expression): boolean {
  if (name === "Object.assign" || name === "Object.defineProperty" || name === "Object.defineProperties") return true;
  if (name === "Object.setPrototypeOf" || name === "Object.preventExtensions" || name === "Object.seal" || name === "Object.freeze") return true;
  if (name === "Reflect.set" || name === "Reflect.deleteProperty" || name === "Reflect.defineProperty") return true;
  return ts.isIdentifier(callee) && ["assign", "defineProperty", "defineProperties", "setPrototypeOf"].includes(callee.text);
}

function isLoggingCall(name: string | undefined): boolean {
  return name !== undefined && /^(console\.(?:debug|error|info|log|table|trace|warn)|process\.emitWarning)$/.test(name);
}

function isLocaleCall(name: string | undefined): boolean {
  return name !== undefined && (
    name.startsWith("Intl.") ||
    name === "Intl" ||
    /\.(?:localeCompare|toLocaleDateString|toLocaleString|toLocaleTimeString|toLocaleLowerCase|toLocaleUpperCase)$/.test(name)
  );
}

function classifyKnownInvocation(name: string | undefined): DirectEffectReasonCode | undefined {
  if (!name) return undefined;
  if (name === "eval" || name === "Function" || name === "globalThis.eval" || name === "globalThis.Function") {
    return "DYNAMIC_EVALUATION";
  }
  if (
    name === "Date" ||
    name === "Date.now" ||
    name === "performance.now" ||
    name === "process.hrtime" ||
    name === "process.hrtime.bigint" ||
    name.startsWith("Temporal.Now.")
  ) {
    return "CLOCK_ACCESS";
  }
  if (
    name === "Math.random" ||
    name === "crypto.randomUUID" ||
    name === "crypto.getRandomValues" ||
    name === "crypto.randomBytes" ||
    name === "randomUUID" ||
    name === "randomBytes"
  ) {
    return "RANDOMNESS";
  }
  if (isLoggingCall(name)) return "LOGGING";
  if (isIoName(name)) return "IO";
  if (isLocaleCall(name)) return "LOCALE_DEPENDENCE";
  return undefined;
}

function isIoName(name: string): boolean {
  if (["fetch", "XMLHttpRequest", "WebSocket", "require"].includes(name)) return true;
  if (/^(fs|fsPromises|node:fs|node:fs\/promises)\./.test(name)) return true;
  if (/^(process\.(?:stdin|stdout|stderr)|Deno)\./.test(name)) return true;
  if (/^(http|https|net|tls|dns|child_process|worker_threads)\./.test(name)) return true;
  return /^(readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|exec|execFile|spawn|fork)$/.test(name);
}

function collectKnownEffectAliases(
  callable: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): Map<string, DirectEffectReasonCode> {
  const aliases = new Map<string, DirectEffectReasonCode>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        const effect = classifyKnownInvocation(imported);
        if (effect) aliases.set(element.name.text, effect);
      }
    }
    if (statement.importClause.name) {
      const effect = classifyKnownInvocation(statement.importClause.name.text);
      if (effect) aliases.set(statement.importClause.name.text, effect);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (node !== callable && isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const effect = classifyKnownInvocation(expressionPath(node.initializer)) ??
          (ts.isIdentifier(node.initializer) ? aliases.get(node.initializer.text) : undefined);
        if (effect && aliases.get(node.name.text) !== effect) {
          aliases.set(node.name.text, effect);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const statement of sourceFile.statements) visit(statement);
    if (callable.body) visit(callable.body);
  }
  return aliases;
}

function collectAmbientReadAliases(
  callable: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== callable && isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const path = expressionPath(node.initializer);
      const root = rootIdentifier(node.initializer);
      if (
        path === "process" || path === "Deno" ||
        path === "process.env" || path?.startsWith("process.env.") ||
        path === "Deno.env" || path?.startsWith("Deno.env.") ||
        (root && aliases.has(root))
      ) aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of sourceFile.statements) visit(statement);
  if (callable.body) visit(callable.body);
  return aliases;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionLike(node);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function hasStaticModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false);
}


function deduplicateAndSort(findings: DirectEffectFinding[]): DirectEffectFinding[] {
  const unique = new Map<string, DirectEffectFinding>();
  for (const finding of findings) {
    const key = `${finding.source}\0${finding.line}\0${finding.column}\0${finding.code}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code),
  );
}
