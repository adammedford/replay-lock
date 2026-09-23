// Constant tables that some code can mutate, leak, or read through the prototype.
const RETURNED = { a: 1 };
const PASSED = { a: 1 };
const NESTED = { inner: { a: 1 } };
const PROTO = { __proto__: { a: 1 } } as { a?: number };
const SPECIFIER = { a: 1 };
const DEFAULTED = { a: 1 };
const ASSIGNED = { a: 1 };
const PUSHED = [1, 2];
const CAST = { a: 1 };
const DESTRUCTURED = [1, 2];
const ALIASED = { a: 1 };
const PROTOTYPE_READ = { a: 1 };
const OBJECT_VALUES = new Map([["a", { x: 1 }]] as [string, { x: number }][]);
const METHOD = { a: 1, read() { return Date.now(); } };

function mutate(target: { a: number }): void {
  target.a = 2;
}

export function returnsTable(): { a: number } {
  return RETURNED;
}

export function passesTable(): number {
  mutate(PASSED);
  return PASSED.a;
}

export function nestedTable(): number {
  return NESTED.inner.a;
}

export function protoTable(): number | undefined {
  return PROTO.a;
}

export function specifierTable(): number {
  return SPECIFIER.a;
}

export function defaultTable(): number {
  return DEFAULTED.a;
}

export function assignedTable(): number {
  Object.assign(ASSIGNED, { a: 2 });
  return ASSIGNED.a;
}

export function pushedTable(): number {
  return PUSHED.length;
}

export function growTable(value: number): void {
  PUSHED.push(value);
}

export function castTable(): number {
  (CAST as { a: number }).a = 2;
  return CAST.a;
}

export function destructuredTable(): number {
  [DESTRUCTURED[0]] = [5];
  return DESTRUCTURED[0]!;
}

export function aliasedTable(): number {
  const alias = ALIASED;
  alias.a = 3;
  return ALIASED.a;
}

export function prototypeReadTable(): unknown {
  return (PROTOTYPE_READ as unknown as { constructor: unknown }).constructor;
}

export function objectValueTable(key: string): number {
  return OBJECT_VALUES.size + key.length;
}

export function methodTable(): number {
  return METHOD.a;
}

export { SPECIFIER };
export default DEFAULTED;
