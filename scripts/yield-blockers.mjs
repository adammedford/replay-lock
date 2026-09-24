// Why development capture skips callables: the root site behind each reason
// code, which sites block the most callables, and which fixes would make the
// most of them eligible. Maintainer tooling for `npm run yield:dev -- --blockers`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { typescriptScriptKind } from '../dist/typescript-script-kind.js';

/**
 * Constructs capture does not support by design. A callable whose shape code
 * roots in one of them, in its own body or a callee, is outside supported
 * shapes: fixing another site cannot make it eligible. `nested` is a function
 * inside an anonymous function or method; `unknown` is a root the report cannot
 * parse. An `await` on an unanalyzed call, a function not bound to a `const`,
 * and a non-literal parameter default are ordinary blockers.
 */
const DESIGN_SHAPES = new Set(['jsx', 'class', 'generator', 'tagged-template', 'arguments', 'nested', 'unknown']);
const SHAPE_CODES = new Set(['UNSUPPORTED_CALLABLE', 'UNSUPPORTED_ASYNC']);
export const UPPER_BOUND_NOTE = 'Unlock counts are upper bounds: analysis records one origin per reason code per callable, so resolving a site can reveal another site with the same code.';
export const SHAPES_NOTE = 'Callables whose own body or callees contain JSX, a class, a generator, a tagged template or `arguments`, or that are nested in an anonymous function or method, are outside supported shapes and excluded from the plan. An `await` on an unanalyzed call (`UNSUPPORTED_ASYNC`) and a function not bound to a `const` or with a non-literal parameter default (`UNSUPPORTED_CALLABLE`) are ordinary blockers.';

const locatorKey = locator => `${locator.module}#${locator.namePath.join('.')}`;
const packageOf = module => [...module.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)].at(-1)?.[1];

/** The analyzer's capture unit: a named declaration, or a function or arrow bound to a variable. */
const namedCallable = node => {
  if (ts.isFunctionDeclaration(node)) return !!node.name && !!node.body;
  if (!ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) return false;
  let outer = node;
  while (ts.isParenthesizedExpression(outer.parent) || ts.isAsExpression(outer.parent) || ts.isSatisfiesExpression(outer.parent)) outer = outer.parent;
  return ts.isVariableDeclaration(outer.parent) && ts.isIdentifier(outer.parent.name);
};
const literalDefault = expression => {
  let node = expression;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isBigIntLiteral(node)) return true;
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind) || (ts.isIdentifier(node) && node.text === 'undefined')) return true;
  if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(element => !ts.isSpreadElement(element) && !ts.isOmittedExpression(element) && literalDefault(element));
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(property => ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && literalDefault(property.initializer));
  return false;
};
const literalParameter = parameter => (!parameter.initializer || literalDefault(parameter.initializer))
  && (ts.isIdentifier(parameter.name) || parameter.name.elements.every(element => ts.isOmittedExpression(element) || literalParameter(element)));

/**
 * The construct behind a shape code's root position: the JSX, class, tagged
 * template, `arguments`, `await`, `yield` or `for await` the analyzer reported,
 * or, for a callable reported as a whole, why its shape is unsupported.
 */
function shapeClassifier(root) {
  const files = new Map();
  const sourceFile = module => {
    if (!files.has(module)) {
      const file = path.join(root, module);
      try { files.set(module, ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, typescriptScriptKind(file))); }
      catch { files.set(module, undefined); }
    }
    return files.get(module);
  };
  return position => {
    const file = sourceFile(position.module);
    if (!file) return 'unknown';
    let offset;
    try { offset = file.getPositionOfLineAndCharacter(position.line - 1, position.column - 1); } catch { return 'unknown'; }
    const starting = [];
    const visit = node => {
      if (node.getStart(file) === offset) starting.push(node);
      if (node.pos <= offset && offset < node.end) ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    const found = test => starting.find(test);
    if (found(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) return 'jsx';
    if (found(node => ts.isClassDeclaration(node) || ts.isClassExpression(node))) return 'class';
    if (found(ts.isTaggedTemplateExpression)) return 'tagged-template';
    if (found(node => ts.isYieldExpression(node) || (ts.isForOfStatement(node) && !!node.awaitModifier))) return 'generator';
    if (found(ts.isAwaitExpression)) return 'await';
    if (found(node => ts.isIdentifier(node) && node.text === 'arguments')) return 'arguments';
    const callable = found(node => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));
    if (!callable) return 'unknown';
    if (callable.asteriskToken) return 'generator';
    for (let owner = callable.parent; owner; owner = owner.parent) if (ts.isFunctionLike(owner) && !namedCallable(owner)) return 'nested';
    return callable.parameters.every(literalParameter) ? 'binding' : 'parameter-default';
  };
}

/**
 * One realm's `analyzeDevProject` result as a blocker report. A blocker is a
 * reason code at its root site: the last cause in the diagnostic's chain, or
 * the diagnostic's own position. Dependency sites are grouped by package.
 */
