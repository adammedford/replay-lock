export function requirePositive(value: number): number {
  if (value <= 0) throw new RangeError("value must be positive");
  return value;
}
