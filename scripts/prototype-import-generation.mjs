// RETAINED #127: authored-byte owned turns, not full evaluated-source parity.
import { open, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { placementDependencies, qualifyPlacementSources } from './prototype-import-placement.mjs';

const failure = code => Object.assign(new Error(code), { code });
const identity = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');

export function fixtureGenerationGate({ analysisCurrent } = {}) {
  let root, snapshot, active, replay, closed = false, finishing = false;
  async function readInput(name) {
    const filename = path.join(root, name);
    if (await realpath(filename) !== filename) throw failure('GRAPH_REFUSED');
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size > 65536n) throw failure('GRAPH_REFUSED');
      const buffer = Buffer.alloc(65537);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > 65536) throw failure('GRAPH_REFUSED');
      const after = await handle.stat({ bigint: true });
      const named = await stat(filename, { bigint: true });
      const bytes = buffer.subarray(0, length), text = bytes.toString('utf8');
      if (identity(before) !== identity(after) || identity(after) !== identity(named)
        || await realpath(filename) !== filename || !Buffer.from(text).equals(bytes)) throw failure('GRAPH_REFUSED');
      return { text, identity: identity(after) };
    } finally { await handle.close(); }
  }
  async function current() {
    if (analysisCurrent && !analysisCurrent()) return false;
    for (const [name, original] of snapshot) {
      const input = await readInput(name);
      if (input.text !== original.text || input.identity !== original.identity) return false;
    }
    return true;
  }
  async function beginTurn() {
    if (closed) throw failure('GENERATION_CLOSED');
    if (active) throw failure('TURN_BUSY');
    const token = randomUUID();
    active = token; // Reserve before asynchronous currentness checks.
    try {
      if (!await current()) throw failure('GENERATION_CLOSED');
      return token;
    } catch {
      closed = true; active = undefined;
      throw failure('GENERATION_CLOSED');
    }
  }
  async function finishTurn(token) {
    if (!active || typeof token !== 'string' || active !== token || finishing) throw failure('TURN_INVALID');
    finishing = true;
    // Admitted work may finish; observed drift only denies subsequent turns.
    try { if (!await current()) closed = true; } catch { closed = true; }
    finally { active = undefined; finishing = false; }
  }
  return {
    name: 'replaylock:prototype-owned-fixture-generation', enforce: 'pre',
    async configResolved(configuration) {
      root = await realpath(configuration.root);
      replay = configuration.mode === 'test';
      snapshot = new Map();
      const sources = new Map(), visiting = new Set();
      async function visit(url) {
        if (visiting.has(url)) throw failure('GRAPH_REFUSED');
        if (sources.has(url)) return;
        if (sources.size >= 32) throw failure('GRAPH_REFUSED');
        visiting.add(url);
        const input = await readInput(url.slice(1));
        snapshot.set(url.slice(1), input); sources.set(url, input.text);
        for (const edge of placementDependencies(input.text, url)) await visit(edge);
        visiting.delete(url);
      }
      await visit('/entry.mjs');
      qualifyPlacementSources(sources);
      for (const name of ['package.json', 'package-lock.json', 'vite.config.mjs', 'index.html']) snapshot.set(name, await readInput(name));
      if (!await current()) throw failure('GRAPH_REFUSED');
      // Stable observed reads are not an atomic arbitrary-filesystem snapshot.
    },
    transformIndexHtml: {
      order: 'pre',
      handler(_html, context) {
        if (replay) return; // Existing isolated verifier owns its generated UI.
        if (path.resolve(context.filename) !== path.join(root, 'index.html')) throw failure('GRAPH_REFUSED');
        // The fixed controller is trusted infrastructure, not mutable app HTML.
        return snapshot.get('index.html').text;
      },
    },
    load(id) {
      const relative = path.relative(root, id);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return;
      if (relative === 'vite.config.mjs') return; // Fixed generated infrastructure.
      // Existing isolated verifier generates this trusted harness, not app code.
      if (replay && /^\.replaylock[\\/]verify[\\/]dev-(?:validate|replay)-[a-zA-Z0-9]{6}[\\/]replay-\d+\.test\.mjs$/.test(relative)) return;
      if (!relative.endsWith('.mjs')) return;
      if (closed) throw failure('GENERATION_CLOSED');
      const input = snapshot.get(relative);
      if (!input || relative.includes(path.sep)) throw failure('GRAPH_REFUSED');
      return input.text; // No mutable filesystem reread on admitted load.
    },
    beginTurn, finishTurn,
    assertDelivery() {
      if (closed) throw failure('GENERATION_CLOSED');
      if (!active) throw failure('TURN_REQUIRED');
    },
    async dispatch(operation) {
      const token = await beginTurn();
      try { return await operation(); } finally { await finishTurn(token); }
    },
  };
}
