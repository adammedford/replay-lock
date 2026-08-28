import ts from "typescript";
import {
  DETERMINISTIC_INTRINSICS,
  EFFECT_ANALYZER_VERSION,
  analyzeDirectEffects,
  analyzeModuleInitialization,
  type DirectEffectFinding,
  type DirectEffectReasonCode,
} from "./effect-analyzer.js";
import { isPackageCallTrusted, type PackageCatalog } from "./package-catalog.js";
import type { ProjectLockfile } from "./project-lockfile.js";
import { typescriptScriptKind } from "./typescript-script-kind.js";

export type CallGraphVerdict = "likely-safe" | "refuted" | "unknown";

export type CallGraphReasonCode = DirectEffectReasonCode | "UNKNOWN_CALL" | "UNKNOWN_MODULE" | "AMBIGUOUS_DISPATCH" | "DYNAMIC_IMPORT" | "PACKAGE_CALL" | "TRUSTED_PACKAGE_CALL";

export interface ProjectModuleSource {
  /** Project-relative module locator, for example `src/entry.ts`. */
  source: string;
  text: string;
}

export interface AnalyzeCallGraphOptions {
  /** In-memory project-local sources. Object input is convenient for fixtures. */
  modules: ReadonlyMap<string, string> | Readonly<Record<string, string>> | readonly ProjectModuleSource[];
  entryModule: string;
  exportName: string;
  /** Project-declared trusted-package catalog consulted before a package import becomes unknown evidence. */
  packageCatalog?: PackageCatalog;
  /** Installed dependency versions used to check a catalog entry's declared version range. */
  lockfile?: ProjectLockfile;
}

export interface CallGraphFinding {
  code: CallGraphReasonCode;
  source: string;
  line: number;
  column: number;
  message: string;
}

export interface TrustedPackageCallEvidence {
  package: string;
  export: string;
  matchedVersion?: string;
  unpinned: boolean;
}

export interface CallGraphNodeSummary {
  id: string;
  module: string;
  name: string;
  excluded: boolean;
  verdict: CallGraphVerdict;
}

export interface CallGraphAnalysis {
  verdict: CallGraphVerdict;
  analyzerVersion: typeof EFFECT_ANALYZER_VERSION;
  findings: readonly CallGraphFinding[];
  reachableModules: readonly string[];
  reachableCallables: readonly CallGraphNodeSummary[];
  trustedPackageCalls: readonly TrustedPackageCallEvidence[];
}

interface ModuleInfo {
  key: string;
  sourceFile: ts.SourceFile;
  source: string;
  exports: Map<string, Target | ResolutionProblem>;
  bindings: Map<string, Binding>;
  imports: Map<string, ImportBinding>;
  classes: Map<string, ClassInfo[]>;
}

interface Target {
  id: string;
  module: ModuleInfo;
  name: string;
  callable: ts.FunctionLikeDeclaration;
  excluded: boolean;
  kind: "function" | "method" | "getter" | "constructor";
}

interface ClassInfo {
  name: string;
  declaration: ts.ClassDeclaration | ts.ClassExpression;
  methods: Map<string, Target[]>;
  getters: Map<string, Target[]>;
  initializationFindings: CallGraphFinding[];
  initializationVerdict: CallGraphVerdict;
  initializers: readonly ts.Expression[];
}

type Binding = Target | ClassInfo[] | { alias: string } | { instanceClasses: ClassInfo[] } | ResolutionProblem;
interface ImportBinding { moduleSpecifier: string; imported: string; namespace?: boolean }
interface ResolutionProblem {
  reason: "unknown-module" | "package" | "ambiguous" | "unresolved";
  node?: ts.Node;
  packageSpecifier?: string;
  exportName?: string;
}

interface Edge {
  from: Target;
  to?: Target;
  problem?: ResolutionProblem;
  node: ts.Node;
  evidence?: readonly CallGraphFinding[];
  evidenceVerdict?: CallGraphVerdict;
  initializerCalls?: readonly (ts.CallExpression | ts.NewExpression)[];
  trustedPackageCall?: TrustedPackageCallEvidence;
}

interface PackageResolutionContext {
  packageCatalog?: PackageCatalog;
  lockfile?: ProjectLockfile;
}

