const startedAt = Date.now();

export function double(value: number): number {
  return value * 2;
}

export function uptime(now: number): number {
  return now - startedAt;
}
