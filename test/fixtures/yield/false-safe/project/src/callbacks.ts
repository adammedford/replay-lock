// Effects and mutation hidden in callbacks passed to built-in methods.
export function randomInMap(values: number[]): number[] {
  return values.map((value) => value + Math.random());
}

export function sortArgument(values: number[]): number[] {
  return values.sort();
}

export function randomComparator(values: number[]): number[] {
  return [...values].sort(() => Math.random() - 0.5);
}

export function callbackParameter(values: number[], transform: (value: number) => number): number[] {
  return values.map(transform);
}

export function replacerFunction(value: { a: number }): string {
  return JSON.stringify(value, (key, item) => (key === "a" ? Math.random() : item));
}

export function anyReceiver(value: unknown): unknown {
  return (value as { custom(): unknown }).custom();
}
