// Optional private-LAN credential machinery, inactive under the installed OAuth-only policy.
// No constructor, readiness view or blocked operation reads a credential.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {REMOTE_POLICY_ACTIVE} from './reviewer-registry.mjs';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
import {windowsTool} from './process-scope.mjs';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const POLICY='momm-private-lan-credential-policy/1';
const POLICY_HASH=hash(fs.readFileSync(new URL('../references/bumble-credential-policy-proposal.md',import.meta.url)));
const WINDOWS_PROTECTORS=new WeakSet();
// A JSON object or named fake backend cannot claim this factory's provenance.
// The runner still belongs to trusted host code; this is not an OS sandbox.
export const isWindowsOpaqueProtector=value=>process.platform==='win32'&&WINDOWS_PROTECTORS.has(value);
const blocked=()=>{throw Object.assign(new Error('Credential policy is not activated. No credential was read, stored or transmitted.'),{code:'policy_required'});};
function scopeValue(scope){
  if(!scope||Object.keys(scope).sort().join(',')!=='connector_id,credential_epoch,endpoint_id,trust_sha256'||![scope.connector_id,scope.credential_epoch,scope.endpoint_id].every(v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v))||!SHA.test(scope.trust_sha256))throw Error('Invalid credential scope binding.');
  return {connector_id:scope.connector_id,endpoint_id:scope.endpoint_id,credential_epoch:scope.credential_epoch,trust_sha256:scope.trust_sha256};
}
export const credentialScope=scope=>hash(JSON.stringify(scopeValue(scope)));
function policyGuard(receipt,scope){
  if(!REMOTE_POLICY_ACTIVE)blocked();
  // Future activation also requires a separately accepted, private owner receipt.
  // This build deliberately cannot mint one or activate this branch.
  if(!receipt||receipt.schema!==POLICY||receipt.accepted!==true||receipt.scope_binding!==credentialScope(scope)||receipt.policy_sha256!==POLICY_HASH||!SHA.test(receipt.disclosure_sha256)||!SHA.test(receipt.logging_sha256))blocked();
}
const DPAPI_SCRIPT=`$ErrorActionPreference='Stop';try {
  Add-Type -AssemblyName System.Security
  $j=[Console]::In.ReadToEnd()|ConvertFrom-Json
  if($j.operation -ne 'protect' -and $j.operation -ne 'unprotect'){throw 'operation'}
  $data=[Convert]::FromBase64String($j.data)
  $entropy=[Convert]::FromBase64String($j.entropy)
  if($j.operation -eq 'protect'){$answer=[Security.Cryptography.ProtectedData]::Protect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
  else {$answer=[Security.Cryptography.ProtectedData]::Unprotect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
  [Console]::Out.Write([Convert]::ToBase64String($answer))
  [Array]::Clear($data,0,$data.Length);[Array]::Clear($answer,0,$answer.Length)
  exit 0
}catch {[Console]::Error.Write('protected_store_failed');exit 1}`;
export function windowsOpaqueProtector(runProcess,{platform=process.platform}={}){
  if(platform!=='win32'||typeof runProcess!=='function')return {kind:'unavailable',available:false};
  // The exact existing MOMM supervisor is supplied by the governor; no replacement
  // spawn/termination path is introduced. Plaintext travels on stdin, never argv.
  const execute=async(operation,bytes,entropy)=>{
    if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>8192||!(entropy instanceof Uint8Array)||entropy.length!==32)throw Error('Invalid protected-store byte budget.');
    const input=JSON.stringify({operation,data:Buffer.from(bytes).toString('base64'),entropy:Buffer.from(entropy).toString('base64')});
    const result=await runProcess(windowsTool('powershell'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(DPAPI_SCRIPT,'utf16le').toString('base64')],{input,timeoutMs:10000});
    if(result.code!==0||result.timedOut||result.outputLimited||typeof result.stdout!=='string'||result.stdout.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(result.stdout))throw Error('Protected store unavailable; no plaintext fallback.');
    const output=Buffer.from(result.stdout,'base64');if(output.length<1||output.length>8192)throw Error('Protected store returned an invalid byte envelope.');
    return output;
  };
  const protector=Object.freeze({kind:'dpapi-current-user/1',available:true,protect:(bytes,entropy)=>execute('protect',bytes,entropy),unprotect:(bytes,entropy)=>execute('unprotect',bytes,entropy)});
  WINDOWS_PROTECTORS.add(protector);return protector;
}

