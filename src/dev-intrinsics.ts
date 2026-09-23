/**
 * Capture targets call built-ins natively, both while recording and during
 * replay, so an analyzed target is deterministic only while those built-ins
 * are the engine's own. This module has no imports so that the browser runtime
 * can load it. It snapshots the shape of the built-ins development analysis
 * relies on when it first loads, and reports whether any property of them has
 * since been replaced, added, or removed, or was not native at that point.
 */
const iteratorPrototype = (value: Iterable<unknown>): object => Object.getPrototypeOf(value[Symbol.iterator]()) as object;
/** Host classes: present in browsers and Node, absent from a bare JavaScript realm. */
const hosted = [globalThis.URL, globalThis.URLSearchParams].filter((host) => typeof host === "function") as { name: string; prototype: object }[];
const shapes: readonly object[] = [
  Object.prototype, Array.prototype, String.prototype, Number.prototype, Boolean.prototype, Function.prototype,
  Map.prototype, Set.prototype, RegExp.prototype, Date.prototype, Promise.prototype, Error.prototype,
  iteratorPrototype([]), iteratorPrototype(new Map()), iteratorPrototype(new Set()), iteratorPrototype(""), Object.getPrototypeOf(iteratorPrototype([])) as object,
  Math, JSON, Object, Array, Number, String, Boolean, Date, Map, Set, RegExp, Promise,
  ...hosted.flatMap((host) => [host, host.prototype]),
];
/** Global bindings whose identity analysis assumes; the global object itself legitimately gains properties. */
const globals = [
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "Math", "JSON", "Date", "Map", "Set", "RegExp", "Promise",
  ...hosted.map((host) => host.name),
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError",
  "parseInt", "parseFloat", "isFinite", "isNaN", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
];

/** Node implements these in JavaScript; they are the runtime's own but not `[native code]`. */
const scripted = new Set<unknown>(hosted.flatMap((host) => [host, host.prototype]));

const owners: object[] = [];
const keys: PropertyKey[] = [];
const values: unknown[] = [];
const accessors: boolean[] = [];
const counts: number[] = [];
const functionSource = Function.prototype.toString;
let native = true;
function remember(owner: object, key: PropertyKey): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) { native = false; return; }
  const accessor = !("value" in descriptor);
  const value = accessor ? descriptor.get : descriptor.value;
  owners.push(owner); keys.push(key); values.push(value); accessors.push(accessor);
  if (scripted.has(owner) || scripted.has(value)) return;
  for (const part of accessor ? [descriptor.get, descriptor.set] : [descriptor.value]) {
    if (typeof part === "function" && !/\{\s*\[native code\]\s*\}\s*$/.test(functionSource.call(part))) native = false;
  }
}
/** Traced effects: every call is intercepted, so recording and replay may substitute them. */
const traced = new Map<object, PropertyKey>([[Math, "random"], [Date, "now"]]);
for (const shape of shapes) {
  const own = Reflect.ownKeys(shape);
  counts.push(own.length);
  for (const key of own) if (traced.get(shape) !== key) remember(shape, key);
}
for (const name of globals) remember(globalThis, name);

/** Every snapshotted built-in is still the native one it was when this module loaded. */
export function intrinsicsIntact(): boolean {
  if (!native) return false;
  for (let index = 0; index < shapes.length; index++) if (Reflect.ownKeys(shapes[index]!).length !== counts[index]) return false;
  for (let index = 0; index < keys.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(owners[index]!, keys[index]!);
    if (!descriptor || ("value" in descriptor) === accessors[index] || !Object.is(accessors[index] ? descriptor.get : descriptor.value, values[index])) return false;
  }
  return true;
}

let verified = false;
/**
 * The same check, performed at most once per synchronous run so that a burst
 * of captured calls pays for one check. A replacement made later in the same
 * run is detected from the next run on.
 */
export function intrinsicsIntactThisTurn(): boolean {
  if (verified) return true;
  if (!intrinsicsIntact()) return false;
  verified = true;
  queueMicrotask(() => { verified = false; });
  return true;
}
