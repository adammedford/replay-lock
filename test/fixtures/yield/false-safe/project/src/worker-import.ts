import Worker from "./work.ts?worker";

export function workerName(): string {
  return typeof Worker;
}