/**
 * Analyze all project-local code reachable from one exported callable.
 *
 * Resolution is intentionally syntax-only and conservative. A local target
 * is followed only when it has one unambiguous declaration. Anything that
 * would require TypeScript's runtime/module loader (package exports,
 * dynamic imports, unresolved paths, or polymorphic dispatch) contributes
 * unknown evidence rather than being guessed pure.
 */
export function analyzeProjectCallGraph(options: AnalyzeCallGraphOptions): CallGraphAnalysis {
  const modules = createModules(options.modules);
  const entry = normalizeModuleKey(options.entryModule);
  const root = modules.get(entry);
  const findings: CallGraphFinding[] = [];
  if (!root) return freezeAnalysis("unknown", [{ code: "UNKNOWN_MODULE", source: entry, line: 1, column: 1, message: "entry module could not be resolved" }], [], [], []);

  indexModules(modules);
  const entryResolution = root.exports.get(options.exportName);
  if (!entryResolution || isProblem(entryResolution)) {
    return freezeAnalysis("unknown", [problemFinding(entryResolution ?? { reason: "unresolved" }, root.source, root.sourceFile, `export ${JSON.stringify(options.exportName)} could not be resolved`)], [root.key], [], []);
  }

  const resolution: PackageResolutionContext = {
    ...(options.packageCatalog ? { packageCatalog: options.packageCatalog } : {}),
    ...(options.lockfile ? { lockfile: options.lockfile } : {}),
  };
  const reachableModules = new Set<string>();
  const reachableTargets = new Map<string, Target>();
  const edges: Edge[] = [];
  const scanned = new Set<string>();
  const directStatuses = new Map<string, CallGraphVerdict>();
  const initializedModules = new Set<string>();
  let unknownModuleDependency = false;
  const queue: (Target | ModuleInfo)[] = [entryResolution];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (isModule(item)) {
      if (scanned.has(item.key)) continue;
      scanned.add(item.key);
      reachableModules.add(item.key);
      for (const statement of item.sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !isRuntimeImport(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const resolved = resolveModule(modules, item, statement.moduleSpecifier.text);
        if (resolved.module) { queue.push(resolved.module); continue; }
        // A catalogued package is trusted at the import boundary too: the project
        // has explicitly vouched for at least one of its exports, and each actual
        // call/member-access site still independently re-verifies its own trust
        // (version-gated) before ever contributing TRUSTED_PACKAGE_CALL evidence.
        if (resolved.problem?.reason === "package" && isCataloguedPackage(resolution.packageCatalog, statement.moduleSpecifier.text)) continue;
        unknownModuleDependency = true;
        findings.push(problemFinding(resolved.problem!, item.source, item.sourceFile, "imported module could not be resolved"));
      }
      const initialization = analyzeModuleInitialization({ source: item.source, sourceFile: item.sourceFile });
      findings.push(...directFindings(initialization.findings));
      if (initialization.verdict === "refuted") initializedModules.add(item.key);
      continue;
    }
    if (reachableTargets.has(item.id)) continue;
    reachableTargets.set(item.id, item);
    reachableModules.add(item.module.key);
    queue.push(item.module);
    const direct = analyzeDirectEffects({ source: item.module.source, sourceFile: item.module.sourceFile, callable: item.callable });
    findings.push(...directFindings(direct.findings));
    const onlyDynamicImportEvidence = direct.verdict === "refuted" && hasDynamicImport(item.callable) && direct.findings.every((finding) => finding.code === "DYNAMIC_EVALUATION");
    directStatuses.set(item.id, onlyDynamicImportEvidence ? "unknown" : direct.verdict);
    for (const edge of collectEdges(item, modules, resolution)) {
      edges.push(edge);
      if (edge.evidence) findings.push(...edge.evidence);
      if (edge.to) queue.push(edge.to);
      else if (edge.problem) findings.push(problemFinding(edge.problem, item.module.source, item.module.sourceFile, messageForProblem(edge.problem)));
    }
  }

  // A fixpoint is equivalent to SCC evaluation here and behaves predictably
  // for recursive groups: refutation and unknown evidence only ever grow.
  const status = new Map<string, CallGraphVerdict>();
  for (const target of reachableTargets.values()) {
    status.set(target.id, initializedModules.has(target.module.key) ? "refuted" : (directStatuses.get(target.id) ?? "unknown"));
  }
  for (const edge of edges) {
    if (edge.evidenceVerdict && status.has(edge.from.id)) {
      status.set(edge.from.id, joinVerdicts(status.get(edge.from.id)!, edge.evidenceVerdict));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!edge.to || !status.has(edge.from.id)) continue;
      const current = status.get(edge.from.id)!;
      const downstream = status.get(edge.to.id) ?? "likely-safe";
      const next = joinVerdicts(current, downstream);
      if (next !== current) { status.set(edge.from.id, next); changed = true; }
    }
  }
  // Direct findings are attached to source positions. An unknown edge is
  // attached to its caller and therefore must taint that caller transitively.
  for (const edge of edges) {
    if (!edge.problem || !status.has(edge.from.id)) continue;
    status.set(edge.from.id, joinVerdicts(status.get(edge.from.id)!, "unknown"));
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!edge.to || !status.has(edge.from.id)) continue;
      const current = status.get(edge.from.id)!;
      const next = joinVerdicts(current, status.get(edge.to.id) ?? "unknown");
      if (next !== current) { status.set(edge.from.id, next); changed = true; }
    }
  }

  const rootStatus = joinVerdicts(
    status.get(entryResolution.id) ?? "unknown",
    initializedModules.size > 0 ? "refuted" : unknownModuleDependency ? "unknown" : "likely-safe",
  );
  status.set(entryResolution.id, rootStatus);
  const summaries = [...reachableTargets.values()].sort((a, b) => a.id.localeCompare(b.id)).map((target) => ({
    id: target.id, module: target.module.key, name: target.name, excluded: target.excluded, verdict: status.get(target.id) ?? "unknown",
  }));
  const finalFindings = dedupeFindings(findings);
  const trustedCalls = dedupeTrustedPackageCalls(edges.flatMap((edge) => edge.trustedPackageCall ? [edge.trustedPackageCall] : []));
  return freezeAnalysis(rootStatus, finalFindings, [...reachableModules].sort(), summaries, trustedCalls);
}

