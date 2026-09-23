import { install } from "./installer";

install(globalThis as unknown as Record<string, unknown>);

export function afterInstall(value: number): number {
  return value;
}
