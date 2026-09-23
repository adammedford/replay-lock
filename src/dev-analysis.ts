import { createHash } from "node:crypto";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import { classifyKnownInvocation, createEffectAnalyzer, expressionPath } from "./effect-analyzer.js";
import { isTypeScriptSourceFilename, typescriptScriptKind } from "./typescript-script-kind.js";
import { createDevInputTracker } from "./dev-project-cache.js";
import { DEV_AMBIENT_GLOBALS, DEV_BUILTIN_GLOBALS, DEV_EFFECT_FUNCTIONS, DEV_FRESH_CONSTRUCTORS, DEV_FRESH_METHODS, DEV_FRESH_STATICS, DEV_GLOBAL_OBJECT_MEMBERS, DEV_IMPLICIT_CALLERS, DEV_METHODS, devCatalogInvocation, devMutatingStatic, devInertInitialization, devReadableBuiltin, inertExpression } from "./dev-catalog.js";
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
  /** Top-level declarations (or namespace-imported modules) this callable references, with a referencing node. */
  references: Map<ts.Node, ts.Node>;
  /** Inline functions passed to allowed built-in methods, analyzed as part of this callable. */
  callbacks: Set<ts.Node>;
  /** Project functions called from those callbacks, where effects are not intercepted. */
  callbackCalls: Map<ts.CallExpression, DevFunction>;
  /** Calls built-ins that can invoke methods of their receiver or arguments. */
  implicitBuiltins: boolean;
}
/**
 * Module initialization runs whenever a module is imported, including when
 * verify imports a case's module. Each initialization effect taints what it
 * can affect: a global effect taints the module and every module importing it;
 * an unbound statement taints every function in the module and every reference
 * to a binding it declares; an effect in one declaration's initializer taints
 * only references to that declaration.
 */