export function blockerReport(analysis, root, { top = 15 } = {}) {
  const lines = new Map();
  const snippet = position => {
    if (!lines.has(position.module)) {
      try { lines.set(position.module, readFileSync(path.join(root, position.module), 'utf8').split('\n')); }
      catch { lines.set(position.module, []); }
    }
    return lines.get(position.module)[position.line - 1]?.trim().slice(0, 120);
  };
  const classify = shapeClassifier(root);
  const sites = new Map(), callables = new Map();
  for (const diagnostic of analysis.diagnostics) {
    if (!diagnostic.locator) continue;
    const origin = diagnostic.causes?.at(-1)?.position ?? diagnostic.position;
    const dependency = origin && packageOf(origin.module);
    const site = !origin ? 'unknown' : dependency ? `pkg:${dependency}` : `${origin.module}:${origin.line}`;
    const key = `${diagnostic.code} @ ${site}`;
    if (!sites.has(key)) sites.set(key, { code: diagnostic.code, site, ...(origin ? dependency ? { example: `${origin.module}:${origin.line}` } : { snippet: snippet(origin) } : {}), callables: new Set() });
    const callable = locatorKey(diagnostic.locator);
    if (!callables.has(callable)) callables.set(callable, { callable, codes: new Set(), blockers: new Map(), shapes: new Map() });
    const entry = callables.get(callable);
    entry.codes.add(diagnostic.code);
    // Inherited through a callee, import or initializer when the chain has causes.
    const inherited = (diagnostic.causes?.length ?? 0) > 0;
    entry.blockers.set(key, (entry.blockers.get(key) ?? true) && inherited);
    if (SHAPE_CODES.has(diagnostic.code)) entry.shapes.set(key, origin ? classify(origin) : 'unknown');
    sites.get(key).callables.add(callable);
  }

  const detail = [...callables.values()].map(({ callable, codes, blockers, shapes }) => ({
    callable,
    category: [...shapes.values()].some(shape => DESIGN_SHAPES.has(shape)) ? 'outside-shapes' : [...blockers.values()].every(Boolean) ? 'inherited-only' : 'own-body',
    codes: [...codes].sort(),
    blockers: [...blockers].map(([key, inherited]) => ({ code: sites.get(key).code, site: sites.get(key).site, inherited, ...(shapes.has(key) ? { shape: shapes.get(key) } : {}) })),
  })).sort((a, b) => a.callable.localeCompare(b.callable));
  const inScope = detail.filter(item => item.category !== 'outside-shapes');
  const blockersOf = new Map(inScope.map(item => [item.callable, new Set(item.blockers.map(blocker => `${blocker.code} @ ${blocker.site}`))]));

  const only = new Map();
  for (const keys of blockersOf.values()) if (keys.size === 1) { const [key] = keys; only.set(key, (only.get(key) ?? 0) + 1); }
  const siteRows = [...sites].map(([key, value]) => ({
    code: value.code, site: value.site, ...(value.snippet ? { snippet: value.snippet } : {}), ...(value.example ? { example: value.example } : {}),
    callables: value.callables.size, only: only.get(key) ?? 0, examples: [...value.callables].sort().slice(0, 3),
  })).sort((a, b) => b.callables - a.callables || b.only - a.only || `${a.code}${a.site}`.localeCompare(`${b.code}${b.site}`));

  // Greedy: take the site that makes the most callables eligible now; break
  // ties by progress, weighting each callable by 1 / its remaining blockers.
  const remaining = new Map([...blockersOf].map(([callable, keys]) => [callable, new Set(keys)]));
  const plan = [];
  let cumulative = 0;
  while (plan.length < top && remaining.size) {
    const scores = new Map();
    for (const keys of remaining.values()) for (const key of keys) {
      const score = scores.get(key) ?? { unlocks: 0, progress: 0 };
      if (keys.size === 1) score.unlocks++;
      score.progress += 1 / keys.size;
      scores.set(key, score);
    }
    const [key] = [...scores].sort(([a, x], [b, y]) => y.unlocks - x.unlocks || y.progress - x.progress || a.localeCompare(b))[0];
    const unlocked = [];
    for (const [callable, keys] of remaining) {
      keys.delete(key);
      if (!keys.size) { unlocked.push(callable); remaining.delete(callable); }
    }
    cumulative += unlocked.length;
    plan.push({ code: sites.get(key).code, site: sites.get(key).site, unlocked: unlocked.sort(), cumulative });
  }

  const count = category => detail.filter(item => item.category === category).length;
  const tally = entries => Object.fromEntries(Object.entries(entries).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
  const codes = {}, shapes = {};
  for (const item of detail) for (const code of item.codes) codes[code] = (codes[code] ?? 0) + 1;
  // Each outside-shape callable counts once per construct that excludes it.
  for (const item of detail) for (const shape of new Set(item.blockers.map(blocker => blocker.shape).filter(shape => DESIGN_SHAPES.has(shape)))) shapes[shape] = (shapes[shape] ?? 0) + 1;
  return {
    eligible: analysis.targets.length, skipped: detail.length,
    outsideShapes: count('outside-shapes'), ownBody: count('own-body'), inheritedOnly: count('inherited-only'),
    outsideShapeKinds: tally(shapes),
    codes: tally(codes),
    plan, sites: siteRows,
    nearMisses: inScope.filter(item => item.blockers.length <= 2).map(({ callable, blockers }) => ({ callable, blockers })),
    callables: detail,
  };
}

const site = row => row.snippet ? `${row.site}  ${row.snippet}` : row.example ? `${row.site} (${row.example})` : row.site;
const shapeKinds = report => Object.entries(report.outsideShapeKinds).map(([shape, count]) => `${shape} ${count}`).join(', ');

export function formatBlockersText(environment, report, { top = 15 } = {}) {
  const out = [`\n${environment} blockers: ${report.skipped} skipped = ${report.outsideShapes} outside supported shapes + ${report.ownBody} blocked in their own body + ${report.inheritedOnly} inherited only`];
  if (report.outsideShapes) out.push(`  Outside supported shapes by construct: ${shapeKinds(report)}`);
  out.push(`  Unlock plan (${UPPER_BOUND_NOTE.split(':')[0].toLowerCase()}):`);
  for (const [index, step] of report.plan.entries()) out.push(`  ${String(index + 1).padStart(2)}. +${String(step.unlocked.length).padEnd(3)} = ${String(step.cumulative).padEnd(4)} ${step.code} @ ${step.site}${step.unlocked.length ? `  (${step.unlocked.slice(0, 3).join(', ')}${step.unlocked.length > 3 ? ', …' : ''})` : ''}`);
  out.push('  Top root sites (callables blocked / only blocker):');
  for (const row of report.sites.slice(0, top)) out.push(`  ${String(row.callables).padStart(5)} / ${String(row.only).padEnd(3)} ${row.code} @ ${site(row)}`);
  out.push(`  Near misses (at most two blockers): ${report.nearMisses.length}`);
  for (const miss of report.nearMisses.slice(0, top)) out.push(`    ${miss.callable}: ${miss.blockers.map(blocker => `${blocker.code} @ ${blocker.site}`).join('; ')}`);
  return out.join('\n');
}

const cell = value => String(value).replaceAll('|', '\\|');

export function formatBlockersMarkdown({ project, commit, replaylockCommit, catalogVersion, generatedAt, environments }, { top = 20 } = {}) {
  const out = [`# Development capture blockers: ${project}`, '', `Generated ${generatedAt} with \`npm run yield:dev -- --blockers\` (catalog ${catalogVersion}${replaylockCommit ? `, ReplayLock ${replaylockCommit}` : ''})${commit ? ` for ${project} at \`${commit}\`` : ''}.`, '', `${UPPER_BOUND_NOTE} ${SHAPES_NOTE} A blocker is *inherited* when its root is reached through a callee, import or initializer rather than the callable's own body.`];
  for (const { environment, report } of environments) {
    out.push('', `## ${environment}`, '', '| Eligible | Skipped | Outside shapes | Blocked in own body | Inherited only |', '|---|---|---|---|---|', `| ${report.eligible} | ${report.skipped} | ${report.outsideShapes} | ${report.ownBody} | ${report.inheritedOnly} |`);
    if (report.outsideShapes) out.push('', `Outside supported shapes by construct (a callable counts once per construct): ${shapeKinds(report)}.`);
    out.push('', '### Unlock plan', '', '| Step | Resolve | Unlocks | Cumulative | Examples |', '|---|---|---|---|---|');
    for (const [index, step] of report.plan.entries()) out.push(`| ${index + 1} | \`${step.code}\` @ ${cell(step.site)} | ${step.unlocked.length} | ${step.cumulative} | ${cell(step.unlocked.slice(0, 3).join(', '))} |`);
    out.push('', '### Top root sites', '', '| Code | Site | Callables | Only blocker | Examples |', '|---|---|---|---|---|');
    for (const row of report.sites.slice(0, top)) out.push(`| \`${row.code}\` | ${cell(row.site)}${row.snippet ? `<br>\`${cell(row.snippet)}\`` : row.example ? `<br>${cell(row.example)}` : ''} | ${row.callables} | ${row.only} | ${cell(row.examples.join(', '))} |`);
    out.push('', `### Near misses (${report.nearMisses.length})`, '');
    for (const miss of report.nearMisses.slice(0, top)) out.push(`- \`${miss.callable}\`: ${miss.blockers.map(blocker => `\`${blocker.code}\` @ ${cell(blocker.site)}`).join('; ')}`);
    if (report.nearMisses.length > top) out.push(`- … ${report.nearMisses.length - top} more (see \`--json\`)`);
  }
  return `${out.join('\n')}\n`;
}
