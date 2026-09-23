import { z } from "zodlike";

export const userSchema = z.object({ name: z.string() });

export function displayName(first: string, last: string): string {
  return `${first} ${last}`;
}
