import { DETERMINISTIC_INTRINSICS } from "./effect-analyzer.js";

/**
 * Built-in knowledge used only by development (V2) analysis. It extends the
 * shared V1 intrinsic catalog without changing it: V1 assumption fingerprints
 * bind `INTRINSIC_CATALOG_VERSION`, which this catalog never affects.
 */
export const DEV_CATALOG_VERSION = "1" as const;

export const DEV_ERROR_CONSTRUCTORS: ReadonlySet<string> = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError"]);
export const DEV_CONVERSION_FUNCTIONS: ReadonlySet<string> = new Set(["Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat", "isFinite", "isNaN"]);
export const DEV_AMBIENT_GLOBALS: ReadonlySet<string> = new Set([
  "undefined", "NaN", "Infinity", "Math", "Date", "crypto", "performance", "fetch", "process", "Promise", "globalThis", "window", "self",
  "Array", "Object", "Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat", "isFinite", "isNaN", ...DEV_ERROR_CONSTRUCTORS,
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
 * cannot observe ambient state even when invoked implicitly.
 */
export function devReadableBuiltin(name: string): boolean {
  return DEV_NAMESPACE_CONSTANTS.has(name) || devDeterministicCall(name);
}
