import ts from "typescript";
import { DETERMINISTIC_INTRINSICS, expressionPath } from "./effect-analyzer.js";

/**
 * Built-in knowledge used only by development (V2) analysis. It extends the
 * shared V1 intrinsic catalog without changing it: V1 assumption fingerprints
 * bind `INTRINSIC_CATALOG_VERSION`, which this catalog never affects.
 */
export const DEV_CATALOG_VERSION = "2" as const;

export const DEV_ERROR_CONSTRUCTORS: ReadonlySet<string> = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError"]);
export const DEV_CONVERSION_FUNCTIONS: ReadonlySet<string> = new Set(["Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat", "isFinite", "isNaN"]);
/** Built-in functions that are deterministic and call no user code when given data. */
const DEV_STATIC_FUNCTIONS: ReadonlySet<string> = new Set([
  "JSON.parse", "JSON.stringify",
  "Object.keys", "Object.values", "Object.entries", "Object.fromEntries", "Object.hasOwn", "Object.getOwnPropertyNames", "Object.isFrozen",
  "Array.from", "Array.of", "Date.UTC",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
]);
/** Deterministic, but mutates its argument. Mutation analysis matches the literal call syntax, so aliases are refused. */
const DEV_MUTATING_STATICS: ReadonlySet<string> = new Set(["Object.freeze"]);
/** Built-in classes whose construction is deterministic; only `new` is supported. */
const DEV_CONSTRUCTORS: ReadonlySet<string> = new Set(["Map", "Set", "URL", "URLSearchParams", "RegExp"]);
export const DEV_AMBIENT_GLOBALS: ReadonlySet<string> = new Set([
  "undefined", "NaN", "Infinity", "Math", "Date", "crypto", "performance", "fetch", "process", "Promise", "globalThis", "window", "self",
  "Array", "Object", "Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat", "isFinite", "isNaN", ...DEV_ERROR_CONSTRUCTORS,
  "JSON", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", ...DEV_CONSTRUCTORS,
]);
/**
 * Global bindings the language and platform define. Writing to one, to its
 * members, or through the global object to its name at module scope changes
 * behavior every module relies on.
 */
export const DEV_BUILTIN_GLOBALS: ReadonlySet<string> = new Set([
  "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Reflect", "Proxy", "Intl",
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Promise", "Iterator", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "structuredClone",
  "parseInt", "parseFloat", "isFinite", "isNaN", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape", "eval",
  "undefined", "NaN", "Infinity", "globalThis",
]);

/** Members that may follow `globalThis`/`window`/`self` without being ambient state. */
export const DEV_GLOBAL_OBJECT_MEMBERS: ReadonlySet<string> = new Set(["Math", "Date", "crypto", "performance", "fetch", "process", "Promise", "Array", "Object", "Number", "String", "Boolean", "BigInt"]);

/** Traced effect functions. Used as values they would run outside interception. */
export const DEV_EFFECT_FUNCTIONS: ReadonlySet<string> = new Set([
  "Math.random", "crypto.randomUUID", "Date", "Date.now", "performance.now", "fetch", "fs.readFileSync", "fsPromises.readFile",
]);

const DEV_NAMESPACE_CONSTANTS: ReadonlySet<string> = new Set([
  "undefined", "NaN", "Infinity",
  "Math.E", "Math.LN10", "Math.LN2", "Math.LOG10E", "Math.LOG2E", "Math.PI", "Math.SQRT1_2", "Math.SQRT2",
  "Number.EPSILON", "Number.MAX_SAFE_INTEGER", "Number.MAX_VALUE", "Number.MIN_SAFE_INTEGER", "Number.MIN_VALUE",
  "Number.NaN", "Number.NEGATIVE_INFINITY", "Number.POSITIVE_INFINITY",
]);

/** A built-in call that is deterministic and runs no user code. */
export function devDeterministicCall(name: string): boolean {
  return DETERMINISTIC_INTRINSICS.has(name) || DEV_ERROR_CONSTRUCTORS.has(name) || DEV_CONVERSION_FUNCTIONS.has(name);
}