function createModules(input: AnalyzeCallGraphOptions["modules"]): Map<string, ModuleInfo> {
  const entries: [string, string][] = input instanceof Map
    ? [...input.entries()]
    : Array.isArray(input) ? input.map(({ source, text }) => [source, text]) : Object.entries(input);
  const result = new Map<string, ModuleInfo>();
  for (const [raw, text] of entries) {
    const key = normalizeModuleKey(raw);
    const sourceFile = ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true, typescriptScriptKind(key));
    result.set(key, { key, sourceFile, source: key, exports: new Map(), bindings: new Map(), imports: new Map(), classes: new Map() });
  }
  return result;
}

function indexModules(modules: Map<string, ModuleInfo>): void {
  for (const info of modules.values()) {
    const top = info.sourceFile.statements;
    for (const statement of top) {
      if (ts.isImportDeclaration(statement) && isRuntimeImport(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        if (clause.name) info.imports.set(clause.name.text, { moduleSpecifier: statement.moduleSpecifier.text, imported: "default" });
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) info.imports.set(named.name.text, { moduleSpecifier: statement.moduleSpecifier.text, imported: "*", namespace: true });
        if (named && ts.isNamedImports(named)) for (const element of named.elements) info.imports.set(element.name.text, { moduleSpecifier: statement.moduleSpecifier.text, imported: element.propertyName?.text ?? element.name.text });
      }
      indexDeclaration(info, statement, hasExport(statement));
    }
    // Resolve export lists after all local declarations are known.
    for (const statement of top) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        for (const element of statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : []) {
          const imported = element.propertyName?.text ?? element.name.text;
          info.exports.set(element.name.text, { reason: "unresolved", node: element });
          const resolved = resolveModule(modules, info, statement.moduleSpecifier.text);
          if (resolved.module) info.exports.set(element.name.text, resolved.module.exports.get(imported) ?? { reason: "unresolved", node: element });
        }
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const binding = info.bindings.get(element.propertyName?.text ?? element.name.text);
          if (binding && !isProblem(binding) && !Array.isArray(binding) && isTarget(binding)) info.exports.set(element.name.text, binding);
        }
      }
    }
  }
}

