// Policy guard and supervised crypto-envelope seam. No real credentials, vault reads or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BumbleSecretStore,windowsOpaqueProtector,credentialScope} from './bumble-secret-store.mjs';
import vm from 'node:vm';
import {createProcessScope} from './process-scope.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-secret-store-test-'));
try{
  let secretReads=0,backendCalls=0;
  const root=path.join(parent,'not-created');
  const vault=new BumbleSecretStore({root,protector:{kind:'synthetic-fixture',available:true,protect(){backendCalls++;},unprotect(){backendCalls++;}}});
  const input=Object.defineProperty({},'secret',{get(){secretReads++;throw Error('Secret must not be read.');}});
  await assert.rejects(vault.store(input),e=>e.code==='policy_required');
  await assert.rejects(vault.read(input),e=>e.code==='policy_required');
  assert.throws(()=>vault.revoke(input),e=>e.code==='policy_required');
  assert.equal(secretReads,0);assert.equal(backendCalls,0);assert(!fs.existsSync(root));assert.equal(vault.readiness().ready,false);
  assert.equal(windowsOpaqueProtector(()=>{}, {platform:'linux'}).available,false);
  const scope={connector_id:'c',credential_epoch:'1',endpoint_id:'e',trust_sha256:'a'.repeat(64)};
  assert.notEqual(credentialScope(scope),credentialScope({...scope,endpoint_id:'other'}));
  const plain=Buffer.from('synthetic-data-not-an-api-key'),entropy=Buffer.alloc(32,1),calls=[];
  // This seam resolves a native Windows executable; POSIX still exercises refusal above.
  if(process.platform==='win32'){
  const protector=windowsOpaqueProtector(async(command,args,options)=>{calls.push({command,args,options});return {code:0,timedOut:false,outputLimited:false,stdout:Buffer.from('synthetic-protected-envelope').toString('base64')};},{platform:'win32'});
  await protector.protect(plain,entropy);
  assert(!calls[0].args.join(' ').includes(plain.toString()));
  assert(!calls[0].args.join(' ').includes(plain.toString('base64')));
  assert.equal(JSON.parse(calls[0].options.input).data,plain.toString('base64'),'opaque data is stdin only');assert.equal(calls[0].options.timeoutMs,10000);
  for(const result of [{code:1,stdout:'private diagnostic'},{code:0,timedOut:true,stdout:'Zm9v'},{code:0,outputLimited:true,stdout:'Zm9v'},{code:0,stdout:'not base64!'}]){
    const failed=windowsOpaqueProtector(async()=>result,{platform:'win32'});await assert.rejects(failed.unprotect(plain,entropy),/Protected store|protected-store/i);
  }
  }
  let native_crypto_executed=false;
  if(process.platform==='win32'){
    const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8'),start=source.indexOf('function runProcess('),end=source.indexOf('\nfunction extractJsonObjects(',start);
    assert(start>=0&&end>start,'the exact existing MOMM supervisor is available');
    const processScope=createProcessScope();
    const run=vm.runInNewContext(source.slice(start,end)+';runProcess',{Buffer,Date,Promise,setTimeout,clearTimeout,setInterval,clearInterval,process,processScope,DEFAULT_TIMEOUT_MS:10000,MAX_OUTPUT_BYTES:24000,cleanOauthEnv:()=>({...process.env}),platformCommand:(command,args)=>({command,args})});
    try{
      const real=windowsOpaqueProtector(run),cipher=await real.protect(plain,entropy);
      assert(!cipher.equals(plain),'native protected bytes are not plaintext');
      const recovered=await real.unprotect(cipher,entropy);assert(recovered.equals(plain));recovered.fill(0);
      await assert.rejects(real.unprotect(cipher,Buffer.alloc(32,2)),/Protected store unavailable/);
      native_crypto_executed=true;
    }finally{processScope.stop();}
  }
  console.log(JSON.stringify({passed:true,real_credentials_read:false,model_calls:0,native_crypto_executed,scope:'policy-before-access, supervised opaque-envelope seam and Windows synthetic DPAPI roundtrip where supported; not live credential qualification'}));
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-secret-store-test-'));fs.rmSync(parent,{recursive:true,force:true});}
