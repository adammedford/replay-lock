// Function values that a built-in or the language invokes implicitly.
import { writeFileSync } from "node:fs";
import os from "node:os";

function randomText(): string {
  return String(Math.random());
}

export function coerceToString(value: number): string {
  return String({ toString() { return String(Math.random()); } }) + value;
}

export function coerceValueOf(value: number): number {
  return value + ({ valueOf() { return Date.now(); } } as unknown as number);
}

export function templateToString(value: number): string {
  return `${{ toString: () => String(Math.random()) }}${value}`;
}

export function iteratorRandom(value: number): number {
  let total = value;
  for (const item of { *[Symbol.iterator]() { yield Math.random(); } } as unknown as number[]) total += item;
  return total;
}

export function writeInToString(value: number): string {
  return String({ toString() { writeFileSync("replaylock-false-safe.txt", "x"); return "s"; } }) + value;
}

export function helperAsToString(value: number): string {
  return String({ toString: randomText }) + value;
}

export function helperCall(value: number): string {
  return randomText.call(null) + value;
}

export function randomAsValue(value: number): string {
  return String({ toString: Math.random }) + value;
}

export function clockAliasAsValue(value: number): string {
  const now = Date.now;
  return String({ toString: now }) + value;
}

export function exitAsValue(value: number): string {
  return String({ toString: process.exit }) + value;
}

export function hostnameAsValue(value: number): string {
  return String({ toString: os.hostname }) + value;
}
