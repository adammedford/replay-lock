import { calculate } from "../src/calculation.js";

test("existing integration coverage exercises the calculation naturally", () => {
  expect(calculate(2, 3)).toBe(5);
});
