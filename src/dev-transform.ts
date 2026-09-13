import path from "node:path";
import { realpathSync } from "node:fs";
import MagicString from "magic-string";
import ts from "typescript";
import { buildDevProject, type DevProject, type DevFunction, type DevOperation } from "./dev-analysis.js";
import type { DevEnvironment, ResolvedDevOptions, DevTransformOptions, DevTransformResult } from "./dev-contract.js";

export { analyzeDevProject } from "./dev-analysis.js";

/** Instrument authored operations only. The caller owns dev/production activation. */
export function transformDevSource(options: DevTransformOptions): DevTransformResult {
  const project = buildDevProject(options.root, options.options, options.environment, { id: options.id, code: options.code });
  return transformProject(project, options);
}

/** One current immutable base plan per realm, owned by one recording/replay
 * session. Overlays never replace the disk plan or survive a transform call.
 */
export function createDevProjectCache(rootInput: string, resolvedOptions: ResolvedDevOptions) {
  const root = realpathSync(rootInput);
  const snapshots = new Map<DevEnvironment, { key: string; project: DevProject }>();
  function projectFor(environment: DevEnvironment, options: ResolvedDevOptions): DevProject {
    const key = JSON.stringify(options);
    let snapshot = snapshots.get(environment);
    if (!snapshot || snapshot.key !== key || !snapshot.project.isCurrent()) {
      snapshot = { key, project: buildDevProject(root, options, environment) };
      snapshots.set(environment, snapshot);
    }
    return snapshot.project;
  }
  return {
    analyze(environment: DevEnvironment) { return projectFor(environment, resolvedOptions).analysis; },
    hasAuthoredTargets(id: string, environment: DevEnvironment): boolean {
      let file = path.resolve(root, id.split("?", 1)[0]!);
      try { file = realpathSync(file); } catch { return false; }
      const module = path.relative(root, file).split(path.sep).join("/");
      return projectFor(environment, resolvedOptions).analysis.targets.some(target => target.locator.module === module);
    },
    transform(options: DevTransformOptions): DevTransformResult {
      if (realpathSync(options.root) !== root) throw new Error("INVALID_PROJECT_ROOT: cache belongs to a different project");
      let file = path.resolve(root, options.id.split("?", 1)[0]!);
      try { file = realpathSync(file); } catch { /* unsaved overlay */ }
      let project = projectFor(options.environment, options.options);
      if (project.modules.get(file)?.sourceFile.text !== options.code) {
        project = buildDevProject(root, options.options, options.environment, { id: options.id, code: options.code });
      }
      return transformProject(project, options);
    },
    invalidate(): void { snapshots.clear(); },
  };
}

