// Catalogued built-ins used in ways that would run user code or hide mutation.
export function replacerParameter(value: { a: number }, replacer: string[]): string {
  return JSON.stringify(value, replacer);
}

export function mappedFrom(values: number[]): number[] {
  return Array.from(values, (value) => value + Math.random());
}

export function freezeArgument(value: { a: number }): { a: number } {
  return Object.freeze(value);
}

export function aliasedFreeze(value: { a: number }): { a: number } {
  const freeze = Object.freeze;
  return freeze(value);
}

export function parenthesizedFreeze(value: { a: number }): { a: number } {
  return (Object.freeze)(value);
}

export function globalFreeze(value: { a: number }): { a: number } {
  return globalThis.Object.freeze(value);
}

export function mapWithoutNew(value: string): unknown {
  return (Map as unknown as (entries: unknown) => unknown)([[value, 1]]);
}
