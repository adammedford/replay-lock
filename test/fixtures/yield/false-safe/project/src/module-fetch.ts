const warmup = fetch("https://replaylock.invalid/warmup");

export function increment(value: number): number {
  return value + 1;
}

export function pending(): Promise<Response> {
  return warmup;
}
