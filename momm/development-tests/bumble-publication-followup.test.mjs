// Governor-authored actual filesystem probes. Fault injection is explicit;
// none of these observations proves power-loss recovery or remote release.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {privateTestFixture} from '../scripts/private-test-fixture.mjs';
import {publishImmutableBytes} from '../scripts/bumble-immutable-file.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const selected=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:'all';assert(['all','names','exists','close'].includes(selected));
let passed=0,failed=0;const observations=[];
function test(name,fn){const root=fs.realpathSync.native(privateTestFixture('momm-publication-followup-'));try{fn(root);passed++;observations.push({name,status:'passed'});}catch(error){failed++;observations.push({name,status:'failed',assertion:error.message});}finally{if(!path.basename(root).startsWith('momm-publication-followup-')||fs.realpathSync.native(root)!==root)throw Error('Cleanup outside disposable fixture');fs.rmSync(root,{recursive:true,force:true});}}
const bytes=Buffer.from('synthetic original bytes');
if(selected==='all'||selected==='names')test('reserved temporary final name refuses before creating evidence',root=>{
 assert.throws(()=>publishImmutableBytes(root,path.join(root,'original.tmp'),bytes),'A final name must not consume the unresolved temporary namespace');
 assert.equal(fs.readdirSync(root).length,0);const result=publishImmutableBytes(root,path.join(root,'original.json'),bytes);assert.equal(result.published,true);
});
if(selected==='all'||selected==='exists'){
 test('pre-existing final name is known not published, not overwritten and never authorizes resend',root=>{
 const file=path.join(root,'existing.json');publishImmutableBytes(root,file,bytes);let error;try{publishImmutableBytes(root,file,Buffer.from('replacement'));}catch(e){error=e;}
 assert(error);assert.equal(error.code,'MOMM_IMMUTABLE_RECONCILIATION');assert.equal(error.publication_state,'not_published');assert.equal(error.published,false);assert.equal(error.resend_authorized,false);assert(fs.readFileSync(file).equals(bytes));assert.equal(fs.lstatSync(file).nlink,1);assert.equal(fs.readdirSync(root).length,1);
 });
 test('post-link EEXIST-shaped error remains ambiguous and retains complete original',root=>{
 const file=path.join(root,'ambiguous.json'),link=fs.linkSync;fs.linkSync=function(...args){link.apply(this,args);throw Object.assign(Error('Generated post-commit link fault'),{code:'EEXIST'});};let error;
 try{publishImmutableBytes(root,file,bytes);}catch(e){error=e;}finally{fs.linkSync=link;}
 assert(error);assert.equal(error.publication_state,'outcome_unknown');assert.equal(error.published,null);assert.equal(error.temporary_retained,true);assert.equal(error.resend_authorized,false);assert(fs.readFileSync(file).equals(bytes));assert.equal(fs.lstatSync(file).nlink,2);assert.throws(()=>publishImmutableBytes(root,path.join(root,'later.json'),bytes));
 });
}
if(selected==='all'||selected==='close')test('close-after-side-effect fault is tagged and descriptor is never closed twice',root=>{
 const file=path.join(root,'close.json'),open=fs.openSync,close=fs.closeSync;let ownedFd=null,calls=0,error;
 fs.openSync=function(target,...args){const fd=open.call(this,target,...args);if(typeof target==='string'&&target.startsWith(file+'.'))ownedFd=fd;return fd;};
 fs.closeSync=function(fd){if(fd===ownedFd){calls++;if(calls===1){close.call(this,fd);throw Error('Generated close-after-side-effect fault');}}return close.call(this,fd);};
 try{publishImmutableBytes(root,file,bytes);}catch(e){error=e;}finally{fs.openSync=open;fs.closeSync=close;}
 assert(error);assert.equal(error.code,'MOMM_IMMUTABLE_RECONCILIATION');assert.equal(error.publication_state,'not_published');assert.equal(error.resend_authorized,false);assert.equal(calls,1,'No double-close after a possibly successful close');assert.equal(fs.existsSync(file),false);assert.equal(error.temporary_retained,true,'Unknown close outcome leaves owned original temporary quarantined');assert.equal(fs.readdirSync(root).length,1);assert.throws(()=>publishImmutableBytes(root,path.join(root,'later.json'),bytes));
});
console.log(JSON.stringify({selected,passed,failed,observations,network_calls:0,model_calls:0,credentials_read:false,completion:false}));if(failed)process.exitCode=1;
