import { later } from "./clock";

export function sinceBoot(value: number): number {
  return value + later;
}
