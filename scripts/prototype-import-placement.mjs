// RETAINED PROTOTYPE #127: placement evidence only, not a ReplayLock adapter,
// recording implementation, public loader API, or hostile-code sandbox.
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { ModuleRunner, ESModulesEvaluator } from 'vite/module-runner';
import ts from 'typescript';

const refused = () => new Error('GRAPH_REFUSED');
const witnessSource = 'throw "SYNTHETIC_PRELUDE_REACHED";';

// A deliberately tiny placement grammar, not the shared production analyzer.
// Only primitive literals/identifier arithmetic and static .mjs edges qualify.
export function placementDependencies(source, url) {
  const file = ts.createSourceFile(url, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw refused();
  const edges = [];
  const expression = node => {
    if (ts.isNumericLiteral(node) || ts.isStringLiteral(node) || ts.isIdentifier(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return;
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operatorToken.kind)) {
      expression(node.left); expression(node.right); return;
    }
    throw refused();
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !/^\.\/[a-z][a-z-]*\.mjs$/.test(specifier.text)
        || statement.attributes || statement.importClause?.isTypeOnly || statement.isTypeOnly) throw refused();
      edges.push('/' + specifier.text.slice(2));
    } else if (ts.isVariableStatement(statement)) {
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) throw refused();
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer
          || ![ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.TrueKeyword,
            ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(declaration.initializer.kind)) throw refused();
      }
    } else if (ts.isFunctionDeclaration(statement)) {
      if (!statement.name || statement.asteriskToken || statement.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
        || statement.parameters.length || statement.body?.statements.length !== 1) throw refused();
      const returned = statement.body.statements[0];
      if (!ts.isReturnStatement(returned) || !returned.expression) throw refused();
      expression(returned.expression);
    } else throw refused();
  }
  return edges;
}

export function qualifyPlacementSources(sources, witnessControl = false) {
  if (witnessControl) {
    // This isolated positive control cannot authorize arbitrary unsafe source.
    if (sources.size !== 1 || sources.get('/entry.mjs') !== witnessSource) throw refused();
    return ['/entry.mjs'];
  }
  const visited = new Set(), active = new Set();
  let bytes = 0;
  function visit(url) {
    if (active.has(url)) throw refused();
    if (visited.has(url)) return;
    const source = sources.get(url);
    if (typeof source !== 'string' || Buffer.byteLength(source) > 65536) throw refused();
    bytes += Buffer.byteLength(source);
    if (bytes > 262144 || visited.size + active.size >= 32) throw refused();
    active.add(url);
    for (const dependency of placementDependencies(source, url)) visit(dependency);
    active.delete(url); visited.add(url);
  }
  visit('/entry.mjs');
  return [...visited];
}

export async function startPlacementProbe(fixture, { witnessControl = false } = {}) {
  const sources = new Map(Object.entries(fixture));
  if ([...sources].some(([url, source]) => !/^\/[a-z][a-z-]*\.mjs$/.test(url) || typeof source !== 'string')) throw refused();
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'replaylock-import-placement-')));
  let vite, runner, host;
  const close = async () => {
    try {
      await new Promise((resolve, reject) => host?.listening ? host.close(error => error ? reject(error) : resolve()) : resolve());
    } finally {
      try { await runner?.close(); } finally {
        try { await vite?.close(); } finally { await rm(root, { recursive: true, force: true }); }
      }
    }
  };
  try {
    for (const [url, source] of sources) await writeFile(path.join(root, url.slice(1)), source);
    vite = await createServer({ root, configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
      server: { middlewareMode: true, watch: null, hmr: false },
      optimizeDeps: { noDiscovery: true }, ssr: { noExternal: true } });
    let preparation;
    const prepare = () => preparation ??= buildSnapshot();
    async function buildSnapshot() {
      const closure = qualifyPlacementSources(sources, witnessControl);
      const node = new Map(), browser = new Map();
      let nodeBytes = 0, browserBytes = 0;
      for (const url of closure) {
        const fetched = await vite.environments.ssr.fetchModule(url, undefined, { cached: false });
        if ('externalize' in fetched || 'cache' in fetched || fetched.file !== path.join(root, url.slice(1))) throw refused();
        nodeBytes += Buffer.byteLength(fetched.code);
        const client = await vite.environments.client.transformRequest(url);
        if (!client) throw refused();
        browserBytes += Buffer.byteLength(client.code);
        if (Buffer.byteLength(fetched.code) > 65536 || Buffer.byteLength(client.code) > 65536
          || nodeBytes > 262144 || browserBytes > 262144) throw refused();
        node.set(url, Object.freeze({ ...fetched })); browser.set(url, client.code);
      }
      // Only fixed trusted Vite transforms run. No app config/plugin execution.
      // Full transform drift, physical revalidation and production grammar are
      // later spec obligations, not established by this immutable-fixture probe.
      const native = new ESModulesEvaluator();
      runner = new ModuleRunner({ hmr: false, sourcemapInterceptor: false,
        transport: { async invoke(payload) {
          const { name, data } = payload.data;
          if (name === 'getBuiltins') return { result: [] };
          if (name !== 'fetchModule' || !node.has(data[0])) throw refused();
          // The immutable fixture generation has no HMR. Do not replay the
          // server's first-fetch invalidation bit on a warm runner import.
          return { result: data[2]?.cached ? { cache: true }
            : { ...node.get(data[0]), invalidate: false } };
        } },
      }, {
        startOffset: native.startOffset,
        async runInlinedModule(context, code, module) {
          const admitted = [...node.values()].find(value => value.id === module.id);
          if (!admitted || admitted.code !== code) throw refused();
          return native.runInlinedModule(context, code, module);
        },
        async runExternalModule() { throw refused(); },
      });
      return { node, browser };
    }
    const document = `<!doctype html><button>Run synthetic graph</button><output></output><script type="module">
      const output = document.querySelector('output');
      document.querySelector('button').onclick = async () => {
        let result;
        try {
          const gate = await fetch('/admission');
          if (!gate.ok) result = await gate.json();
          else {
            const first = await import('/entry.mjs');
            const second = await import('/entry.mjs');
            result = {value:first.result(),sameNamespace:first===second};
          }
        } catch (error) { result = {code:typeof error==='string'?error:'HOST_FAILURE'}; }
        output.textContent = JSON.stringify(result); output.dataset.settled='true';
      };
    </script>`;
    host = createHttpServer((request, response) => { void (async () => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(document); return; }
        const admitted = await prepare();
        if (request.url === '/admission') { response.setHeader('Content-Type', 'application/json'); response.end('{}'); }
        else if (request.url === '/invoke') {
          const first = await runner.import('/entry.mjs'), second = await runner.import('/entry.mjs');
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ value: first.result(), sameNamespace: first === second }));
        } else if (admitted.browser.has(request.url)) {
          response.setHeader('Content-Type', 'text/javascript'); response.end(admitted.browser.get(request.url));
        } else throw refused();
      } catch (error) {
        response.statusCode = 409; response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ code: error === 'SYNTHETIC_PRELUDE_REACHED' ? error
          : error instanceof Error && error.message === 'GRAPH_REFUSED' ? 'GRAPH_REFUSED' : 'HOST_FAILURE' }));
      }
    })(); });
    await new Promise((resolve, reject) => { host.once('error', reject); host.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${host.address().port}`, close };
  } catch (error) { await close(); throw error; }
}
