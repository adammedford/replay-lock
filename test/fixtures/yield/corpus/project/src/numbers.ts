export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function bmi(weightKg: number, heightM: number): number {
  return weightKg / (heightM * heightM);
}

export function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

export function isEven(value: number): boolean {
  return value % 2 === 0;
}
