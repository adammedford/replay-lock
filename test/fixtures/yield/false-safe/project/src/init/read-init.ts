import { readFileSync } from "node:fs";

const config = readFileSync("replaylock-config.json", "utf8");

export function besideConfigRead(value: number): number {
  return value;
}

export function configLength(): number {
  return config.length;
}
