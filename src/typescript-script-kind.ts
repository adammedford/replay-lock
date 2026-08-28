import ts from "typescript";

const supportedSourceExtension = /\.[cm]?[jt]sx?$/;

/** Whether a filename belongs to ReplayLock's TypeScript/JavaScript source set. */
export function isTypeScriptSourceFilename(filename: string): boolean {
  return supportedSourceExtension.test(filename);
}

/** Select the parser mode for the locked Vite source-extension policy. */
export function typescriptScriptKind(filename: string): ts.ScriptKind {
  if (/\.tsx$/.test(filename)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(filename)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filename)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
