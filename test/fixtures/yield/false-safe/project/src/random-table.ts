import { randomEntries } from "./entries";

const RANDOM_TABLE = new Map(randomEntries as unknown as [string, number][]);

export function randomTableRead(key: string): number {
  return RANDOM_TABLE.get(key) ?? 0;
}
