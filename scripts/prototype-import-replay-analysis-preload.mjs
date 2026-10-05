// RETAINED #127: private ordinary-CLI experiment, not final executable binding.
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { captureFixtureAnalysis } from './prototype-import-analysis-bootstrap.mjs';

const fail = () => { throw new Error('REPLAY_ANALYSIS_REFUSED'); };
const root = process.env.REPLAYLOCK_PROTOTYPE_ANALYSIS_ROOT;
if (!root || root !== process.cwd() || !['release', 'refuse'].includes(process.env.REPLAYLOCK_PROTOTYPE_ANALYSIS_MODE)) fail();
// Guard the exact trusted configuration before the ordinary loader can run it.
// Do not qualify application source here: original physical preflight owns that.
const { snapshot, current } = captureFixtureAnalysis(root);
const gateModule = new URL('./prototype-import-generation.mjs', import.meta.url).href;
const configuration = `import { fixtureGenerationGate } from ${JSON.stringify(gateModule)};
      
      export default {plugins:[fixtureGenerationGate()]};`;
if (snapshot.records.find(record => record.name === 'vite.config.mjs').text !== configuration || !current()) fail();
const pins = new Map([
  ['dev-analysis', '009661e49beee0b24771a062b7743457cf9268675bc77c1f868cb796493dbdc1'],
  ['dev-project-cache', 'cc61421424a0fc7768cebd8c5100b66d69159908676925e4612d172366899e9a'],
  ['dev-transform', '7cbee4185d385d8bc48376ed02649bc202c8595c1355fda54866078d84dc9675'],
  ['dev-verify', '00eeb5aea20a3537489a9885659f9230bc803de3cd4fe35a4e1181d5438149a6'],
].map(([name, digest]) => [new URL(`../dist/${name}.js`, import.meta.url).href, digest]));
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context), pin = pins.get(url);
  if (!pin) return result;
  const bytes = Buffer.from(result.source);
  if (createHash('sha256').update(bytes).digest('hex') !== pin) fail();
  let code = bytes.toString('utf8');
  function replace(before, after) {
    if (code.split(before).length !== 2) fail();
    code = code.replace(before, after);
  }
  if (url.endsWith('/dev-verify.js')) {
    replace('export async function preflightDevCases(root, cases, options) {',
      'export async function preflightDevCases(root, cases, options) { assertPhysicalPreflight();');
    replace('const { root, cases, options, temporary, index, phase } = input;\n    await preflightDevCases(root, cases, options);',
      'const { root, cases, options, temporary, index, phase } = input;\n    await preflightDevCases(root, cases, options);\n    beginReplayAnalysis(root, phase);');
    replace('const analysis = phase === "replay" ? project.analyze(realm) : undefined;',
      'const analysis = phase === "replay" ? project.analyze(realm) : undefined;\n    assertReplayAnalysis();');
    replace('return { code: transformed.code, map: transformed.map };',
      'assertReplayAnalysis(); return { code: transformed.code, map: transformed.map };');
    code = `import { assertPhysicalPreflight, beginReplayAnalysis, assertReplayAnalysis } from ${JSON.stringify(new URL('./prototype-import-replay-analysis-state.mjs', import.meta.url).href)};\n` + code;
  } else {
    replace('from "node:fs"', `from ${JSON.stringify(new URL('./prototype-import-replay-analysis-fs.mjs', import.meta.url).href)}`);
  }
  return { ...result, source: code };
} });
