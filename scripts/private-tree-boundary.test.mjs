import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'momm/scripts/multi-review.mjs'),'utf8');
const start=source.indexOf('function hardenPrivateTree('),end=source.indexOf('// Fail immediately',start);
assert(start>=0&&end>start);
const zone=path.resolve('synthetic-zone'),link=path.join(zone,'outside-link');
const touched=[];
const stat=p=>({isDirectory:()=>p===zone||p===link,isSymbolicLink:()=>p===link});
const fn=vm.runInNewContext(source.slice(start,end)+';hardenPrivateTree',{
 path,PRIVATE_DIR_MODE:0o700,PRIVATE_FILE_MODE:0o600,
 fs:{statSync:stat,lstatSync:stat,chmodSync:p=>touched.push(p),readdirSync:p=>p===zone?['outside-link']:['external.txt']}
});
fn(zone);
assert.deepEqual(touched,[zone],'Never follow a symlink/junction while tightening evidence permissions');
console.log('Private tree boundary: link traversal refused (synthetic filesystem)');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-private-boundary-'));
try {
 const evidence=path.join(fixture,'evidence'),outside=path.join(fixture,'outside');
 fs.mkdirSync(evidence);fs.mkdirSync(outside);
 fs.writeFileSync(path.join(outside,'synthetic.txt'),'harmless control');
 fs.symlinkSync(outside,path.join(evidence,'external'),process.platform==='win32'?'junction':'dir');
 const calls=[];
 const native=vm.runInNewContext(source.slice(start,end)+';hardenPrivateTree',{path,PRIVATE_DIR_MODE:0o700,PRIVATE_FILE_MODE:0o600,fs:{...fs,chmodSync:p=>calls.push(p)}});
 native(evidence);
 assert.deepEqual(calls,[evidence],'Actual native link must not be visited; chmod is recorded, never applied');
 assert.equal(fs.readFileSync(path.join(outside,'synthetic.txt'),'utf8'),'harmless control');
 console.log('Private tree boundary: native symlink/junction refused; unrelated synthetic data preserved');
} finally {fs.rmSync(fixture,{recursive:true,force:true});}
