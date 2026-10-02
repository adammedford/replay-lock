const secrets = process.env.NODE_ENV?.split(",");
const schedule = typeof setTimeout === "function" ? setTimeout.bind(globalThis) : undefined;

export function readsInitializedEnvironment() { return secrets?.[0]; }
export function runsInitializedTimer() { return schedule?.(() => {}, 0); }