function indexDeclaration(info: ModuleInfo, node: ts.Statement, exported: boolean): void {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    const target = makeTarget(info, node.name.text, node, "function");
    info.bindings.set(node.name.text, target); if (exported) info.exports.set(node.name.text, target); return;
  }
  if (ts.isClassDeclaration(node) && node.name) {
    const cls = indexClass(info, node.name.text, node);
    info.bindings.set(node.name.text, [cls]); if (exported) { /* classes are not callable exports */ }
    return;
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const target = functionTargetFromExpression(info, declaration.name.text, declaration.initializer);
      if (target) { info.bindings.set(declaration.name.text, target); if (exported) info.exports.set(declaration.name.text, target); }
      else if (ts.isNewExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression)) {
        const cls = info.bindings.get(declaration.initializer.expression.text);
        if (Array.isArray(cls)) info.bindings.set(declaration.name.text, { instanceClasses: cls });
      } else if (ts.isIdentifier(declaration.initializer)) info.bindings.set(declaration.name.text, { alias: declaration.initializer.text });
    }
  }
}

function indexClass(info: ModuleInfo, name: string, declaration: ts.ClassDeclaration | ts.ClassExpression): ClassInfo {
  const initializationFindings: CallGraphFinding[] = [];
  const initializers: ts.Expression[] = [];
  let initializationVerdict: CallGraphVerdict = "likely-safe";
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member) || hasStaticModifier(member) || !member.initializer) continue;
    const evidence = analyzeInitializerEvidence(info, member.initializer);
    initializationFindings.push(...evidence.findings);
    initializationVerdict = joinVerdicts(initializationVerdict, evidence.verdict);
    initializers.push(member.initializer);
  }
  const cls: ClassInfo = { name, declaration, methods: new Map(), getters: new Map(), initializationFindings, initializationVerdict, initializers };
  for (const member of declaration.members) {
    if ((!member.name && !ts.isConstructorDeclaration(member)) || (!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isConstructorDeclaration(member))) continue;
    const memberName = ts.isConstructorDeclaration(member) ? "constructor" : propertyText(member.name);
    if (!memberName || !member.body) continue;
    const kind = ts.isGetAccessorDeclaration(member) ? "getter" : ts.isConstructorDeclaration(member) ? "constructor" : "method";
    const target = makeTarget(info, `${name}.${memberName}`, member, kind);
    const map = kind === "getter" ? cls.getters : cls.methods;
    map.set(memberName, [...(map.get(memberName) ?? []), target]);
  }
  info.classes.set(name, [...(info.classes.get(name) ?? []), cls]);
  return cls;
}

function functionTargetFromExpression(info: ModuleInfo, name: string, expression: ts.Expression): Target | undefined {
  const unwrapped = unwrap(expression);
  if ((ts.isFunctionExpression(unwrapped) || ts.isArrowFunction(unwrapped)) && unwrapped.body) return makeTarget(info, name, unwrapped, "function");
  if (ts.isIdentifier(unwrapped)) {
    const binding = info.bindings.get(unwrapped.text);
    return binding && !isProblem(binding) && !Array.isArray(binding) && "callable" in binding ? binding : undefined;
  }
  return undefined;
}

function makeTarget(info: ModuleInfo, name: string, callable: ts.FunctionLikeDeclaration, kind: Target["kind"]): Target {
  const id = `${info.key}#${name}:${callable.getStart(info.sourceFile)}`;
  return { id, module: info, name, callable, excluded: hasExcludeTag(callable), kind };
}

function collectEdges(target: Target, modules: Map<string, ModuleInfo>, resolution: PackageResolutionContext): Edge[] {
  const edges: Edge[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== target.callable && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const edge = resolveInvocation(target, node.expression, modules, resolution, ts.isNewExpression(node));
      if (edge) {
        edges.push({ from: target, node, ...edge });
        for (const initializerCall of edge.initializerCalls ?? []) {
          const initializerEdge = resolveInvocation(target, initializerCall.expression, modules, resolution, ts.isNewExpression(initializerCall));
          if (initializerEdge) edges.push({ from: target, node: initializerCall, ...initializerEdge });
        }
      }
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const parent = node.parent;
      if (!(ts.isCallExpression(parent) || ts.isNewExpression(parent)) || parent.expression !== node) {
        const edge = resolveMemberAccess(target, node, modules, resolution);
        if (edge) edges.push({ from: target, node, ...edge });
      }
    }
    ts.forEachChild(node, visit);
  };
  if (target.callable.body) visit(target.callable.body);
  return edges;
}