export class BumbleSecretStore {
  #root;#project;#protector;
  constructor({root,project_root=process.cwd(),protector}){
    if(typeof root!=='string'||!path.isAbsolute(root))throw Error('A private absolute credential-store home is required.');
    this.#root=path.resolve(root);this.#project=fs.realpathSync(project_root);this.#protector=protector;
  }
  readiness(){return {policy_active:REMOTE_POLICY_ACTIVE,protected_backend:this.#protector?.kind||'unavailable',credentials_read:false,ready:false,quorum_votes:0};}
  #home(){
    const outside=actual=>{const rel=path.relative(this.#project,actual);return Boolean(rel)&&(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep));};
    const ancestor=fs.existsSync(this.#root)?this.#root:path.dirname(this.#root);
    if(!outside(this.#root)||!outside(fs.realpathSync(ancestor)))throw Error('Protected credentials belong outside project source.');
    preparePrivateEvidence(this.#root);requirePrivateEvidence(this.#root);return this.#root;
  }
  #file(ref){if(!UUID.test(ref))throw Error('Invalid owned credential reference.');return path.join(this.#home(),`credential-${ref}.json`);}
  #read(ref,scope){
    const file=this.#file(ref),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>24000)throw Error('Protected credential record refused.');
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(record.schema!=='momm-protected-credential/1'||record.reference!==ref||record.scope_binding!==credentialScope(scope)||record.protection!==this.#protector?.kind||!SHA.test(record.ciphertext_sha256)||typeof record.ciphertext!=='string'||record.ciphertext.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(record.ciphertext)||hash(Buffer.from(record.ciphertext,'base64'))!==record.ciphertext_sha256)throw Error('Protected credential binding changed.');
    if(fs.existsSync(path.join(this.#root,`revoked-${ref}.json`)))throw Error('Credential reference was locally revoked; remote credential status is not claimed.');
    return record;
  }
  async store(input){
    if(!REMOTE_POLICY_ACTIVE)blocked(); // before destructuring or reading an input secret
    const {receipt,scope,secret}=input;policyGuard(receipt,scope);
    if(!this.#protector?.available||typeof secret!=='string'||!secret||Buffer.byteLength(secret)>4096||/[\x00-\x20\x7f]/.test(secret))throw Error('Protected credential cannot be accepted.');
    const data=Buffer.from(secret),entropy=Buffer.from(credentialScope(scope),'hex');let ciphertext;
    try{ciphertext=await this.#protector.protect(data,entropy);}finally{data.fill(0);}
    const reference=crypto.randomUUID(),record={schema:'momm-protected-credential/1',reference,scope_binding:credentialScope(scope),protection:this.#protector.kind,ciphertext:Buffer.from(ciphertext).toString('base64'),ciphertext_sha256:hash(ciphertext)};
    const fd=fs.openSync(this.#file(reference),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    requirePrivateEvidence(this.#root);return {reference,scope_binding:record.scope_binding,protection:record.protection,credential_epoch:scope.credential_epoch};
  }
  async read(input){
    if(!REMOTE_POLICY_ACTIVE)blocked();
    const {receipt,scope,reference}=input;policyGuard(receipt,scope);
    if(!this.#protector?.available)throw Error('Protected credential backend unavailable.');
    const record=this.#read(reference,scope);
    return this.#protector.unprotect(Buffer.from(record.ciphertext,'base64'),Buffer.from(record.scope_binding,'hex'));
  }
  revoke(input){
    if(!REMOTE_POLICY_ACTIVE)blocked();
    const {receipt,scope,reference}=input;policyGuard(receipt,scope);this.#read(reference,scope);
    const file=path.join(this.#root,`revoked-${reference}.json`),fd=fs.openSync(file,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({schema:'momm-local-credential-revocation/1',reference,scope_binding:credentialScope(scope),remote_revocation:'unverified'})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    return {locally_revoked:true,remote_revocation:'unverified'};
  }
}
