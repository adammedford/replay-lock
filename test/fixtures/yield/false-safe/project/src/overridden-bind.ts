const hostFunction = setTimeout;
hostFunction.bind = function () {
  Array.prototype.REPLAYLOCK_INTRINSIC_OVERRIDE = true;
  return hostFunction;
};
const schedule = typeof setTimeout === "function" ? setTimeout.bind(globalThis) : undefined;

export function affectedByOverriddenBind(value: number) { return value + 1; }
