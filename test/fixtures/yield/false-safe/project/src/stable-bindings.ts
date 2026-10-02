export let reassigned = (value: number) => value + 1;
reassigned = (value: number) => value - 1;
const CLOCK = Date.now();
export function clockConstantDefault(value = CLOCK) { return value; }
const DATA = { label: "first" };
export function mutableConstantDefault(value = DATA) { return value.label; }
export function mutateDefault() { DATA.label = "changed"; }

export var destructuredReassignment = (value: number) => value + 1;
[destructuredReassignment] = [(value: number) => value - 1];
export let loopReassignment = (value: number) => value + 1;
for (loopReassignment of [(value: number) => value - 1]) { /* reassigned by the loop */ }
