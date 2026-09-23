import * as clock from "./clock";

export function namespaceRead(value: number): number {
  return clock.bootedAt + value;
}
