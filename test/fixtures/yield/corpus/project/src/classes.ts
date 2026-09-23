import { twMerge } from "mergelike";

export function initial(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

export function cn(...classes: string[]): string {
  return twMerge(classes.join(" "));
}
