// Actual worker publication boundary only; downstream changes remain unguarded.
import { workerData } from 'node:worker_threads';
import { isDeepStrictEqual } from 'node:util';
const reference = workerData.replaylockPrototypeReference;
let refused = false;
const equal = (left, right) => isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
function fail() { refused = true; throw new Error('REFERENCE_INPUT_REFUSED'); }

export function compareReference(request, result) {
  if (!reference) return result;
  if (refused || !equal(request.options, reference.table.tuple.options)) return fail();
  if (!request.transform) return result;
  const input = request.transform;
  const record = reference.table.records.find(record => record.id === input.id);
  const { root, id, code, ...tuple } = input;
  if (root !== workerData.root || !record || code !== record.authored || !equal(tuple, reference.table.tuple)) return fail();
  // Harmless actual-output control, applied only after independent publication.
  if (id.endsWith('/entry.mjs') && ['mutate', 'unguarded-mutate'].includes(reference.mode)) {
    if (!result?.code.includes('scalar + 4')) return fail();
    result = { ...result, code: result.code.replace('scalar + 4', 'scalar + 5') };
  }
  if (reference.mode !== 'unguarded-mutate') {
    if (result === null ? record.result.targets.length !== 0 : !equal(result, record.result)) return fail();
  }
  return result;
}
