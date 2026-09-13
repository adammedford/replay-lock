import { createHash } from "node:crypto";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import { analyzeDirectEffects, analyzeModuleInitialization, DETERMINISTIC_INTRINSICS } from "./effect-analyzer.js";
import { isTypeScriptSourceFilename, typescriptScriptKind } from "./typescript-script-kind.js";
import { createDevInputTracker } from "./dev-project-cache.js";
import type { DevAnalysis, DevDiagnostic, DevEnvironment, DevLocator, DevSourcePosition, DevTarget, ResolvedDevOptions } from "./dev-contract.js";

export type DevCallable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
export interface DevOperation {
  operation: string;
  asynchronous: boolean;
  kind: "call" | "environment" | "response";
  key?: string;
}
export interface DevFunction extends DevTarget {
  node: DevCallable;
  module: DevModule;
  name: string;
  asynchronous: boolean;
  instrument: boolean;
  problems: DevProblems;
  effects: Map<ts.Node, DevOperation>;
  calls: Map<ts.CallExpression, DevFunction>;
}
export interface DevModule {
  file: string;
  sourceFile: ts.SourceFile;
  selected: boolean;
  dependencies: Set<string>;
  dependencyNodes: Map<string, ts.Node>;
  problems: DevProblems;
}
export interface DevProject {
  analysis: DevAnalysis;
  modules: Map<string, DevModule>;
  functions: DevFunction[];
  isCurrent(): boolean;
}

type DevOrigin = { position: DevSourcePosition; causes: { code: string; position: DevSourcePosition }[] };
const maxCauses = 8;
class DevProblems extends Set<string> {
  readonly origins = new Map<string, DevOrigin>();
  constructor(private readonly root: string, private readonly source: ts.SourceFile, private readonly fallback: ts.Node) { super(); }
  position(node: ts.Node): DevSourcePosition {
    const location = this.source.getLineAndCharacterOfPosition(node.getStart(this.source));
    return { module: posix(path.relative(this.root, this.source.fileName)), line: location.line + 1, column: location.character + 1 };
  }
  override add(code: string): this { return this.at(code, this.fallback); }
  at(code: string, node: ts.Node | DevSourcePosition): this {
    if (!this.has(code)) {
      this.origins.set(code, { position: "line" in node ? node : this.position(node), causes: [] });
      super.add(code);
    }
    return this;
  }
  inherit(code: string, source: DevProblems, via: ts.Node): void {
    if (this.has(code)) return;
    const origin = source.origins.get(code)!;
    const causes = [{ code, position: origin.position }, ...origin.causes];
    this.origins.set(code, { position: this.position(via), causes: causes.length > maxCauses ? [...causes.slice(0, maxCauses - 1), causes.at(-1)!] : causes });
    super.add(code);
  }
}

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const ignoredDirectories = new Set(["node_modules", ".git", ".replaylock", ".unlazy", "dist", "coverage", ".vite", ".next"]);
const coveredFindingCodes = new Set(["CLOCK_ACCESS", "RANDOMNESS", "IO", "ENVIRONMENT_DEPENDENCE"]);
const constructors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError"]);
const ambientGlobals = new Set(["undefined", "NaN", "Infinity", "Math", "Date", "crypto", "performance", "fetch", "process", "Promise", "globalThis", "window", "self", "Array", "Object", "Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat", "isFinite", "isNaN", ...constructors]);

/** Static discovery only: importing or invoking project code is never necessary. */
export function analyzeDevProject(root: string, options: ResolvedDevOptions, environment: DevEnvironment): DevAnalysis {
  return buildDevProject(root, options, environment).analysis;
}

