import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const source = fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), 'momm/scripts/update.mjs'), 'utf8');
const results=[];
async function test(name,run){try{await run();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
const exclusiveSource=source.slice(source.indexOf('function exclusive('),source.indexOf('export async function update('));
assert(exclusiveSource.startsWith('function exclusive('));
await test('dead claim cannot admit overlapping mutations',async()=>{
 let active={pid:999999},next=1,paused=false,first,actions=[];
 const fakefs={openSync(){if(active)throw Object.assign(Error('exists'),{code:'EEXIST'});active={};return next++;},writeFileSync(_fd,data){active=JSON.parse(data);},closeSync(){},unlinkSync(){if(!active)throw Object.assign(Error('missing'),{code:'ENOENT'});active=null;}};
 const c={directory(){},path,fs:fakefs,regular(){return !!active;},readJSON(){return {...active};},Date,Promise,process:{pid:123,kill(){if(!paused){paused=true;try{first=c.exclusive('/fixture',async()=>actions.push('first'));}catch(e){first=Promise.reject(e);}}throw Object.assign(Error('dead'),{code:'ESRCH'});}}};
 vm.createContext(c);vm.runInContext(exclusiveSource,c);
 let second;try{second=c.exclusive('/fixture',async()=>actions.push('second'));}catch(e){second=Promise.reject(e);}
 await Promise.allSettled([first,second].filter(Boolean));
 assert(actions.length<=1,`overlapping admitted actions: ${actions.join(',')}`);
 if(!actions.length)assert.equal(active.pid,999999,'failed-closed claim must remain intact');
});
const updateSource=source.slice(source.indexOf('export async function update('),source.indexOf('function isEntrypoint(')).replace('export async function','async function');
await test('channel change reads latest receipt inside exclusive claim',async()=>{
 let receipt={schema:'momm-lock/1',current:{commit:'old',version:'1.15.0'},previous:{current:{commit:'restored'}}};
 const restored={schema:'momm-lock/1',current:{commit:'restored',version:'1.14.1'},previous:null};
 const c={parse:()=>({channel:'pinned'}),process:{stdout:{write(){}}},ENTRY:'/repo/momm/scripts/update.mjs',path,fs:{existsSync:()=>false},repoRoot:()=>'/repo',stateDir:()=>'/repo/.git/momm',readLock:()=>structuredClone(receipt),writeJSON(_file,value){receipt=value;},exclusive:async(_dir,action)=>{receipt=structuredClone(restored);return action();},safeText:String,reinstall(){},regular:()=>false};
 vm.createContext(c);vm.runInContext(updateSource,c);await c.update([]);
 assert.equal(receipt.current.commit,'restored');assert.equal(receipt.previous,null);assert.equal(receipt.channel,'pinned');
});
console.log(JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
assert(results.every(r=>r.passed), 'updater exclusivity regression failed');
