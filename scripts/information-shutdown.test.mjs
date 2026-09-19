import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parse as parseUpdateOptions} from '../momm/scripts/update.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'momm/scripts/multi-review.mjs'),'utf8');
const start=source.lastIndexOf('}).finally(() => {')+'}).finally(() => {'.length;
const end=source.lastIndexOf('});');
assert(start>20&&end>start);
// The slice is exact only while the termination handler is the file's final statement.
assert.equal(end,source.trimEnd().length-3,'the termination handler must remain the last statement of multi-review.mjs');
assert(!source.slice(start,end).includes('\n}).finally('),'the slice must hold exactly one finally handler');
function probe(args,{stall=false,broken=false}={}){
 const timers=[],exits=[];
 const stream={write(_text,callback){if(broken)throw Error('broken fixture pipe');if(!stall)callback();}};
 const proc={argv:['node','multi-review.mjs',...args],platform:'win32',exitCode:3,exit:code=>exits.push(code),stdout:stream,stderr:stream};
 const finish=vm.runInNewContext(`()=>{${source.slice(start,end)}}`,{process:proc,parseUpdateOptions,setTimeout:(fn,ms)=>{const timer={fn,ms,referenced:true,unref(){this.referenced=false;}};timers.push(timer);return timer;}});
 finish();return {timers,exits};
}
const info=probe(['update']);
assert.equal(info.timers.length,1,'Information-only update must not force an early healthy shutdown');
assert.equal(info.timers[0].ms,2000);
assert.equal(info.timers[0].referenced,false,'Allow a drained information-only process to exit naturally');
info.timers[0].fn();assert.deepEqual(info.exits,[3],'A still-pinned loop retains the bounded exit and code');
for(const args of [['update','--repo','fixture'],['update','--check-all','--json']]){
 const run=probe(args);assert.equal(run.timers.length,1);assert.equal(run.timers[0].referenced,false);
}
for(const args of [['--governor','codex'],['update','--apply'],['update','--rollback'],['update','--dry-run'],['update','--channel','pinned'],['update','--unknown']]){
 const run=probe(args);assert.deepEqual(run.timers.map(t=>t.ms),[2000,250]);assert(run.timers[0].referenced);
}
for(const options of [{stall:true},{broken:true}]){
 const run=probe(['update'],options);assert.equal(run.timers.length,1);assert(run.timers[0].referenced);run.timers[0].fn();assert.deepEqual(run.exits,[3]);
}
console.log('Information shutdown controls pass; review/mutating paths and stalled-flush fallback retained');
