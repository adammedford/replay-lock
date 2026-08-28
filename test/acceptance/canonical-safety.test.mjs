import assert from "node:assert/strict";
import test from "node:test";

import {
  UnsupportedValueError,
  decodeCanonicalValue,
  encodeCanonicalCompletion,
  encodeCanonicalSnapshot,
  encodeCanonicalValue,
} from "../../dist/canonical.js";

function assertUnsupported(operation) {
  assert.throws(operation, (error) => error instanceof UnsupportedValueError && error.code === "UNSUPPORTED_VALUE");
}

test("unsupported V1 categories fail closed with UNSUPPORTED_VALUE", () => {
  class CustomValue {}
  const values = [
    undefined,
    1n,
    Symbol("value"),
    () => 1,
    new Date(),
    /regexp/u,
    new Map(),
    new Set(),
    new WeakMap(),
    new WeakSet(),
    Promise.resolve(1),
    new ArrayBuffer(1),
    new DataView(new ArrayBuffer(1)),
    new Uint8Array(1),
    Object(1),
    Object.create(null),
    new CustomValue(),
  ];

  for (const value of values) assertUnsupported(() => encodeCanonicalValue(value));
});

test("cycles, repeated references, and snapshot aliases are rejected", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assertUnsupported(() => encodeCanonicalValue(cyclic));

  const shared = { answer: 42 };
  assertUnsupported(() => encodeCanonicalValue({ first: shared, second: shared }));

  const child = { kind: "number", value: 1 };
  assertUnsupported(() => decodeCanonicalValue({ kind: "array", items: [child, child] }));

  const cycleNode = { kind: "array", items: [] };
  cycleNode.items.push(cycleNode);
  assertUnsupported(() => decodeCanonicalValue(cycleNode));

  const argumentAlias = { answer: 42 };
  assertUnsupported(() => encodeCanonicalSnapshot(
    [argumentAlias, argumentAlias],
    { kind: "return", value: true },
  ));
  assertUnsupported(() => encodeCanonicalSnapshot(
    [argumentAlias],
    { kind: "return", value: argumentAlias },
  ));
  assertUnsupported(() => encodeCanonicalSnapshot(
    [argumentAlias],
    { kind: "throw", value: argumentAlias },
  ));
});

test("Node proxy detection rejects proxies before any proxy trap runs", () => {
  let trapCount = 0;
  const proxy = new Proxy([], {
    get() {
      trapCount += 1;
      throw new Error("proxy trap ran");
    },
    ownKeys() {
      trapCount += 1;
      throw new Error("proxy trap ran");
    },
    getPrototypeOf() {
      trapCount += 1;
      throw new Error("proxy trap ran");
    },
  });
  assertUnsupported(() => encodeCanonicalValue(proxy));
  assert.equal(trapCount, 0);

  const typedNodeProxy = new Proxy({ kind: "number", value: 1 }, {
    get() {
      trapCount += 1;
      throw new Error("proxy trap ran");
    },
  });
  assertUnsupported(() => decodeCanonicalValue(typedNodeProxy));
  assert.equal(trapCount, 0);
});

test("inspection invokes no getters, iterators, coercion, toJSON, instanceof, or Symbol.hasInstance", () => {
  let invoked = 0;
  const accessor = {};
  for (const key of ["kind", "value", "toJSON", "valueOf", "toString", Symbol.iterator]) {
    Object.defineProperty(accessor, key, {
      configurable: true,
      enumerable: true,
      get() {
        invoked += 1;
        throw new Error("application behavior invoked");
      },
    });
  }
  assertUnsupported(() => encodeCanonicalValue(accessor));
  assert.equal(invoked, 0);

  const completion = {};
  Object.defineProperties(completion, {
    kind: {
      configurable: true,
      enumerable: true,
      get() {
        invoked += 1;
        throw new Error("completion getter invoked");
      },
    },
    value: { configurable: true, enumerable: true, value: 1 },
  });
  assertUnsupported(() => encodeCanonicalCompletion(completion));
  assert.equal(invoked, 0);

  const decodedAccessor = {};
  Object.defineProperties(decodedAccessor, {
    kind: {
      configurable: true,
      enumerable: true,
      get() {
        invoked += 1;
        throw new Error("canonical getter invoked");
      },
    },
    value: { configurable: true, enumerable: true, value: 1 },
  });
  assertUnsupported(() => decodeCanonicalValue(decodedAccessor));
  assert.equal(invoked, 0);

  const executableHooks = {
    toJSON() { invoked += 1; throw new Error("toJSON invoked"); },
    valueOf() { invoked += 1; throw new Error("valueOf invoked"); },
    toString() { invoked += 1; throw new Error("toString invoked"); },
  };
  assertUnsupported(() => encodeCanonicalValue(executableHooks));

  const iteratorArray = [1];
  Object.defineProperty(iteratorArray, Symbol.iterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value() { invoked += 1; throw new Error("iterator invoked"); },
  });
  assertUnsupported(() => encodeCanonicalValue(iteratorArray));

  class HasInstanceTrap {
    static [Symbol.hasInstance]() {
      invoked += 1;
      throw new Error("Symbol.hasInstance invoked");
    }
  }
  assertUnsupported(() => encodeCanonicalValue(Object.create(HasInstanceTrap.prototype)));
  assert.equal(invoked, 0);
});

test("array extras, sparse arrays, descriptors, prototypes, and custom instances fail explicitly", () => {
  const extra = [1];
  extra.extra = true;
  assertUnsupported(() => encodeCanonicalValue(extra));

  const symbolExtra = [1];
  symbolExtra[Symbol.iterator] = function* () { yield 1; };
  assertUnsupported(() => encodeCanonicalValue(symbolExtra));

  const sparse = [];
  sparse.length = 1;
  assertUnsupported(() => encodeCanonicalValue(sparse));

  const readonly = [1];
  Object.defineProperty(readonly, "0", { configurable: true, enumerable: true, writable: false, value: 1 });
  assertUnsupported(() => encodeCanonicalValue(readonly));

  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = 1;
  assertUnsupported(() => encodeCanonicalValue(customPrototype));

  class CustomRecord { constructor() { this.value = 1; } }
  assertUnsupported(() => encodeCanonicalValue(new CustomRecord()));

  const customError = new Error("safe");
  Object.defineProperty(customError, "secret", {
    configurable: true,
    enumerable: true,
    get() { throw new Error("error getter invoked"); },
  });
  assertUnsupported(() => encodeCanonicalCompletion({ kind: "throw", value: customError }));
});

test("typed-node tag collisions and trap fixtures are inspected safely", () => {
  const collision = encodeCanonicalValue({
    kind: "array",
    items: null,
    entries: [],
    value: "payload",
  });
  assert.equal(collision.kind, "record");
  assert.equal(collision.entries.length, 4);

  const malformedTag = { kind: "array", items: [] };
  Object.defineProperty(malformedTag, "items", {
    configurable: true,
    enumerable: true,
    get() { throw new Error("typed-node getter invoked"); },
  });
  assertUnsupported(() => decodeCanonicalValue(malformedTag));

  const items = new Proxy([], {
    get() { throw new Error("items proxy trap invoked"); },
  });
  assertUnsupported(() => decodeCanonicalValue({ kind: "array", items }));
});
