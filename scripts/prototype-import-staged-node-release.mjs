// RETAINED #127: fixed inline-family staging, not general/native qualification.
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const refusal = () => Object.assign(new Error('EVALUATED_INPUT_REFUSED'), { code: 'EVALUATED_INPUT_REFUSED' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {}); // Refusal may precede the collector's await.
  return { promise, resolve, reject };
};
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(refusal()), 5000); })]);
  } finally { clearTimeout(timer); }
}

function sameContextDescriptors(context, expected) {
  const actual = Object.getOwnPropertyDescriptors(context), keys = Reflect.ownKeys(expected);
  return Reflect.ownKeys(actual).length === keys.length && keys.every(key => Object.hasOwn(actual, key)
    && Reflect.ownKeys(actual[key]).length === Reflect.ownKeys(expected[key]).length
    && Reflect.ownKeys(expected[key]).every(field => Object.hasOwn(actual[key], field)
      && Object.is(actual[key][field], expected[key][field])));
}

export function attachStagedNodeRelease(runner, declaration, control) {
  if (control !== undefined && control !== 'replace-entry-exports') throw refusal();
  const { entry, helper, runtimeURL, runtimeFile } = declaration;
  // Pinned EvaluatedModules normalizes file URLs to a path, while its fetched
  // metadata/native evaluator retain the URL. Reject encoded-path differences.
  const runtimeId = fileURLToPath(runtimeFile);
  if (runtimeId !== runtimeFile.replace(/^file:\/+/, '/')) throw refusal();
  const evaluator = runner.evaluator;
  const originals = { import: runner.import, fetch: runner.cachedModule, request: runner.cachedRequest, close: runner.close };
  const inlineEvaluator = evaluator.runInlinedModule, externalEvaluator = evaluator.runExternalModule;
  let phase = 'idle', collecting, nextDemand = 0, failure;
  const records = new Map();
  const order = [entry, runtimeId, helper];
  const abort = error => {
    if (!failure) failure = error?.code === 'SYNTHETIC_EVALUATOR_DELEGATE_REACHED' ? error : refusal();
    phase = 'refused';
    for (const record of records.values()) { record.arrived.reject(failure); record.done.reject(failure); }
    return failure;
  };
  const fail = () => { throw abort(); };
  function bindings() {
    if (runner.isClosed() || runner.evaluator !== evaluator || runner.import !== ownedImport
      || runner.cachedModule !== retainedModule || runner.cachedRequest !== demandRequest || runner.close !== close
      || evaluator.runInlinedModule !== inlineEvaluator || evaluator.runExternalModule !== externalEvaluator) fail();
  }
  function current(record) {
    bindings();
    const mod = record.module;
    if (runner.evaluatedModules.getModuleById(record.id) !== mod
      || runner.evaluatedModules.getModuleByUrl(record.url) !== mod || mod.id !== record.id || mod.url !== record.url
      || mod.meta !== record.meta || !isDeepStrictEqual(mod.meta, record.metadata)
      || mod.promise !== record.nodePromise) fail();
    if (!record.started && (mod.evaluated || mod.exports !== record.exports)) fail();
    if (record.context && !sameContextDescriptors(record.context, record.contextDescriptors)) fail();
  }
  function capture(record, delegate, context) {
    if (!record || phase !== 'collecting' || collecting !== record || record.delegate || typeof delegate !== 'function') fail();
    record.delegate = delegate; // Captures the exact post-control string/receiver.
    record.context = context;
    record.exports = record.module.exports;
    if (context) record.contextDescriptors = Object.getOwnPropertyDescriptors(context);
    record.arrived.resolve();
    return record.done.promise; // Do NOT call the original evaluator yet.
  }
  async function collect(url, importer, id) {
    bindings();
    const mod = await bounded(originals.fetch.call(runner, url, importer));
    bindings();
    if (phase !== 'collecting') fail();
    if (mod.id !== id || mod.promise || mod.evaluated || records.has(id)) fail();
    if (id === runtimeId && !isDeepStrictEqual(mod.meta, { externalize: runtimeFile, type: 'module', url, id: runtimeFile })) fail();
    const record = { id, url, module: mod, meta: mod.meta, metadata: structuredClone(mod.meta),
      arrived: deferred(), done: deferred(), started: false };
    records.set(id, record); collecting = record;
    // Only this explicit collector invokes the original request directly. No
    // phase flag gives unrelated requests permission to collect/evaluate.
    record.request = originals.request.call(runner, url, mod);
    record.request.catch(error => record.arrived.reject(error));
    await bounded(record.arrived.promise);
    record.nodePromise = mod.promise;
    if (!record.nodePromise || !record.delegate) fail();
    current(record); collecting = undefined;
  }
  async function ownedImport(url) {
    if (phase !== 'idle' || url !== '/entry.mjs') fail();
    phase = 'collecting';
    try {
      await collect('/entry.mjs', undefined, entry);
      await collect('/helper.mjs', entry, helper); // Declared helper has NO edges.
      await collect(runtimeURL, entry, runtimeId); // Route only; no native import.
      if (records.size !== 3 || collecting) fail();
      if (control === 'replace-entry-exports') {
        // Witness-only fixed host control. Pinned Vite constructs this context
        // slot at module-runner.js:1264 and consumes it at :1021. No original
        // evaluation may run with this substituted, equal-content object.
        const context = records.get(entry).context;
        const exports = context.__vite_ssr_exports__;
        context.__vite_ssr_exports__ = Object.create(Object.getPrototypeOf(exports), Object.getOwnPropertyDescriptors(exports));
      }
      for (const record of records.values()) current(record);
      phase = 'released';
      const result = await bounded(originals.import.call(runner, url));
      if (nextDemand !== order.length) fail();
      return result;
    } catch (error) {
      const reason = abort(error);
      await bounded(Promise.allSettled([...records.values()].map(record => record.request)));
      throw reason;
    }
  }
  async function retainedModule(url, importer) {
    if (phase !== 'released') fail();
    const id = url === '/entry.mjs' && importer === undefined ? entry
      : importer === entry && url === '/helper.mjs' ? helper
      : importer === entry && url === runtimeURL ? runtimeId : undefined;
    const record = records.get(id);
    if (!record) fail();
    current(record);
    return record.module; // No post-seal fetch, cache copy or second control pass.
  }
  async function demandRequest(url, mod, callstack = [], metadata) {
    const record = records.get(mod.id);
    if (phase !== 'released' || !record || record.module !== mod || record.url !== url
      || metadata?.isDynamicImport || (record.id === entry ? callstack.length !== 0
        : callstack.length !== 1 || callstack[0] !== entry)) fail();
    current(record);
    if (record.started || order[nextDemand] !== record.id) fail();
    record.started = true; nextDemand++;
    try {
      // Activate on ordinary demand, not a speculative release-all Promise.all.
      Promise.resolve(record.delegate()).then(record.done.resolve, error => abort(error));
    } catch (error) { throw abort(error); }
    return originals.request.call(runner, url, mod, callstack, metadata);
  }
  async function close() {
    abort();
    try { await bounded(Promise.allSettled([...records.values()].map(record => record.request))); }
    finally { await originals.close.call(runner); records.clear(); collecting = undefined; phase = 'closed'; }
  }
  runner.import = ownedImport;
  runner.cachedModule = retainedModule;
  runner.cachedRequest = demandRequest;
  runner.close = close;
  return {
    inline(context, code, mod, delegate) {
      const record = records.get(mod.id);
      if (!record || record.module !== mod || ![entry, helper].includes(mod.id) || typeof code !== 'string') fail();
      return capture(record, delegate, context);
    },
    external(filepath, delegate) {
      if (filepath !== runtimeFile) fail();
      return capture(records.get(runtimeId), delegate);
    },
  };
}
