import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { createAssumptionFingerprint } from "./assumptions.js";
import { analyzeProjectCallGraph, type CallGraphAnalysis } from "./call-graph.js";
import { resolveCallableModuleLocator } from "./callable-locator.js";
import { INTRINSIC_CATALOG_VERSION } from "./effect-analyzer.js";
import { parseCase, type CaseArtifact } from "./model.js";
import { emptyPackageCatalog, type PackageCatalog } from "./package-catalog.js";
import { readProjectLockfile, type ProjectLockfile } from "./project-lockfile.js";
import { resolveProjectPackageCatalog } from "./project-execution.js";
import { typescriptScriptKind } from "./typescript-script-kind.js";

export type VerificationPreflightCode =
  | "CASE_SCHEMA_UNSUPPORTED"
  | "ORPHANED_CALLABLE"
  | "CAPTURE_POLICY_CHANGED"
  | "UNSUPPORTED_CALLABLE"
  | "EFFECT_REFUTED"
  | "MISSING_ASSUMPTION"
  | "STALE_ASSERTION";

export class VerificationPreflightError extends Error {
  constructor(
    readonly code: VerificationPreflightCode,
    readonly locator: string,
    detail: string,
  ) {
    super(`${code} ${locator}: ${detail}`);
    this.name = "VerificationPreflightError";
  }
}

export interface AcceptedCaseInput {
  filename: string;
  text: string;
}

/**
 * Parse and re-qualify the complete accepted case set without importing or
 * invoking project code. A caller may start its test harness only after this
 * promise resolves.
 */
export async function preflightAcceptedCases(
  projectRoot: string,
  inputs: readonly AcceptedCaseInput[],
): Promise<CaseArtifact[]> {
  const parsed = inputs.map(({ filename, text }) => parseAcceptedCase(filename, text));
  const catalogResolution = await resolveProjectPackageCatalog(projectRoot, "replay");
  if (!catalogResolution.ok) {
    const detail = catalogResolution.detailCode ? ` ${catalogResolution.detailCode}` : "";
    throw new Error(`TRUSTED_PACKAGE_INVALID ${catalogResolution.code}${detail}: project trusted-package catalog is invalid`);
  }
  const packageCatalog = catalogResolution.catalog ?? emptyPackageCatalog;
  let lockfile: ProjectLockfile | undefined;
  try {
    lockfile = await readProjectLockfile(projectRoot);
  } catch {
    lockfile = undefined;
  }

  const prepared: PreparedTarget[] = [];
  for (const artifact of parsed) prepared.push(await prepareTarget(projectRoot, artifact, packageCatalog, lockfile));

  // Evaluate only after every artifact and target has been prepared. This is
  // intentionally separate from execution: a valid earlier case can never run
  // before a later invalid case is discovered.
  for (const target of prepared) validateEligibility(projectRoot, target);
  return parsed;
}

function parseAcceptedCase(filename: string, text: string): CaseArtifact {
  try {
    return parseCase(text);
  } catch (error) {
    const reason = error instanceof Error && error.message.length > 0
      ? ` (${error.message})`
      : "";
    throw new VerificationPreflightError(
      "CASE_SCHEMA_UNSUPPORTED",
      filename,
      `accepted case is malformed or uses an unsupported schema version${reason}`,
    );
  }
}

interface PreparedTarget {
  artifact: CaseArtifact;
  modules: Readonly<Record<string, string>>;
  analysis: CallGraphAnalysis;
  policy: SourcePolicy;
}

