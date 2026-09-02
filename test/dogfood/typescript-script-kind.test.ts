import { expect, test } from "vitest";
import {
  isTypeScriptSourceFilename,
  typescriptScriptKind,
} from "../../src/typescript-script-kind.js";

test("recognizes supported and unsupported source filenames naturally", () => {
  expect(isTypeScriptSourceFilename("sample.ts")).toBe(true);
  expect(isTypeScriptSourceFilename("README.md")).toBe(false);
});

test("selects each supported parser mode naturally", () => {
  expect(typescriptScriptKind("view.tsx")).toBe(4);
  expect(typescriptScriptKind("view.jsx")).toBe(2);
  expect(typescriptScriptKind("module.mjs")).toBe(1);
  expect(typescriptScriptKind("module.ts")).toBe(3);
});
