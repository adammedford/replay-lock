import ts from "typescript";

export const INITIALIZER_BRANCH_PROOF_PROTOTYPE_REVISION = "125-1";
type Primitive = boolean | string | number | null;
type Fact = { known: true; value: Primitive } | { known: false };
const unknown: Fact = { known: false };

/** Retained #125 evaluation only: suppress execution findings, never syntax or bindings. */
export function createInitializerBranchProofPrototype(checker: ts.TypeChecker) {
  const immutable = new WeakMap<ts.VariableDeclaration, boolean>();
  const unchanged = (declaration: ts.VariableDeclaration): boolean => {
    if (immutable.has(declaration)) return immutable.get(declaration)!;
    const binding = checker.getSymbolAtLocation(declaration.name);
    let stable = true;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node !== declaration.name) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
        if (symbol === binding) {
          let site: ts.Node = node;
          while (site.parent && (ts.isParenthesizedExpression(site.parent) || ts.isAsExpression(site.parent) || ts.isNonNullExpression(site.parent) || ts.isSatisfiesExpression(site.parent) || ts.isTypeAssertionExpression(site.parent) || ts.isArrayLiteralExpression(site.parent) || ts.isObjectLiteralExpression(site.parent) || ts.isSpreadElement(site.parent) || ts.isSpreadAssignment(site.parent) || ts.isShorthandPropertyAssignment(site.parent) || ts.isPropertyAssignment(site.parent) && site.parent.initializer === site)) site = site.parent;
          const parent = site.parent;
          if (ts.isBinaryExpression(parent) && parent.left === site && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
            || (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === site
            || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)) stable = false;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration.getSourceFile());
    immutable.set(declaration, stable);
    return stable;
  };
  const value = (expression: ts.Expression, seen = new Set<ts.Node>()): Fact => {
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
    if (ts.isStringLiteral(expression)) return { known: true, value: expression.text };
    if (ts.isNumericLiteral(expression)) {
      const number = Number(expression.text);
      return Number.isFinite(number) ? { known: true, value: number } : unknown;
    }
    if (ts.isParenthesizedExpression(expression)) return value(expression.expression, seen);
    if (ts.isPrefixUnaryExpression(expression)) {
      const operand = value(expression.operand, new Set(seen));
      if (!operand.known) return unknown;
      if (expression.operator === ts.SyntaxKind.ExclamationToken) return { known: true, value: !operand.value };
      if (expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand) && typeof operand.value === "number") return { known: true, value: -operand.value };
      return unknown;
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expression.operatorToken.kind)) {
      const left = value(expression.left, new Set(seen)), right = value(expression.right, new Set(seen));
      return left.known && right.known ? { known: true, value: expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? left.value === right.value : left.value !== right.value } : unknown;
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
      const left = value(expression.left, new Set(seen));
      if (!left.known) return unknown;
      const shortCircuits = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? !left.value : !!left.value;
      return shortCircuits ? left : value(expression.right, new Set(seen));
    }
    if (!ts.isIdentifier(expression)) return unknown;
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration) || seen.has(declaration) || !ts.isIdentifier(declaration.name) || !declaration.initializer) return unknown;
    const list = declaration.parent;
    if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(list.parent) || !ts.isSourceFile(list.parent.parent)) return unknown;
    if (declaration.getSourceFile() !== expression.getSourceFile() || declaration.end >= expression.getStart()) return unknown;
    if (!unchanged(declaration)) return unknown;
    seen.add(declaration);
    return value(declaration.initializer, seen);
  };
  return (node: ts.Node): boolean => {
    const path: { child: ts.Node; parent: ts.Node }[] = [];
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return false;
      path.push({ child, parent });
    }
    // Outer unreachable execution dominates inner constructs; otherwise don't
    // derive new paths from loop/try/switch execution in this first slice.
    for (const { child, parent } of path.reverse()) {
      if (ts.isTryStatement(parent) || ts.isIterationStatement(parent, false) || ts.isSwitchStatement(parent)) return false;
      if (ts.isIfStatement(parent)) {
        const known = value(parent.expression);
        if (known.known && child === parent.thenStatement && !known.value) return true;
        if (known.known && child === parent.elseStatement && !!known.value) return true;
      }
      if (ts.isConditionalExpression(parent)) {
        const known = value(parent.condition);
        if (known.known && child === parent.whenTrue && !known.value) return true;
        if (known.known && child === parent.whenFalse && !!known.value) return true;
      }
      if (ts.isBinaryExpression(parent) && child === parent.right) {
        const known = value(parent.left);
        if (known.known && (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && !known.value || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken && !!known.value)) return true;
      }
    }
    return false;
  };
}
