(globalThis as unknown as { onerror: unknown }).onerror = null;

export function afterHostWrite(value: number): number {
  return value;
}
