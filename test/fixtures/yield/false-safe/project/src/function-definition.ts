const registered = Object.assign(() => 1, {
  get id() { globalThis.REPLAYLOCK_UNSAFE_REGISTRY = "changed"; return "registered"; },
});

export function readsEffectfulFunctionDefinition(value: number) { return value + 1; }
