import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import { scriptPath } from "./process-evidence.mjs";

// Checked against the pinned evaluators and the actual inspector source, not
// guessed from coverage percentages. Vite's inline map includes its three
// AsyncFunction prefix lines; Vitest's map excludes its same-line prefix.
const viteArguments = "__vite_ssr_exports__,__vite_ssr_import_meta__,__vite_ssr_import__,__vite_ssr_dynamic_import__,__vite_ssr_exportAll__,__vite_ssr_exportName__";
const vitestPrefix = `'use strict';async (${viteArguments},__filename,__dirname,module,exports,require)=>{{`;
const vitePrefix = `(async function anonymous(${viteArguments}\n) {\n"use strict";\n`;

export function sourceVariants(directory) {
  const written = new Map();
  return async (script, captured) => {
    const original = scriptPath(script.url);
    assert.ok(original, "source variant needs an absolute path");
    if (captured) assert.equal(scriptPath(captured.url), original, "captured script identity disagrees with V8 coverage");
    const nativeSource = await readFile(original, "utf8");
    const source = captured?.source ?? nativeSource;
    const vitest = source.startsWith(vitestPrefix) && source.endsWith("\n}}");
    const vite = source.startsWith(vitePrefix) && source.endsWith("\n})");
    assert.ok(source === nativeSource || vitest || vite, `unrecognized executed-source wrapper: ${original}`);
    let map;
    if (captured?.sourceMapURL?.startsWith("data:application/json;base64,")) {
      map = JSON.parse(Buffer.from(captured.sourceMapURL.split(",", 2)[1], "base64").toString("utf8"));
    } else {
      const mapReference = /\/\/# sourceMappingURL=([^\s]+)/.exec(source)?.[1];
      if (mapReference) map = JSON.parse(await readFile(path.resolve(path.dirname(original), mapReference), "utf8"));
    }
    assert.ok(map && map.version === 3 && Array.isArray(map.sources), `missing executed-source map: ${original}`);
    if (vitest || vite) {
      assert.ok(captured?.sourceMapURL?.startsWith("data:application/json;base64,"), "transformed source must have its executed inline map");
      const mappings = decode(map.mappings);
      if (vitest) {
        assert.equal(mappings[0]?.[0]?.[0], 0, "Vitest map must begin before its same-line wrapper prefix");
        for (const segment of mappings[0]) segment[0] += vitestPrefix.length;
      } else {
        assert.ok(mappings.length > 3 && mappings.slice(0, 3).every((line) => line.length === 0), "Vite map must include the actual AsyncFunction prefix lines");
      }
      map.mappings = encode(mappings);
    }
    map.sources = map.sources.map((file) => path.resolve(path.dirname(original), map.sourceRoot ?? "", file));
    delete map.sourceRoot;
    const identity = createHash("sha256").update(original).update("\0").update(source).update("\0").update(JSON.stringify(map)).digest("hex");
    let variant = written.get(identity);
    if (!variant) {
      const location = path.join(directory, identity, path.basename(original));
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, source);
      variant = { url: pathToFileURL(location).href, map };
      written.set(identity, variant);
    }
    // Distinct executed code must not share a V8 merge key. c8 remaps each
    // compatible variant first, then Istanbul combines authored TS locations.
    return { script: { ...script, url: variant.url }, sourceMap: variant.map };
  };
}
