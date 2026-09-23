// Defining from a descriptor with an accessor runs that accessor.
Object.defineProperty({}, "installed", {
  get value() {
    (globalThis as unknown as Record<string, unknown>).installed = true;
    return true;
  },
});

export function besideAccessorDefinition(value: number): number {
  return value;
}
