import { register } from "./registry";

register("local");

export function besideRegister(value: number): number {
  return value;
}
