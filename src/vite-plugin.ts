import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ResolvedConfig } from "vite";

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
      const targets = sourceFile.statements
        .filter(isCapturedFunction)
        .filter(isIssue2LikelySafeNumericLeaf);
      if (targets.length === 0) return null;

      const transformed = new MagicString(code);
      const moduleLocator = path.relative(resolvedConfig.root, id).replaceAll(path.sep, "/");
      const sourceGraphDigest = `sha256:${createHash("sha256").update(code).digest("hex")}`;

      for (const target of [...targets].reverse()) {
        const metadata = JSON.stringify({
          locator: { module: moduleLocator, exportName: target.name.text },
          sourceGraphDigest,
        });
        const bodyStart = target.body.getStart(sourceFile) + 1;
        const bodyEnd = target.body.end - 1;
        transformed.appendLeft(
          bodyStart,
          `\nreturn __replaylockObserve(${metadata}, Array.from(arguments), () => {`,
        );
        transformed.appendLeft(bodyEnd, "\n});\n");
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

function isIssue2LikelySafeNumericLeaf(
  target: ts.FunctionDeclaration & { name: ts.Identifier; body: ts.Block },
): boolean {
  if (
    target.parameters.some(
      (parameter) =>
        !ts.isIdentifier(parameter.name) ||
        parameter.initializer !== undefined ||
        parameter.dotDotDotToken !== undefined,
    ) ||
    target.body.statements.length !== 1
  ) {
    return false;
  }

  const [statement] = target.body.statements;
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression) return false;
  const parameterNames = new Set(
    target.parameters.map((parameter) => (parameter.name as ts.Identifier).text),
  );
  return isNumericLeafExpression(statement.expression, parameterNames);
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

function isCapturedFunction(statement: ts.Statement): statement is ts.FunctionDeclaration & {
  name: ts.Identifier;
  body: ts.Block;
} {
  if (
    !ts.isFunctionDeclaration(statement) ||
    !statement.name ||
    !statement.body ||
    statement.asteriskToken ||
    hasModifier(statement, ts.SyntaxKind.AsyncKeyword) ||
    !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
  ) {
    return false;
  }

  return ts.getJSDocTags(statement).some((tag) => {
    const comment = typeof tag.comment === "string" ? tag.comment.trim() : "";
    return tag.tagName.text === "replaylock" && comment === "capture";
  });
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function scriptKind(id: string): ts.ScriptKind {
  if (id.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (id.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (id.endsWith(".js") || id.endsWith(".mjs") || id.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
