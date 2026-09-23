import { flag } from "./patcher";

export function patchedImport(value: number): number {
  return value + flag;
}
