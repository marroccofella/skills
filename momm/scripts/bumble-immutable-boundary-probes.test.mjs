// Governor-authored material probes, not peer-authored snippets. Synthetic data.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {privateTestFixture} from '../scripts/private-test-fixture.mjs';
import {publishImmutableBytes} from '../scripts/bumble-immutable-file.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const selected=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:'all';assert(['all','post','identity'].includes(selected));
let passed=0,failed=0;const observations=[];
function test(name,fn){const root=fs.realpathSync.native(privateTestFixture('momm-immutable-boundary-'));try{observations.push({name,status:'passed',...fn(root)});passed++;}catch(error){observations.push({name,status:'failed',assertion:error.message,...error.observation});failed++;}finally{if(!path.basename(root).startsWith('momm-immutable-boundary-')||fs.realpathSync.native(root)!==root)throw Error('Cleanup outside disposable fixture');fs.rmSync(root,{recursive:true,force:true});}}
function verify(observation,fn){try{fn();}catch(error){error.observation=observation;throw error;}return observation;}
if(selected==='all'||selected==='post')test('post-link failure exposes publication uncertainty, never safe resend',root=>{
 const file=path.join(root,'post.json'),bytes=Buffer.from('synthetic complete bytes'),unlink=fs.unlinkSync;let error=null;
 fs.unlinkSync=function(target){if(typeof target==='string'&&target.startsWith(file+'.'))throw Error('Generated post-link unlink fault');return unlink.call(this,target);};
 try{publishImmutableBytes(root,file,bytes);}catch(e){error=e;}finally{fs.unlinkSync=unlink;}
 const observation={did_throw:Boolean(error),final_exists:fs.existsSync(file),complete_final_bytes:fs.existsSync(file)&&fs.readFileSync(file).equals(bytes),final_links:fs.existsSync(file)?fs.lstatSync(file).nlink:null,error_discloses_published:error?.published===true,explicit_quarantine:error?.publication_state==='published_unsettled'};
 return verify(observation,()=>{assert(error);assert(observation.complete_final_bytes);assert.equal(observation.final_links,2);assert(observation.error_discloses_published&&observation.explicit_quarantine,'A raw post-link error cannot distinguish an already-published original from not-published; no resend permitted');});
});
if(selected==='all'||selected==='identity')test('unusable file identity refuses publication instead of treating zero as an identity',root=>{
 const file=path.join(root,'identity.json'),stat=fs.fstatSync,lstat=fs.lstatSync;let error=null,result=null;
 const zero=value=>{if(value.isFile())Object.defineProperty(value,'ino',{value:0n});return value;};
 fs.fstatSync=function(...args){return zero(stat.apply(this,args));};fs.lstatSync=function(...args){const value=lstat.apply(this,args);return args[1]?.bigint?zero(value):value;};
 try{result=publishImmutableBytes(root,file,Buffer.from('synthetic'));}catch(e){error=e;}finally{fs.fstatSync=stat;fs.lstatSync=lstat;}
 const observation={did_throw:Boolean(error),returned_publication:result?.published??false,final_exists:fs.existsSync(file),mode:'injected zero file-index fault; not a claim about the actual native filesystem'};
 return verify(observation,()=>{assert(error,'An unusable zero identity must fail closed before publication');assert.equal(observation.returned_publication,false);assert.equal(observation.final_exists,false);});
});
console.log(JSON.stringify({selected,passed,failed,observations,network_calls:0,model_calls:0,credentials_read:false,scope:'Actual post-link fault and mocked zero identity; no retry, release grant or power-loss certification'}));if(failed)process.exitCode=1;
