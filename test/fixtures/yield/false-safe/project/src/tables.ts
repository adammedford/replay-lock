// Module state that is not an immutable literal table.
const CLOCK = { get now() { return Date.now(); } };
const COUNTS: Record<string, number> = { a: 1 };
const WORD = /\w+/g;
export const SHARED = { limit: 3 };

export function clockTable(): number {
  return CLOCK.now;
}

export function mutatedTable(key: string): number {
  return COUNTS[key] ?? 0;
}

export function bumpTable(key: string): void {
  COUNTS[key] = (COUNTS[key] ?? 0) + 1;
}

export function statefulRegex(text: string): boolean {
  return WORD.test(text);
}

export function exportedTable(value: number): number {
  return SHARED.limit + value;
}
