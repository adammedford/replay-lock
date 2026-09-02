import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ResolvedConfig } from "vite";
import { resolveCallableModuleLocator } from "./callable-locator.js";
import { analyzeProjectCallGraph } from "./call-graph.js";
import { createAssumptionFingerprint, unknownEvidence } from "./assumptions.js";
import { INTRINSIC_CATALOG_VERSION } from "./effect-analyzer.js";
import type { AssumptionCaptureEvidence, TrustedPackageCaptureEvidence } from "./model.js";
import type { SourceDiagnostic, SourceDiagnosticCode } from "./model.js";
import { emptyPackageCatalog, type PackageCatalog } from "./package-catalog.js";
import { findProjectConfigurationSync } from "./project-configuration.js";
import { resolveProjectPackageCatalog } from "./project-execution.js";
import { selectProjectLockfile, type ProjectLockfile } from "./project-lockfile.js";
import { isTypeScriptSourceFilename, typescriptScriptKind } from "./typescript-script-kind.js";

const replayLockImplementationRoot = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

interface PackageResolution {
  packageCatalog?: PackageCatalog;
  lockfile?: ProjectLockfile;
}

export function replaylock(): Plugin {
  // Activation is a capability, not a mode that can be toggled while Vite is
  // processing a module graph. Snapshot it when the plugin is constructed so
  // an ordinary Vite process cannot become instrumented through a later env
  // mutation.
  const activation = activeSession();
  let resolvedConfig: ResolvedConfig | undefined;
  let projectConfiguration: string | undefined;
  let packageCatalog: PackageCatalog = emptyPackageCatalog;
  let lockfile: ProjectLockfile | undefined;

  const publicRegistryId = "virtual:replaylock/value-adapters";
  const internalRegistryId = `\0${publicRegistryId}`;

  return {
    name: "replaylock",
    enforce: "pre",
    async configResolved(config) {
      resolvedConfig = config;
      projectConfiguration = findProjectConfigurationSync(config.root);
      try {
        packageCatalog = (await resolveProjectPackageCatalog(config.root, "recording")).catalog ?? emptyPackageCatalog;
      } catch {
        packageCatalog = emptyPackageCatalog;
      }
      try {
        lockfile = selectProjectLockfile({ projectRoot: config.root });
      } catch {
        lockfile = undefined;
      }
      if (!activation) return;

      mkdirSync(activation.directory, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(activation.directory, "handshake.json"),
        `${JSON.stringify({ token: activation.token })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    },
    resolveId(id) {
      return id === publicRegistryId ? internalRegistryId : null;
    },
    load(id) {
      if (id !== internalRegistryId) return null;
      const adaptersModule = new URL("./adapters.js", import.meta.url).href;
      if (!projectConfiguration) {
        return `import { emptyValueAdapterRegistry } from ${JSON.stringify(adaptersModule)};\nexport const valueAdapterRegistry = emptyValueAdapterRegistry;\n`;
      }
      return `import { appendFileSync } from "node:fs";\nimport path from "node:path";\nimport configuration from ${JSON.stringify(projectConfiguration)};\nimport { createValueAdapterRegistry, ValueAdapterConfigurationError } from ${JSON.stringify(adaptersModule)};\nlet valueAdapterRegistry;\ntry {\n  valueAdapterRegistry = createValueAdapterRegistry(configuration);\n} catch (error) {\n  if (error instanceof ValueAdapterConfigurationError) {\n    const directory = process.env.REPLAYLOCK_SESSION_DIR;\n    const token = process.env.REPLAYLOCK_SESSION_TOKEN;\n    if (directory && token) appendFileSync(path.join(directory, "adapter-diagnostics.jsonl"), JSON.stringify({ token, code: error.code, message: error.message }) + "\\n", { encoding: "utf8", mode: 0o600 });\n  }\n  throw error;\n}\nexport { valueAdapterRegistry };\n`;
    },
    transform(code, rawId) {
      if (!activation || !resolvedConfig) return null;

      const id = rawId.split("?", 1)[0] ?? rawId;
      if (id.includes("/node_modules/") || !isTypeScriptSourceFilename(id)) return null;
      // Vite realpaths linked dependencies before transform, so a consumer's
      // `node_modules/replaylock` can arrive here as ReplayLock's checkout path.
      // Permit this package to dogfood its own source, but never let its
      // implementation annotations become capture targets in another project.
      if (isReplayLockImplementationModule(resolvedConfig.root, id)) return null;

      const sourceFile = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        typescriptScriptKind(id),
      );
      const evaluated = evaluateCaptureSource(resolvedConfig.root, id, code, sourceFile, {
        packageCatalog,
        ...(lockfile ? { lockfile } : {}),
      });
      for (const diagnostic of evaluated.diagnostics) {
        writeSourceDiagnostic(activation.directory, diagnostic);
      }
      if (!evaluated.moduleLocator) return null;
      const moduleLocator = evaluated.moduleLocator;
      const targets = evaluated.targets;
      const projectModules = evaluated.projectModules;
      if (targets.length === 0) return null;

      const transformed = new MagicString(code);
      const sourceGraphDigest = digestProjectModules(projectModules);
      const observerBinding = freshObserverBinding(sourceFile);
      const adapterBinding = freshBinding(sourceFile, "__replaylockValueAdapters");

      for (const capture of [...targets].reverse()) {
        const target = capture.target;
        const metadata = JSON.stringify({
          locator: { module: moduleLocator, exportName: target.exportName },
          sourceGraphDigest,
          ...(capture.assumption ? { assumption: capture.assumption } : {}),
          ...(capture.packageTrust && capture.packageTrust.length > 0 ? { packageTrust: capture.packageTrust } : {}),
        });
        instrumentTarget(transformed, sourceFile, target, metadata, observerBinding, adapterBinding);
      }

      const observerImport = `import { observeCall as ${observerBinding} } from "replaylock/vite/runtime";\n`;
      const adapterImport = `import { valueAdapterRegistry as ${adapterBinding} } from ${JSON.stringify(publicRegistryId)};\n`;
      const hashbangEnd = code.startsWith("#!") ? (code.indexOf("\n") + 1 || code.length) : 0;
      if (hashbangEnd === 0) transformed.prepend(observerImport + adapterImport);
      else transformed.appendLeft(hashbangEnd, observerImport + adapterImport);
      return {
        code: transformed.toString(),
        map: transformed.generateMap({
          file: id,
          source: id,
          includeContent: true,
          hires: true,
        }),
      };
    },
  };
}

function isReplayLockImplementationModule(projectRoot: string, modulePath: string): boolean {
  const physicalProjectRoot = physicalPath(projectRoot);
  if (physicalProjectRoot === replayLockImplementationRoot) return false;
  const relative = path.relative(replayLockImplementationRoot, physicalPath(modulePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function physicalPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

export interface RecordingPreflight {
  captureTargets: number;
  eligibleTargets: number;
  diagnostics: SourceDiagnostic[];
}

/**
 * Analyze all authored project modules before a record command starts. This is
 * deliberately backed by the same evaluator used by the Vite transform: the
 * preflight is an execution gate, never a second interpretation of policy.
 */
export function preflightRecordingProject(
  projectRoot: string,
  resolution: PackageResolution = {},
): RecordingPreflight {
  let captureTargets = 0;
  let eligibleTargets = 0;
  const diagnostics: SourceDiagnostic[] = [];
  for (const sourcePath of projectSourceFiles(projectRoot)) {
    const code = readFileSync(sourcePath, "utf8");
    const evaluated = evaluateCaptureSource(projectRoot, sourcePath, code, undefined, resolution);
    captureTargets += evaluated.captureTargets;
    eligibleTargets += evaluated.targets.length;
    diagnostics.push(...evaluated.diagnostics);
  }
  diagnostics.sort(compareSourceDiagnostics);
  return { captureTargets, eligibleTargets, diagnostics };
}

export type ScanStatus =
  | "eligible"
  | "needs-review"
  | "ineligible"
  | "unsupported-shape"
  | "excluded";

export interface ScanFinding {
  source: string;
  line: number;
  column: number;
  exportName: string;
  status: ScanStatus;
  reasonCode?: string;
}

export interface ScanReport {
  findings: ScanFinding[];
}

/**
 * Report every exported function's capture eligibility across the project,
 * whether or not it already carries a `@replaylock` directive, without
 * executing any test or writing anything under `.replaylock/`. This reuses
 * the same shape recognition and call-graph analysis `record`'s preflight
 * uses; it never launches a second interpretation of policy.
 */
export function scanProjectEligibility(
  projectRoot: string,
  resolution: PackageResolution = {},
): ScanReport {
  const findings: ScanFinding[] = [];
  for (const sourcePath of projectSourceFiles(projectRoot)) {
    const code = readFileSync(sourcePath, "utf8");
    findings.push(...scanSourceFile(projectRoot, sourcePath, code, resolution));
  }
  findings.sort(compareScanFindings);
  return { findings };
}

function scanSourceFile(
  projectRoot: string,
  sourcePath: string,
  code: string,
  resolution: PackageResolution,
): ScanFinding[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    typescriptScriptKind(sourcePath),
  );
  const locatorResolution = resolveCallableModuleLocator(projectRoot, sourcePath);
  if (!locatorResolution.ok) return [];

  const findings: ScanFinding[] = [];
  const projectModules = collectProjectModules(projectRoot, sourcePath, code);
  for (const statement of sourceFile.statements) {
    const target = supportedCaptureTarget(statement, sourceFile);
    if (!target) {
      for (const attempt of scannableExportAttempts(statement)) {
        findings.push(scanFinding(sourceFile, locatorResolution.source, attempt.node, attempt.name, "unsupported-shape"));
      }
      continue;
    }
    const tags = ownReplaylockTags(statement);
    const parsed = parseSourcePolicy(tags);
    if (parsed.errors.length === 0 && parsed.policy.exclusionReasons.length > 0) {
      findings.push(scanFinding(sourceFile, locatorResolution.source, target.callable, target.exportName, "excluded"));
      continue;
    }

    const eligibility = analyzeProjectCallGraph({
      modules: projectModules,
      entryModule: locatorResolution.source,
      exportName: target.exportName,
      ...(resolution.packageCatalog ? { packageCatalog: resolution.packageCatalog } : {}),
      ...(resolution.lockfile ? { lockfile: resolution.lockfile } : {}),
    });
    const hasAssumption = parsed.errors.length === 0 && parsed.policy.assumptionReasons.length > 0;
    if (eligibility.verdict === "likely-safe" || (eligibility.verdict === "unknown" && hasAssumption)) {
      findings.push(scanFinding(sourceFile, locatorResolution.source, target.callable, target.exportName, "eligible"));
      continue;
    }
    const leading = eligibility.findings[0];
    findings.push({
      source: locatorResolution.source,
      ...positionOf(sourceFile, target.callable),
      exportName: target.exportName,
      status: eligibility.verdict === "refuted" ? "ineligible" : "needs-review",
      ...(leading ? { reasonCode: leading.code } : {}),
    });
  }
  return findings;
}

/** Top-level exported function-looking declarations that failed `supportedCaptureTarget`. */
function scannableExportAttempts(node: ts.Node): Array<{ node: ts.Node; name: string }> {
  if (
    ts.isFunctionDeclaration(node) &&
    node.body &&
    (hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword))
  ) {
    return [{ node, name: node.name?.text ?? "default" }];
  }
  if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    const attempts: Array<{ node: ts.Node; name: string }> = [];
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        isIndirectOrFunctionInitializer(declaration.initializer)
      ) {
        attempts.push({ node: declaration, name: declaration.name.text });
      }
    }
    return attempts;
  }
  return [];
}

function scanFinding(
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
  exportName: string,
  status: ScanStatus,
): ScanFinding {
  return { source, ...positionOf(sourceFile, node), exportName, status };
}

function positionOf(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function compareScanFindings(left: ScanFinding, right: ScanFinding): number {
  return left.source < right.source ? -1 : left.source > right.source ? 1
    : left.line - right.line || left.column - right.column
      || (left.exportName < right.exportName ? -1 : left.exportName > right.exportName ? 1 : 0);
}

interface EvaluatedCaptureSource {
  captureTargets: number;
  diagnostics: SourceDiagnostic[];
  moduleLocator?: string;
  projectModules: Record<string, string>;
  targets: Array<{
    target: CaptureTarget;
    assumption?: AssumptionCaptureEvidence;
    packageTrust?: TrustedPackageCaptureEvidence[];
  }>;
}

function evaluateCaptureSource(
  projectRoot: string,
  sourcePath: string,
  code: string,
  parsedSource?: ts.SourceFile,
  resolution: PackageResolution = {},
): EvaluatedCaptureSource {
  const sourceFile = parsedSource ?? ts.createSourceFile(
    sourcePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    typescriptScriptKind(sourcePath),
  );
  const locatorResolution = resolveCallableModuleLocator(projectRoot, sourcePath);
  const analysis = analyzeSourcePolicies(sourceFile, locatorResolution.source);
  const requested = analysis.callables.filter(
    ({ policy }) => policy.capture && policy.exclusionReasons.length === 0,
  );
  const diagnostics = [...analysis.diagnostics];
  if (!locatorResolution.ok) {
    diagnostics.push(...requested.map(({ target }) => sourceDiagnostic(
      "UNSUPPORTED_CALLABLE",
      sourceFile,
      locatorResolution.source,
      target.callable,
      locatorResolution.message,
    )));
    return { captureTargets: requested.length, diagnostics, projectModules: {}, targets: [] };
  }

  const projectModules = collectProjectModules(projectRoot, sourcePath, code);
  const targets: EvaluatedCaptureSource["targets"] = [];
  for (const callable of requested) {
    const eligibility = analyzeProjectCallGraph({
      modules: projectModules,
      entryModule: locatorResolution.source,
      exportName: callable.target.exportName,
      ...(resolution.packageCatalog ? { packageCatalog: resolution.packageCatalog } : {}),
      ...(resolution.lockfile ? { lockfile: resolution.lockfile } : {}),
    });
    if (eligibility.verdict === "likely-safe") {
      const packageTrust = eligibility.trustedPackageCalls.map((call) => ({
        package: call.package,
        export: call.export,
        unpinned: call.unpinned,
        ...(call.matchedVersion ? { matchedVersion: call.matchedVersion } : {}),
      }));
      targets.push({
        target: callable.target,
        ...(packageTrust.length > 0 ? { packageTrust } : {}),
      });
      continue;
    }
    const hasAssumption = callable.policy.assumptionReasons.length > 0;
    if (eligibility.verdict === "unknown" && hasAssumption) {
      try {
        const reason = callable.policy.assumptionReasons.join("; ");
        const evidence = unknownEvidence(eligibility.findings);
        targets.push({
          target: callable.target,
          assumption: {
            reason,
            fingerprint: createAssumptionFingerprint({
              modules: projectModules,
              analysis: eligibility,
              projectRoot,
            }),
            originalEvidence: evidence.map((finding) => ({ ...finding })),
            analyzerVersion: eligibility.analyzerVersion,
            intrinsicCatalogVersion: INTRINSIC_CATALOG_VERSION,
          },
        });
        continue;
      } catch {
        // Missing or ambiguous fingerprint inputs remain unknown.
      }
    }
    diagnostics.push(sourceDiagnostic(
      eligibility.verdict === "refuted"
        ? hasAssumption ? "ASSERTION_CONFLICT" : "KNOWN_EFFECT"
        : "UNKNOWN_EFFECT",
      sourceFile,
      locatorResolution.source,
      callable.target.callable,
      eligibility.verdict === "refuted"
        ? hasAssumption
          ? "known effects conflict with the assume-pure assertion"
          : "known effects make this callable ineligible for recording"
        : hasAssumption
          ? "assume-pure fingerprint inputs are unavailable for explicit review"
          : "unknown effects require an explicit reviewed assumption before recording",
    ));
  }
  return {
    captureTargets: requested.length,
    diagnostics,
    moduleLocator: locatorResolution.locator,
    projectModules,
    targets,
  };
}

interface CaptureTarget {
  exportName: string;
  callable:
    | (ts.FunctionDeclaration & { name: ts.Identifier; body: ts.Block })
    | (ts.FunctionExpression & { body: ts.Block })
    | ts.ArrowFunction;
}

interface SourcePolicy {
  capture: boolean;
  assumptionReasons: string[];
  exclusionReasons: string[];
}

interface AnalyzedCallable {
  target: CaptureTarget;
  policy: SourcePolicy;
}

interface SourcePolicyAnalysis {
  callables: AnalyzedCallable[];
  diagnostics: SourceDiagnostic[];
}

function analyzeSourcePolicies(
  sourceFile: ts.SourceFile,
  moduleLocator: string,
): SourcePolicyAnalysis {
  const callables: AnalyzedCallable[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    const tags = ownReplaylockTags(node);
    if (tags.length > 0) {
      const parsed = parseSourcePolicy(tags);
      if (parsed.errors.length > 0) {
        diagnostics.push(
          ...parsed.errors.map((message) =>
            sourceDiagnostic("INVALID_POLICY", sourceFile, moduleLocator, node, message),
          ),
        );
      } else {
        const target = supportedCaptureTarget(node, sourceFile);
        if (target) {
          callables.push({ target, policy: parsed.policy });
        } else if (isUnsupportedCallableShape(node)) {
          diagnostics.push(
            sourceDiagnostic(
              "UNSUPPORTED_CALLABLE",
              sourceFile,
              moduleLocator,
              node,
              "annotated callable is not a directly exported named synchronous function",
            ),
          );
        } else {
          diagnostics.push(
            sourceDiagnostic(
              "INVALID_POLICY",
              sourceFile,
              moduleLocator,
              node,
              "directive is not attached to a callable",
            ),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { callables, diagnostics };
}

function supportedCaptureTarget(node: ts.Node, sourceFile: ts.SourceFile): CaptureTarget | undefined {
  if (node.parent !== sourceFile) return undefined;

  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    node.body &&
    !node.asteriskToken &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    !hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  ) {
    return { exportName: node.name.text, callable: node as CaptureTarget["callable"] };
  }

  if (
    ts.isVariableStatement(node) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    (node.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    node.declarationList.declarations.length === 1
  ) {
    const declaration = node.declarationList.declarations[0];
    if (
      declaration &&
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      isCapturableFunctionInitializer(declaration.initializer) &&
      isCaptureArgumentListSupported(declaration.initializer)
    ) {
      return { exportName: declaration.name.text, callable: declaration.initializer };
    }
  }

  return undefined;
}

function ownReplaylockTags(node: ts.Node): ts.JSDocTag[] {
  return ts
    .getJSDocTags(node)
    .filter((tag) => tag.tagName.text === "replaylock" && tag.parent.parent === node);
}

function parseSourcePolicy(tags: readonly ts.JSDocTag[]): {
  policy: SourcePolicy;
  errors: string[];
} {
  const policy: SourcePolicy = {
    capture: false,
    assumptionReasons: [],
    exclusionReasons: [],
  };
  const errors: string[] = [];

  for (const tag of tags) {
    const comment = jsDocCommentText(tag.comment).trim();
    const separator = comment.search(/\s/);
    const directive = separator < 0 ? comment : comment.slice(0, separator);
    const reason = separator < 0 ? "" : comment.slice(separator).trim();
    switch (directive) {
      case "capture":
        if (reason.length > 0) errors.push("capture does not accept a reason");
        policy.capture = true;
        break;
      case "assume-pure":
        if (reason.length === 0) errors.push("assume-pure requires a nonempty reason");
        else policy.assumptionReasons.push(reason);
        break;
      case "exclude":
        if (reason.length === 0) errors.push("exclude requires a nonempty reason");
        else policy.exclusionReasons.push(reason);
        break;
      default:
        errors.push(`unknown directive ${JSON.stringify(directive)}`);
        break;
    }
  }

  if (policy.assumptionReasons.length > 0 && !policy.capture) {
    errors.push("assume-pure requires capture");
  }
  if (
    policy.exclusionReasons.length > 0 &&
    (policy.capture || policy.assumptionReasons.length > 0)
  ) {
    errors.push("exclude cannot be combined with capture or assume-pure");
  }

  return { policy, errors };
}

function jsDocCommentText(comment: ts.JSDocTag["comment"]): string {
  if (typeof comment === "string") return comment;
  if (!comment) return "";
  return comment.map((part) => part.getText()).join("");
}

function isUnsupportedCallableShape(node: ts.Node): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isExportAssignment(node)
  ) {
    return true;
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.some(
      (declaration) =>
        declaration.initializer !== undefined &&
        isIndirectOrFunctionInitializer(declaration.initializer),
    );
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
    return node.initializer !== undefined && isIndirectOrFunctionInitializer(node.initializer);
  }
  if (ts.isShorthandPropertyAssignment(node)) return true;
  return (
    ts.isExpressionStatement(node) &&
    ts.isBinaryExpression(node.expression) &&
    node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isCommonJsExportReference(node.expression.left) &&
    isIndirectOrFunctionInitializer(node.expression.right)
  );
}

function isIndirectOrFunctionInitializer(expression: ts.Expression): boolean {
  if (
    ts.isFunctionExpression(expression) ||
    ts.isArrowFunction(expression) ||
    ts.isIdentifier(expression) ||
    ts.isCallExpression(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return true;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isIndirectOrFunctionInitializer(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isIndirectOrFunctionInitializer(expression.whenTrue) ||
      isIndirectOrFunctionInitializer(expression.whenFalse)
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expression.operatorToken.kind === ts.SyntaxKind.CommaToken)
  ) {
    return (
      isIndirectOrFunctionInitializer(expression.left) ||
      isIndirectOrFunctionInitializer(expression.right)
    );
  }
  return false;
}

function isCommonJsExportReference(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "exports";
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      (ts.isIdentifier(expression.expression) &&
        expression.expression.text === "module" &&
        expression.name.text === "exports") ||
      isCommonJsExportReference(expression.expression)
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    return (
      (ts.isIdentifier(expression.expression) &&
        expression.expression.text === "module" &&
        argument !== undefined &&
        ts.isStringLiteral(argument) &&
        argument.text === "exports") ||
      isCommonJsExportReference(expression.expression)
    );
  }
  return false;
}

function sourceDiagnostic(
  code: SourceDiagnosticCode,
  sourceFile: ts.SourceFile,
  source: string,
  node: ts.Node,
  message: string,
): SourceDiagnostic {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    code,
    source,
    line: position.line + 1,
    column: position.character + 1,
    message,
  };
}

function writeSourceDiagnostic(directory: string, diagnostic: SourceDiagnostic): void {
  appendFileSync(
    path.join(directory, `diagnostics-${process.pid}.jsonl`),
    `${JSON.stringify(diagnostic)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function isCapturableFunctionInitializer(
  expression: ts.Expression,
): expression is (ts.FunctionExpression & { body: ts.Block }) | ts.ArrowFunction {
  return (
    (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) &&
    !expression.asteriskToken
  );
}

// Ordinary functions expose their exact caller argument list through the
// standard `arguments` object. Arrows do not, so only simple identifier
// parameters can be captured without changing the callable's contract or
// inventing an argument list for defaults, rest, or destructuring.
function isCaptureArgumentListSupported(callable: ts.ArrowFunction | ts.FunctionExpression): boolean {
  if (ts.isFunctionExpression(callable)) return true;
  return callable.parameters.every(
    (parameter) =>
      ts.isIdentifier(parameter.name) &&
      parameter.initializer === undefined &&
      parameter.dotDotDotToken === undefined,
  );
}

function instrumentTarget(
  transformed: MagicString,
  sourceFile: ts.SourceFile,
  target: CaptureTarget,
  metadata: string,
  observerBinding: string,
  adapterBinding: string,
): void {
  const { callable } = target;
  const observedArguments = ts.isArrowFunction(callable)
    ? `[${callable.parameters.map((parameter) => parameter.name.getText(sourceFile)).join(", ")}]`
    : "Array.from(arguments)";
  // The outer declaration keeps its own `async` keyword untouched; only the
  // inner closure passed to the observer needs one, so any `await` in the
  // original body remains syntactically valid inside it.
  const asynchronous = hasModifier(callable, ts.SyntaxKind.AsyncKeyword);
  const closurePrefix = asynchronous ? "async " : "";

  if (ts.isBlock(callable.body)) {
    const bodyStart = callable.body.getStart(sourceFile) + 1;
    const bodyEnd = callable.body.end - 1;
    transformed.appendLeft(
      bodyStart,
      `\nreturn ${observerBinding}(${metadata}, ${observedArguments}, ${closurePrefix}() => {`,
    );
    transformed.appendLeft(bodyEnd, `\n}, ${adapterBinding}, ${asynchronous});\n`);
    return;
  }

  const expression = callable.body;
  transformed.overwrite(
    expression.getStart(sourceFile),
    expression.end,
    `${observerBinding}(${metadata}, ${observedArguments}, ${closurePrefix}() => (${expression.getText(sourceFile)}), ${adapterBinding}, ${asynchronous})`,
  );
}

function freshObserverBinding(sourceFile: ts.SourceFile): string {
  return freshBinding(sourceFile, "__replaylockObserve");
}

function freshBinding(sourceFile: ts.SourceFile, base: string): string {
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  let suffix = 0;
  let candidate = base;
  while (identifiers.has(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

function collectProjectModules(
  projectRoot: string,
  entryPath: string,
  entryCode: string,
): Record<string, string> {
  const entry = resolveCallableModuleLocator(projectRoot, entryPath);
  if (!entry.ok) return {};
  const modules: Record<string, string> = { [entry.locator]: entryCode };
  const queue: Array<{ absolutePath: string; locator: string; code: string }> = [
    { absolutePath: entryPath, locator: entry.locator, code: entryCode },
  ];
  const visited = new Set([entry.locator]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const sourceFile = ts.createSourceFile(
      current.absolutePath,
      current.code,
      ts.ScriptTarget.Latest,
      true,
      typescriptScriptKind(current.absolutePath),
    );
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.importClause?.isTypeOnly ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith(".")
      ) continue;
      const resolved = resolveStaticProjectImport(
        projectRoot,
        current.absolutePath,
        current.locator,
        statement.moduleSpecifier.text,
      );
      if (!resolved || visited.has(resolved.locator)) continue;
      const importedCode = readFileSync(resolved.absolutePath, "utf8");
      visited.add(resolved.locator);
      modules[resolved.locator] = importedCode;
      queue.push({ ...resolved, code: importedCode });
    }
  }
  return modules;
}

function digestProjectModules(modules: Readonly<Record<string, string>>): string {
  const hash = createHash("sha256");
  for (const [name, source] of Object.entries(modules).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    hash.update(`${Buffer.byteLength(name, "utf8")}:`, "utf8");
    hash.update(name, "utf8");
    hash.update(`${Buffer.byteLength(source, "utf8")}:`, "utf8");
    hash.update(source, "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function resolveStaticProjectImport(
  projectRoot: string,
  importerPath: string,
  importerLocator: string,
  specifier: string,
): { absolutePath: string; locator: string } | undefined {
  const absoluteBase = path.resolve(path.dirname(importerPath), specifier);
  const locatorBase = path.posix.normalize(path.posix.join(path.posix.dirname(importerLocator), specifier));
  const extension = path.extname(absoluteBase);
  const candidates = extension
    ? [absoluteBase, ...([".js", ".mjs", ".cjs"].includes(extension)
        ? [absoluteBase.slice(0, -extension.length) + ".ts", absoluteBase.slice(0, -extension.length) + ".tsx"]
        : [])]
    : [
        absoluteBase,
        ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].map((suffix) => absoluteBase + suffix),
        ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((name) => path.join(absoluteBase, name)),
      ];
  const existing = candidates.filter(isFile);
  if (existing.length !== 1) return undefined;
  const actual = existing[0];
  if (!actual) return undefined;
  const actualResolution = resolveCallableModuleLocator(projectRoot, actual);
  if (!actualResolution.ok) return undefined;
  const requestedLocator = extension ? locatorBase : actualResolution.locator;
  return { absolutePath: actual, locator: requestedLocator };
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

const ignoredProjectDirectories = new Set([".git", ".replaylock", "dist", "node_modules"]);

function projectSourceFiles(projectRoot: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredProjectDirectories.has(entry.name)) visit(path.join(directory, entry.name));
        continue;
      }
      if (entry.isFile() && isTypeScriptSourceFilename(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  visit(projectRoot);
  return files.sort();
}

function compareSourceDiagnostics(left: SourceDiagnostic, right: SourceDiagnostic): number {
  return left.source < right.source ? -1 : left.source > right.source ? 1
    : left.line - right.line || left.column - right.column
      || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
      || (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function activeSession(): { directory: string; token: string } | undefined {
  const directory = process.env.REPLAYLOCK_SESSION_DIR;
  const token = process.env.REPLAYLOCK_SESSION_TOKEN;
  if (!directory || !path.isAbsolute(directory) || !token || !/^[a-f0-9]{64}$/.test(token)) {
    return undefined;
  }
  return { directory, token };
}
