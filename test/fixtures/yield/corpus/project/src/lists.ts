export function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function compact(values: (number | null)[]): (number | null)[] {
  return values.filter(Boolean);
}

export function segmentLengths(path: string): number[] {
  return path.trim().split(":").map((part) => part.length);
}

export function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  values.forEach((value) => { counts[value] = (counts[value] ?? 0) + 1; });
  return counts;
}

export function evens(values: number[]): number[] {
  const out: number[] = [];
  for (const value of values) if (value % 2 === 0) out.push(value);
  return out;
}

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+$/.test(value);
}

export function titleCase(value: string): string {
  return value.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}
