const JSON = { parse(text: string) { return text + Math.random(); } };

export function shadowedJson(text: string): string {
  return JSON.parse(text);
}
