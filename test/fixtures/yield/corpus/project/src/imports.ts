import { isEven } from "#utils/numbers";
import "./styles.css";

export function parityLabel(value: number): string {
  return isEven(value) ? "even" : "odd";
}
