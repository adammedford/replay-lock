import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  UnsupportedValueError,
  canonicalCompletionBytes,
  canonicalCompletionJson,
  canonicalCompletionsEqual,
  canonicalValueBytes,
  canonicalValueJson,
  canonicalValuesEqual,
  decodeCanonicalCompletion,
  decodeCanonicalValue,
  encodeCanonicalCompletion,
  encodeCanonicalValue,
} from "../../dist/canonical.js";

test("canonical values round-trip every supported scalar exactly", () => {
  const values = [
    null,
    false,
    true,
    "",
    "plain",
    "\u0000\ud800\n😀",
    0,
    1,
    -1,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
  ];

  for (const value of values) {
    const decoded = decodeCanonicalValue(encodeCanonicalValue(value));
    assert.ok(Object.is(decoded, value), `failed scalar round trip for ${String(value)}`);
  }

  assert.deepEqual(encodeCanonicalValue(null), { kind: "null" });
  assert.deepEqual(encodeCanonicalValue(false), { kind: "boolean", value: false });
  assert.deepEqual(encodeCanonicalValue("x"), { kind: "string", value: "x" });
  assert.deepEqual(encodeCanonicalValue(3.5), { kind: "number", value: 3.5 });
  for (const unsupportedNumber of [-0, Infinity, -Infinity, Number.NaN]) {
    assert.throws(() => encodeCanonicalValue(unsupportedNumber), UnsupportedValueError);
  }
});

test("canonical values round-trip dense arrays and ordinary plain records", () => {
  const value = {
    empty: [],
    nested: [null, true, "value", 2.5, { child: [false] }],
    record: {},
  };
  const decoded = decodeCanonicalValue(encodeCanonicalValue(value));
  assert.deepEqual(decoded, value);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.getPrototypeOf(decoded.nested), Array.prototype);

  const nullPrototype = Object.create(null);
  nullPrototype.answer = 42;
  assert.throws(() => encodeCanonicalValue(nullPrototype), UnsupportedValueError);
});

test("canonical values reject executable, aliased, and non-data inputs", () => {
  for (const value of [undefined, 1n, Symbol("value"), () => 1, new Date()]) {
    assert.throws(() => encodeCanonicalValue(value), UnsupportedValueError);
  }

  const shared = { value: true };
  assert.throws(() => encodeCanonicalValue({ first: shared, second: shared }), UnsupportedValueError);

  const accessor = {};
  Object.defineProperty(accessor, "value", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("accessor must not run");
    },
  });
  assert.throws(() => encodeCanonicalValue(accessor), UnsupportedValueError);
});

test("canonical encoding uses typed nodes and sorted record-entry keys", () => {
  const encoded = encodeCanonicalValue({ value: 2, kind: "array", entries: [], items: null, a: 1 });
  assert.deepEqual(encoded, {
    kind: "record",
    entries: [
      { key: "a", value: { kind: "number", value: 1 } },
      { key: "entries", value: { kind: "array", items: [] } },
      { key: "items", value: { kind: "null" } },
      { key: "kind", value: { kind: "string", value: "array" } },
      { key: "value", value: { kind: "number", value: 2 } },
    ],
  });
  assert.equal(
    canonicalValueJson(encoded),
    '{"kind":"record","entries":[{"key":"a","value":{"kind":"number","value":1}},{"key":"entries","value":{"kind":"array","items":[]}},{"key":"items","value":{"kind":"null"}},{"key":"kind","value":{"kind":"string","value":"array"}},{"key":"value","value":{"kind":"number","value":2}}]}',
  );
});

test("canonical record decoding treats __proto__ as an ordinary data key", () => {
  const input = {};
  Object.defineProperty(input, "__proto__", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { safe: true },
  });
  const decoded = decodeCanonicalValue(encodeCanonicalValue(input));
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.hasOwn(decoded, "__proto__"), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(decoded, "__proto__"), {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { safe: true },
  });
});

test("canonical decoding rejects ambiguous or noncanonical record entry order", () => {
  assert.throws(
    () =>
      decodeCanonicalValue({
        kind: "record",
        entries: [
          { key: "b", value: { kind: "null" } },
          { key: "a", value: { kind: "null" } },
        ],
      }),
    UnsupportedValueError,
  );
  assert.throws(
    () =>
      decodeCanonicalValue({
        kind: "record",
        entries: [
          { key: "a", value: { kind: "null" } },
          { key: "a", value: { kind: "null" } },
        ],
      }),
    UnsupportedValueError,
  );
});