/** Shared analysis/rewrite plan. Each covered finding has an actual AST rewrite. */
export function buildDevProject(rootInput: string, options: ResolvedDevOptions, environment: DevEnvironment, overlay?: { id: string; code: string }): DevProject {
  const root = realpathSync(rootInput);
  const inputs = createDevInputTracker();
  const { isFile, read } = inputs;
  inputs.track(rootInput);
  const sources = new Map<string, string>();
  const metadata = new Map<string, string>();
  const rootFiles = new Set<string>();
  const walk = (directory: string): void => {
    inputs.track(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name) && !entry.name.startsWith(".")) walk(file);
      else if (entry.isFile() && sourceFilename(file)) { sources.set(file, read(file)); rootFiles.add(file); }
      else if (entry.isFile() && (entry.name === "package.json" || /^(?:tsconfig|jsconfig).*\.json$/.test(entry.name) || /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|\.env(?:\..*)?)$/.test(entry.name))) metadata.set(file, read(file));
    }
  };
  walk(root);
  let overlayFile = overlay ? path.resolve(root, overlay.id.split("?", 1)[0]!) : undefined;
  if (overlayFile && isFile(overlayFile)) overlayFile = realpathSync(overlayFile);
  if (overlay && overlayFile && inside(root, overlayFile) && sourceFilename(overlayFile) && physicalInside(root, overlayFile)) {
    sources.set(overlayFile, overlay.code);
    if (!overlayFile.split(path.sep).includes("node_modules")) rootFiles.add(overlayFile);
  }
  const resolution = new Map<string, string | undefined>();
  const readMetadata = (directory: string): void => {
    const file = path.join(directory, "package.json");
    if (isFile(file)) metadata.set(file, read(file));
  };
  readMetadata(root);
  const resolve = (from: string, specifier: string): string | undefined => {
    const key = `${from}\0${specifier}`;
    if (resolution.has(key)) return resolution.get(key);
    // Vite's string aliases match the whole import or a slash-delimited
    // prefix, in configured order. Replacements are applied once, as in Vite.
    const requested = applyAlias(specifier, options);
    if (builtins.has(requested.replace(/^node:/, ""))) { resolution.set(key, undefined); return undefined; }
    let resolved: string | undefined;
    if (requested.startsWith(".") || path.isAbsolute(requested)) {
      const base = path.resolve(path.dirname(from), requested);
      const stem = base.replace(/\.[cm]?jsx?$/, "");
      const candidates = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].flatMap((extension) => [stem + extension, base + extension, path.join(base, "index" + extension)])];
      resolved = candidates.find((file) => sources.has(file) || isFile(file));
    } else {
      // Node's package exports/main resolution is used for installed code, never
      // a declaration file standing in for executable dependency behavior.
      resolved = resolvePackageSource(from, requested, environment, metadata, inputs);
    }
    if (resolved && isFile(resolved)) resolved = realpathSync(resolved);
    if (resolved && (!inside(root, resolved) || !sourceFilename(resolved))) resolved = undefined;
    if (resolved) {
      let directory = path.dirname(resolved);
      while (inside(root, directory)) {
        readMetadata(directory);
        if (directory === root) break;
        directory = path.dirname(directory);
      }
    }
    resolution.set(key, resolved);
    return resolved;
  };
  const modules = new Map<string, DevModule>();
  // Excluded tests/configuration are fingerprinted but are not discovery roots.
  // Their imports can include an entire installed compiler/build toolchain.
  // Still follow an excluded source when selected application code imports it:
  // exclusion is never permission to bypass dependency effect analysis.
  const reachable = new Set([...rootFiles].filter((file) => selectedSource(posix(path.relative(root, file)), options)));
  for (const file of reachable) {
    const text = sources.get(file)!;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, typescriptScriptKind(file));
    const dependencies = new Set<string>();
    const problems = new DevProblems(root, sourceFile, sourceFile);
    const dependencyNodes = new Map<string, ts.Node>();
    if (options.resolveAliases?.some((entry) => typeof entry.find !== "string" || typeof entry.replacement !== "string" || !entry.find)) problems.add("UNKNOWN_MODULE");
    const relative = posix(path.relative(root, file));
    const selected = rootFiles.has(file) && selectedSource(relative, options);
    const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (parseDiagnostics.length) { const location = sourceFile.getLineAndCharacterOfPosition(parseDiagnostics[0]!.start ?? 0); problems.at("UNSUPPORTED_SOURCE", { module: relative, line: location.line + 1, column: location.character + 1 }); }
    for (const statement of sourceFile.statements) {
      if (!runtimeImport(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) { problems.at("UNKNOWN_MODULE", statement); continue; }
      if (builtins.has(applyAlias(specifier.text, options).replace(/^node:/, ""))) continue;
      const dependency = resolve(file, specifier.text);
      if (!dependency) { problems.at("UNKNOWN_MODULE", specifier); continue; }
      dependencies.add(dependency);
      dependencyNodes.set(dependency, specifier);
      if (!sources.has(dependency)) sources.set(dependency, read(dependency));
      reachable.add(dependency);
    }
    for (const finding of analyzeModuleInitialization({ source: relative, sourceFile }).findings) problems.at("EFFECTFUL_INITIALIZATION", { module: relative, line: finding.line, column: finding.column });
    modules.set(file, { file, sourceFile, selected, dependencies, dependencyNodes, problems });
  }
  const compilerOptions: ts.CompilerOptions = { noLib: true, allowJs: true, checkJs: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(compilerOptions);
  host.getSourceFile = (file) => modules.get(path.resolve(file))?.sourceFile;
  host.resolveModuleNames = (names, from) => names.map((name) => {
    const file = resolve(from, name);
    return file ? { resolvedFileName: file, isExternalLibraryImport: false } : undefined;
  });
  const program = ts.createProgram([...modules.keys()], compilerOptions, host);
  const checker = program.getTypeChecker();
  const functions: DevFunction[] = [];
  const bySymbol = new Map<ts.Symbol, DevFunction>();
  const symbol = (node: ts.Node): ts.Symbol | undefined => {
    const found = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    if (!found) return undefined;
    return found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
  };
  for (const module of modules.values()) {
    const exported = new Set<ts.Symbol>();
    const moduleSymbol = checker.getSymbolAtLocation(module.sourceFile);
    if (moduleSymbol) for (const item of checker.getExportsOfModule(moduleSymbol)) exported.add(item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item);
    const visit = (node: ts.Node, owners: string[], unsupportedOwner: boolean, excludedOwner: boolean): void => {
      let nextOwners = owners;
      let nextUnsupported = unsupportedOwner;
      let nextExcluded = excludedOwner;
      if (ts.isFunctionLike(node)) {
        const nameNode = callableName(node);
        const name = nameNode?.text;
        const policy = sourcePolicy(node);
        nextExcluded ||= policy.excluded || policy.invalid;
        if (name && isCallable(node) && node.body) {
          const binding = symbol(nameNode!);
          const namePath = [...owners, name];
          const locator: DevLocator = { module: posix(path.relative(root, module.file)), kind: owners.length ? "nested" : binding && exported.has(binding) ? "export" : "local", namePath };
          const problems = new DevProblems(root, module.sourceFile, node);
          if (unsupportedOwner || !supportedShape(node) || !binding) problems.add("UNSUPPORTED_CALLABLE");
          if (nextExcluded) problems.add(policy.invalid ? "INVALID_POLICY" : "SOURCE_EXCLUDED");
          const candidate: DevFunction = {
            locator, replayExport: `__replaylock_dev_${createHash("sha256").update(JSON.stringify(locator)).digest("hex").slice(0, 24)}`,
            node, module, name, asynchronous: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
            instrument: module.selected && (options.capture.mode === "automatic" || policy.capture),
            problems, effects: new Map(), calls: new Map(),
          };
          if (binding && bySymbol.has(binding)) { problems.add("AMBIGUOUS_CALLABLE"); bySymbol.get(binding)!.problems.add("AMBIGUOUS_CALLABLE"); }
          else if (binding) bySymbol.set(binding, candidate);
          if (ts.isFunctionExpression(node) && node.name) { const own = symbol(node.name); if (own) bySymbol.set(own, candidate); }
          functions.push(candidate);
          nextOwners = namePath;
        } else { nextOwners = [...owners, name ?? "<anonymous>"]; nextUnsupported = true; }
      }
      ts.forEachChild(node, (child) => visit(child, nextOwners, nextUnsupported, nextExcluded));
    };
    visit(module.sourceFile, [], false, false);
  }

  const canonical = (expression: ts.Expression, seen = new Set<ts.Node>()): string | undefined => {
    const node = unwrap(expression);
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (ts.isAwaitExpression(node)) {
      const operand = unwrap(node.expression);
      return ts.isCallExpression(operand) && canonical(operand.expression, seen)?.replace(/^\$global\./, "") === "fetch" ? "$response" : undefined;
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return "import.meta";
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = canonical(node.expression, seen);
      const key = memberName(node);
      return base && key !== undefined ? `${base}.${key}` : undefined;
    }
    if (!ts.isIdentifier(node)) return undefined;
    const own = checker.getSymbolAtLocation(node);
    const declaration = own?.declarations?.[0];
    if (!declaration) return ["globalThis", "window", "self"].includes(node.text) ? "$global" : node.text;
    if (ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) {
      let statement: ts.Node = declaration;
      while (!ts.isImportDeclaration(statement) && statement.parent) statement = statement.parent;
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
      const specifier = applyAlias(statement.moduleSpecifier.text, options).replace(/^node:/, "");
      const base = new Map([["fs", "fs"], ["fs/promises", "fsPromises"], ["crypto", "crypto"], ["perf_hooks", "$perf_hooks"], ["process", "process"]]).get(specifier);
      if (!base) return undefined;
      if (ts.isImportSpecifier(declaration)) {
        const imported = (declaration.propertyName ?? declaration.name).text;
        if (imported === "default") return base;
        if (base === "$perf_hooks" && imported === "performance") return "performance";
        return `${base}.${imported}`;
      }
      return base;
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer && constantDeclaration(declaration)) return canonical(declaration.initializer, seen);
    if (ts.isBindingElement(declaration) && !declaration.initializer && !declaration.dotDotDotToken && ts.isObjectBindingPattern(declaration.parent)) {
      const variable = declaration.parent.parent;
      const key = declaration.propertyName ?? declaration.name;
      if (ts.isVariableDeclaration(variable) && variable.initializer && constantDeclaration(variable) && (ts.isIdentifier(key) || ts.isStringLiteral(key))) {
        const base = canonical(variable.initializer, seen);
        return base ? `${base}.${key.text}` : undefined;
      }
    }
    return undefined;
  };
  const identity = (expression: ts.Expression): string | undefined => canonical(expression)?.replace(/^\$global\./, "").replace(/^fs\.promises\./, "fsPromises.").replace(/^\$perf_hooks\.performance\./, "performance.");
  const resolveFunction = (expression: ts.Expression, seen = new Set<ts.Node>()): DevFunction | undefined => {
    const node = unwrap(expression);
    if (seen.has(node)) return undefined;
    seen.add(node);
    const binding = symbol(ts.isPropertyAccessExpression(node) ? node.name : node);
    if (binding && bySymbol.has(binding)) return bySymbol.get(binding);
    const declaration = binding?.declarations?.[0];
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && constantDeclaration(declaration)) return resolveFunction(declaration.initializer, seen);
    return undefined;
  };
  const operation = (node: ts.Node): DevOperation | undefined => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (ts.isCallExpression(node) && (node.questionDotToken || ts.isCallChain(node))) return undefined;
      if (node.arguments?.some(ts.isSpreadElement)) return undefined;
      const name = identity(node.expression);
      const count = node.arguments?.length ?? 0;
      if (!ts.isNewExpression(node) && options.effects.randomness && ((name === "Math.random" && count === 0) || (name === "crypto.randomUUID" && count <= 1))) return { operation: name, asynchronous: false, kind: "call" };
      if (options.effects.time && name === "Date" && count <= 7) return { operation: ts.isNewExpression(node) ? "new Date" : "Date", asynchronous: false, kind: "call" };
      if (!ts.isNewExpression(node) && options.effects.time && (name === "Date.now" || name === "performance.now") && count === 0) return { operation: name, asynchronous: false, kind: "call" };
      if (ts.isNewExpression(node)) return undefined;
      if (options.effects.fetch && name === "fetch" && count >= 1 && count <= 2) return { operation: "fetch", asynchronous: true, kind: "call" };
      if (options.effects.fetch && name && ["$response.json", "$response.text", "$response.arrayBuffer"].includes(name) && count === 0 && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && identity(node.expression.expression) === "$response") return { operation: name.replace("$response", "Response"), asynchronous: true, kind: "response" };
      if (environment === "node" && options.effects.filesystem && (name === "fs.readFileSync" || name === "fsPromises.readFile") && count >= 1 && count <= 2) return { operation: name === "fsPromises.readFile" ? "fs.readFile" : name, asynchronous: name === "fsPromises.readFile", kind: "call" };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = identity(node.expression);
      const key = memberName(node);
      if (((environment === "node" && base === "process.env") || base === "import.meta.env") && key !== undefined && options.effects.environment.includes(key) && !writePosition(node)) return { operation: base, asynchronous: false, kind: "environment", key };
    }
    return undefined;
  };

  // Module execution must be safe independently of capture selection. In
  // particular, an environment snapshot in a dependency is not a traced read.
  for (const module of modules.values()) {
    const initialization = (child: ts.Node): void => {
      if (ts.isFunctionLike(child)) {
        if (child.name && ts.isComputedPropertyName(child.name)) initialization(child.name.expression);
        return;
      }
      if (ts.isTypeNode(child) || ts.isImportDeclaration(child) || ts.isExportDeclaration(child)) return;
      if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
        const name = identity(child);
        if (name === "process.env" || name?.startsWith("process.env.") || name === "import.meta.env" || name?.startsWith("import.meta.env.")) module.problems.at("EFFECTFUL_INITIALIZATION", child);
      }
      if ((ts.isCallExpression(child) || ts.isNewExpression(child)) && !DETERMINISTIC_INTRINSICS.has(identity(child.expression) ?? "")) module.problems.at("EFFECTFUL_INITIALIZATION", child);
      ts.forEachChild(child, initialization);
    };
    initialization(module.sourceFile);
  }
  for (const candidate of functions) {
    const { node, module, problems, effects, calls } = candidate;
    const inspect = (child: ts.Node): void => {
      if (child !== node && ts.isFunctionLike(child)) {
        if (ts.isGetAccessorDeclaration(child) || ts.isSetAccessorDeclaration(child)) problems.at("UNKNOWN_CALL", child);
        return;
      }
      if (ts.isTypeNode(child)) return;
      if (child.kind === ts.SyntaxKind.ThisKeyword || child.kind === ts.SyntaxKind.SuperKeyword || (ts.isMetaProperty(child) && child.keywordToken === ts.SyntaxKind.NewKeyword)) problems.at("RECEIVER_DEPENDENCE", child);
      if (ts.isIdentifier(child) && referenceIdentifier(child)) {
        const binding = symbol(child);
        const declaration = binding?.valueDeclaration ?? binding?.declarations?.[0] ?? checker.getSymbolAtLocation(child)?.declarations?.[0];
        if (declaration && !descendantOf(declaration, node) && bySymbol.get(binding!) !== candidate) {
          const owner = enclosingFunction(declaration);
          if (owner) problems.at("CLOSURE_CAPTURE", child);
          if (ts.isVariableDeclaration(declaration)) {
            if (!constantDeclaration(declaration)) problems.at("AMBIENT_STATE", child);
            // Objects in module scope can carry getters or be mutated by an
            // unrelated export. Only immutable scalar values and resolved
            // callable/builtin aliases are proven safe ambient bindings.
            if (!owner && !bySymbol.has(binding!) && !identity(child) && declaration.initializer && !immutableScalar(declaration.initializer, checker)) problems.at("AMBIENT_STATE", child);
          }
        }
        if (!declaration && child.text === "arguments") problems.at("UNSUPPORTED_CALLABLE", child);
        if (!declaration && !ambientGlobals.has(child.text)) problems.at("UNKNOWN_REFERENCE", child);
      }
      if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
        const binding = symbol(ts.isPropertyAccessExpression(child) ? child.name : child);
        const declaration = binding?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && !descendantOf(declaration, node) && !bySymbol.has(binding!) && !identity(child) && declaration.initializer && !immutableScalar(declaration.initializer, checker)) problems.at("AMBIENT_STATE", child);
        if (declaration && (ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) problems.at("UNKNOWN_CALL", child);
        const name = identity(child);
        if (canonical(child.expression) === "$global" && !["Math", "Date", "crypto", "performance", "fetch", "process", "Promise", "Array", "Object", "Number", "String", "Boolean", "BigInt"].includes(name ?? "")) problems.at("AMBIENT_STATE", child);
      }
      const effect = operation(child);
      if (effect) {
        if (!candidate.instrument) problems.at("UNINSTRUMENTED_EFFECT", child);
        else effects.set(child, effect);
      }
      if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
        const target = ts.isCallExpression(child) ? resolveFunction(child.expression) : undefined;
        const name = identity(child.expression);
        let asynchronous = effect?.asynchronous ?? false;
        if (!effect) {
          if (target && ts.isCallExpression(child) && !child.questionDotToken && !ts.isCallChain(child)) {
            calls.set(child, target);
            asynchronous = target.asynchronous;
          } else if (name === "Promise.all" && ts.isCallExpression(child) && child.arguments.length === 1 && ts.isArrayLiteralExpression(unwrap(child.arguments[0]!))) {
            asynchronous = true;
          } else if (name === "Promise.resolve" && ts.isCallExpression(child) && child.arguments.length <= 1) {
            // Only immediate values; assimilating an unknown thenable would run hidden work.
            if (child.arguments[0] && !literalValue(child.arguments[0])) problems.at("UNKNOWN_CALL", child);
            asynchronous = true;
          } else if (!(name && (DETERMINISTIC_INTRINSICS.has(name) || constructors.has(name) || ["Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat", "isFinite", "isNaN"].includes(name)))) {
            problems.at("UNKNOWN_CALL", child);
          }
        }
        if (asynchronous && !joinedAsync(child, candidate, identity)) problems.at("DETACHED_ASYNC", child);
      }
      if (ts.isAwaitExpression(child)) {
        const expression = unwrap(child.expression);
        if (!ts.isCallExpression(expression) || !(operation(expression)?.asynchronous || resolveFunction(expression.expression)?.asynchronous || ["Promise.all", "Promise.resolve"].includes(identity(expression.expression) ?? ""))) problems.at("UNSUPPORTED_ASYNC", child);
      }
      if (ts.isYieldExpression(child) || (ts.isForOfStatement(child) && child.awaitModifier)) problems.at("UNSUPPORTED_ASYNC", child);
      if (ts.isClassDeclaration(child) || ts.isClassExpression(child) || ts.isTaggedTemplateExpression(child) || ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) problems.at("UNSUPPORTED_CALLABLE", child);
      ts.forEachChild(child, inspect);
    };
    inspect(node);
    // V1 evidence is retained verbatim except a specific intercepted operation's
    // source location. Writes, receiver dependence, and initialization never clear.
    const direct = analyzeDirectEffects({ source: candidate.locator.module, sourceFile: module.sourceFile, callable: node });
    for (const finding of direct.findings) {
      const position = module.sourceFile.getPositionOfLineAndCharacter(finding.line - 1, finding.column - 1);
      const covered = coveredFindingCodes.has(finding.code) && [...effects.keys()].some((effectNode) => position === effectNode.getStart() || ((ts.isCallExpression(effectNode) || ts.isNewExpression(effectNode)) && position === effectNode.expression.getStart()));
      if (!covered) problems.at(finding.code, { module: candidate.locator.module, line: finding.line, column: finding.column });
    }
  }
  // Stable lexical locators must never silently pick one of two block-scoped names.
  const locators = new Map<string, DevFunction>();
  for (const candidate of functions) {
    const key = JSON.stringify(candidate.locator);
    const previous = locators.get(key);
    if (previous) { previous.problems.add("AMBIGUOUS_CALLABLE"); candidate.problems.add("AMBIGUOUS_CALLABLE"); }
    locators.set(key, candidate);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of modules.values()) for (const dependency of module.dependencies) {
      const inherited = modules.get(dependency)?.problems;
      if (inherited) for (const code of inherited) if (!module.problems.has(code)) {
        module.problems.inherit(code, inherited, module.dependencyNodes.get(dependency)!); changed = true;
      }
    }
    for (const candidate of functions) {
      for (const code of candidate.module.problems) if (!candidate.problems.has(code)) {
        candidate.problems.inherit(code, candidate.module.problems, candidate.node); changed = true;
      }
      for (const [call, target] of candidate.calls) for (const code of target.problems) if (!candidate.problems.has(code)) {
        candidate.problems.inherit(code, target.problems, call); changed = true;
      }
    }
  }
  const diagnostics: DevDiagnostic[] = [];
  const targets: DevTarget[] = [];
  for (const candidate of functions) {
    if (!candidate.instrument) continue;
    if (candidate.problems.size === 0) targets.push({ locator: candidate.locator, replayExport: candidate.replayExport });
    else for (const code of [...candidate.problems].sort()) diagnostics.push({ code, locator: candidate.locator, ...candidate.problems.origins.get(code), message: `${candidate.locator.module}#${candidate.locator.namePath.join(".")}: ${code}` });
  }
  const hash = createHash("sha256");
  const fingerprintOptions = { ...options, ...(options.resolveAliases ? { resolveAliases: options.resolveAliases.map((entry) => {
    const aliasRoot = inside(root, entry.replacement) ? root : path.resolve(rootInput);
    return { ...entry, replacement: path.isAbsolute(entry.replacement) && inside(aliasRoot, entry.replacement) ? `$root/${posix(path.relative(aliasRoot, entry.replacement))}` : entry.replacement };
  }) } : {}) };
  hash.update(JSON.stringify({ version: 2, options: fingerprintOptions, environment }));
  for (const [file, text] of [...sources, ...metadata].sort(([a], [b]) => a.localeCompare(b))) hash.update(JSON.stringify([posix(path.relative(root, file)), text]));
  const sourceGraphDigest = hash.digest("hex");
  const analysis = { targets, diagnostics, sourceGraphDigest };
  freezeAnalysis(analysis);
  return { analysis, modules, functions, isCurrent: inputs.isCurrent };
}

