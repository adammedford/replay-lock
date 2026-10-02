import ts from "typescript";

/** Internal plan identity only; never part of a public graph digest. */
export const OWNED_INITIALIZATION_PROOF_REVISION = "closed-owned-numeric-table/1";

export interface OwnedInitializationProof {
  covers(node: ts.Node): boolean;
  finalized(declaration: ts.VariableDeclaration): boolean;
}

/**
 * Evaluation-only closed syntax, not a native identity or sandbox claim.
 * Every unknown (including resource exhaustion) leaves the ordinary analyzer
 * in charge. No source is evaluated and no table is replaced at runtime.
 */
export function createOwnedInitializationProof(source: ts.SourceFile, checker: ts.TypeChecker, graphClosed: boolean): OwnedInitializationProof {
  const covered = new Set<ts.Node>(), tables = new Set<ts.VariableDeclaration>();
  const unknown: OwnedInitializationProof = { covers: () => false, finalized: () => false };
  if (!graphClosed) return unknown;
  if (!source.statements.some((statement, index) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer))
    && source.statements[index + 1] && ts.isForStatement(source.statements[index + 1]!))) return unknown;
  // One linear reference index, with explicit structural and arithmetic caps.
  // Caps are deliberately non-configurable and shared by all candidates.
  let remaining = 32768, nodes = 16384, exhaustive = true, suspended = false;
  const references = new Map<ts.Symbol, ts.Identifier[]>();
  const symbol = (node: ts.Identifier): ts.Symbol | undefined => {
    const found = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    return found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
  };
  const index = (node: ts.Node, depth: number, inFunction: boolean): void => {
    if (--nodes < 0 || depth > 192) { exhaustive = false; return; }
    if (!inFunction && (ts.isAwaitExpression(node) || ts.isForOfStatement(node) && !!node.awaitModifier)) suspended = true;
    if (ts.isIdentifier(node)) {
      const binding = symbol(node);
      if (binding) { const list = references.get(binding) ?? []; list.push(node); references.set(binding, list); }
    }
    ts.forEachChild(node, child => { if (exhaustive) index(child, depth + 1, inFunction || ts.isFunctionLike(node)); });
  };
  index(source, 0, false);
  if (!exhaustive || suspended) return unknown;
  const unwrap = (node: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
  };
  const expressionSite = (node: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
    return node;
  };
  const written = (node: ts.Expression): boolean => {
    let site: ts.Node = node;
    while (site.parent && (ts.isParenthesizedExpression(site.parent) || ts.isAsExpression(site.parent) || ts.isTypeAssertionExpression(site.parent) || ts.isNonNullExpression(site.parent)
      || ts.isArrayLiteralExpression(site.parent) || ts.isObjectLiteralExpression(site.parent) || ts.isSpreadElement(site.parent) || ts.isSpreadAssignment(site.parent)
      || ts.isShorthandPropertyAssignment(site.parent) || ts.isPropertyAssignment(site.parent) && site.parent.initializer === site)) site = site.parent;
    const parent = site.parent;
    return ts.isBinaryExpression(parent) && parent.left === site && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      || ts.isDeleteExpression(parent)
      || (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === site
      || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
  };
  const exact = (expression: ts.Expression, binding: ts.Symbol): boolean => {
    const node = unwrap(expression);
    return ts.isIdentifier(node) && symbol(node) === binding;
  };
  const unwrittenFacts = new Map<ts.VariableDeclaration, boolean>();
  for (let position = 0; position + 1 < source.statements.length; position++) {
    const statement = source.statements[position]!, loop = source.statements[position + 1]!;
    if (!ts.isVariableStatement(statement) || statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      || !(statement.declarationList.flags & ts.NodeFlags.Const) || statement.declarationList.declarations.length !== 1 || !ts.isForStatement(loop)) continue;
    const declaration = statement.declarationList.declarations[0]!;
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue;
    const table = declaration.initializer, binding = symbol(declaration.name);
    if (!binding || table.elements.length === 0 || table.elements.length > 256
      || !loop.initializer || !ts.isVariableDeclarationList(loop.initializer) || !(loop.initializer.flags & ts.NodeFlags.Let)
      || loop.initializer.declarations.length !== 1 || !loop.condition || !loop.incrementor) continue;
    const counter = loop.initializer.declarations[0]!;
    if (!ts.isIdentifier(counter.name) || !counter.initializer || !ts.isNumericLiteral(counter.initializer) || Number(counter.initializer.text) !== 0) continue;
    const counterBinding = symbol(counter.name);
    const condition = loop.condition, increment = loop.incrementor;
    if (!counterBinding || !ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.LessThanToken
      || !exact(condition.left, counterBinding)
      || !(ts.isPrefixUnaryExpression(increment) || ts.isPostfixUnaryExpression(increment)) || increment.operator !== ts.SyntaxKind.PlusPlusToken
      || !exact(increment.operand, counterBinding)) continue;
    const bound = unwrap(condition.right);
    const count = ts.isNumericLiteral(bound) ? Number(bound.text)
      : ts.isPropertyAccessExpression(bound) && bound.name.text === "length" && exact(bound.expression, binding) ? table.elements.length : undefined;
    if (count === undefined || !Number.isInteger(count) || count !== table.elements.length || count > 256) continue;
    const body = ts.isBlock(loop.statement) ? loop.statement.statements : [loop.statement];
    if (body.length === 0) continue;
    const values: number[] = [];
    const allowedReferences = new Set<ts.Identifier>([declaration.name]);
    const addReceiver = (expression: ts.Expression): void => { const node = unwrap(expression); if (ts.isIdentifier(node)) allowedReferences.add(node); };
    if (ts.isPropertyAccessExpression(bound)) addReceiver(bound.expression);
    // Only prior, top-level const numeric facts with no attempted writes.
    const facts = new Map<ts.VariableDeclaration, number | undefined>();
    const evaluating = new Set<ts.VariableDeclaration>();
    const evaluate = (expression: ts.Expression, iteration?: number, depth = 0): number | undefined => {
      if (--remaining < 0 || depth > 128) return undefined;
      const node = unwrap(expression);
      let value: number | undefined;
      if (ts.isNumericLiteral(node)) value = Number(node.text);
      else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const operand = evaluate(node.operand, iteration, depth + 1);
        if (operand !== undefined) value = -operand;
      } else if (ts.isIdentifier(node)) {
        const own = symbol(node);
        if (own === counterBinding && iteration !== undefined) value = iteration;
        else {
          const prior = own?.valueDeclaration;
          if (!prior || !ts.isVariableDeclaration(prior) || !ts.isIdentifier(prior.name) || !prior.initializer || prior.getStart(source) >= statement.getStart(source) || prior.end >= node.getStart(source)
            || !ts.isVariableDeclarationList(prior.parent) || !(prior.parent.flags & ts.NodeFlags.Const)
            || !ts.isVariableStatement(prior.parent.parent) || prior.parent.parent.parent !== source) return undefined;
          if (facts.has(prior)) return facts.get(prior);
          if (evaluating.has(prior)) return undefined;
          if (!unwrittenFacts.has(prior)) unwrittenFacts.set(prior, !(references.get(own!) ?? []).some(reference => reference !== prior.name && written(reference)));
          if (!unwrittenFacts.get(prior)) { facts.set(prior, undefined); return undefined; }
          evaluating.add(prior);
          value = evaluate(prior.initializer, undefined, depth + 1);
          evaluating.delete(prior);
          facts.set(prior, value);
        }
      } else if (ts.isElementAccessExpression(node) && iteration !== undefined && exact(node.expression, binding)) {
        const key = evaluate(node.argumentExpression, iteration, depth + 1);
        if (key !== undefined && Number.isInteger(key) && key >= 0 && key < values.length) { value = values[key]; addReceiver(node.expression); }
      } else if (ts.isBinaryExpression(node)) {
        const left = evaluate(node.left, iteration, depth + 1), right = evaluate(node.right, iteration, depth + 1);
        if (left === undefined || right === undefined) return undefined;
        switch (node.operatorToken.kind) {
          case ts.SyntaxKind.PlusToken: value = left + right; break;
          case ts.SyntaxKind.MinusToken: value = left - right; break;
          case ts.SyntaxKind.AsteriskToken: value = left * right; break;
          case ts.SyntaxKind.SlashToken: value = left / right; break;
          case ts.SyntaxKind.PercentToken: value = left % right; break;
        }
      }
      return value !== undefined && Number.isFinite(value) ? value : undefined;
    };
    let valid = true;
    for (const element of table.elements) {
      // The allocation itself is literal numeric data, not a fact-dependent
      // expression whose execution might need independent initialization proof.
      const numeric = unwrap(element);
      if (!(ts.isNumericLiteral(numeric) || ts.isPrefixUnaryExpression(numeric) && numeric.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(unwrap(numeric.operand)))) { valid = false; break; }
      const value = evaluate(element);
      if (value === undefined) { valid = false; break; }
      values.push(value);
    }
    const assignments: ts.BinaryExpression[] = [];
    for (const item of body) {
      if (!ts.isExpressionStatement(item) || !ts.isBinaryExpression(item.expression) || item.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) { valid = false; break; }
      const assignment = item.expression, target = unwrap(assignment.left);
      if (!ts.isElementAccessExpression(target) || !exact(target.expression, binding) || !exact(target.argumentExpression, counterBinding)) { valid = false; break; }
      addReceiver(target.expression);
      assignments.push(assignment);
    }
    if (!valid) continue;
    for (let iteration = 0; iteration < count && valid; iteration++) for (const assignment of assignments) {
      const value = evaluate(assignment.right, iteration);
      if (value === undefined) { valid = false; break; }
      values[iteration] = value;
    }
    if (!valid) continue;
    // Whole-module finalization is distinct from construction. Every reference
    // is checked at its exact lexical site; a declaration predicate cannot
    // launder a dynamic index, alias, mutation or property/method traversal.
    for (const reference of references.get(binding) ?? []) {
      if (allowedReferences.has(reference)) continue;
      const receiver = expressionSite(reference), read = receiver.parent;
      if (reference.getStart(source) < loop.end || !ts.isElementAccessExpression(read) || read.expression !== receiver || written(read)) { valid = false; break; }
      const key = evaluate(read.argumentExpression);
      if (key === undefined || !Number.isInteger(key) || key < 0 || key >= values.length) { valid = false; break; }
      const site = expressionSite(read), parent = site.parent;
      if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent) || ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === site) { valid = false; break; }
    }
    if (!valid || remaining < 0) continue;
    tables.add(declaration);
    covered.add(increment);
    for (const assignment of assignments) covered.add(assignment);
  }
  // An exhausted module never keeps a partially established earlier proof.
  if (remaining < 0) return unknown;
  return { covers: node => covered.has(node), finalized: declaration => tables.has(declaration) };
}
