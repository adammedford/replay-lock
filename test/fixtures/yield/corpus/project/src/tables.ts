const STATUS_LABELS = { draft: "Draft", published: "Published" } as const;
const FACTORS = Object.freeze({ kg: 1, lb: 0.453592 });
const PRIORITY = new Map([["low", 1], ["high", 3]]);

export function statusLabel(status: "draft" | "published"): string {
  return STATUS_LABELS[status];
}

export function toKg(value: number, unit: "kg" | "lb"): number {
  return value * FACTORS[unit];
}

export function priority(name: string): number {
  return PRIORITY.get(name) ?? 0;
}

export function isPositive(value: number): boolean {
  return value > 0;
}
