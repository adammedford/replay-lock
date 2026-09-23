// Built-in methods whose callbacks or receivers would reach effects or shared values.
let total = 0;

function noisy(value: number): number {
  return value + Math.random();
}

export function forEachWrite(values: { count: number }[]): number {
  values.forEach((value) => { value.count++; });
  return values.length;
}

export function helperCallback(values: number[]): number[] {
  return values.map(noisy);
}

export function effectfulCallee(values: number[]): number[] {
  return values.map((value) => noisy(value));
}

export function localeSort(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function asyncCallback(values: number[]): Promise<number>[] {
  return values.map(async (value) => value);
}

export function receiverCallback(values: number[]): number[] {
  return values.map(function (this: { offset: number }, value) { return this.offset + value; });
}

export function aliasPush(input: { items: number[] }): number {
  const items = input.items;
  items.push(1);
  return items.length;
}

export function freezeElements(values: { a: number }[]): number {
  values.forEach((value) => Object.freeze(value));
  return values.length;
}

export function moduleTotal(values: number[]): number {
  values.forEach((value) => { total += value; });
  return values.length;
}

export function randomReplacer(text: string): string {
  return text.replace(/a/, () => String(Math.random()));
}

export function parameterRegex(pattern: RegExp, text: string): boolean {
  return pattern.test(text);
}

export function reduceIntoArgument(values: number[], target: number[]): number[] {
  return values.reduce((accumulator, value) => { accumulator.push(value); return accumulator; }, target);
}
