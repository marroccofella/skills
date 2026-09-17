import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'scripts/momm-release.mjs');
const source=fs.readFileSync(script,'utf8').replace(/^#!.*\n/,'').replace(/^import .*;\r?$/gm,'').replace('fileURLToPath(import.meta.url)',JSON.stringify(script));
function probe(release,mode='--check'){
 let hashes=0,writes=0;
 const manifest={momm:'1.16.0',momm_releases:[{version:'1.16.0',tag:'momm-1.16.0',...release}]};
 const raw=JSON.stringify(manifest);
 const ctx={path,process:{argv:['node',script,mode],stdout:{write(){}}},fs:{readFileSync:p=>p.endsWith('versions.json')?raw:p.endsWith('README.md')?'momm-1.16.0-badge':'const MOMM_VERSION = "1.16.0";',writeFileSync(){writes++;}},git:(_root,...args)=>args[0]==='show'?raw:args[0]==='write-tree'?'tree':'',treeHash:()=>{hashes++;return 'a'.repeat(64);}};
 let error=null;try{vm.runInNewContext(source,ctx);}catch(e){error=e.message;}
 return {hashes,writes,error};
}
for(const seal of [{},{sha256:'invalid'},{sha256:'a'.repeat(64)},{sha256:'a'.repeat(64),hash_covers:'unknown'}]){
 const r=probe(seal);assert.equal(r.hashes,0,'Absent/malformed seal must refuse before package hashing');assert.match(r.error,/seal.*(?:missing|malformed|unsupported)/i);assert.equal(r.writes,0);
}
const valid=probe({sha256:'a'.repeat(64),hash_covers:'git-tree-blobs-excluding-versions/1'});assert.equal(valid.hashes,1);assert.equal(valid.error,null);
const mismatch=probe({sha256:'b'.repeat(64),hash_covers:'git-tree-blobs-excluding-versions/1'});assert.equal(mismatch.hashes,1);assert.match(mismatch.error,/does not match/);assert.equal(mismatch.writes,0);
const prepare=probe({},'--prepare');assert.equal(prepare.hashes,1);assert.equal(prepare.writes,1);assert.equal(prepare.error,null);
console.log('Release seal precheck: missing/malformed fast refusal, real mismatch check and prepare retained');