function freezeAnalysis(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === "object") freezeAnalysis(child);
  Object.freeze(value);
}

function sourceFilename(file: string): boolean { return isTypeScriptSourceFilename(file) && !/\.d\.[cm]?ts$/.test(file); }
function isFile(file: string): boolean { try { return statSync(file).isFile(); } catch { return false; } }
function inside(root: string, file: string): boolean { const relative = path.relative(root, file); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function physicalInside(root: string, file: string): boolean { try { return inside(root, realpathSync(file)); } catch { return inside(root, realpathSync(path.dirname(file))); } }
function posix(file: string): string { return file.split(path.sep).join("/"); }
function selectedSource(file: string, options: ResolvedDevOptions): boolean {
  const match = (pattern: string): boolean => {
    let expression = "^";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]!;
      if (char === "*" && pattern[i + 1] === "*") { i++; if (pattern[i + 1] === "/") { i++; expression += "(?:.*/)?"; } else expression += ".*"; }
      else if (char === "*") expression += "[^/]*";
      else if (char === "?") expression += "[^/]";
      else expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(expression + "$").test(file);
  };
  return (options.capture.include.length === 0 || options.capture.include.some(match)) && !options.capture.exclude.some(match);
}
function applyAlias(specifier: string, options: ResolvedDevOptions): string {
  const alias = options.resolveAliases?.find((entry) => typeof entry.find === "string" && typeof entry.replacement === "string" && entry.find.length > 0 && (specifier === entry.find || specifier.startsWith(`${entry.find}/`)));
  return alias ? alias.replacement + specifier.slice(alias.find.length) : specifier;
}
function runtimeImport(node: ts.Statement): node is ts.ImportDeclaration | ts.ExportDeclaration {
  if (ts.isExportDeclaration(node)) return !!node.moduleSpecifier && !node.isTypeOnly;
  if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) return false;
  const clause = node.importClause;
  return !clause || !!clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.namedBindings.elements.some((entry) => !entry.isTypeOnly);
}
export function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean { return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind); }
function isCallable(node: ts.Node): node is DevCallable { return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node); }
function callableName(node: ts.Node): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(node)) return node.name;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    let outer: ts.Node = node;
    while (outer.parent && (ts.isParenthesizedExpression(outer.parent) || ts.isAsExpression(outer.parent) || ts.isSatisfiesExpression(outer.parent))) outer = outer.parent;
    if (ts.isVariableDeclaration(outer.parent) && ts.isIdentifier(outer.parent.name)) return outer.parent.name;
  }
  return undefined;
}
function supportedShape(node: DevCallable): boolean {
  if (node.asteriskToken || node.parameters.some((parameter) => !ts.isIdentifier(parameter.name) || !!parameter.initializer || ["this", "arguments"].includes(parameter.name.text))) return false;
  if (ts.isFunctionDeclaration(node)) return !!node.name && (ts.isSourceFile(node.parent) || !!enclosingFunction(node));
  let outer: ts.Node = node;
  while (outer.parent && (ts.isParenthesizedExpression(outer.parent) || ts.isAsExpression(outer.parent) || ts.isSatisfiesExpression(outer.parent))) outer = outer.parent;
  return ts.isVariableDeclaration(outer.parent) && constantDeclaration(outer.parent) && (ts.isSourceFile(outer.parent.parent.parent.parent) || !!enclosingFunction(node));
}
function constantDeclaration(node: ts.VariableDeclaration): boolean { return ts.isVariableDeclarationList(node.parent) && !!(node.parent.flags & ts.NodeFlags.Const); }
function sourcePolicy(node: ts.Node): { capture: boolean; excluded: boolean; invalid: boolean } {
  const tags = new Set<ts.JSDocTag>();
  let owner: ts.Node | undefined = node;
  while (owner && !ts.isSourceFile(owner) && !ts.isBlock(owner)) {
    for (const tag of ts.getJSDocTags(owner)) if (tag.tagName.text === "replaylock") tags.add(tag);
    if (owner !== node && ts.isFunctionLike(owner)) break;
    owner = owner.parent;
  }
  let capture = false, excluded = false, assumed = false, invalid = false;
  for (const tag of tags) {
    const comment = typeof tag.comment === "string" ? tag.comment : tag.comment?.map((part) => part.getText()).join("") ?? "";
    const [directive, ...reason] = comment.trim().split(/\s+/);
    if (directive === "capture") { capture = true; invalid ||= reason.length > 0; }
    else if (directive === "exclude") { excluded = true; invalid ||= reason.length === 0; }
    else if (directive === "assume-pure") { assumed = true; invalid ||= reason.length === 0; }
    else invalid = true;
  }
  return { capture, excluded, invalid: invalid || (assumed && !capture) || (excluded && (capture || assumed)) };
}
function descendantOf(node: ts.Node, ancestor: ts.Node): boolean { for (let current: ts.Node | undefined = node; current; current = current.parent) if (current === ancestor) return true; return false; }
function enclosingFunction(node: ts.Node): ts.Node | undefined { for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current)) return current; return undefined; }
function referenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isMetaProperty(parent)) return false;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isBindingElement(parent) && parent.propertyName === node)) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isBindingElement(parent)) && parent.name === node) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
  return true;
}
function memberName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const key = node.argumentExpression;
  return ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) ? key.text : undefined;
}
function writePosition(node: ts.Node): boolean {
  let current = node;
  while (current.parent && (ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent) || ts.isParenthesizedExpression(current.parent))) current = current.parent;
  const parent = current.parent;
  return (ts.isBinaryExpression(parent) && parent.left === current && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) || ts.isDeleteExpression(parent) || ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator));
}
function literalValue(expression: ts.Expression): boolean {
  const node = unwrap(expression);
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind);
}
function immutableScalar(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): boolean {
  const node = unwrap(expression);
  if (seen.has(node)) return false;
  seen.add(node);
  if (literalValue(node) || ts.isBigIntLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node) && ![ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) return immutableScalar(node.operand, checker, seen);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind < ts.SyntaxKind.FirstAssignment) return immutableScalar(node.left, checker, new Set(seen)) && immutableScalar(node.right, checker, new Set(seen));
  if (ts.isIdentifier(node)) {
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    return !!declaration && ts.isVariableDeclaration(declaration) && constantDeclaration(declaration) && !!declaration.initializer && immutableScalar(declaration.initializer, checker, seen);
  }
  return false;
}

