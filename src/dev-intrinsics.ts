/**
 * Capture targets call built-ins natively, both while recording and during
 * replay, so an analyzed target is deterministic only while those built-ins
 * are the engine's own. This module has no imports so that the browser runtime
 * can load it. It snapshots the shape of the built-ins development analysis
 * relies on when it first loads, and reports whether any property of them has
 * since been replaced, added, or removed, or was not native at that point.
 * Namespace objects may gain members other than well-known symbols.
 */
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectIs = Object.is;
const getPrototypeOf = Object.getPrototypeOf;
const functionSource = Function.prototype.toString;

const iteratorPrototype = (value: Iterable<unknown>): object => getPrototypeOf(value[Symbol.iterator]()) as object;
/** Host classes: present in browsers and Node, absent from a bare JavaScript realm. */
const hosted = [globalThis.URL, globalThis.URLSearchParams].filter((host) => typeof host === "function") as { name: string; prototype: object }[];
const shapes: readonly object[] = [
  Object.prototype, Array.prototype, String.prototype, Number.prototype, Boolean.prototype, Function.prototype,
  Symbol.prototype,
  Map.prototype, Set.prototype, RegExp.prototype, Date.prototype, Promise.prototype, Error.prototype,
  iteratorPrototype([]), iteratorPrototype(new Map()), iteratorPrototype(new Set()), iteratorPrototype(""), getPrototypeOf(iteratorPrototype([])) as object,
  Math, JSON, Object, Array, Number, String, Boolean, Symbol, Reflect, Date, Map, Set, RegExp, Promise,
  ...hosted.flatMap((host) => [host, host.prototype]),
];
/**
 * Namespace objects and constructor statics. Libraries add members to them
 * (reflect-metadata's `Reflect.defineMetadata`), which analysis never relies
 * on: only catalogued members are allowed, and those are snapshotted below.
 * An added well-known symbol, such as `Symbol.hasInstance`, changes how the
 * built-in behaves and still counts as tampering, as does any prototype change.
 */
const namespaces = new Set<object>([Math, JSON, Object, Array, Number, String, Boolean, Symbol, Reflect, Date, Map, Set, RegExp, Promise, ...hosted]);
const wellKnownSymbols: readonly symbol[] = Object.getOwnPropertyNames(Symbol).map((name) => (Symbol as unknown as Record<string, unknown>)[name]).filter((value): value is symbol => typeof value === "symbol");
/** Index loops and `===` only: this runs after application code, which may have replaced iterators or collection methods. */
function wellKnownKeys(own: readonly PropertyKey[]): number {
  let count = 0;
  for (let index = 0; index < own.length; index++) {
    for (let symbol = 0; symbol < wellKnownSymbols.length; symbol++) if (own[index] === wellKnownSymbols[symbol]) count++;
  }
  return count;
}
/** Global bindings whose identity analysis assumes; the global object itself legitimately gains properties. */
const globals = [
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "Reflect", "Math", "JSON", "Date", "Map", "Set", "RegExp", "Promise",
  ...hosted.map((host) => host.name),
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError",
  "parseInt", "parseFloat", "isFinite", "isNaN", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
];

/** Node implements these in JavaScript; they are the runtime's own but not `[native code]`. */
const scripted = new Set<unknown>(hosted.flatMap((host) => [host, host.prototype]));

const owners: object[] = [];
const keys: PropertyKey[] = [];
const values: unknown[] = [];
const setters: unknown[] = [];
const accessors: boolean[] = [];
const counts: number[] = [];
/** For namespaces, the well-known symbol keys; for other shapes, -1: any added key is tampering. */
const wellKnownCounts: number[] = [];
let native = true;
function remember(owner: object, key: PropertyKey): void {
  const descriptor = getOwnPropertyDescriptor(owner, key);
  if (!descriptor) { native = false; return; }
  const accessor = !("value" in descriptor);
  owners.push(owner); keys.push(key);
  values.push(accessor ? descriptor.get : descriptor.value);
  setters.push(accessor ? descriptor.set : undefined);
  accessors.push(accessor);
  if (scripted.has(owner) || (accessor ? scripted.has(descriptor.get) || scripted.has(descriptor.set) : scripted.has(descriptor.value))) return;
  for (const part of accessor ? [descriptor.get, descriptor.set] : [descriptor.value]) {
    if (typeof part === "function" && !/\{\s*\[native code\]\s*\}\s*$/.test(functionSource.call(part))) native = false;
  }
}
/** Traced effects: every call is intercepted, so recording and replay may substitute them. */
const traced = new Map<object, PropertyKey>([[Math, "random"], [Date, "now"]]);
for (const shape of shapes) {
  const own = ownKeys(shape);
  counts.push(own.length);
  wellKnownCounts.push(namespaces.has(shape) ? wellKnownKeys(own) : -1);
  for (const key of own) if (traced.get(shape) !== key) remember(shape, key);
}
for (const name of globals) remember(globalThis, name);

/** Every snapshotted built-in is still the native one it was when this module loaded. */
export function intrinsicsIntact(): boolean {
  if (!native) return false;
  for (let index = 0; index < shapes.length; index++) {
    const own = ownKeys(shapes[index]!);
    // Removed or replaced members fail the per-key check below.
    if (own.length !== counts[index] && (wellKnownCounts[index]! < 0 || wellKnownKeys(own) !== wellKnownCounts[index])) return false;
  }
  for (let index = 0; index < keys.length; index++) {
    const descriptor = getOwnPropertyDescriptor(owners[index]!, keys[index]!);
    if (!descriptor || ("value" in descriptor) === accessors[index]) return false;
    if (accessors[index]) {
      if (!objectIs(descriptor.get, values[index]) || !objectIs(descriptor.set, setters[index])) return false;
    } else {
      if (!objectIs(descriptor.value, values[index])) return false;
    }
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