async function prepareTarget(
  projectRoot: string,
  artifact: CaseArtifact,
  packageCatalog: PackageCatalog,
  lockfile: ProjectLockfile | undefined,
): Promise<PreparedTarget> {
  const locator = `${artifact.locator.module}#${artifact.locator.exportName}`;
  const absoluteModule = path.join(projectRoot, artifact.locator.module);
  const resolution = resolveCallableModuleLocator(projectRoot, absoluteModule);
  if (!resolution.ok || resolution.locator !== artifact.locator.module) {
    throw new VerificationPreflightError(
      "ORPHANED_CALLABLE",
      locator,
      resolution.ok ? "module locator no longer resolves exactly" : resolution.message,
    );
  }

  let source: string;
  try {
    source = await readFile(absoluteModule, "utf8");
  } catch {
    throw new VerificationPreflightError("ORPHANED_CALLABLE", locator, "module no longer exists");
  }
  const sourceFile = ts.createSourceFile(
    artifact.locator.module,
    source,
    ts.ScriptTarget.Latest,
    true,
    typescriptScriptKind(artifact.locator.module),
  );
  const exported = findExactExport(sourceFile, artifact.locator.exportName);
  if (!exported) {
    throw new VerificationPreflightError("ORPHANED_CALLABLE", locator, "exact named export no longer exists");
  }
  if (!exported.supported) {
    throw new VerificationPreflightError(
      "UNSUPPORTED_CALLABLE",
      locator,
      "export is no longer a directly exported named synchronous function",
    );
  }

  const policy = sourcePolicy(exported.node);
  if (!policy.capture) {
    throw new VerificationPreflightError(
      "CAPTURE_POLICY_CHANGED",
      locator,
      "the capture directive was removed",
    );
  }
  if (policy.excluded) {
    throw new VerificationPreflightError(
      "CAPTURE_POLICY_CHANGED",
      locator,
      "the callable is now excluded",
    );
  }
  if (policy.invalid) {
    throw new VerificationPreflightError(
      "CAPTURE_POLICY_CHANGED",
      locator,
      "the callable has an invalid ReplayLock source policy",
    );
  }

  const modules = await collectProjectModules(projectRoot, absoluteModule, artifact.locator.module, source);
  const analysis = analyzeProjectCallGraph({
    modules,
    entryModule: artifact.locator.module,
    exportName: artifact.locator.exportName,
    packageCatalog,
    ...(lockfile ? { lockfile } : {}),
  });
  return { artifact, modules, analysis, policy };
}

function validateEligibility(projectRoot: string, target: PreparedTarget): void {
  const { artifact, modules, analysis, policy } = target;
  const locator = `${artifact.locator.module}#${artifact.locator.exportName}`;
  if (analysis.verdict === "refuted") {
    throw new VerificationPreflightError(
      "EFFECT_REFUTED",
      locator,
      "current reachable source graph contains refuting effect evidence",
    );
  }
  const assumption = artifact.eligibility.assumption;
  if (!assumption) {
    if (analysis.verdict === "likely-safe") return;
    throw new VerificationPreflightError(
      "MISSING_ASSUMPTION",
      locator,
      artifact.eligibility.basis === "catalog"
        ? "the trusted-package catalog entry this case relied on no longer matches"
        : "current unknown effects require retained reviewed assumption evidence",
    );
  }
  if (!policy.assumed) {
    throw new VerificationPreflightError(
      "MISSING_ASSUMPTION",
      locator,
      "the reviewed source assumption was removed",
    );
  }
  let fingerprint: string;
  try {
    fingerprint = createAssumptionFingerprint({
      modules,
      analysis,
      projectRoot,
      analyzerVersion: analysis.analyzerVersion,
      intrinsicCatalogVersion: INTRINSIC_CATALOG_VERSION,
    });
  } catch {
    throw new VerificationPreflightError(
      "STALE_ASSERTION",
      locator,
      "current fingerprint inputs are missing or ambiguous",
    );
  }
  if (
    fingerprint !== assumption.fingerprint ||
    assumption.analyzerVersion !== analysis.analyzerVersion ||
    assumption.intrinsicCatalogVersion !== INTRINSIC_CATALOG_VERSION
  ) {
    throw new VerificationPreflightError(
      "STALE_ASSERTION",
      locator,
      "reviewed assumption fingerprint no longer matches current source evidence",
    );
  }
}

type ExactExport = { supported: true; node: ts.Node } | { supported: false; node: ts.Node };

function findExactExport(sourceFile: ts.SourceFile, exportName: string): ExactExport | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExport(statement) && statement.name?.text === exportName) {
      const supported = Boolean(
        statement.body &&
        !statement.asteriskToken &&
        !hasModifier(statement, ts.SyntaxKind.DefaultKeyword),
      );
      return { supported, node: statement };
    }
    if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
        const initializer = declaration.initializer;
        const supported = Boolean(
          statement.declarationList.declarations.length === 1 &&
          (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
          initializer &&
          (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) &&
          !initializer.asteriskToken &&
          (ts.isFunctionExpression(initializer) || initializer.parameters.every(
            (parameter) =>
              ts.isIdentifier(parameter.name) &&
              parameter.initializer === undefined &&
              parameter.dotDotDotToken === undefined,
          )),
        );
        return { supported, node: statement };
      }
    }
    if (ts.isClassDeclaration(statement) && hasExport(statement) && statement.name?.text === exportName) {
      return { supported: false, node: statement };
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      if (statement.exportClause.elements.some((element) => element.name.text === exportName)) {
        return { supported: false, node: statement };
      }
    }
  }
  return undefined;
}