/** Resolve import conditions instead of accidentally analyzing a package's require branch. */
function resolvePackageSource(from: string, specifier: string, environment: DevEnvironment, metadata: Map<string, string>, inputs: ReturnType<typeof createDevInputTracker>): string | undefined {
  const { isFile, read } = inputs;
  if (specifier.startsWith("#") || path.isAbsolute(specifier)) return undefined;
  const parts = specifier.split("/");
  const packageName = parts.splice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  const subpath = parts.length ? `./${parts.join("/")}` : ".";
  let directory = path.dirname(from);
  while (true) {
    const packageRoot = path.join(directory, "node_modules", packageName);
    const manifest = path.join(packageRoot, "package.json");
    if (isFile(manifest)) {
      const text = read(manifest);
      metadata.set(manifest, text);
      let definition: { exports?: unknown; main?: unknown; type?: unknown };
      try { definition = JSON.parse(text) as typeof definition; } catch { return undefined; }
      if (definition.exports !== undefined) {
        let entry: unknown = definition.exports;
        let wildcard: string | undefined;
        if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).some((key) => key.startsWith("."))) {
          const entries = entry as Record<string, unknown>;
          entry = entries[subpath];
          if (entry === undefined) {
            const pattern = Object.keys(entries).filter((key) => key.includes("*")).sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length).find((key) => {
              const [before, after] = key.split("*");
              return subpath.startsWith(before!) && subpath.endsWith(after!) && subpath.length >= before!.length + after!.length;
            });
            if (pattern) { const [before, after] = pattern.split("*"); wildcard = subpath.slice(before!.length, subpath.length - after!.length); entry = entries[pattern]; }
          }
        } else if (subpath !== ".") return undefined;
        const select = (value: unknown): string | undefined => {
          if (typeof value === "string") return value;
          if (Array.isArray(value)) { for (const item of value) { const selected = select(item); if (selected) return selected; } }
          else if (value && typeof value === "object") for (const [condition, target] of Object.entries(value)) {
            if (["default", "import", environment, ...(environment === "node" ? ["node-addons"] : [])].includes(condition)) return select(target);
            // Configured/custom conditions cannot safely be guessed from source.
            if (!["types", "require", "node", "node-addons", "browser"].includes(condition)) return undefined;
          }
          return undefined;
        };
        let target = select(entry);
        if (!target?.startsWith("./")) return undefined;
        if (wildcard !== undefined) target = target.replaceAll("*", wildcard);
        const file = path.resolve(packageRoot, target);
        return inside(packageRoot, file) && isFile(file) ? file : undefined;
      }
      // Resolve legacy main without Node's process-wide package resolution
      // cache, which can retain an earlier manifest after an edit.
      const entry = subpath !== "." ? subpath : typeof definition.main === "string" ? definition.main : "./index.js";
      const base = path.resolve(packageRoot, entry);
      if (!inside(packageRoot, base)) return undefined;
      return [base, ...[".js", ".mjs", ".cjs"].flatMap(extension => [base + extension, path.join(base, "index" + extension)])].find(isFile);
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
function joinedAsync(node: ts.Node, candidate: DevFunction, identity: (node: ts.Expression) => string | undefined): boolean {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent))) current = current.parent;
  if (ts.isAwaitExpression(current.parent)) return true;
  if (ts.isReturnStatement(current.parent) || (ts.isArrowFunction(candidate.node) && candidate.node.body === current)) return candidate.asynchronous;
  if (ts.isArrayLiteralExpression(current.parent)) {
    let array: ts.Node = current.parent;
    while (ts.isParenthesizedExpression(array.parent)) array = array.parent;
    if (ts.isCallExpression(array.parent) && identity(array.parent.expression) === "Promise.all") return joinedAsync(array.parent, candidate, identity);
  }
  return false;
}