function resolveInvocation(
  target: Target,
  callee: ts.Expression,
  modules: Map<string, ModuleInfo>,
  resolution: PackageResolutionContext,
  construction = false,
): Omit<Edge, "from" | "node"> | undefined {
  const path = expressionPath(callee);
  if (path && DETERMINISTIC_INTRINSICS.has(path)) return undefined;
  if (path && path.startsWith("import(")) return { problem: { reason: "unknown-module", node: callee } };
  const direct = path ? knownDirectEffect(path) : undefined;
  if (direct) return undefined;
  if (ts.isIdentifier(callee)) {
    const binding = resolveBinding(target.module, callee.text, modules);
    if (isTarget(binding)) return { to: binding };
    if (
      isProblem(binding) && binding.reason === "package" && binding.packageSpecifier && binding.exportName &&
      !isLocallyShadowedBinding(target.callable, callee.text)
    ) {
      const trusted = trustedCallEdge(resolution, binding.packageSpecifier, binding.exportName, target.module, callee);
      if (trusted) return trusted;
    }
    if (construction) {
      const classes = classesForBinding(target.module, callee.text, modules);
      if (classes.length === 1) return constructionEdge(classes[0]!);
      if (classes.length > 1) return { problem: { reason: "ambiguous", node: callee } };
    }
    if (Array.isArray(target.module.bindings.get(callee.text))) return undefined;
    return { problem: binding && isProblem(binding) ? { ...binding, node: binding.node ?? callee } : { reason: "unresolved", node: callee } };
  }
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    return resolveMemberAccess(target, callee, modules, resolution);
  }
  return { problem: { reason: "unresolved", node: callee } };
}

function isCataloguedPackage(catalog: PackageCatalog | undefined, packageSpecifier: string): boolean {
  return catalog?.entries.some((entry) => entry.package === packageSpecifier) ?? false;
}

function trustedCallEdge(
  resolution: PackageResolutionContext,
  packageSpecifier: string,
  exportName: string,
  module: ModuleInfo,
  node: ts.Node,
): Omit<Edge, "from" | "node"> | undefined {
  const trust = isPackageCallTrusted(resolution.packageCatalog, packageSpecifier, exportName, resolution.lockfile);
  if (!trust.trusted) return undefined;
  const position = module.sourceFile.getLineAndCharacterOfPosition(node.getStart(module.sourceFile));
  const versionSuffix = trust.unpinned ? " (unpinned)" : trust.matchedVersion ? `@${trust.matchedVersion}` : "";
  const finding: CallGraphFinding = {
    code: "TRUSTED_PACKAGE_CALL",
    source: module.source,
    line: position.line + 1,
    column: position.character + 1,
    message: `trusted package call: ${packageSpecifier}#${exportName}${versionSuffix}`,
  };
  return {
    evidence: [finding],
    evidenceVerdict: "likely-safe",
    trustedPackageCall: {
      package: packageSpecifier,
      export: exportName,
      unpinned: trust.unpinned,
      ...(trust.matchedVersion ? { matchedVersion: trust.matchedVersion } : {}),
    },
  };
}

function constructionEdge(cls: ClassInfo): Omit<Edge, "from" | "node"> {
  const constructors = cls.methods.get("constructor") ?? [];
  const evidence = cls.initializationFindings.length > 0 ? cls.initializationFindings : undefined;
  const evidenceVerdict = cls.initializationVerdict === "likely-safe" ? undefined : cls.initializationVerdict;
  const initializerCalls = cls.initializers.flatMap(collectInitializerCalls);
  if (constructors.length > 1) return { problem: { reason: "ambiguous" } };
  if (constructors.length === 1 && constructors[0]) return { to: constructors[0], ...(evidence ? { evidence } : {}), ...(evidenceVerdict ? { evidenceVerdict } : {}), ...(initializerCalls.length > 0 ? { initializerCalls } : {}) };
  return evidence || initializerCalls.length > 0
    ? { ...(evidence ? { evidence } : {}), ...(evidenceVerdict ? { evidenceVerdict } : {}), ...(initializerCalls.length > 0 ? { initializerCalls } : {}) }
    : {};
}

