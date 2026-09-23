export function roundTrip(value: { a: number }): { a: number } {
  return JSON.parse(JSON.stringify(value));
}

export function toQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function encodePath(segment: string): string {
  return encodeURIComponent(segment);
}