/**
 * A built-in path that may be read as a value (rather than called) inside a
 * capture target: an immutable constant or a deterministic function that
 * cannot observe ambient state or mutate its arguments even when invoked
 * implicitly.
 */
export function devReadableBuiltin(name: string): boolean {
  return DEV_NAMESPACE_CONSTANTS.has(name) || devDeterministicCall(name) || DEV_STATIC_FUNCTIONS.has(name);
}

/**
 * Whether invoking the catalogued built-in `name` is deterministic. `path` is
 * the callee's literal syntax (see `expressionPath`), which must match `name`
 * for a built-in that mutates its argument.
 */
export function devCatalogInvocation(node: ts.CallExpression | ts.NewExpression, name: string, path: string | undefined): boolean {
  if (devDeterministicCall(name)) return true;
  const args = node.arguments ?? [];
  if (args.some(ts.isSpreadElement)) return false;
  if (DEV_CONSTRUCTORS.has(name)) return ts.isNewExpression(node);
  if (ts.isNewExpression(node)) return false;
  if (DEV_MUTATING_STATICS.has(name)) return path === name;
  if (!DEV_STATIC_FUNCTIONS.has(name)) return false;
  // A reviver, replacer, or mapping function would run user code.
  if (name === "JSON.parse" || name === "Array.from") return args.length === 1;
  if (name === "JSON.stringify") return args.length >= 1 && args.length <= 3 && (args.length < 2 || literalReplacer(args[1]!)) && (args.length < 3 || literal(args[2]!));
  return true;
}

export interface DevInitializationContext {
  /** The built-in a callee or member expression denotes, if any. */
  name(expression: ts.Expression): string | undefined;
  /** Whether a referenced binding holds inert data. */
  inertIdentifier(node: ts.Identifier): boolean;
}

/**
 * A module-scope call that runs no user code: a catalogued built-in whose
 * arguments are inert literal data. Nested calls are checked on their own.
 */
export function devInertInitialization(node: ts.CallExpression | ts.NewExpression, context: DevInitializationContext): boolean {
  const name = context.name(node.expression);
  if (name === undefined || !devCatalogInvocation(node, name, expressionPath(node.expression))) return false;
  return (node.arguments ?? []).every((argument) => inertExpression(argument, context));
}

/** Literal data, catalogued built-in results, and inert bindings: evaluating it runs no user code. */
export function inertExpression(expression: ts.Expression, context: DevInitializationContext): boolean {
  const node = unwrapExpression(expression);
  if (literal(node) || ts.isRegularExpressionLiteral(node) || ts.isBigIntLiteral(node)) return true;
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return true;
  if (ts.isIdentifier(node)) return context.inertIdentifier(node);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return DEV_NAMESPACE_CONSTANTS.has(context.name(node) ?? "");
  if (ts.isPrefixUnaryExpression(node)) return node.operator !== ts.SyntaxKind.PlusPlusToken && node.operator !== ts.SyntaxKind.MinusMinusToken && inertExpression(node.operand, context);
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => inertExpression(span.expression, context));
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((element) => ts.isOmittedExpression(element) || (!ts.isSpreadElement(element) && inertExpression(element, context)));
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return !property.objectAssignmentInitializer && property.name.text !== "__proto__" && context.inertIdentifier(property.name);
      if (!ts.isPropertyAssignment(property)) return false;
      const key = property.name;
      return (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)) && key.text !== "__proto__" && inertExpression(property.initializer, context);
    });
  }
  return false;
}

function literal(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword
    || (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand));
}

function literalReplacer(expression: ts.Expression): boolean {
  const node = unwrapExpression(expression);
  return literal(node) || (ts.isIdentifier(node) && node.text === "undefined") || (ts.isArrayLiteralExpression(node) && node.elements.every((element) => ts.isStringLiteral(element) || ts.isNumericLiteral(element)));
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}
