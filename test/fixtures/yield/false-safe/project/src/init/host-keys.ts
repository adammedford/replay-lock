// The global object's keys are host state.
const keys = Object.keys(globalThis);

export function hostKeyCount(): number {
  return keys.length;
}
