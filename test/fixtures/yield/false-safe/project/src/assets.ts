// Imports that execute no code still bind values analysis cannot see.
import data from "./data.json";
import styles from "./button.module.css";

export function jsonLimit(value: number): number {
  return data.limit + value;
}

export function cssClass(): string {
  return styles.button;
}
