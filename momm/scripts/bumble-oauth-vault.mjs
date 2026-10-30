// Internal trusted-host OAuth storage. Default denial precedes all token access.
// The authorizer must verify private owner policy/trust/disclosure/logging receipts;
// never construct it from worker output or an unverified HTTP request body.
// This component does not authenticate tokens, dispatch workers or grant votes.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';import {parseBumbleJSON} from './bumble-contract.mjs';
import {isWindowsOpaqueProtector} from './bumble-secret-store.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=Object.freeze({test:v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)}),UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v),clock=v=>Number.isSafeInteger(v)&&v>=0;
const fail=code=>{throw Object.assign(Error('OAuth vault refused: '+code),{code});};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const closed=(v,fields)=>{if(!plain(v))return false;const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);return ks.length===fields.length&&ks.every(k=>typeof k==='string'&&fields.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));};
const outside=(project,target)=>{const r=path.relative(project,target);return Boolean(r)&&(path.isAbsolute(r)||r==='..'||r.startsWith('..'+path.sep));};
function scopeValue(s){
 const fields=['schema','connector_id','endpoint_id','issuer','resource','client_id','profile_sha256','trust_sha256','configuration_epoch','credential_epoch'];
 if(!closed(s,fields)||s.schema!=='momm-bumble-oauth-vault-scope/1'||![s.connector_id,s.endpoint_id,s.configuration_epoch,s.credential_epoch].every(id)||typeof s.client_id!=='string'||s.client_id.length<1||s.client_id.length>200||/[\x00-\x20\x7f]/.test(s.client_id)||!SHA.test(s.profile_sha256)||!SHA.test(s.trust_sha256))fail('invalid_scope');
 for(const value of [s.issuer,s.resource]){let u;try{u=new URL(value);}catch{fail('invalid_scope');}if(typeof value!=='string'||value.length>2000||/[\x00-\x20\x7f]/.test(value)||u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail('invalid_scope');}
 return Object.freeze(Object.fromEntries(fields.map(k=>[k,s[k]])));
}
export const bumbleOAuthVaultScope=s=>H(JSON.stringify(scopeValue(s)));
export class BumbleOAuthVault{
 #root;#project;#protector;#authorize;#clock;
 constructor({root,project_root=process.cwd(),protector,authorize=null,now=Date.now}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof now!=='function'||(authorize!==null&&typeof authorize!=='function'))fail('invalid_configuration');
  this.#root=path.resolve(root);this.#project=fs.realpathSync.native(project_root);this.#protector=protector;this.#authorize=authorize;this.#clock=now;
 }
 readiness(){return{schema:'momm-bumble-oauth-vault-readiness/1',owner_authorizer_configured:typeof this.#authorize==='function',protected_backend:this.#protector?.kind??'unavailable',credentials_read:false,login_verified:false,qualified:false,quorum_votes:0};}
 #gate(op,scope){
  if(!this.#authorize)fail('owner_approval_required');const stable=scopeValue(scope),scope_binding=H(JSON.stringify(stable)),now=this.#clock();if(!clock(now))fail('invalid_clock');
  let grant;try{grant=this.#authorize({operation:op,scope_binding,now});}catch{fail('owner_approval_unavailable');}
  if(!closed(grant,['schema','operation','scope_binding','policy_sha256','disclosure_sha256','logging_sha256','valid_until'])||grant.schema!=='momm-bumble-oauth-vault-approval/1'||grant.operation!==op||grant.scope_binding!==scope_binding||![grant.policy_sha256,grant.disclosure_sha256,grant.logging_sha256].every(v=>SHA.test(v))||!clock(grant.valid_until)||grant.valid_until<=now||grant.valid_until-now>86400000)fail('owner_approval_required');
  if(!isWindowsOpaqueProtector(this.#protector)||this.#protector?.available!==true||this.#protector.kind!=='dpapi-current-user/1'||typeof this.#protector.protect!=='function'||typeof this.#protector.unprotect!=='function')fail('qualified_protected_backend_required');
  return{stable,scope_binding,now,grant:Object.freeze({...grant})};
 }
 #home(){
  const ancestor=fs.existsSync(this.#root)?this.#root:path.dirname(this.#root);if(!outside(this.#project,this.#root)||!outside(this.#project,fs.realpathSync.native(ancestor)))fail('private_external_home_required');
  preparePrivateEvidence(this.#root);const real=fs.realpathSync.native(this.#root);if(real!==this.#root||!outside(this.#project,real))fail('private_external_home_required');requirePrivateEvidence(this.#root);
 }
 #regular(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>24000)fail('invalid_record');const b=fs.readFileSync(file);const again=fs.lstatSync(file);if(again.ino!==st.ino||again.size!==st.size||again.nlink!==1||again.isSymbolicLink())fail('record_changed');return b;}
 #write(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}requirePrivateEvidence(this.#root);}
 async #locked(fn){
  this.#home();const file=path.join(this.#root,'writer.lock');let fd;try{fd=fs.openSync(file,'wx',0o600);}catch{fail('busy_or_unknown_prior_outcome');}const own=fs.fstatSync(fd,{bigint:true});let answer,error;
  try{answer=await fn();}catch(e){error=e;}let cleanup=false;
  try{const st=fs.lstatSync(file,{bigint:true});if(st.ino!==own.ino||(process.platform!=='win32'&&st.dev!==own.dev)||st.nlink!==1n||st.isSymbolicLink())fail('lock_changed');fs.unlinkSync(file);}catch{cleanup=true;}try{fs.closeSync(fd);}catch{cleanup=true;}
  if(error)throw error;if(cleanup)fail('unknown_committed_outcome');return answer;
 }
 #file(ref){if(typeof ref!=='string'||!UUID.test(ref))fail('invalid_reference');return path.join(this.#root,'oauth-session-'+ref+'.json');}
 #read(ref,binding){
  const file=this.#file(ref);requirePrivateEvidence(this.#root);if(fs.existsSync(path.join(this.#root,'oauth-revoked-'+ref+'.json')))fail('locally_revoked');let r;try{r=parseBumbleJSON(this.#regular(file).toString('utf8'));}catch{fail('invalid_record');}
  if(!closed(r,['schema','reference','scope_binding','protection','expires_at','identity_binding','ciphertext','ciphertext_sha256'])||r.schema!=='momm-bumble-protected-oauth-session/1'||r.reference!==ref||r.scope_binding!==binding||r.protection!==this.#protector.kind||!clock(r.expires_at)||!SHA.test(r.identity_binding)||!SHA.test(r.ciphertext_sha256)||typeof r.ciphertext!=='string'||r.ciphertext.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.ciphertext)||Buffer.from(r.ciphertext,'base64').toString('base64')!==r.ciphertext||H(Buffer.from(r.ciphertext,'base64'))!==r.ciphertext_sha256)fail('record_binding_changed');return r;
 }
 async store(scope,input){
  const gate=this.#gate('store_session',scope);return this.#locked(async()=>{
   // Validate home and owner approvals before even evaluating token fields.
   if(!closed(input,['access_token','expires_at','identity_binding'])||!(input.access_token instanceof Uint8Array)||input.access_token.length<8||input.access_token.length>4096||!clock(input.expires_at)||input.expires_at<=gate.now||input.expires_at-gate.now>86400000||!SHA.test(input.identity_binding))fail('invalid_oauth_material');
   const token=Buffer.from(input.access_token);if(!/^[-A-Za-z0-9._~+/]+=*$/.test(token.toString('utf8'))){token.fill(0);fail('invalid_oauth_material');}
   const expires_at=input.expires_at,identity_binding=input.identity_binding,plain=Buffer.from(JSON.stringify({schema:'momm-bumble-oauth-secret-payload/1',scope_binding:gate.scope_binding,expires_at,identity_binding,access_base64:token.toString('base64')}));token.fill(0);let cipher;
   try{cipher=await this.#protector.protect(plain,Buffer.from(gate.scope_binding,'hex'));}catch{fail('protected_backend_failed');}finally{plain.fill(0);}
   const after=this.#gate('store_session',gate.stable);if(after.now>=expires_at)fail('expired_during_storage');
   if(!(cipher instanceof Uint8Array)||cipher.length<1||cipher.length>8192)fail('invalid_protected_envelope');const reference=crypto.randomUUID();
   const r={schema:'momm-bumble-protected-oauth-session/1',reference,scope_binding:gate.scope_binding,protection:this.#protector.kind,expires_at,identity_binding,ciphertext:Buffer.from(cipher).toString('base64'),ciphertext_sha256:H(cipher)};
   this.#write(this.#file(reference),Buffer.from(JSON.stringify(r)+'\n'));return Object.freeze({reference,scope_binding:r.scope_binding,expires_at,identity_binding,protection:r.protection,identity_verified:false,quorum_votes:0});
  });
 }
 async withAccess(scope,reference,{deadline,minimum_lifetime_ms=0}={},use){
  const gate=this.#gate('use_access',scope);if(!clock(deadline)||deadline<=gate.now||deadline-gate.now>300000||deadline>gate.grant.valid_until||!clock(minimum_lifetime_ms)||typeof use!=='function')fail('invalid_finite_access');
  return this.#locked(async()=>{
   const original=this.#read(reference,gate.scope_binding);if(original.expires_at<=deadline+minimum_lifetime_ms)fail('insufficient_token_lifetime');let decoded,token;
   try{
    try{decoded=await this.#protector.unprotect(Buffer.from(original.ciphertext,'base64'),Buffer.from(gate.scope_binding,'hex'));}catch{fail('protected_backend_failed');}
    const after=this.#gate('use_access',gate.stable);if(after.now>=deadline||after.now>=original.expires_at||after.grant.valid_until<deadline)fail('expired_during_access');
    const current=this.#read(reference,gate.scope_binding);if(JSON.stringify(current)!==JSON.stringify(original))fail('record_changed');let value;
    try{value=parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(decoded));}catch{fail('invalid_protected_payload');}
    if(!closed(value,['schema','scope_binding','expires_at','identity_binding','access_base64'])||value.schema!=='momm-bumble-oauth-secret-payload/1'||value.scope_binding!==gate.scope_binding||value.expires_at!==original.expires_at||value.identity_binding!==original.identity_binding||typeof value.access_base64!=='string'||value.access_base64.length>5500||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.access_base64))fail('invalid_protected_payload');
    token=Buffer.from(value.access_base64,'base64');if(token.length<8||token.length>4096||token.toString('base64')!==value.access_base64)fail('invalid_protected_payload');
    // Internal host callback only. This API cannot control a plugin's permissions;
    // never expose it as an adapter supplied by model text. It must use the existing
    // supervised transport to bound execution; this storage wrapper is not a process
    // supervisor and cannot contain arbitrary JavaScript. No token is returned.
    let result;try{result=await use(token,Object.freeze({resource:gate.stable.resource,issuer:gate.stable.issuer,identity_binding:original.identity_binding,deadline}));}catch{fail('callback_outcome_unknown');}
    if(!closed(result,['status'])||!['completed','refused','outcome_unknown'].includes(result.status))fail('callback_result_withheld');
    let final;try{final=this.#gate('use_access',gate.stable);}catch{return Object.freeze({status:'outcome_unknown',credential_reference:reference,identity_verified:false,physical_release_verified:false,quorum_votes:0,completion:false});}
    const late=final.now>=deadline||final.now>=original.expires_at||final.grant.valid_until<deadline;
    return Object.freeze({status:late?'outcome_unknown':result.status,credential_reference:reference,identity_verified:false,physical_release_verified:false,quorum_votes:0,completion:false});
   }finally{if(decoded instanceof Uint8Array)decoded.fill(0);if(token)token.fill(0);}
  });
 }
 async revokeLocal(scope,reference){const gate=this.#gate('revoke_local',scope);return this.#locked(async()=>{this.#read(reference,gate.scope_binding);this.#write(path.join(this.#root,'oauth-revoked-'+reference+'.json'),Buffer.from(JSON.stringify({schema:'momm-bumble-oauth-local-revocation/1',reference,scope_binding:gate.scope_binding,at:gate.now,remote_revocation:'unverified',physical_release:'unverified'})+'\n'));return Object.freeze({locally_revoked:true,remote_revocation:'unverified',physical_release_verified:false,quorum_votes:0});});}
}
