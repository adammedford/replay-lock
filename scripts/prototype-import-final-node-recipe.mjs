// Finite independent two-file recipe, not general Vite/native qualification.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import MagicString from 'magic-string';

const fail = () => { throw new Error('REFERENCE_INPUT_REFUSED'); };
export async function acquireFinalNodeRecipe() {
  const require = createRequire(import.meta.url);
  const directory = path.dirname(require.resolve('vite/package.json'));
  for (const [filename, expected] of [
    ['dist/node/chunks/node.js', 'f64038f08022030b77efee87b6baa81933a7b77d820aaa64bc3262fda44d80b0'],
    ['dist/node/module-runner.js', 'c9515eb9c6c77d5212c581b7c9ec45caa3a909e7da3b57b3405546df10a10b92'],
  ]) if (createHash('sha256').update(await readFile(path.join(directory, filename))).digest('hex') !== expected) fail();
  const { ESModulesEvaluator } = await import('vite/module-runner');
  const startOffset = new ESModulesEvaluator().startOffset;
  if (!Number.isSafeInteger(startOffset) || startOffset < 1 || startOffset > 8) fail();
  // devRecordingPlugin.config explicitly externalizes replaylock, including
  // its runtime subpath. This comes from the fixed plugin, not actual outputs.
  const runtimeURL = 'replaylock/dev/runtime';
  const runtimeFile = new URL('../dist/dev-runtime.js', import.meta.url).href;
  return { revision: 1, startOffset, runtimeURL, runtimeFile };
}

export async function prepareFinalNodeRecord(recipe, url, id, authored, result) {
  const original = result.targets.length ? result.code : authored;
  if (!['/entry.mjs', '/helper.mjs'].includes(url) || !id.endsWith(url)
    || original.includes('import.meta') || original.includes('sourceMappingURL')
    || original.includes('sourceMappingSource') || original.startsWith('#!')) fail();
  const ast = ts.createSourceFile(id, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) fail();
  const edits = new MagicString(original);
  const imports = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail();
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) fail();
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const source = statement.moduleSpecifier;
    if (!ts.isStringLiteral(source) || statement.attributes) fail();
    imports.push(source.text);
    let replacement;
    if (source.text === './helper.mjs' && url === '/entry.mjs') replacement = '/helper.mjs';
    else if (source.text === 'replaylock/dev/runtime' && url === '/entry.mjs') replacement = recipe.runtimeURL;
    else fail(); // Includes every Oxc helper, virtual and undeclared edge.
    edits.overwrite(source.getStart(ast), source.end, JSON.stringify(replacement));
  }
  if (url === '/entry.mjs' ? imports.join('\0') !== 'replaylock/dev/runtime\0./helper.mjs' : imports.length) fail();
  // Serve import-analysis emits map:null: it does not erase instrumentation's
  // existing map and it does not contribute a new rewrite map.
  let map = result.targets.length ? structuredClone(result.map) : null;
  if (map) {
    if (map.version !== 3 || map.sources.length !== 1 || map.sources[0] !== id
      || map.sourcesContent?.length !== 1 || map.sourcesContent[0] !== authored
      || !map.mappings || id.includes('/node_modules/') || map.sourceRoot || map.x_google_ignoreList) fail();
    map.sources = [path.relative(path.dirname(id), id)];
  }
  const { moduleRunnerTransform } = await import('vite');
  const lowered = await moduleRunnerTransform(edits.toString(), map, url, authored, { json: { stringify: false } });
  if (lowered.dynamicDeps.length || lowered.ssr !== true || !lowered.map || lowered.map.version !== 3) fail();
  const expectedDeps = url === '/entry.mjs' ? [recipe.runtimeURL, '/helper.mjs'] : [];
  if (JSON.stringify(lowered.deps) !== JSON.stringify(expectedDeps)) fail();
  const offsetMap = { ...lowered.map, mappings: ';'.repeat(recipe.startOffset) + lowered.map.mappings };
  const code = `${lowered.code.trimEnd()}\n//# sourceURL=${id}\n//# sourceMappingSource=vite-generated\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(offsetMap)).toString('base64')}\n`;
  if (Buffer.byteLength(code) > 65536) fail();
  return { code, file: id, id, url };
}