function transformProject(project: DevProject, options: DevTransformOptions): DevTransformResult {
  let file = path.resolve(realpathSync(options.root), options.id.split("?", 1)[0]!);
  try { file = realpathSync(file); } catch { /* new, not-yet-saved source overlay */ }
  const module = project.modules.get(file);
  const targets = project.functions.filter((candidate) => candidate.module === module && candidate.instrument && candidate.problems.size === 0);
  const analysis = {
    targets: targets.map(({ locator, replayExport }) => ({ locator, replayExport })),
    diagnostics: project.analysis.diagnostics.filter((diagnostic) => diagnostic.locator?.module === (module ? path.relative(realpathSync(options.root), module.file).split(path.sep).join("/") : "")),
    sourceGraphDigest: project.analysis.sourceGraphDigest,
  };
  if (!module || targets.length === 0) return { ...analysis, code: options.code, map: null };
  let prefix = "__replaylock_dev";
  while (options.code.includes(prefix)) prefix += "_";
  const observe = `${prefix}_observe`, context = `${prefix}_context`, effect = `${prefix}_effect`;
  const byNode = new Map(targets.map((candidate) => [candidate.node, candidate]));
  const frames = new Map(targets.map((candidate, index) => [candidate, `${prefix}_frame${index}`]));
  let sequence = 0;

  // This binding tuple captures receiver, method, then arguments in precisely
  // native order. Argument expressions stay outside new callbacks, including
  // await expressions; no expression gets evaluated twice.
  const invocation = (node: ts.CallExpression | ts.NewExpression, candidate: DevFunction, operation?: DevOperation): string => {
    const callee = node.expression;
    const binding = `${prefix}_binding${sequence++}`;
    const args = `${prefix}_args${sequence++}`;
    let receiver = `[void 0, ${render(callee, candidate)}]`;
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const local = `${prefix}_receiver${sequence++}`;
      const property = ts.isPropertyAccessExpression(callee) ? `.${callee.name.text}` : `[${render(callee.argumentExpression, candidate)}]`;
      receiver = `((${local}) => [${local}, ${local}${property}])(${render(callee.expression, candidate)})`;
    }
    const argumentsText = (node.arguments ?? []).map((argument) => render(argument, candidate)).join(", ");
    const native = ts.isNewExpression(node) ? `new ${binding}[1](...${args})` : `${binding}[1].apply(${binding}[0], ${args})`;
    const frame = frames.get(candidate)!;
    const traceArguments = operation?.kind === "response" ? `[${binding}[0]]` : args;
    const call = operation
      ? `${effect}(${frame}, ${JSON.stringify(operation.operation)}, ${traceArguments}, () => ${native})`
      : `${context}(${frame}, () => ${native})`;
    return `((${binding}, ${args}) => ${call})(${receiver}, [${argumentsText}])`;
  };
  const wrapBody = (candidate: DevFunction): string => {
    const { node } = candidate;
    const parameters = node.parameters.map((parameter) => `${parameter.dotDotDotToken ? "..." : ""}${parameter.name.getText()}`).join(", ");
    const args = ts.isArrowFunction(node) ? `[${parameters}]` : "[...arguments]";
    const metadata = JSON.stringify({ locator: candidate.locator, sourceGraphDigest: analysis.sourceGraphDigest, generation: options.generation, environment: options.environment });
    const body = render(node.body!, candidate);
    const callbackBody = ts.isBlock(node.body!) ? body : `{ return ${body}; }`;
    return `{ return ${observe}(${metadata}, ${args}, ${candidate.asynchronous ? "async " : ""}(${frames.get(candidate)}) => ${callbackBody}, ${candidate.asynchronous}); }`;
  };
  const render = (node: ts.Node, active?: DevFunction): string => {
    const callable = byNode.get(node as DevFunction["node"]);
    if (callable) return options.code.slice(node.getStart(), callable.node.body!.getStart()) + wrapBody(callable);
    if (active) {
      const operation = active.effects.get(node);
      if (operation?.kind === "environment") {
        return `${effect}(${frames.get(active)}, ${JSON.stringify(operation.operation)}, [${JSON.stringify(operation.key)}], () => ${node.getText()})`;
      }
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && operation) return invocation(node, active, operation);
      if (ts.isCallExpression(node) && active.calls.has(node)) return invocation(node, active);
    }
    // A blocked owner may still contain an independently safe stateless child.
    // Its authored body remains untouched except that child's own wrapper.
    const nextActive = ts.isFunctionLike(node) ? undefined : active;
    const start = node.getStart();
    let position = start;
    let result = "";
    ts.forEachChild(node, (child) => {
      const childStart = child.getStart();
      if (childStart < position) return;
      result += options.code.slice(position, childStart) + render(child, nextActive);
      position = child.end;
    });
    return result + options.code.slice(position, node.end);
  };
  const edits = new MagicString(options.code);
  const replace = (node: ts.Node): void => {
    if (byNode.has(node as DevFunction["node"])) {
      edits.overwrite(node.getStart(), node.end, render(node));
      return;
    }
    ts.forEachChild(node, replace);
  };
  replace(module.sourceFile);
  const importText = `import { observeDevCall as ${observe}, withDevContext as ${context}, devEffect as ${effect} } from ${JSON.stringify(options.runtimeImport ?? "replaylock/dev/runtime")};\n`;
  // Preserve an executable script's shebang.
  if (options.code.startsWith("#!")) edits.appendLeft(options.code.indexOf("\n") + 1, importText);
  else edits.prepend(importText);
  if (options.replay) {
    for (const candidate of targets) {
      if (candidate.locator.kind !== "nested") {
        edits.append(`\nexport { ${candidate.name} as ${candidate.replayExport} };\n`);
      } else {
        const node = candidate.node;
        // A named function expression preserves self recursion without looking
        // up the owner's lexical scope. No owner invocation or closure factory.
        const parameters = node.parameters.map((parameter) => parameter.getText()).join(", ");
        const typeParameters = node.typeParameters?.length ? `<${node.typeParameters.map((parameter) => parameter.getText()).join(", ")}>` : "";
        const returnType = node.type ? `: ${node.type.getText()}` : "";
        const selfName = ts.isFunctionExpression(node) && node.name ? node.name.text : candidate.name;
        edits.append(`\nexport const ${candidate.replayExport} = ${candidate.asynchronous ? "async " : ""}function ${selfName}${typeParameters}(${parameters})${returnType} ${wrapBody(candidate)};\n`);
      }
    }
  }
  return { ...analysis, code: edits.toString(), map: edits.generateMap({ source: options.id, includeContent: true, hires: true }) };
}