function collectInitializerCalls(initializer: ts.Expression): (ts.CallExpression | ts.NewExpression)[] {
  const calls: (ts.CallExpression | ts.NewExpression)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return calls;
}

function resolveMemberAccess(
  target: Target,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  modules: Map<string, ModuleInfo>,
  resolution: PackageResolutionContext,
): Omit<Edge, "from" | "node"> | undefined {
  const accessPath = expressionPath(access);
  if (accessPath && (DETERMINISTIC_INTRINSICS.has(accessPath) || knownDirectEffect(accessPath))) return undefined;
  const member = ts.isPropertyAccessExpression(access) ? propertyText(access.name) : propertyText(access.argumentExpression);
  const instance = instanceClasses(target, access.expression, modules);
  if (member && instance.length === 1) {
    const candidates = [...(instance[0]!.methods.get(member) ?? []), ...(instance[0]!.getters.get(member) ?? [])];
    if (candidates.length === 1 && candidates[0]) return { to: candidates[0] };
    return { problem: { reason: "ambiguous", node: access } };
  }
  if (member && instance.length === 0 && ts.isIdentifier(access.expression)) {
    const receiverName = access.expression.text;
    const imported = target.module.imports.get(receiverName);
    const shadowedByLocal = target.module.bindings.has(receiverName) || isLocallyShadowedBinding(target.callable, receiverName);
    if (imported && !shadowedByLocal) {
      const trusted = trustedCallEdge(resolution, imported.moduleSpecifier, member, target.module, access);
      if (trusted) return trusted;
    }
  }
  const pathName = expressionPath(access);
  if (pathName && (pathName.startsWith("Object.") || pathName.startsWith("Array.") || pathName.startsWith("String."))) return undefined;
  return { problem: { reason: "unresolved", node: access } };
}

/** Fails closed: any same-named parameter or local declaration anywhere in the callable is treated as shadowing, even outside its exact lexical scope. */
function isLocallyShadowedBinding(callable: ts.FunctionLikeDeclaration, name: string): boolean {
  for (const parameter of callable.parameters) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return true;
  }
  let shadowed = false;
  const visit = (node: ts.Node): void => {
    if (shadowed) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      shadowed = true;
      return;
    }
    if (ts.isFunctionLike(node) && node !== callable) {
      for (const parameter of node.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === name) { shadowed = true; return; }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (callable.body) visit(callable.body);
  return shadowed;
}

function resolveBinding(info: ModuleInfo, name: string, modules: Map<string, ModuleInfo>): Target | ResolutionProblem | undefined {
  const local = info.bindings.get(name);
  if (local) {
    if (isTarget(local)) return local;
    if ("alias" in local) return resolveBinding(info, local.alias, modules);
    if (isProblem(local)) return local;
  }
  const imported = info.imports.get(name);
  if (!imported) return undefined;
  const resolved = resolveModule(modules, info, imported.moduleSpecifier);
  if (!resolved.module) {
    if (resolved.problem?.reason === "package") {
      return { reason: "package", packageSpecifier: imported.moduleSpecifier, exportName: imported.imported };
    }
    return resolved.problem;
  }
  if (imported.namespace) return { reason: "unresolved" };
  const exported = resolved.module.exports.get(imported.imported);
  return exported && !isProblem(exported) && !Array.isArray(exported) ? exported : exported ?? { reason: "unresolved" };
}

