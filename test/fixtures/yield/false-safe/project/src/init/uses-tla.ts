import { ready } from "./tla";

export function afterAwait(value: number): number {
  return value + ready;
}
