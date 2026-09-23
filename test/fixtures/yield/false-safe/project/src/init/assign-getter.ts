const source = {
  get installed() {
    (globalThis as unknown as Record<string, unknown>).installed = true;
    return true;
  },
};
// Object.assign reads every source property, running its getters.
export const merged = Object.assign({}, source);

export function besideAssign(value: number): number {
  return value;
}
