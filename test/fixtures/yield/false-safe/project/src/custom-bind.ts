// A typeof guard proves callability, not that an ambient object's bind is native.
const bound = typeof globalThis.REPLAYLOCK_CUSTOM_FUNCTION === "function"
  ? globalThis.REPLAYLOCK_CUSTOM_FUNCTION.bind(globalThis)
  : undefined;

export function affectedByCustomBind(value: number) { return value + 1; }
