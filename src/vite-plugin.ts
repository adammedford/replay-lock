import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ResolvedConfig } from "vite";
import { resolveCallableModuleLocator } from "./callable-locator.js";
import type { SourceDiagnostic, SourceDiagnosticCode } from "./model.js";

const OBSERVER_IMPORT =
  'import { observeCall as __replaylockObserve } from "replaylock/vite/runtime";\n';

export function replaylock(): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;

  return {
    name: "replaylock",
    enforce: "pre",
    configResolved(config) {
      resolvedConfig = config;
      const activation = activeSession();
      if (!activation) return;

      mkdirSync(activation.directory, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(activation.directory, "handshake.json"),
        `${JSON.stringify({ token: activation.token })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    },
    transform(code, rawId) {
      const activation = activeSession();
      if (!activation || !resolvedConfig) return null;

      const id = rawId.split("?", 1)[0] ?? rawId;
      if (id.includes("/node_modules/") || !/\.[cm]?[jt]sx?$/.test(id)) return null;

      const sourceFile = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(id),
      );
      const locatorResolution = resolveCallableModuleLocator(resolvedConfig.root, id);
      const analysis = analyzeSourcePolicies(sourceFile, locatorResolution.source);
      const locatorDiagnostics = locatorResolution.ok
        ? []
        : analysis.callables
            .filter(({ policy }) => policy.capture && policy.exclusionReasons.length === 0)
            .map(({ target }) =>
              sourceDiagnostic(
                "UNSUPPORTED_CALLABLE",
                sourceFile,
                locatorResolution.source,
                target.callable,
                locatorResolution.message,
              ),
            );
      for (const diagnostic of [...analysis.diagnostics, ...locatorDiagnostics]) {
        writeSourceDiagnostic(activation.directory, diagnostic);
      }
      if (!locatorResolution.ok) return null;
      const moduleLocator = locatorResolution.locator;
      const targets = analysis.callables
        .filter(({ policy }) => policy.capture && policy.exclusionReasons.length === 0)
        .map(({ target }) => target)
        .filter(isIssue2LikelySafeNumericLeaf);
      if (targets.length === 0) return null;

      const transformed = new MagicString(code);
      const sourceGraphDigest = `sha256:${createHash("sha256").update(code).digest("hex")}`;

      for (const target of [...targets].reverse()) {
        const metadata = JSON.stringify({
          locator: { module: moduleLocator, exportName: target.exportName },
          sourceGraphDigest,
        });
        instrumentTarget(transformed, sourceFile, target, metadata);
      }

      transformed.prepend(OBSERVER_IMPORT);
      return {
        code: transformed.toString(),
        map: transformed.generateMap({
          file: id,
          source: id,
          includeContent: true,
          hires: true,
        }),
      };
    },
  };
}

interface CaptureTarget {
  exportName: string;
  callable:
    | (ts.FunctionDeclaration & { name: ts.Identifier; body: ts.Block })
    | (ts.FunctionExpression & { body: ts.Block })
    | ts.ArrowFunction;
}

interface SourcePolicy {
  capture: boolean;
  assumptionReasons: string[];
  exclusionReasons: string[];
}

interface AnalyzedCallable {
  target: CaptureTarget;
  policy: SourcePolicy;
}

interface SourcePolicyAnalysis {
  callables: AnalyzedCallable[];
  diagnostics: SourceDiagnostic[];
}

function analyzeSourcePolicies(
  sourceFile: ts.SourceFile,
  moduleLocator: string,
): SourcePolicyAnalysis {
  const callables: AnalyzedCallable[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    const tags = ownReplaylockTags(node);
    if (tags.length > 0) {
      const parsed = parseSourcePolicy(tags);
      if (parsed.errors.length > 0) {
        diagnostics.push(
          ...parsed.errors.map((message) =>
            sourceDiagnostic("INVALID_POLICY", sourceFile, moduleLocator, node, message),
          ),
        );
      } else {
        const target = supportedCaptureTarget(node, sourceFile);
        if (target) {
          callables.push({ target, policy: parsed.policy });
        } else if (isUnsupportedCallableShape(node)) {
          diagnostics.push(
            sourceDiagnostic(
              "UNSUPPORTED_CALLABLE",
              sourceFile,
              moduleLocator,
              node,
              "annotated callable is not a directly exported named synchronous function",
            ),
          );
        } else {
          diagnostics.push(
            sourceDiagnostic(
              "INVALID_POLICY",
              sourceFile,
              moduleLocator,
              node,
              "directive is not attached to a callable",
            ),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { callables, diagnostics };
}

function supportedCaptureTarget(node: ts.Node, sourceFile: ts.SourceFile): CaptureTarget | undefined {
  if (node.parent !== sourceFile) return undefined;

  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    node.body &&
    !node.asteriskToken &&
    !hasModifier(node, ts.SyntaxKind.AsyncKeyword) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    !hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  ) {
    return { exportName: node.name.text, callable: node as CaptureTarget["callable"] };
  }

  if (
    ts.isVariableStatement(node) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    (node.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    node.declarationList.declarations.length === 1
  ) {
    const declaration = node.declarationList.declarations[0];
    if (
      declaration &&
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      isSynchronousFunctionInitializer(declaration.initializer)
    ) {
      return { exportName: declaration.name.text, callable: declaration.initializer };
    }
  }

  return undefined;
}

function ownReplaylockTags(node: ts.Node): ts.JSDocTag[] {
  return ts
    .getJSDocTags(node)
    .filter((tag) => tag.tagName.text === "replaylock" && tag.parent.parent === node);
}

function parseSourcePolicy(tags: readonly ts.JSDocTag[]): {
  policy: SourcePolicy;
  errors: string[];
} {
  const policy: SourcePolicy = {
    capture: false,
    assumptionReasons: [],
    exclusionReasons: [],
  };
  const errors: string[] = [];

  for (const tag of tags) {
    const comment = typeof tag.comment === "string" ? tag.comment.trim() : "";
    const separator = comment.search(/\s/);
    const directive = separator < 0 ? comment : comment.slice(0, separator);
    const reason = separator < 0 ? "" : comment.slice(separator).trim();
    switch (directive) {
      case "capture":
        if (reason.length > 0) errors.push("capture does not accept a reason");
        policy.capture = true;
        break;
      case "assume-pure":
        if (reason.length === 0) errors.push("assume-pure requires a nonempty reason");
        else policy.assumptionReasons.push(reason);
        break;
      case "exclude":
        if (reason.length === 0) errors.push("exclude requires a nonempty reason");
        else policy.exclusionReasons.push(reason);
        break;
      default:
        errors.push(`unknown directive ${JSON.stringify(directive)}`);
        break;
    }
  }

  if (policy.assumptionReasons.length > 0 && !policy.capture) {
    errors.push("assume-pure requires capture");
  }
  if (
    policy.exclusionReasons.length > 0 &&
    (policy.capture || policy.assumptionReasons.length > 0)
  ) {
    errors.push("exclude cannot be combined with capture or assume-pure");
  }

  return { policy, errors };
}

function isUnsupportedCallableShape(node: ts.Node): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isExportAssignment(node)
  ) {
    return true;
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.some(
      (declaration) =>
        declaration.initializer !== undefined &&
        isIndirectOrFunctionInitializer(declaration.initializer),
    );
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
    return node.initializer !== undefined && isIndirectOrFunctionInitializer(node.initializer);
  }
  if (ts.isShorthandPropertyAssignment(node)) return true;
  return (
    ts.isExpressionStatement(node) &&
    ts.isBinaryExpression(node.expression) &&
    node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isCommonJsExportReference(node.expression.left) &&
    isIndirectOrFunctionInitializer(node.expression.right)
  );
}

function isIndirectOrFunctionInitializer(expression: ts.Expression): boolean {
  if (
    ts.isFunctionExpression(expression) ||
    ts.isArrowFunction(expression) ||
    ts.isIdentifier(expression) ||
    ts.isCallExpression(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return true;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isIndirectOrFunctionInitializer(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isIndirectOrFunctionInitializer(expression.whenTrue) ||
      isIndirectOrFunctionInitializer(expression.whenFalse)
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expression.operatorToken.kind === ts.SyntaxKind.CommaToken)
  ) {
    return (
      isIndirectOrFunctionInitializer(expression.left) ||
      isIndirectOrFunctionInitializer(expression.right)
    );
  }
  return false;
}

function isCommonJsExportReference(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "exports";
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      (ts.isIdentifier(expression.expression) &&
        expression.expression.text === "module" &&
        expression.name.text === "exports") ||
      isCommonJsExportReference(expression.expression)
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    return (
      (ts.isIdentifier(expression.expression) &&
        expression.expression.text === "module" &&
        argument !== undefined &&
        ts.isStringLiteral(argument) &&
        argument.text === "exports") ||
      isCommonJsExportReference(expression.expression)
    );
  }
  return false;
}

function sourceDiagnostic(
  code: SourceDiagnosticCode,
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
  message: string,
): SourceDiagnostic {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    code,
    source,
    line: position.line + 1,
    column: position.character + 1,
    message,
  };
}

function writeSourceDiagnostic(directory: string, diagnostic: SourceDiagnostic): void {
  appendFileSync(
    path.join(directory, `diagnostics-${process.pid}.jsonl`),
    `${JSON.stringify(diagnostic)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function isSynchronousFunctionInitializer(
  expression: ts.Expression,
): expression is (ts.FunctionExpression & { body: ts.Block }) | ts.ArrowFunction {
  return (
    (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) &&
    !expression.asteriskToken &&
    !hasModifier(expression, ts.SyntaxKind.AsyncKeyword)
  );
}

function isIssue2LikelySafeNumericLeaf(
  target: CaptureTarget,
): boolean {
  const callable = target.callable;
  if (
    callable.parameters.some(
      (parameter) =>
        !ts.isIdentifier(parameter.name) ||
        parameter.initializer !== undefined ||
        parameter.dotDotDotToken !== undefined,
    )
  ) {
    return false;
  }

  const expression = callableBodyExpression(callable);
  if (!expression) return false;
  const parameterNames = new Set(
    callable.parameters.map((parameter) => (parameter.name as ts.Identifier).text),
  );
  return isNumericLeafExpression(expression, parameterNames);
}

function callableBodyExpression(callable: CaptureTarget["callable"]): ts.Expression | undefined {
  if (!ts.isBlock(callable.body)) return callable.body;
  if (callable.body.statements.length !== 1) return undefined;
  const [statement] = callable.body.statements;
  return statement && ts.isReturnStatement(statement) ? statement.expression : undefined;
}

function instrumentTarget(
  transformed: MagicString,
  sourceFile: ts.SourceFile,
  target: CaptureTarget,
  metadata: string,
): void {
  const { callable } = target;
  const observedArguments = ts.isArrowFunction(callable)
    ? `[${callable.parameters.map((parameter) => parameter.name.getText(sourceFile)).join(", ")}]`
    : "Array.from(arguments)";

  if (ts.isBlock(callable.body)) {
    const bodyStart = callable.body.getStart(sourceFile) + 1;
    const bodyEnd = callable.body.end - 1;
    transformed.appendLeft(
      bodyStart,
      `\nreturn __replaylockObserve(${metadata}, ${observedArguments}, () => {`,
    );
    transformed.appendLeft(bodyEnd, "\n});\n");
    return;
  }

  const expression = callable.body;
  transformed.overwrite(
    expression.getStart(sourceFile),
    expression.end,
    `__replaylockObserve(${metadata}, ${observedArguments}, () => (${expression.getText(sourceFile)}))`,
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function isNumericLeafExpression(expression: ts.Expression, parameters: ReadonlySet<string>): boolean {
  if (ts.isNumericLiteral(expression)) return true;
  if (ts.isIdentifier(expression)) return parameters.has(expression.text);
  if (ts.isParenthesizedExpression(expression)) {
    return isNumericLeafExpression(expression.expression, parameters);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    return (
      (expression.operator === ts.SyntaxKind.PlusToken ||
        expression.operator === ts.SyntaxKind.MinusToken) &&
      isNumericLeafExpression(expression.operand, parameters)
    );
  }
  if (!ts.isBinaryExpression(expression) || !isNumericOperator(expression.operatorToken.kind)) {
    return false;
  }
  return (
    isNumericLeafExpression(expression.left, parameters) &&
    isNumericLeafExpression(expression.right, parameters)
  );
}

function isNumericOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.PlusToken ||
    kind === ts.SyntaxKind.MinusToken ||
    kind === ts.SyntaxKind.AsteriskToken ||
    kind === ts.SyntaxKind.SlashToken ||
    kind === ts.SyntaxKind.PercentToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskToken
  );
}

function activeSession(): { directory: string; token: string } | undefined {
  const directory = process.env.REPLAYLOCK_SESSION_DIR;
  const token = process.env.REPLAYLOCK_SESSION_TOKEN;
  if (!directory || !token) return undefined;
  return { directory, token };
}

function scriptKind(id: string): ts.ScriptKind {
  if (id.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (id.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (id.endsWith(".js") || id.endsWith(".mjs") || id.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
