import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, build } from "vite";
import { chromium } from "playwright";
import { replaylock } from "../../dist/vite-plugin.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(root, "dist/cli.js");
const source = `function roll(value) { return value + Math.random(); }
export function calculate(value) { return roll(value); }
export function owner() { function hidden(value) { return value + Math.random(); } return hidden(3); }
export async function remote(url) { const response = await fetch(url); return await response.text(); }
`;
async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "replaylock-dev-")));
  await mkdir(path.join(directory, "src"));
  await mkdir(path.join(directory, "node_modules"));
  await symlink(root, path.join(directory, "node_modules/replaylock"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "dev-fixture", version: "1.0.0", type: "module", scripts: { dev: "vite --host 127.0.0.1" } }));
  await writeFile(path.join(directory, "package-lock.json"), JSON.stringify({ name: "dev-fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "dev-fixture", version: "1.0.0" } } }));
  await writeFile(path.join(directory, "src/calculation.js"), source);
  await writeFile(path.join(directory, "index.html"), `<button id="roll">Roll</button><output id="result"></output><script type="module" src="/src/main.js"></script>`);
  await writeFile(path.join(directory, "src/main.js"), `import { calculate, owner } from './calculation.js'; document.querySelector('#roll').onclick = () => { document.querySelector('#result').textContent = String(calculate(2)); owner(); };`);
  return directory;
}
async function manifests(directory) {
  try { return await Promise.all((await readdir(path.join(directory, ".replaylock/dev"))).filter(name => name.endsWith(".json")).map(async name => JSON.parse(await readFile(path.join(directory, ".replaylock/dev", name), "utf8")))); }
  catch { return []; }
}
async function until(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error("condition timed out");
}
async function control(manifest, operation, headers = {}) {
  const response = await fetch(`${manifest.url}__replaylock/${operation}`, { method: "POST", headers: { "Content-Type": "application/json", "X-ReplayLock-Token": manifest.token, ...headers }, body: "{}" });
  return { status: response.status, body: await response.json() };
}
async function command(directory, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: directory, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject); child.on("close", status => resolve({ status, output })); child.stdin.end(input);
  });
}