export interface DevModule {
  file: string;
  sourceFile: ts.SourceFile;
  selected: boolean;
  /** Authored initialization alone taints every function in this module. */
  initializationTaintsModule: boolean;
  dependencies: Set<string>;
  dependencyNodes: Map<string, ts.Node>;
  /** Dependencies imported only for their side effects. */
  bareDependencies: Set<string>;
  /** Global: this module and, transitively, every module importing it. */
  problems: DevProblems;
  /** Module-wide: every function here and every reference to a binding declared here. */
  moduleProblems: DevProblems;
  /** Per top-level declaration (or unresolved import binding): references to it. */
  bindings: Map<ts.Node, DevProblems>;
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

/** Static discovery only: importing or invoking project code is never necessary. */
export function analyzeDevProject(root: string, options: ResolvedDevOptions, environment: DevEnvironment): DevAnalysis {
  return buildDevProject(root, options, environment).analysis;
}

/** Shared analysis/rewrite plan. Each covered finding has an actual AST rewrite. */
export function buildDevProject(rootInput: string, options: ResolvedDevOptions, environment: DevEnvironment, overlay?: { id: string; code: string }): DevProject {
  const root = realpathSync(rootInput);
  const inputs = createDevInputTracker();
  // This syntactic pass runs before bindings resolve, so it accepts any
  // identifier argument; the binding-aware initialization pass below is strict.
  const { analyzeDirectEffects, moduleInitializationNodes } = createEffectAnalyzer({
    isDeterministicInvocation: (node) => devInertInitialization(node, { name: expressionPath, inertIdentifier: () => true }),
    callableInitialization: "omit",
  });
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
  const conditions = options.resolveConditions?.[environment];
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
    if (requested.startsWith(".") || path.isAbsolute(requested) || requested.startsWith("#")) {
      // Subpath imports map through the importing package's `imports` field;
      // like Vite, the mapped path is then resolved as a relative request.
      const base = requested.startsWith("#") ? resolveSubpathImport(root, from, requested, environment, conditions, metadata, inputs) : path.resolve(path.dirname(from), requested);
      resolved = base === undefined ? undefined : sourceCandidates(base).find((file) => sources.has(file) || isFile(file));
    } else {
      // Node's package exports/main resolution is used for installed code, never
      // a declaration file standing in for executable dependency behavior.
      resolved = resolvePackageSource(from, requested, environment, metadata, inputs, conditions);
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
  // A stylesheet, image, font, media, text or JSON import, or a `?url`,
  // `?raw` or `?inline` import, executes no code. Its bindings, if any, are
  // still unresolved values that capture targets cannot read.
  const inertAsset = (from: string, specifier: string): boolean => {
    const requested = applyAlias(specifier, options);
    const query = requested.indexOf("?");
    const request = query < 0 ? requested : requested.slice(0, query);
    if (query < 0 ? !assetFilename(request) : !["url", "raw", "inline"].includes(requested.slice(query + 1))) return false;
    const file = request.startsWith(".") || path.isAbsolute(request) ? path.resolve(path.dirname(from), request)
      : request.startsWith("#") ? resolveSubpathImport(root, from, request, environment, conditions, metadata, inputs)
      : resolvePackageSource(from, request, environment, metadata, inputs, conditions);
    return !!file && isFile(file) && inside(root, realpathSync(file));
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
    const bareDependencies = new Set<string>();
    const problems = new DevProblems(root, sourceFile, sourceFile);
    const bindings = new Map<ts.Node, DevProblems>();
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
      if (inertAsset(file, specifier.text)) continue;
      const bare = ts.isImportDeclaration(statement) && !statement.importClause;
      const dependency = resolve(file, specifier.text);
      if (!dependency) {
        // Unknown code imported only for its effects taints everything; an
        // unresolved binding taints only the code that references it.
        if (bare) problems.at("UNKNOWN_MODULE", specifier);
        else for (const binding of importBindings(statement)) {
          const unresolved = new DevProblems(root, sourceFile, binding);
          unresolved.at("UNKNOWN_MODULE", specifier);
          bindings.set(binding, unresolved);
        }
        continue;
      }
      if (bare) bareDependencies.add(dependency);
      dependencies.add(dependency);
      dependencyNodes.set(dependency, specifier);
      if (!sources.has(dependency)) sources.set(dependency, read(dependency));
      reachable.add(dependency);
    }
    modules.set(file, {
      file, sourceFile, selected, initializationTaintsModule: false, dependencies, dependencyNodes, bareDependencies,
      problems, moduleProblems: new DevProblems(root, sourceFile, sourceFile), bindings,
    });
  }
  const compilerOptions: ts.CompilerOptions = { noLib: true, allowJs: true, checkJs: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(compilerOptions);
  // A custom resolver otherwise leaves TypeScript rereading package metadata
  // for each source file. This cache belongs only to this project build.
  const packageResolution = ts.createModuleResolutionCache(root, host.getCanonicalFileName, compilerOptions);
  host.getModuleResolutionCache = () => packageResolution;
  host.fileExists = isFile;
  host.readFile = (file) => isFile(file) ? read(file) : undefined;
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
            problems, effects: new Map(), calls: new Map(), references: new Map(), callbacks: new Set(), callbackCalls: new Map(), implicitBuiltins: false,
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
  // The AST and checker are fixed for this build, so identities are memoized.
  const identities = new Map<ts.Node, string | undefined>();
  const identity = (expression: ts.Expression): string | undefined => {
    if (identities.has(expression)) return identities.get(expression);
    const name = canonical(expression)?.replace(/^\$global\./, "").replace(/^fs\.promises\./, "fsPromises.").replace(/^\$perf_hooks\.performance\./, "performance.");
    identities.set(expression, name);
    return name;
  };
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

  // A module-scope binding is inert when it is a constant initialized with
  // literal data or catalogued built-in results that run no user code.
  const inertBindings = new Map<ts.Node, boolean>();
  const initializationContext = {
    name: identity,
    inertIdentifier: (node: ts.Identifier): boolean => {
      const declaration = symbol(node)?.valueDeclaration;
      if (!declaration) return ["undefined", "NaN", "Infinity"].includes(node.text) && !checker.getSymbolAtLocation(node)?.declarations?.length;
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer || !constantDeclaration(declaration) || enclosingFunction(declaration)) return false;
      if (!inertBindings.has(declaration)) {
        inertBindings.set(declaration, false); // a cycle is not inert
        inertBindings.set(declaration, inertExpression(declaration.initializer, initializationContext));
      }
      return inertBindings.get(declaration)!;
    },
  };
  // Module execution must be safe independently of capture selection. Each
  // module-scope effect is attributed to what it can affect (see DevModule);
  // an environment snapshot in a dependency is not a traced read.
  const moduleOf = new Map<ts.SourceFile, DevModule>([...modules.values()].map((module) => [module.sourceFile, module]));
  const bindingProblems = (module: DevModule, declaration: ts.Node): DevProblems => {
    let problems = module.bindings.get(declaration);
    if (!problems) module.bindings.set(declaration, problems = new DevProblems(root, module.sourceFile, declaration));
    return problems;
  };
  const undeclared = (node: ts.Identifier): boolean => !checker.getSymbolAtLocation(node)?.declarations?.length;
  /** The top-level declaration a binding belongs to, keyed as module bindings are. */
  const topLevelDeclaration = (declaration: ts.Node | undefined): ts.Node | undefined => {
    let node = declaration;
    while (node && (ts.isBindingElement(node) || ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))) node = node.parent;
    if (!node) return undefined;
    if (ts.isVariableDeclaration(node)) return ts.isVariableStatement(node.parent.parent) && ts.isSourceFile(node.parent.parent.parent) ? node : undefined;
    return (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isExportAssignment(node)) && ts.isSourceFile(node.parent) ? node : undefined;
  };
  /** A referenced top-level declaration, namespace-imported module, or unresolved import binding. */
  const referenceTarget = (node: ts.Identifier): ts.Node | undefined => {
    const own = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    const local = own?.declarations?.[0];
    if (!own || !local) return undefined;
    if (!(own.flags & ts.SymbolFlags.Alias)) return topLevelDeclaration(own.valueDeclaration ?? local);
    const target = checker.getAliasedSymbol(own);
    const declaration = target.valueDeclaration ?? target.declarations?.[0];
    if (!declaration) return moduleOf.get(local.getSourceFile())?.bindings.has(local) ? local : undefined;
    if (ts.isSourceFile(declaration)) return moduleOf.has(declaration) ? declaration : undefined;
    return topLevelDeclaration(declaration);
  };
  type Tier = { kind: "global" } | { kind: "module" } | { kind: "binding"; declaration: ts.Node };
  const globalTier: Tier = { kind: "global" }, moduleTier: Tier = { kind: "module" };
  const globalObject = (name: string): boolean => name === "globalThis" || name === "window" || name === "self";
  /** An effect outside any declaration is unbound; inside one, it taints that declaration. */
  const containingTier = (node: ts.Node): Tier => {
    let statement = node;
    while (statement.parent && !ts.isSourceFile(statement.parent)) statement = statement.parent;
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find((item) => descendantOf(node, item));
      if (declaration) return { kind: "binding", declaration };
    }
    return ts.isClassDeclaration(statement) || ts.isExportAssignment(statement) ? { kind: "binding", declaration: statement } : moduleTier;
  };
  /** A write taints what it writes. */
  const writeTier = (target: ts.Expression): Tier => {
    let node = unwrap(target);
    let member: string | undefined;
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) { member = memberName(node); node = unwrap(node.expression); }
    if (node.kind === ts.SyntaxKind.ThisKeyword) return moduleTier;
    if (!ts.isIdentifier(node)) return globalTier;
    if (undeclared(node)) {
      if (node.text === "module" || node.text === "exports") return moduleTier;
      // A conventionally private global registration (`window.__version`)
      // cannot be read by a capture target; host and built-in globals can.
      return globalObject(node.text) && member !== undefined && /^[_$]/.test(member) ? moduleTier : globalTier;
    }
    const own = checker.getSymbolAtLocation(node)!;
    if (own.flags & ts.SymbolFlags.Alias) return moduleTier;
    const declaration = topLevelDeclaration(own.valueDeclaration ?? own.declarations?.[0]);
    return declaration ? { kind: "binding", declaration } : moduleTier;
  };
  /** The global object, a built-in global, or a built-in prototype passed where unknown code can change it. */
  const builtinObject = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) return undeclared(node) && (globalObject(node.text) || DEV_BUILTIN_GLOBALS.has(node.text));
    if (!ts.isPropertyAccessExpression(node)) return false;
    const base = unwrap(node.expression);
    return ts.isIdentifier(base) && undeclared(base) && (globalObject(base.text) || (node.name.text === "prototype" && DEV_BUILTIN_GLOBALS.has(base.text)));
  };
  const mutationApis = new Set(["Object.assign", "Object.defineProperty", "Object.defineProperties", "Object.setPrototypeOf", "Object.freeze", "Object.seal", "Object.preventExtensions", "Reflect.set", "Reflect.deleteProperty", "Reflect.defineProperty", "Reflect.setPrototypeOf"]);
  const knownReads = new Set(["Math.random", "crypto.randomUUID", "Date", "Date.now", "performance.now"]);
  const callTier = (node: ts.CallExpression | ts.NewExpression): Tier => {
    const callee = unwrap(node.expression);
    const args = node.arguments ?? [];
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return globalTier;
    const name = identity(callee);
    if (ts.isIdentifier(callee) && callee.text === "require" && undeclared(callee)) return args.length === 1 && ts.isStringLiteral(args[0]!) ? containingTier(node) : globalTier;
    if (name && mutationApis.has(name) && args[0]) return writeTier(args[0]);
    const known = classifyKnownInvocation(expressionPath(callee) ?? name);
    if (known === "DYNAMIC_EVALUATION" || known === "IO" || known === "LOGGING") return globalTier;
    if (name && knownReads.has(name)) return containingTier(node);
    if (args.some(builtinObject)) return globalTier;
    let base: ts.Expression = callee;
    let member: string | undefined;
    while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base) || ts.isCallExpression(base)) {
      if (!ts.isCallExpression(base)) member = memberName(base);
      base = unwrap(base.expression);
    }
    if (ts.isIdentifier(base) && undeclared(base)) {
      // Host APIs (timers, listeners, storage, network, logging) act globally;
      // built-ins only compute values.
      const global = globalObject(base.text) ? member : base.text;
      return global !== undefined && DEV_BUILTIN_GLOBALS.has(global) ? containingTier(node) : globalTier;
    }
    return containingTier(node);
  };
  const initializationTier = (node: ts.Node): Tier => {
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isForOfStatement(node)) return globalTier;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return callTier(node);
    if (ts.isBinaryExpression(node)) return writeTier(node.left);
    if (ts.isDeleteExpression(node)) return writeTier(node.expression);
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return writeTier(node.operand);
    return containingTier(node);
  };
  for (const module of modules.values()) {
    const findings = new Set<ts.Node>(moduleInitializationNodes(module.sourceFile));
    const initialization = (child: ts.Node): void => {
      if (ts.isFunctionLike(child)) {
        if (child.name && ts.isComputedPropertyName(child.name)) initialization(child.name.expression);
        return;
      }
      if (ts.isTypeNode(child) || ts.isImportDeclaration(child) || ts.isExportDeclaration(child)) return;
      if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
        const name = identity(child);
        if (name === "process.env" || name?.startsWith("process.env.") || name === "import.meta.env" || name?.startsWith("import.meta.env.")) findings.add(child);
      }
      if ((ts.isCallExpression(child) || ts.isNewExpression(child)) && !devInertInitialization(child, initializationContext)) findings.add(child);
      if (ts.isForOfStatement(child) && child.awaitModifier) findings.add(child);
      ts.forEachChild(child, initialization);
    };
    initialization(module.sourceFile);
    for (const finding of findings) {
      const tier = initializationTier(finding);
      const problems = tier.kind === "global" ? module.problems : tier.kind === "module" ? module.moduleProblems : bindingProblems(module, tier.declaration);
      problems.at("EFFECTFUL_INITIALIZATION", finding);
    }
    // Resolution-independent: the transform may rely on this before analysis.
    module.initializationTaintsModule = module.problems.has("EFFECTFUL_INITIALIZATION") || module.problems.has("UNSUPPORTED_SOURCE") || module.moduleProblems.size > 0;
  }
  // References made while a declaration initializes carry its dependencies' taint.
  const declarationReferences = new Map<ts.Node, Map<ts.Node, ts.Node>>();
  for (const module of modules.values()) for (const statement of module.sourceFile.statements) {
    const declarations: ts.Node[] = ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : ts.isClassDeclaration(statement) || ts.isExportAssignment(statement) ? [statement] : [];
    for (const declaration of declarations) {
      const references = new Map<ts.Node, ts.Node>();
      const visit = (child: ts.Node): void => {
        if (child !== declaration && ts.isFunctionLike(child)) return;
        if (ts.isTypeNode(child)) return;
        if (ts.isIdentifier(child) && referenceIdentifier(child)) {
          const target = referenceTarget(child);
          if (target && target !== declaration && !references.has(target)) references.set(target, child);
        }
        ts.forEachChild(child, visit);
      };
      visit(declaration);
      if (references.size) declarationReferences.set(declaration, references);
    }
  }
  // Unselected dependency callables contribute only when reached by a selected
  // callable. Global initialization effects above apply to every importer.
  const reachableFunctions = new Set(functions.filter(candidate => candidate.instrument));
  // Every function body a target can reach is either analyzed as its own
  // callable or excluded. An unanalyzed function value can run implicitly
  // (toString, valueOf, iterators, callbacks) outside effect interception.
  const discovered = new Set<ts.Node>(functions.map((candidate) => candidate.node));
  // A module-private constant holding flat literal data that no code in its
  // module can mutate or leak is a lookup table: every read yields a primitive
  // fixed at initialization, so reading it is as safe as reading a scalar.
  const identifierIndex = new Map<ts.SourceFile, Map<string, ts.Identifier[]>>();
  const namedIdentifiers = (sourceFile: ts.SourceFile, name: string): ts.Identifier[] => {
    let index = identifierIndex.get(sourceFile);
    if (!index) {
      const built = new Map<string, ts.Identifier[]>();
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) { const list = built.get(node.text); if (list) list.push(node); else built.set(node.text, [node]); }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      identifierIndex.set(sourceFile, index = built);
    }
    return index.get(name) ?? [];
  };
  const flatTable = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    const scalar = (element: ts.Expression): boolean => !ts.isSpreadElement(element) && !ts.isOmittedExpression(element) && immutableScalar(element, checker);
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.every((property) => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) && property.name.text !== "__proto__" && scalar(property.initializer));
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(scalar);
    const [argument, ...rest] = (ts.isCallExpression(node) || ts.isNewExpression(node)) ? node.arguments ?? [] : [];
    if (!argument || rest.length) return false;
    if (ts.isCallExpression(node)) {
      const literal = unwrap(argument);
      return expressionPath(node.expression) === "Object.freeze" && identity(node.expression) === "Object.freeze" && (ts.isObjectLiteralExpression(literal) || ts.isArrayLiteralExpression(literal)) && flatTable(literal);
    }
    const entries = unwrap(argument);
    if (!ts.isNewExpression(node) || !ts.isArrayLiteralExpression(entries)) return false;
    const constructor = identity(node.expression);
    if (constructor === "Set") return entries.elements.every(scalar);
    return constructor === "Map" && entries.elements.every((entry) => { const pair = unwrap(entry as ts.Expression); return ts.isArrayLiteralExpression(pair) && pair.elements.length === 2 && pair.elements.every(scalar); });
  };
  const tableReaders = new Set(["Object.keys", "Object.values", "Object.entries", "Object.hasOwn", "Object.getOwnPropertyNames", "JSON.stringify", "Array.from"]);
  /** A use that reads the table without mutating it or letting a reference escape. */
  const tableRead = (reference: ts.Identifier): boolean => {
    if (ts.isTypeQueryNode(reference.parent)) return true;
    const site = expressionSite(reference);
    const parent = site.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === site) {
      if (["__proto__", "constructor", "prototype"].includes(memberName(parent) ?? "")) return false;
      if (calleePosition(parent)) {
        // Reading methods only; a callback would receive the table itself.
        const spec = DEV_METHODS.get(memberName(parent) ?? "");
        return !!spec && !spec.mutating && !spec.callbacks && !spec.regex;
      }
      let top: ts.Node = parent;
      while (top.parent && (((ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent)) && top.parent.expression === top) || ts.isParenthesizedExpression(top.parent) || ts.isAsExpression(top.parent) || ts.isTypeAssertionExpression(top.parent) || ts.isNonNullExpression(top.parent) || ts.isSatisfiesExpression(top.parent))) top = top.parent;
      return !writtenExpression(top);
    }
    if (ts.isTypeOfExpression(parent) || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword && parent.right === site)) return true;
    if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.expression === site) return true;
    if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) return !writtenExpression(parent.parent);
    return ts.isCallExpression(parent) && parent.arguments[0] === site && tableReaders.has(identity(parent.expression) ?? "") && expressionPath(parent.expression) === identity(parent.expression);
  };
  const tables = new Map<ts.VariableDeclaration, boolean>();
  const immutableTable = (declaration: ts.VariableDeclaration): boolean => {
    let result = tables.get(declaration);
    if (result !== undefined) return result;
    const statement = declaration.parent.parent;
    result = ts.isIdentifier(declaration.name) && !!declaration.initializer && constantDeclaration(declaration)
      && ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent) && !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      && flatTable(declaration.initializer);
    if (result) {
      const name = declaration.name as ts.Identifier;
      const binding = symbol(name);
      result = namedIdentifiers(declaration.getSourceFile(), name.text).every((reference) => reference === name || symbol(reference) !== binding || tableRead(reference));
    }
    tables.set(declaration, result);
    return result;
  };
  // An imported binding whose module or export does not resolve has no
  // analyzed value; builtin imports are identified separately.
  const unresolvedImport = (node: ts.Identifier): boolean => {
    const own = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    if (!own || !(own.flags & ts.SymbolFlags.Alias) || checker.getAliasedSymbol(own).declarations?.length) return false;
    let statement: ts.Node | undefined = own.declarations?.[0];
    while (statement && !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) statement = statement.parent;
    const specifier = statement && (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ? statement.moduleSpecifier : undefined;
    return !(specifier && ts.isStringLiteral(specifier) && builtins.has(applyAlias(specifier.text, options).replace(/^node:/, "")));
  };
  // A binding imported from a Node builtin that has no effect identity
  // (for example `os` or `child_process`) is ambient host state.
  const builtinImportRoot = (expression: ts.Expression): boolean => {
    let root = unwrap(expression);
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = unwrap(root.expression);
    if (!ts.isIdentifier(root)) return false;
    let statement: ts.Node | undefined = checker.getSymbolAtLocation(root)?.declarations?.[0];
    if (!statement || !(ts.isImportSpecifier(statement) || ts.isNamespaceImport(statement) || ts.isImportClause(statement))) return false;
    while (statement && !ts.isImportDeclaration(statement)) statement = statement.parent;
    return !!statement && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && builtins.has(applyAlias(statement.moduleSpecifier.text, options).replace(/^node:/, "")) && canonical(root) === undefined;
  };
  /** A value this invocation created and owns, so mutating it affects nothing else. */
  const freshValue = (expression: ts.Expression, owner: ts.Node, seen = new Set<ts.Node>()): boolean => {
    const node = unwrap(expression);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) return true;
    if (ts.isNewExpression(node)) return DEV_FRESH_CONSTRUCTORS.has(identity(node.expression) ?? "");
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const name = identity(callee);
      if (name !== undefined) return DEV_FRESH_STATICS.has(name);
      return (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && DEV_FRESH_METHODS.has(memberName(callee) ?? "");
    }
    if (!ts.isIdentifier(node)) return false;
    const declaration = symbol(node)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) || !declaration.initializer || !descendantOf(declaration, owner) || !freshValue(declaration.initializer, owner, seen)) return false;
    if (constantDeclaration(declaration)) return true;
    // A reassigned local stays owned only if every value assigned to it is.
    const binding = symbol(declaration.name);
    return namedIdentifiers(owner.getSourceFile(), declaration.name.text).every((reference) => {
      if (reference === declaration.name || symbol(reference) !== binding) return true;
      const site = expressionSite(reference);
      const parent = site.parent;
      if (ts.isBinaryExpression(parent) && parent.left === site && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && freshValue(parent.right, owner, seen);
      return !writtenExpression(site);
    });
  };
  /** A regular expression whose `test`/`exec` cannot depend on `lastIndex`. */
  const statelessRegex = (expression: ts.Expression, owner: ts.Node): boolean => {
    const node = unwrap(expression);
    if (ts.isRegularExpressionLiteral(node)) return !/[gy]/.test(node.text.slice(node.text.lastIndexOf("/") + 1));
    if (ts.isNewExpression(node)) {
      const flags = node.arguments?.[1];
      return identity(node.expression) === "RegExp" && (!flags || (ts.isStringLiteral(flags) && !/[gy]/.test(flags.text)));
    }
    if (!ts.isIdentifier(node)) return false;
    const declaration = symbol(node)?.valueDeclaration;
    return !!declaration && ts.isVariableDeclaration(declaration) && !!declaration.initializer && constantDeclaration(declaration) && descendantOf(declaration, owner) && statelessRegex(declaration.initializer, owner);
  };
  /** An inline, synchronous function, or a readable built-in, passed as a callback. */
  const callbackArgument = (argument: ts.Expression): boolean => {
    const callback = unwrap(argument);
    if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) return !callback.asteriskToken && !hasModifier(callback, ts.SyntaxKind.AsyncKeyword);
    // A position that also accepts data, such as `replace`'s replacement string.
    if (literalValue(callback) || ts.isNoSubstitutionTemplateLiteral(callback) || ts.isTemplateExpression(callback)) return true;
    const name = identity(callback);
    return name !== undefined && devReadableBuiltin(name);
  };
  /** A catalogued method called on data, registering its inline callbacks for analysis. */
  const builtinMethod = (call: ts.CallExpression, candidate: DevFunction): boolean => {
    const callee = unwrap(call.expression);
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return false;
    const spec = DEV_METHODS.get(memberName(callee) ?? "");
    if (!spec || call.arguments.some(ts.isSpreadElement)) return false;
    const receiver = unwrap(callee.expression);
    if (receiver.kind === ts.SyntaxKind.ThisKeyword || receiver.kind === ts.SyntaxKind.SuperKeyword) return false;
    // An ambient path names a static or host API, never a data receiver.
    if (identity(callee) !== undefined) return false;
    if (spec.regex && !statelessRegex(receiver, candidate.node)) return false;
    if (spec.mutating && !freshValue(receiver, candidate.node)) return false;
    const callbacks = (spec.callbacks ?? []).map((index) => call.arguments[index]).filter((argument): argument is ts.Expression => !!argument);
    if (!callbacks.every(callbackArgument)) return false;
    for (const argument of callbacks) {
      const callback = unwrap(argument);
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) candidate.callbacks.add(callback);
    }
    return true;
  };
  /** A write inside a callback may only change the invocation's own locals or owned values. */
  const callbackWrite = (target: ts.Expression, owner: ts.Node): string | undefined => {
    let node = unwrap(target);
    if (ts.isIdentifier(node)) {
      const declaration = symbol(node)?.valueDeclaration;
      return declaration && descendantOf(declaration, owner) ? undefined : "AMBIENT_MUTATION";
    }
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return "ARGUMENT_MUTATION";
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) node = unwrap(node.expression);
    if (freshValue(node, owner)) return undefined;
    const declaration = ts.isIdentifier(node) ? symbol(node)?.valueDeclaration : undefined;
    return declaration && !descendantOf(declaration, owner) ? "AMBIENT_MUTATION" : "ARGUMENT_MUTATION";
  };
  for (const candidate of reachableFunctions) {
    const { node, module, problems, effects, calls, references } = candidate;
    let callbackDepth = 0;
    const inspect = (child: ts.Node): void => {
      if (child !== node && ts.isFunctionLike(child)) {
        if (candidate.callbacks.has(child)) {
          // Allowed callbacks run synchronously inside this invocation.
          callbackDepth++;
          ts.forEachChild(child, inspect);
          callbackDepth--;
        } else if (ts.isGetAccessorDeclaration(child) || ts.isSetAccessorDeclaration(child)) problems.at("UNKNOWN_CALL", child);
        else if (runtimeFunction(child) && !discovered.has(child)) problems.at("FUNCTION_VALUE", child);
        return;
      }
      if (callbackDepth > 0) {
        const written = ts.isBinaryExpression(child) && child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && child.operatorToken.kind <= ts.SyntaxKind.LastAssignment ? child.left
          : ts.isDeleteExpression(child) ? child.expression
          : (ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) && (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken) ? child.operand : undefined;
        const code = written && callbackWrite(written, node);
        if (code) problems.at(code, child);
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
            if (!owner && !bySymbol.has(binding!) && !identity(child) && declaration.initializer && !immutableScalar(declaration.initializer, checker) && !immutableTable(declaration)) problems.at("AMBIENT_STATE", child);
          }
        }
        const target = referenceTarget(child);
        if (target && !references.has(target)) references.set(target, child);
        // A function is safe only where it is called and analyzed as a call.
        if (!calleePosition(child) && (bySymbol.has(binding!) || (declaration && functionDeclaration(declaration)))) problems.at("FUNCTION_VALUE", child);
        // An unresolved module is inherited below with its cause chain; this
        // covers missing exports and values bound by inert asset imports.
        if (!module.problems.has("UNKNOWN_MODULE") && !(target && module.bindings.has(target)) && unresolvedImport(child)) problems.at("UNKNOWN_MODULE", child);
        if (!declaration && child.text === "arguments") problems.at("UNSUPPORTED_CALLABLE", child);
        if (!declaration && !DEV_AMBIENT_GLOBALS.has(child.text)) problems.at("UNKNOWN_REFERENCE", child);
      }
      if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
        const binding = symbol(ts.isPropertyAccessExpression(child) ? child.name : child);
        const declaration = binding?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && !descendantOf(declaration, node) && !bySymbol.has(binding!) && !identity(child) && declaration.initializer && !immutableScalar(declaration.initializer, checker) && !immutableTable(declaration)) problems.at("AMBIENT_STATE", child);
        if (declaration && (ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) problems.at("UNKNOWN_CALL", child);
        if (binding && bySymbol.has(binding) && !calleePosition(child)) problems.at("FUNCTION_VALUE", child);
        const name = identity(child);
        if (canonical(child.expression) === "$global" && !DEV_GLOBAL_OBJECT_MEMBERS.has(name ?? "")) problems.at("AMBIENT_STATE", child);
      }
      // A built-in read outside a call is only safe when it is an immutable
      // constant or a deterministic function; an alias is checked where used.
      if (((ts.isIdentifier(child) && referenceIdentifier(child)) || ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) && valueReference(child)) {
        const name = identity(child);
        if (name !== undefined) {
          if (!name.startsWith("$response") && operation(child)?.kind !== "environment" && !devReadableBuiltin(name)) problems.at(DEV_EFFECT_FUNCTIONS.has(name) ? "FUNCTION_VALUE" : "AMBIENT_STATE", child);
        } else if (ts.isElementAccessExpression(child) ? identity(child.expression) !== undefined || builtinImportRoot(child.expression) : builtinImportRoot(child)) {
          problems.at("AMBIENT_STATE", child);
        }
      }
      const effect = operation(child);
      if (effect) {
        // Effects inside callbacks run outside interception.
        if (callbackDepth > 0) problems.at("CALLBACK_EFFECT", child);
        else if (!candidate.instrument) problems.at("UNINSTRUMENTED_EFFECT", child);
        else effects.set(child, effect);
      }
      if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
        const target = ts.isCallExpression(child) ? resolveFunction(child.expression) : undefined;
        const name = identity(child.expression);
        let asynchronous = effect?.asynchronous ?? false;
        if (!effect) {
          if (target && ts.isCallExpression(child) && !child.questionDotToken && !ts.isCallChain(child)) {
            calls.set(child, target);
            if (callbackDepth > 0) candidate.callbackCalls.set(child, target);
            reachableFunctions.add(target);
            asynchronous = target.asynchronous;
          } else if (name === "Promise.all" && ts.isCallExpression(child) && child.arguments.length === 1 && ts.isArrayLiteralExpression(unwrap(child.arguments[0]!))) {
            asynchronous = true;
          } else if (name === "Promise.resolve" && ts.isCallExpression(child) && child.arguments.length <= 1) {
            // Only immediate values; assimilating an unknown thenable would run hidden work.
            if (child.arguments[0] && !literalValue(child.arguments[0])) problems.at("UNKNOWN_CALL", child);
            asynchronous = true;
          } else if (name && devCatalogInvocation(child, name, expressionPath(child.expression))) {
            if (DEV_IMPLICIT_CALLERS.has(name) && child.arguments?.length) candidate.implicitBuiltins = true;
            // Direct mutation analysis does not descend into callbacks.
            if (callbackDepth > 0 && devMutatingStatic(name) && !(child.arguments?.[0] && freshValue(child.arguments[0], node))) problems.at("ARGUMENT_MUTATION", child);
          } else if (ts.isCallExpression(child) && builtinMethod(child, candidate)) {
            candidate.implicitBuiltins = true;
          } else {
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
    // The development analyzer records nested callables as their own targets and
    // projects their effects onto every active ancestor at runtime, so a nested
    // effect is already captured and must not exclude this callable. Keep the
    // direct scan to this callable's own body; nested descent is a V1 concern.
    const direct = analyzeDirectEffects({ source: candidate.locator.module, sourceFile: module.sourceFile, callable: node, nestedFunctions: "skip" });
    for (const finding of direct.findings) {
      const position = module.sourceFile.getPositionOfLineAndCharacter(finding.line - 1, finding.column - 1);
      const covered = coveredFindingCodes.has(finding.code) && [...effects.keys()].some((effectNode) => position === effectNode.getStart() || ((ts.isCallExpression(effectNode) || ts.isNewExpression(effectNode)) && position === effectNode.expression.getStart()));
      if (!covered) problems.at(finding.code, { module: candidate.locator.module, line: finding.line, column: finding.column });
    }
  }
  // A project function called from a callback runs outside this invocation's
  // interception, so it must have no traced effects, directly or transitively.
  // A callable whose built-ins may invoke methods of its values requires plain
  // values, and so does every callable that calls it.
  const effectful = new Set([...reachableFunctions].filter((candidate) => candidate.effects.size > 0));
  const plain = new Set([...reachableFunctions].filter((candidate) => candidate.implicitBuiltins));
  for (let grew = true; grew;) {
    grew = false;
    for (const candidate of reachableFunctions) for (const target of candidate.calls.values()) {
      if (effectful.has(target) && !effectful.has(candidate)) { effectful.add(candidate); grew = true; }
      if (plain.has(target) && !plain.has(candidate)) { plain.add(candidate); grew = true; }
    }
  }
  for (const candidate of reachableFunctions) {
    for (const [call, target] of candidate.callbackCalls) if (effectful.has(target)) candidate.problems.at("CALLBACK_EFFECT", call);
    if (plain.has(candidate)) candidate.requires = ["plainValues"];
  }
  // Stable lexical locators must never silently pick one of two block-scoped names.
  const locators = new Map<string, DevFunction>();
  for (const candidate of functions) {
    const key = JSON.stringify(candidate.locator);
    const previous = locators.get(key);
    if (previous) { previous.problems.add("AMBIGUOUS_CALLABLE"); candidate.problems.add("AMBIGUOUS_CALLABLE"); }
    locators.set(key, candidate);
  }
  const inheritAll = (problems: DevProblems, source: DevProblems | undefined, via: ts.Node): boolean => {
    let changed = false;
    if (source) for (const code of source) if (!problems.has(code)) { problems.inherit(code, source, via); changed = true; }
    return changed;
  };
  /** Inherit what a reference to `target` can observe: its binding and, from another module, that module's unbound effects. */
  const inheritReference = (problems: DevProblems, from: DevModule, target: ts.Node, via: ts.Node): boolean => {
    const owner = moduleOf.get(target.getSourceFile());
    if (!owner) return false;
    let changed = owner !== from && inheritAll(problems, owner.moduleProblems, via);
    if (ts.isSourceFile(target)) for (const binding of owner.bindings.values()) changed = inheritAll(problems, binding, via) || changed;
    else changed = inheritAll(problems, owner.bindings.get(target), via) || changed;
    return changed;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of modules.values()) for (const dependency of module.dependencies) {
      const imported = modules.get(dependency);
      if (!imported) continue;
      const via = module.dependencyNodes.get(dependency)!;
      changed = inheritAll(module.problems, imported.problems, via) || changed;
      // A side-effect import runs the whole module for its effects.
      if (module.bareDependencies.has(dependency)) changed = inheritAll(module.problems, imported.moduleProblems, via) || changed;
    }
    for (const [declaration, targets] of declarationReferences) {
      const module = moduleOf.get(declaration.getSourceFile())!;
      for (const [target, via] of targets) {
        const owner = moduleOf.get(target.getSourceFile());
        const tainted = owner && (owner !== module && owner.moduleProblems.size > 0 || (ts.isSourceFile(target) ? [...owner.bindings.values()].some((binding) => binding.size > 0) : !!owner.bindings.get(target)?.size));
        if (tainted) changed = inheritReference(bindingProblems(module, declaration), module, target, via) || changed;
      }
    }
    // Unreached dependency functions cannot contribute diagnostics to a selected
    // callable. Keep global propagation to every importer, but avoid constructing
    // unused per-callable cause chains for the rest of the dependency graph.
    for (const candidate of reachableFunctions) {
      changed = inheritAll(candidate.problems, candidate.module.problems, candidate.node) || changed;
      changed = inheritAll(candidate.problems, candidate.module.moduleProblems, candidate.node) || changed;
      for (const [call, target] of candidate.calls) changed = inheritAll(candidate.problems, target.problems, call) || changed;
      for (const [target, via] of candidate.references) changed = inheritReference(candidate.problems, candidate.module, target, via) || changed;
    }
  }
  const diagnostics: DevDiagnostic[] = [];
  const targets: DevTarget[] = [];
  for (const candidate of functions) {
    if (!candidate.instrument) continue;
    if (candidate.problems.size === 0) targets.push({ locator: candidate.locator, replayExport: candidate.replayExport, ...(candidate.requires ? { requires: candidate.requires } : {}) });
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
/** The local bindings a runtime import declares: default, namespace, and non-type named imports. */
function importBindings(node: ts.ImportDeclaration | ts.ExportDeclaration): ts.Node[] {
  const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
  if (!clause || clause.isTypeOnly) return [];
  const named = clause.namedBindings;
  return [
    ...(clause.name ? [clause] : []),
    ...(named && ts.isNamespaceImport(named) ? [named] : []),
    ...(named && ts.isNamedImports(named) ? named.elements.filter((element) => !element.isTypeOnly) : []),
  ];
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
function runtimeFunction(node: ts.Node): boolean {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && !!node.body;
}
function functionDeclaration(node: ts.Declaration): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isMethodDeclaration(node)) return true;
  if (!ts.isVariableDeclaration(node) || !node.initializer) return false;
  const initializer = unwrap(node.initializer);
  return ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer) || ts.isClassExpression(initializer);
}
/** The outermost expression that `node` denotes, skipping type-only wrappers. */
function expressionSite(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isTypeAssertionExpression(current.parent) || ts.isNonNullExpression(current.parent) || ts.isSatisfiesExpression(current.parent))) current = current.parent;
  return current;
}
function calleePosition(node: ts.Node): boolean {
  const site = expressionSite(node);
  const parent = site.parent;
  return ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === site) || (ts.isTaggedTemplateExpression(parent) && parent.tag === site);
}
/** A complete value read: not a member-chain prefix, callee, alias declaration, or `typeof` operand. */
function valueReference(node: ts.Node): boolean {
  const site = expressionSite(node);
  const parent = site.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === site) return false;
  if (calleePosition(node) || ts.isTypeOfExpression(parent)) return false;
  return !(ts.isVariableDeclaration(parent) && parent.initializer === site && constantDeclaration(parent));
}
/** Whether an expression is written: assigned, deleted, updated, or a destructuring or loop target. */
function writtenExpression(node: ts.Node): boolean {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isArrayLiteralExpression(current.parent) || ts.isObjectLiteralExpression(current.parent) || ts.isSpreadElement(current.parent) || ts.isSpreadAssignment(current.parent) || ts.isShorthandPropertyAssignment(current.parent) || (ts.isPropertyAssignment(current.parent) && current.parent.initializer === current))) current = current.parent;
  const parent = current.parent;
  if (ts.isBinaryExpression(parent)) return parent.left === current && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === current) return true;
  if (current !== node) return false;
  return ts.isDeleteExpression(parent) || ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator));
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
function resolvePackageSource(from: string, specifier: string, environment: DevEnvironment, metadata: Map<string, string>, inputs: ReturnType<typeof createDevInputTracker>, conditions?: readonly string[]): string | undefined {
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
        if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).some((key) => key.startsWith("."))) ({ entry, wildcard } = subpathEntry(entry as Record<string, unknown>, subpath));
        else if (subpath !== ".") return undefined;
        let target = selectTarget(entry, environment, conditions);
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
/**
 * Map a `#` specifier through the `imports` field of the importer's package
 * scope (its nearest package.json inside the project) to a path or package.
 */
