export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function sortedKeys(record: Record<string, number>): string[] {
  return Object.keys(record).sort();
}

export function first<T>(values: T[]): T | null {
  return values.length > 0 ? values[0]! : null;
}

export function pairs(values: number[]): number[][] {
  const result: number[][] = [];
  for (let index = 0; index + 1 < values.length; index += 2) result.push([values[index]!, values[index + 1]!]);
  return result;
}