interface SourcePolicy {
  capture: boolean;
  assumed: boolean;
  excluded: boolean;
  invalid: boolean;
}

function sourcePolicy(node: ts.Node): SourcePolicy {
  let capture = false;
  let assumed = false;
  let excluded = false;
  let invalid = false;
  const tags = ts.getJSDocTags(node).filter(
    (tag) => tag.tagName.text === "replaylock" && tag.parent.parent === node,
  );
  for (const tag of tags) {
    const comment = jsDocCommentText(tag.comment).trim();
    const separator = comment.search(/\s/);
    const directive = separator < 0 ? comment : comment.slice(0, separator);
    const reason = separator < 0 ? "" : comment.slice(separator).trim();
    if (directive === "capture") {
      capture = true;
      invalid ||= reason.length > 0;
    } else if (directive === "assume-pure") {
      assumed = true;
      invalid ||= reason.length === 0;
    } else if (directive === "exclude") {
      excluded = true;
      invalid ||= reason.length === 0;
    } else {
      invalid = true;
    }
  }
  invalid ||= assumed && !capture;
  invalid ||= excluded && (capture || assumed);
  return { capture, assumed, excluded, invalid };
}

async function collectProjectModules(
  projectRoot: string,
  entryPath: string,
  entryLocator: string,
  entrySource: string,
): Promise<Record<string, string>> {
  const modules: Record<string, string> = { [entryLocator]: entrySource };
  const queue = [{ absolutePath: entryPath, locator: entryLocator, source: entrySource }];
  const visited = new Set([entryLocator]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const sourceFile = ts.createSourceFile(
      current.locator,
      current.source,
      ts.ScriptTarget.Latest,
      true,
      typescriptScriptKind(current.locator),
    );
    for (const statement of sourceFile.statements) {
      let specifier: string | undefined;
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifier = statement.moduleSpecifier.text;
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifier = statement.moduleSpecifier.text;
      }
      if (!specifier?.startsWith(".")) continue;
      const resolved = await resolveLocalImport(
        projectRoot,
        current.absolutePath,
        current.locator,
        specifier,
      );
      if (!resolved || visited.has(resolved.locator)) continue;
      const source = await readFile(resolved.absolutePath, "utf8");
      visited.add(resolved.locator);
      modules[resolved.locator] = source;
      queue.push({ ...resolved, source });
    }
  }
  return modules;
}

async function resolveLocalImport(
  projectRoot: string,
  importer: string,
  importerLocator: string,
  specifier: string,
): Promise<{ absolutePath: string; locator: string } | undefined> {
  const base = path.resolve(path.dirname(importer), specifier);
  const extension = path.extname(base);
  const candidates = extension
    ? [
        base,
        ...([".js", ".mjs", ".cjs"].includes(extension)
          ? [base.slice(0, -extension.length) + ".ts", base.slice(0, -extension.length) + ".tsx"]
          : []),
      ]
    : [
        base,
        ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].map((suffix) => base + suffix),
        ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((name) => path.join(base, name)),
      ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) existing.push(candidate);
    } catch {
      // Missing candidates are expected while resolving an import.
    }
  }
  if (existing.length !== 1) return undefined;
  const absolutePath = existing[0];
  if (!absolutePath) return undefined;
  const resolution = resolveCallableModuleLocator(projectRoot, absolutePath);
  if (!resolution.ok) return undefined;
  const requestedExtension = path.posix.extname(specifier);
  const actualExtension = path.extname(absolutePath);
  const locator = [".js", ".mjs", ".cjs"].includes(requestedExtension) &&
      [".ts", ".tsx", ".mts", ".cts"].includes(actualExtension)
    ? path.posix.normalize(path.posix.join(path.posix.dirname(importerLocator), specifier)).replace(/^\.\//, "")
    : resolution.locator;
  return { absolutePath, locator };
}

function hasExport(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function jsDocCommentText(comment: ts.JSDocTag["comment"]): string {
  if (typeof comment === "string") return comment;
  if (!comment) return "";
  return comment.map((part) => part.getText()).join("");
}
