export function withClockDefault(value = Date.now()): number {
  return value;
}

const LIMIT = { max: 3 };

export function tableDefault(value = LIMIT.max): number {
  return value;
}

export function computedKey({ [String(Math.random())]: value }: Record<string, number>): number {
  return value ?? 0;
}

export const nestedClockDefault = ({ at = Date.now() }: { at?: number }): number => at;