function resolveSubpathImport(root: string, from: string, specifier: string, environment: DevEnvironment, conditions: readonly string[] | undefined, metadata: Map<string, string>, inputs: ReturnType<typeof createDevInputTracker>): string | undefined {
  const { isFile, read } = inputs;
  for (let directory = path.dirname(from); inside(root, directory); directory = path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (!isFile(manifest)) { if (directory === root) return undefined; continue; }
    const text = read(manifest);
    metadata.set(manifest, text);
    let definition: { imports?: unknown };
    try { definition = JSON.parse(text) as typeof definition; } catch { return undefined; }
    if (!definition.imports || typeof definition.imports !== "object" || Array.isArray(definition.imports)) return undefined;
    const { entry, wildcard } = subpathEntry(definition.imports as Record<string, unknown>, specifier);
    let target = selectTarget(entry, environment, conditions);
    if (target === undefined) return undefined;
    if (wildcard !== undefined) target = target.replaceAll("*", wildcard);
    if (!target.startsWith("./")) return target.startsWith("#") || target.startsWith(".") || path.isAbsolute(target) ? undefined : resolvePackageSource(manifest, target, environment, metadata, inputs, conditions);
    const file = path.resolve(directory, target);
    return inside(directory, file) ? file : undefined;
  }
  return undefined;
}
/** The exports or imports entry for a subpath, and the text its `*` matched. */
function subpathEntry(entries: Record<string, unknown>, subpath: string): { entry: unknown; wildcard?: string } {
  if (entries[subpath] !== undefined) return { entry: entries[subpath] };
  const pattern = Object.keys(entries).filter((key) => key.includes("*")).sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length).find((key) => {
    const [before, after] = key.split("*");
    return subpath.startsWith(before!) && subpath.endsWith(after!) && subpath.length >= before!.length + after!.length;
  });
  if (!pattern) return { entry: undefined };
  const [before, after] = pattern.split("*");
  return { entry: entries[pattern], wildcard: subpath.slice(before!.length, subpath.length - after!.length) };
}
/**
 * Node's conditional target selection. With the host's conditions, inactive
 * conditions are skipped as Vite skips them; without them, a configured or
 * custom condition cannot safely be guessed from source and fails closed.
 */
function selectTarget(value: unknown, environment: DevEnvironment, conditions: readonly string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) { const selected = selectTarget(item, environment, conditions); if (selected) return selected; }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [condition, target] of Object.entries(value)) {
    if (conditions) {
      if (condition !== "default" && condition !== "import" && !conditions.includes(condition)) continue;
      if (target === null) return undefined;
      const selected = selectTarget(target, environment, conditions);
      if (selected !== undefined) return selected;
      continue;
    }
    if (["default", "import", environment, ...(environment === "node" ? ["node-addons"] : [])].includes(condition)) return selectTarget(target, environment, conditions);
    if (!["types", "require", "node", "node-addons", "browser"].includes(condition)) return undefined;
  }
  return undefined;
}
function sourceCandidates(base: string): string[] {
  const stem = base.replace(/\.[cm]?jsx?$/, "");
  return [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].flatMap((extension) => [stem + extension, base + extension, path.join(base, "index" + extension)])];
}
function assetFilename(request: string): boolean {
  return /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss|svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|aac|opus|mov|m4a|txt|json|webmanifest)$/i.test(request);
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
