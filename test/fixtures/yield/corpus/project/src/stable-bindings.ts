const DEFAULT_LABEL = "untitled";
export var legacyLabel = function (value: string) { return value.trim(); };
export let stableIncrement = (value: number) => value + 1;
export function defaultLabel(value = DEFAULT_LABEL) { return value; }
