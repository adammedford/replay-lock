import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
export const library = fileURLToPath(new URL('../../', import.meta.url));
export const digest = `sha256:${'a'.repeat(64)}`;
export async function put(root, name, content) {
  await mkdir(path.dirname(path.join(root, name)), {recursive:true});
  await writeFile(path.join(root, name), content);
}
export async function fixture(t, files = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'replaylock-usability-')));
  t.after(() => rm(root, {recursive:true,force:true}));
  for (const [name, content] of Object.entries({'package.json':'{"name":"dev-fixture","type":"module","private":true}', 'package-lock.json':'{"lockfileVersion":3}', ...files})) await put(root, name, content);
  await mkdir(path.join(root,'node_modules'),{recursive:true});
  await symlink(library, path.join(root,'node_modules/replaylock'), process.platform==='win32'?'junction':'dir');
  return root;
}
export async function jsonFiles(root, directory) {
  try { return await Promise.all((await readdir(path.join(root,directory))).filter(n=>n.endsWith('.json')).sort().map(async n=>JSON.parse(await readFile(path.join(root,directory,n),'utf8')))); }
  catch(error) { if(error.code==='ENOENT') return []; throw error; }
}
export async function until(check, timeout = 15000) {
  const end = Date.now()+timeout;
  while(Date.now()<end) { const result=await check(); if(result) return result; await new Promise(r=>setTimeout(r,25)); }
  throw new Error('condition timed out');
}
export async function control(manifest, operation) {
  const response = await fetch(`${manifest.url}__replaylock/${operation}`, {method:'POST',headers:{'Content-Type':'application/json','X-ReplayLock-Token':manifest.token},body:'{}'});
  const body = await response.json();
  if(!response.ok) throw new Error(JSON.stringify(body));
  return body;
}
export function command(root, args, input='') {
  return new Promise((resolve,reject)=>{
    const child = spawn(process.execPath,[path.join(library,'dist/cli.js'),...args],{cwd:root,stdio:['pipe','pipe','pipe']});
    let output=''; child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
    child.on('error',reject);child.on('close',status=>{clearTimeout(timer);resolve({status,output});});child.stdin.end(input);
  });
}
