// Reading every value of the global object runs host getters.
export const snapshot = Object.values(globalThis);

export function besideGlobalValues(value: number): number {
  return value;
}
