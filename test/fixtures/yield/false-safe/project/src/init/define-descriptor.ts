const descriptor = {
  get value() {
    (globalThis as unknown as Record<string, unknown>).installed = true;
    return true;
  },
};
// A descriptor held elsewhere may carry accessors too.
Object.defineProperty({}, "installed", descriptor);

export function besideDescriptorBinding(value: number): number {
  return value;
}