function running(directory, args) {
  const child = spawn(process.execPath, args, { cwd: directory, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const completed = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", status => resolve({ status, output })); });
  return { child, completed, output: () => output };
}

test("middleware HTTP hosts discover authenticated capture and replay, with lifecycle cleanup", { timeout: 90000 }, async () => {
  const directory = await fixture();
  await writeFile(path.join(directory,"src/calculation.js"),source+"\nexport function getPassword() { console.log('unsupported'); }\n");
  let vite, browser;
  const host = httpServer((req,res) => vite.middlewares(req,res,()=>{res.statusCode=404;res.end();}));
  try {
    await new Promise(resolve=>host.listen(0,"127.0.0.1",resolve));
    vite = await createServer({root:directory,configFile:false,base:"/app/",plugins:[replaylock({dev:true})],server:{middlewareMode:{server:host},hmr:{server:host},fs:{allow:[directory,root]}}});
    assert.equal(vite.httpServer,null);
    const manifest=await until(async()=>(await manifests(directory))[0]);
    assert.equal(manifest.url,`http://127.0.0.1:${host.address().port}/app/`);
    assert.equal((await control(manifest,"start",{"X-ReplayLock-Token":"wrong"})).status,401);
    assert.equal((await control(manifest,"start")).status,200);
    const calls=await vite.ssrLoadModule("/src/calculation.js");calls.calculate(7);
    browser=await chromium.launch({headless:true});const page=await browser.newPage();
    await page.goto(manifest.url);await page.click("#roll");
    await page.waitForFunction(()=>document.querySelector("#result").textContent.length>0);
    const stopped=await control(manifest,"stop");
    assert.equal(stopped.body.recordingBlocks,0,JSON.stringify(stopped.body));
    assert.ok(stopped.body.candidates>0);
    const sessionReport=JSON.parse((await command(directory,["report","--session",stopped.body.session,"--json"])).output);
    const excluded=sessionReport.rows.find(row=>row.locator.namePath[0]==='getPassword');
    assert.equal(excluded.eligibility,'blocked');
    assert.ok(excluded.diagnostics.every(diagnostic=>diagnostic.message===diagnostic.code));
    await browser.close();browser=undefined;
    await vite.close();vite=undefined;
    assert.equal(host.listening,true,"Vite cleanup must not close the application's listener");
    assert.equal((await manifests(directory)).length,0);
    await new Promise(resolve=>host.close(resolve));
    const reviewed=await command(directory,["review"],"a\n".repeat(100));assert.equal(reviewed.status,0,reviewed.output);
    const verified=await command(directory,["verify"]);assert.equal(verified.status,0,verified.output);
  } finally {
    if(browser)await browser.close();if(vite)await vite.close();
    if(host.listening)await new Promise(resolve=>host.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});

test("middleware listener publication follows late listen and external close", async () => {
  const directory=await fixture();const host=httpServer();let vite;
  try {
    vite=await createServer({root:directory,configFile:false,plugins:[replaylock({dev:true})],server:{middlewareMode:{server:host},watch:null,ws:false}});
    assert.equal((await manifests(directory)).length,0);
    await new Promise(resolve=>host.listen(0,"127.0.0.1",resolve));
    await until(async()=>(await manifests(directory)).length===1);
    await new Promise(resolve=>host.close(resolve));
    await until(async()=>(await manifests(directory)).length===0);
  } finally {if(vite)await vite.close();if(host.listening)await new Promise(resolve=>host.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test("record controller survives one reset status connection without stopping the host", {timeout:30000},async()=>{
  const directory=await fixture();let vite,controller;let polls=0;
  const host=httpServer((req,res)=>{if(req.url==='/__replaylock/status'&&++polls===1){req.socket.destroy();return;}vite.middlewares(req,res);});
  try{
    vite=await createServer({root:directory,configFile:false,plugins:[replaylock({dev:true})],server:{middlewareMode:{server:host},watch:null,ws:false}});
    await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
    const manifest=await until(async()=>(await manifests(directory))[0]);
    controller=running(directory,[cli,'record','--attach',manifest.url]);
    await until(()=>controller.output().includes('ReplayLock attached'));
    const calls=await vite.ssrLoadModule('/src/calculation.js');calls.calculate(2);
    await until(()=>polls>=2||controller.child.exitCode!==null);
    assert.ok(polls>=2,`controller abandoned a reset status request: ${controller.output()}`);
    assert.equal(controller.child.exitCode,null);
    await control(manifest,'stop');
    const result=await controller.completed;assert.equal(result.status,0,result.output);
    assert.equal(host.listening,true);
  }finally{
    if(controller&&controller.child.exitCode===null){controller.child.kill('SIGTERM');await controller.completed;}
    if(vite)await vite.close();if(host.listening)await new Promise(resolve=>host.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});

test("real Vite browser and Node workloads produce reviewed cases that replay offline", { timeout: 180000 }, async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "replaylock.config.mjs"), "export default {capture:{retention:false}};");
  const external = httpServer((_req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.end("observed external response"); });
  await new Promise(resolve => external.listen(0, "127.0.0.1", resolve));
  const externalUrl = `http://127.0.0.1:${external.address().port}/data`;
  let browser, vite;
  try {
    vite = await createServer({ root: directory, configFile: false, plugins: [replaylock({ dev: true })], server: { host: "127.0.0.1", port: 0, fs: { allow: [directory, root] } } });
    await vite.listen();
    const manifest = await until(async () => (await manifests(directory))[0]);
    assert.equal((await control(manifest, "start", { "X-ReplayLock-Token": "incorrect" })).status, 401);
    assert.equal((await control(manifest, "start", { Origin: "http://example.invalid" })).status, 400);
    const started = await control(manifest, "start"); assert.equal(started.status, 200, JSON.stringify(started));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const transport = []; page.on("console", message => { if (message.type() === "error" || message.type() === "warning") transport.push(message.text()); });
    await page.goto(manifest.url);
    await page.click("#roll");
    await page.click("#roll");
    await page.evaluate(async url => { const { remote } = await import('/src/calculation.js'); return remote(url); }, externalUrl);
    const second = await browser.newPage(); await second.goto(manifest.url); await second.click("#roll");
    const serverModule = await vite.ssrLoadModule("/src/calculation.js");
    assert.equal(await serverModule.remote(externalUrl), "observed external response");
    serverModule.calculate(5);
    try { await until(async () => (await control(manifest, "status")).body.stored >= 16); }
    catch (error) { throw new Error(JSON.stringify({ status: await control(manifest, "status"), errors, transport }), { cause: error }); }
    assert.deepEqual(errors, []);
    const stopped = await control(manifest, "stop"); assert.equal(stopped.status, 200, JSON.stringify(stopped));
    assert.ok(stopped.body.candidates >= 16, JSON.stringify(stopped));
    const pending = path.join(directory, ".replaylock/observations/pending-v2");
    const cases = await Promise.all((await readdir(pending)).map(async name => JSON.parse(await readFile(path.join(pending, name), "utf8"))));
    assert.ok(cases.some(value => value.locator.kind === "nested"));
    assert.ok(cases.some(value => value.environment === "node"));
    assert.ok(cases.some(value => value.environment === "browser"));
    const rolls = cases.filter(value => value.locator.namePath.join(".") === "roll" && value.environment === "browser");
    assert.equal(rolls.length, 3); assert.equal(new Set(rolls.map(value => value.caseId)).size, 3);
    const reviewed = await command(directory, ["review"], "a\n".repeat(cases.length)); assert.equal(reviewed.status, 0, reviewed.output);
    await browser.close(); browser = undefined;
    await vite.close(); vite = undefined;
    await new Promise(resolve => external.close(resolve));
    const verified = await command(directory, ["verify"]); assert.equal(verified.status, 0, verified.output);
    assert.match(verified.output, /Verified .* V2 case/);
    await writeFile(path.join(directory, "src/calculation.js"), source.replace("value + Math.random()", "value + 10 + Math.random()"));
    const regressed = await command(directory, ["verify"]); assert.equal(regressed.status, 1, regressed.output);
    assert.match(regressed.output, /MISMATCH/);
  } finally {
    await browser?.close(); await vite?.close(); external.close(); await rm(directory, { recursive: true, force: true });
  }
});

test("production build contains no capture runtime or synthetic replay exports", { timeout: 30000 }, async () => {
  const directory = await fixture();
  try {
    const output = await build({ root: directory, configFile: false, plugins: [replaylock({ dev: true })], logLevel: "silent", build: { write: false, minify: false } });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => result.output).filter(chunk => chunk.type === "chunk");
    assert.ok(chunks.some(chunk => chunk.code.includes("Math.random")));
    assert.ok(chunks.every(chunk => !/__replaylock|observeDevCall|devEffect|replaylock\/dev/.test(chunk.code)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("development adapters share class identity with the browser and Node application graphs", { timeout: 60000 }, async () => {
  const directory = await fixture(); let browser, vite;
  try {
    await writeFile(path.join(directory, "src/calculation.js"), "export function echo(value) { return value; }");
    await writeFile(path.join(directory, "src/main.js"), "");
    await writeFile(path.join(directory, "src/amount.js"), "export class Amount { constructor(value) { this.value = value; } }");
    await writeFile(path.join(directory, "replaylock.config.mjs"), `import {defineReplayLock,defineValueAdapter} from 'replaylock';
import {Amount} from './src/amount.js';
export default defineReplayLock({valueAdapters:[defineValueAdapter({id:'example/amount',version:1,type:Amount,serialize(value){return value.value},deserialize(value){return new Amount(value)}})]});`);
    vite = await createServer({ root: directory, configFile: false, plugins: [replaylock({ dev: true })], server: { host: "127.0.0.1", port: 0, fs: { allow: [directory, root] } } });
    await vite.listen(); const manifest = await until(async () => (await manifests(directory))[0]);
    const started = await control(manifest, "start"); assert.equal(started.status, 200, JSON.stringify(started));
    const { Amount } = await vite.ssrLoadModule("/src/amount.js");
    const { echo } = await vite.ssrLoadModule("/src/calculation.js");
    assert.equal(echo(new Amount(7)).value, 7);
    browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(manifest.url);
    assert.equal(await page.evaluate(async () => {
      const { Amount } = await import('/src/amount.js'); const { echo } = await import('/src/calculation.js');
      return echo(new Amount(7)).value;
    }), 7);
    await until(async () => (await control(manifest, "status")).body.stored === 2);
    const stopped = await control(manifest, "stop"); assert.equal(stopped.body.recordingBlocks, 0); assert.equal(stopped.body.candidates, 2);
    const reviewed = await command(directory, ["review"], "a\na\n"); assert.equal(reviewed.status, 0, reviewed.output);
    await browser.close(); browser = undefined; await vite.close(); vite = undefined;
    const verified = await command(directory, ["verify"]); assert.equal(verified.status, 0, verified.output);
  } finally { await browser?.close(); await vite?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("HMR retains latest completed behavior and retransmission is acknowledged once", { timeout: 60000 }, async () => {
  const directory = await fixture();
  let browser, vite;
  try {
    const filename = path.join(directory, "src/calculation.js");
    await writeFile(path.join(directory, "src/main.js"), "");
    await writeFile(filename, "export function calculate(value) { return value + 1; }");
    vite = await createServer({ root: directory, configFile: false, plugins: [replaylock({ dev: true })], server: { host: "127.0.0.1", port: 0, fs: { allow: [directory, root] } } });
    await vite.listen();
    const manifest = await until(async () => (await manifests(directory))[0]);
    assert.equal((await control(manifest, "start")).status, 200);
    browser = await chromium.launch(); const page = await browser.newPage();
    const transport = [];
    page.on("requestfailed", request => transport.push({ url: request.url(), failure: request.failure() }));
    page.on("console", message => transport.push(message.text()));
    let deliveries = 0;
    let original, token;
    await page.route("**/__replaylock/observations", async route => {
      if (!route.request().postDataJSON().observation) { await route.continue(); return; }
      original ??= route.request().postDataJSON();
      token ??= route.request().headers()["x-replaylock-token"];
      const [response] = await Promise.all([route.fetch(), route.fetch()]);
      if (++deliveries === 1) await route.abort();
      else await route.fulfill({ response });
    });
    await page.goto(manifest.url);
    assert.equal(await page.evaluate(async () => (await import('/src/calculation.js')).calculate(2)), 3);
    try { await until(async () => deliveries >= 2); }
    catch (error) { throw new Error(JSON.stringify({ deliveries, transport, status: await control(manifest, "status") }), { cause: error }); }
    assert.equal((await control(manifest, "status")).body.stored, 1);
    const reloaded = page.waitForEvent("load");
    await writeFile(filename, "export function calculate(value) { return value + 2; }");
    await reloaded;
    assert.equal(await page.evaluate(async () => (await import('/src/calculation.js')).calculate(2)), 4);
    await until(async () => (await control(manifest, "status")).body.stored === 2);
    const late = await fetch(`${manifest.url}__replaylock/observations`, { method: "POST", headers: { "X-ReplayLock-Token": token }, body: JSON.stringify({ ...original, client: "delayed-generation", sequence: 1 }) });
    assert.equal(late.status, 200);
    const stopped = await control(manifest, "stop"); assert.equal(stopped.status, 200, JSON.stringify(stopped));
    const pending = path.join(directory, ".replaylock/observations/pending-v2");
    const names = await readdir(pending); assert.equal(names.length, 1);
    const candidate = JSON.parse(await readFile(path.join(pending, names[0]), "utf8"));
    assert.deepEqual(candidate.completion, { kind: "return", value: { kind: "number", value: 4 } });
  } finally { await browser?.close(); await vite?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("stop reports missing browser acknowledgements and keeps sealed observations", { timeout: 30000 }, async () => {
  const directory = await fixture();
  let browser, vite;
  try {
    vite = await createServer({ root: directory, configFile: false, plugins: [replaylock({ dev: true })], server: { host: "127.0.0.1", port: 0, fs: { allow: [directory, root] } } });
    await vite.listen(); const manifest = await until(async () => (await manifests(directory))[0]);
    assert.equal((await control(manifest, "start")).status, 200);
    browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(manifest.url); await page.click("#roll");
    await until(async () => (await control(manifest, "status")).body.stored === 4);
    await page.route("**/__replaylock/observations", route => route.abort());
    const stopped = await control(manifest, "stop");
    assert.equal(stopped.status, 200); assert.ok(stopped.body.recordingBlocks > 0); assert.equal(stopped.body.candidates, 4);
  } finally { await browser?.close(); await vite?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("browser queue overflow reaches the collector as a partial-capture diagnostic", { timeout: 60000 }, async () => {
  const directory = await fixture(); let browser, vite;
  try {
    await writeFile(path.join(directory, "src/calculation.js"), "export function echo(value) { return value; }");
    await writeFile(path.join(directory, "src/main.js"), "import {echo} from './calculation.js'; globalThis.runEcho = echo;");
    vite = await createServer({ root: directory, configFile: false, plugins: [replaylock({ dev: true })], server: { host: "127.0.0.1", port: 0, fs: { allow: [directory, root] } } });
    await vite.listen(); const manifest = await until(async () => (await manifests(directory))[0]);
    assert.equal((await control(manifest, "start")).status, 200);
    browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(manifest.url);
    let disconnected = true;
    await page.route("**/__replaylock/observations", route => disconnected ? route.abort() : route.continue());
    await page.evaluate(() => { for (let index = 0; index < 1001; index++) globalThis.runEcho(7); });
    disconnected = false;
    await until(async () => (await control(manifest, "status")).body.blocks > 0, 30000);
    const stopped = await control(manifest, "stop");
    assert.equal(stopped.status, 200); assert.ok(stopped.body.recordingBlocks > 0);
    assert.ok(stopped.body.observations < 1001); assert.equal(stopped.body.candidates, 1);
  } finally { await browser?.close(); await vite?.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const mode of ["launch", "attach", "recover"]) test(`CLI ${mode} records a real development workload`, { timeout: 90000 }, async () => {
  const directory = await fixture();
  let browser, owner, recorder;
  try {
    await writeFile(path.join(directory, "vite.config.mjs"), `import {replaylock} from 'replaylock/vite'; export default {plugins:[replaylock({dev:true})],server:{fs:{allow:${JSON.stringify([directory, root])}}}};`);
    const viteCli = path.join(root, "node_modules/vite/bin/vite.js");
    if (mode === "attach") owner = running(directory, [viteCli, "--host", "127.0.0.1", "--port", "0"]);
    else recorder = running(directory, [cli, "record", "--", process.execPath, viteCli, "--host", "127.0.0.1", "--port", "0"]);
    const manifest = await until(async () => (await manifests(directory))[0]);
    if (mode === "attach") recorder = running(directory, [cli, "record", "--attach", manifest.url]);
    await until(() => recorder.output().includes("ReplayLock attached"));
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.goto(manifest.url); await page.click("#roll");
    await until(async () => (await control(manifest, "status")).body.stored >= 4);
    const active = (await control(manifest, "status")).body;
    if (mode === "recover") {
      process.kill(manifest.pid, "SIGKILL");
      const crashed = await recorder.completed; assert.equal(crashed.status, 2, crashed.output);
      const recovered = await command(directory, ["record", "--recover", active.session]);
      assert.equal(recovered.status, 0, recovered.output); assert.match(recovered.output, /SESSION_PARTIAL/);
    } else {
      // Windows child.kill terminates directly; exercise the authenticated stop path there.
      if (process.platform === "win32" || mode === "attach") assert.equal((await control(manifest, "stop")).status, 200);
      else recorder.child.kill("SIGTERM");
      const stopped = await recorder.completed; assert.equal(stopped.status, 0, stopped.output);
    }
    const pending = path.join(directory, ".replaylock/observations/pending-v2");
    const candidates = await Promise.all((await readdir(pending)).map(async name => JSON.parse(await readFile(path.join(pending, name), "utf8"))));
    assert.equal(candidates.length, 4);
    assert.ok(candidates.every(candidate => candidate.provenance.captureStatus === (mode === "recover" ? "partial" : "complete")));
    if (mode === "attach") { assert.equal((await control(manifest, "status")).body.recording, false); assert.equal(owner.child.exitCode, null); }
  } finally {
    await browser?.close(); recorder?.child.kill("SIGTERM"); owner?.child.kill("SIGTERM");
    if (owner) await owner.completed;
    if (recorder) await recorder.completed;
    await rm(directory, { recursive: true, force: true });
  }
});