function instanceClasses(target: Target, expression: ts.Expression, modules: Map<string, ModuleInfo>): ClassInfo[] {
  const info = target.module;
  const unwrapped = unwrap(expression);
  if (ts.isNewExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) return classesForBinding(info, unwrapped.expression.text, modules);
  if (ts.isIdentifier(unwrapped)) {
    const binding = info.bindings.get(unwrapped.text);
    if (binding && "instanceClasses" in binding) return binding.instanceClasses;
    let found: ClassInfo[] = [];
    const visit = (node: ts.Node): void => {
      if (node !== target.callable && ts.isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === unwrapped.text && node.initializer && ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)) {
        found = classesForBinding(info, node.initializer.expression.text, modules);
      }
      ts.forEachChild(node, visit);
    };
    if (target.callable.body) visit(target.callable.body);
    if (found.length > 0) return found;
  }
  return [];
}

function classesForBinding(info: ModuleInfo, name: string, modules: Map<string, ModuleInfo>): ClassInfo[] {
  const local = info.bindings.get(name);
  if (Array.isArray(local)) return local;
  const localClasses = info.classes.get(name);
  if (localClasses) return localClasses;
  const imported = info.imports.get(name);
  if (!imported) return [];
  const resolved = resolveModule(modules, info, imported.moduleSpecifier);
  if (!resolved.module) return [];
  const exported = resolved.module.bindings.get(imported.imported) ?? resolved.module.exports.get(imported.imported);
  return Array.isArray(exported) ? exported : [];
}

