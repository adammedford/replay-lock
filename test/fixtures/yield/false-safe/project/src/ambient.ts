// Untraced host or global state.
export function patchedMath(value: number): number {
  return (Math as unknown as { patched: number }).patched + value;
}

export function dynamicMathMember(value: number, key: string): unknown {
  return (Math as unknown as Record<string, unknown>)[key] ?? value;
}

export function argvLength(value: number): number {
  return process.argv.length + value;
}

export function platformName(value: number): string {
  return process.platform + value;
}

export function globalFlag(value: number): unknown {
  return (globalThis as unknown as { flag?: unknown }).flag ?? value;
}
