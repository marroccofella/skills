import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
delete process.env.MOMM_EVIDENCE_HOME;
const {ReviewerRegistry}=await import('./reviewer-registry.mjs');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-auth-choice-'));
const root=path.join(fixture,'private'),registry=new ReviewerRegistry({root});let checks=0;
const command=x=>registry.command({...x,revision:registry.read().revision});
try{
  command({op:'save',profile:{label:'Default',kind:'bumbler'}});
  const original=registry.read().profiles[0];assert.equal(original.auth_mode,'oauth');checks++;
  command({op:'save',profile:{label:'Optional key',kind:'bumbler',auth_mode:'api_key'}});
  const keyProfile=registry.read().profiles[1];assert.equal(keyProfile.auth_mode,'api_key');assert.equal(keyProfile.state,'draft');assert.equal(keyProfile.quorum_eligible,false);checks++;
  assert.equal(new ReviewerRegistry({root}).snapshot().profiles[1].auth_mode,'api_key');checks++;
  command({op:'save',id:keyProfile.id,profile:{label:'Still key',kind:'bumbler'}});assert.equal(registry.read().profiles[1].auth_mode,'api_key');checks++;
  const before=fs.readFileSync(registry.file);
  for(const profile of [{label:'Bad',kind:'bumbler',auth_mode:'automatic_fallback'},{label:'Bad',kind:'bumbler',auth_mode:'api_key',api_key:['synthetic','not','a','key'].join('-')},{label:'Bad',kind:'cli',route:'claude',auth_mode:'api_key'}]){assert.throws(()=>command({op:'save',profile}));assert.deepEqual(fs.readFileSync(registry.file),before);checks++;}
  command({op:'save',id:keyProfile.id,profile:{label:'Now OAuth',kind:'bumbler',auth_mode:'oauth'}});assert.equal(registry.read().profiles[1].auth_mode,'oauth');assert.equal(registry.read().profiles[1].qualification,null);checks++;
  const bytes=fs.readFileSync(registry.file);for(const op of ['test','qualify','enable','rotate','revoke'])assert.throws(()=>command({op,id:keyProfile.id}),/No request or credential operation/);assert.deepEqual(fs.readFileSync(registry.file),bytes);checks++;
  console.log(JSON.stringify({passed:true,checks,credential_operations:0,network_calls:0,scope:'saved authentication choice only; native protected entry/transport not activated'}));
}finally{
  const absolute=path.resolve(fixture),tmp=path.resolve(os.tmpdir());assert(absolute.startsWith(tmp+path.sep+'momm-auth-choice-'));fs.rmSync(absolute,{recursive:true,force:true});
}