function resolveModule(modules: Map<string, ModuleInfo>, from: ModuleInfo, specifier: string): { module?: ModuleInfo; problem?: ResolutionProblem } {
  if (!specifier.startsWith(".")) return { problem: { reason: "package" } };
  const base = normalizeModuleKey(joinPath(dirname(from.key), specifier));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.js`];
  const matches = candidates.filter((candidate) => modules.has(candidate));
  if (matches.length !== 1) return { problem: { reason: matches.length > 1 ? "ambiguous" : "unknown-module" } };
  const module = modules.get(matches[0]!);
  return module ? { module } : { problem: { reason: "unknown-module" } };
}

function knownDirectEffect(path: string): DirectEffectReasonCode | undefined {
  if (path === "eval" || path === "Function") return "DYNAMIC_EVALUATION";
  if (path === "Date" || path === "Date.now") return "CLOCK_ACCESS";
  if (path === "Math.random") return "RANDOMNESS";
  if (path === "fetch" || path.startsWith("fs.") || path.startsWith("node:fs.")) return "IO";
  if (path.startsWith("console.")) return "LOGGING";
  return undefined;
}

function analyzeInitializerEvidence(info: ModuleInfo, initializer: ts.Expression): { verdict: CallGraphVerdict; findings: CallGraphFinding[] } {
  const findings: CallGraphFinding[] = [];
  let verdict: CallGraphVerdict = "likely-safe";
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const path = expressionPath(node.expression);
      if (path && knownDirectEffect(path)) {
        const position = info.sourceFile.getLineAndCharacterOfPosition(node.getStart(info.sourceFile));
        findings.push({ code: knownDirectEffect(path)!, source: info.source, line: position.line + 1, column: position.character + 1, message: "instance field initializer executes an ambient effect" });
        verdict = "refuted";
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return { verdict, findings: dedupeFindings(findings) };
}

function freezeAnalysis(verdict: CallGraphVerdict, findings: CallGraphFinding[], modules: string[], nodes: CallGraphNodeSummary[], trustedCalls: TrustedPackageCallEvidence[]): CallGraphAnalysis {
  return Object.freeze({
    verdict,
    analyzerVersion: EFFECT_ANALYZER_VERSION,
    findings: Object.freeze(dedupeFindings(findings).map((finding) => Object.freeze(finding))),
    reachableModules: Object.freeze(modules),
    reachableCallables: Object.freeze(nodes.map((node) => Object.freeze(node))),
    trustedPackageCalls: Object.freeze(dedupeTrustedPackageCalls(trustedCalls).map((call) => Object.freeze(call))),
  });
}

function dedupeTrustedPackageCalls(calls: readonly TrustedPackageCallEvidence[]): TrustedPackageCallEvidence[] {
  const map = new Map<string, TrustedPackageCallEvidence>();
  for (const call of calls) {
    const key = `${call.package}\0${call.export}\0${call.matchedVersion ?? ""}\0${call.unpinned}`;
    if (!map.has(key)) map.set(key, call);
  }
  return [...map.values()].sort((a, b) =>
    a.package.localeCompare(b.package) || a.export.localeCompare(b.export) || (a.matchedVersion ?? "").localeCompare(b.matchedVersion ?? ""));
}

function directFindings(findings: readonly DirectEffectFinding[]): CallGraphFinding[] { return findings.map((finding) => ({ ...finding })); }
function problemFinding(problem: ResolutionProblem, source: string, file: ts.SourceFile, message: string): CallGraphFinding {
  const node = problem.node;
  const position = node ? file.getLineAndCharacterOfPosition(node.getStart(file)) : { line: 0, character: 0 };
  const code: CallGraphReasonCode = problem.reason === "package" ? "PACKAGE_CALL" : problem.reason === "ambiguous" ? "AMBIGUOUS_DISPATCH" : problem.reason === "unknown-module" ? "UNKNOWN_MODULE" : problem.reason === "unresolved" ? "UNKNOWN_CALL" : "UNKNOWN_CALL";
  return { code, source, line: position.line + 1, column: position.character + 1, message };
}
function messageForProblem(problem: ResolutionProblem): string { return problem.reason === "package" ? "package call or initialization cannot be inspected" : problem.reason === "ambiguous" ? "dispatch has multiple possible local targets" : problem.reason === "unknown-module" ? "local module could not be resolved" : "call target could not be resolved"; }
function dedupeFindings(findings: readonly CallGraphFinding[]): CallGraphFinding[] { const map = new Map<string, CallGraphFinding>(); for (const finding of findings) { const key = `${finding.code}\0${finding.source}\0${finding.line}\0${finding.column}`; if (!map.has(key)) map.set(key, finding); } return [...map.values()].sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code)); }
function joinVerdicts(left: CallGraphVerdict, right: CallGraphVerdict): CallGraphVerdict { if (left === "refuted" || right === "refuted") return "refuted"; if (left === "unknown" || right === "unknown") return "unknown"; return "likely-safe"; }
function isModule(value: Target | ModuleInfo): value is ModuleInfo { return "sourceFile" in value; }
function isTarget(value: unknown): value is Target { return !!value && typeof value === "object" && "callable" in value; }
function isProblem(value: unknown): value is ResolutionProblem { return !!value && typeof value === "object" && "reason" in value; }
function hasExport(node: ts.Statement): boolean { return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false); }
function hasStaticModifier(node: ts.Node): boolean { return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false); }
function isRuntimeImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)) return false;
  return true;
}
function hasExcludeTag(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some((tag) => {
    if (tag.tagName.text !== "replaylock") return false;
    const comment = typeof tag.comment === "string" ? tag.comment : tag.comment ? tag.comment.map((part) => part.getText()).join("") : "";
    return comment.trim().startsWith("exclude");
  });
}
function hasDynamicImport(callable: ts.FunctionLikeDeclaration): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== callable && ts.isFunctionLike(node))) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  if (callable.body) visit(callable.body);
  return found;
}
function unwrap(expression: ts.Expression): ts.Expression { let current = expression; while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) current = current.expression; return current; }
function propertyText(name: ts.PropertyName | ts.BindingName | ts.Expression | undefined): string | undefined { if (!name) return undefined; if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text; if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) return name.expression.text; return undefined; }
function expressionPath(expression: ts.Expression): string | undefined { const value = unwrap(expression); if (ts.isIdentifier(value)) return value.text; if (value.kind === ts.SyntaxKind.ImportKeyword) return "import("; if (ts.isPropertyAccessExpression(value)) { const base = expressionPath(value.expression); return base ? `${base}.${value.name.text}` : undefined; } if (ts.isElementAccessExpression(value) && value.argumentExpression && (ts.isStringLiteral(value.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(value.argumentExpression))) { const base = expressionPath(value.expression); return base ? `${base}.${value.argumentExpression.text}` : undefined; } return undefined; }
function normalizeModuleKey(value: string): string { return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/"); }
function dirname(value: string): string { const slash = value.lastIndexOf("/"); return slash < 0 ? "" : value.slice(0, slash); }
function joinPath(base: string, child: string): string { const parts = `${base}/${child}`.split("/"); const out: string[] = []; for (const part of parts) { if (!part || part === ".") continue; if (part === "..") out.pop(); else out.push(part); } return out.join("/"); }