test("canonical decoding rejects sparse or executable node arrays", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => decodeCanonicalValue({ kind: "array", items: sparse }),
    UnsupportedValueError,
  );

  const accessorItems = [];
  Object.defineProperty(accessorItems, "0", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("canonical accessor must not run");
    },
  });
  accessorItems.length = 1;
  assert.throws(
    () => decodeCanonicalValue({ kind: "array", items: accessorItems }),
    UnsupportedValueError,
  );
});

test("canonical completions distinguish returns, thrown values, and standard errors", () => {
  const returned = encodeCanonicalCompletion({ kind: "return", value: "same" });
  const thrownValue = encodeCanonicalCompletion({ kind: "throw", value: "same" });
  assert.deepEqual(returned, {
    kind: "return",
    value: { kind: "string", value: "same" },
  });
  assert.deepEqual(thrownValue, {
    kind: "throw",
    value: { kind: "string", value: "same" },
  });
  assert.equal(canonicalCompletionsEqual(returned, thrownValue), false);

  const errors = [
    new Error("error"),
    new EvalError("eval"),
    new RangeError("range"),
    new ReferenceError("reference"),
    new SyntaxError("syntax"),
    new TypeError("type"),
    new URIError("uri"),
    new AggregateError([new Error("nested")], "aggregate"),
  ];
  for (const error of errors) {
    const encoded = encodeCanonicalCompletion({ kind: "throw", value: error });
    assert.deepEqual(encoded, {
      kind: "throw",
      error: { kind: "standard-error", name: error.name, message: error.message },
    });
    const json = canonicalCompletionJson(encoded);
    assert.equal(json.includes("stack"), false);
    assert.equal(json.includes("nested"), false);
    const decoded = decodeCanonicalCompletion(encoded);
    assert.equal(decoded.kind, "throw");
    assert.equal(Object.getPrototypeOf(decoded.value), Object.getPrototypeOf(error));
    assert.equal(decoded.value.message, error.message);
  }
});

test("completion input accessors are rejected before they execute", () => {
  const completion = {};
  Object.defineProperties(completion, {
    kind: {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error("completion accessor must not run");
      },
    },
    value: {
      configurable: true,
      enumerable: true,
      value: 1,
    },
  });
  assert.throws(() => encodeCanonicalCompletion(completion), UnsupportedValueError);
});

test("exact comparison detects scalar, structural, and completion-kind changes", () => {
  const number = encodeCanonicalValue(1);
  const string = encodeCanonicalValue("1");
  const record = encodeCanonicalValue({ 0: 1 });
  const array = encodeCanonicalValue([1]);
  const nestedA = encodeCanonicalValue({ nested: [1, { a: true }] });
  const nestedB = encodeCanonicalValue({ nested: [1, { a: false }] });

  assert.equal(canonicalValuesEqual(number, encodeCanonicalValue(1)), true);
  assert.equal(canonicalValuesEqual(number, string), false);
  assert.equal(canonicalValuesEqual(record, array), false);
  assert.equal(canonicalValuesEqual(nestedA, nestedB), false);
  assert.equal(
    canonicalCompletionsEqual(
      encodeCanonicalCompletion({ kind: "throw", value: new TypeError("a") }),
      encodeCanonicalCompletion({ kind: "throw", value: new TypeError("b") }),
    ),
    false,
  );
});

test("equivalent observations have byte-identical canonical output across processes", () => {
  const moduleUrl = new URL("../../dist/canonical.js", import.meta.url).href;
  const source = `
    import { canonicalCompletionBytes, encodeCanonicalCompletion } from ${JSON.stringify(moduleUrl)};
    const record = {};
    for (const key of JSON.parse(process.argv[1])) record[key] = { nested: [true, null, 4.5] };
    process.stdout.write(canonicalCompletionBytes(encodeCanonicalCompletion({ kind: "return", value: record })));
  `;
  const first = spawnSync(process.execPath, ["--input-type=module", "--eval", source, '["z","a"]']);
  const second = spawnSync(process.execPath, ["--input-type=module", "--eval", source, '["a","z"]']);
  assert.equal(first.status, 0, first.stderr.toString());
  assert.equal(second.status, 0, second.stderr.toString());
  assert.deepEqual(first.stdout, second.stdout);

  const local = canonicalCompletionBytes(
    encodeCanonicalCompletion({
      kind: "return",
      value: { z: { nested: [true, null, 4.5] }, a: { nested: [true, null, 4.5] } },
    }),
  );
  assert.deepEqual(first.stdout, local);
  assert.deepEqual(canonicalValueBytes(encodeCanonicalValue({ b: 2, a: 1 })), canonicalValueBytes(encodeCanonicalValue({ a: 1, b: 2 })));
});
