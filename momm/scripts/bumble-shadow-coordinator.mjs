// Explicit development coordinator. No native/default route is activated.
// Separately pinned owner signatures must bind both the synthetic plan and the
// complete captured code graph. Baseline-first is checked again before admission.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {requirePrivateEvidence} from './evidence-permissions.mjs';
import {parseBumbleJSON} from './bumble-contract.mjs';
import {openBumbleBaseline,materialForBumbleStage} from './bumble-baseline.mjs';
import {createBumbleShadowBroker} from './bumble-peer-shadow.mjs';
import {captureBumbleWorker} from './bumble-protected-execution.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),directory=path.dirname(fileURLToPath(import.meta.url));
const fail=()=>{throw Error('Protected synthetic coordinator refused; no dispatch or hold release authorized.');};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function fields(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);if(names.length!==keys.length||names.some(k=>!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function readApproval(root,name,digest){
 if(!sha(digest)||typeof name!=='string'||!/^execution-[a-f0-9-]{36}\.json$/.test(name))fail();requirePrivateEvidence(root);
 const file=path.join(root,name),a=fs.lstatSync(file,{bigint:true});
 const same=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.ino>0n&&s.ino===a.ino&&(process.platform==='win32'||s.dev===a.dev)&&s.size===a.size&&s.mtimeNs===a.mtimeNs;
 if(!same(a)||a.size<1n||a.size>65536n)fail();const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
 try{if(!same(fs.fstatSync(fd,{bigint:true})))fail();bytes=Buffer.alloc(Number(a.size)+1);let n=0;while(n<bytes.length){const got=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!got)break;n+=got;}if(n!==Number(a.size)||!same(fs.fstatSync(fd,{bigint:true}))||!same(fs.lstatSync(file,{bigint:true})))fail();bytes=bytes.subarray(0,n);}finally{fs.closeSync(fd);}
 if(H(bytes)!==digest)fail();return fields(parseBumbleJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),['payload','signature']);
}
export function createBumbleShadowCoordinator(options){
 const o=fields(options,['broker_options','execution_approval_file','execution_approval_sha256']);
 const b=fields(o.broker_options,['project_root','journal_root','approval_root','approval_file','approval_sha256','public_key_pem','public_key_sha256','connection','capacity','runProcess']);
 if(typeof b.runProcess!=='function'||typeof b.public_key_pem!=='string'||!sha(b.public_key_sha256))fail();
 const envelope=readApproval(b.approval_root,o.execution_approval_file,o.execution_approval_sha256);
 if(typeof envelope.payload!=='string'||Buffer.byteLength(envelope.payload)>60000||typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))fail();
 const key=crypto.createPublicKey(b.public_key_pem),signature=Buffer.from(envelope.signature,'base64url');
 if(key.asymmetricKeyType!=='ed25519'||H(key.export({type:'spki',format:'der'}))!==b.public_key_sha256||signature.toString('base64url')!==envelope.signature||!crypto.verify(null,Buffer.from(envelope.payload),key,signature))fail();
 const p=fields(parseBumbleJSON(envelope.payload),['schema','authorization_id','approval_sha256','run_id','issued_at','expires_at','baseline_report_sha256','input_sha256','coordinator_sha256','executor_sha256','manifest_sha256','files']);
 if(p.schema!=='momm-bumble-captured-execution-approval/1'||typeof p.authorization_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.authorization_id)||typeof p.run_id!=='string'||!/^rev_[A-Za-z0-9_]{1,124}$/.test(p.run_id)||!Array.isArray(p.files)||o.execution_approval_file!=='execution-'+p.authorization_id+'.json'||b.approval_file!=='approval-'+p.authorization_id+'.json'||p.approval_sha256!==b.approval_sha256||!Number.isSafeInteger(p.issued_at)||!Number.isSafeInteger(p.expires_at)||p.expires_at<=p.issued_at||p.expires_at-p.issued_at>3600000||!['approval_sha256','baseline_report_sha256','input_sha256','coordinator_sha256','executor_sha256','manifest_sha256'].every(k=>sha(p[k])))fail();
 let previous=Date.now(),burned=false;
 const approvalCurrent=()=>{
   const now=Date.now();if(burned||now<previous||now<p.issued_at||now>=p.expires_at){burned=true;fail();}previous=now;
   readApproval(b.approval_root,o.execution_approval_file,o.execution_approval_sha256);
   if(H(fs.readFileSync(fileURLToPath(import.meta.url)))!==p.coordinator_sha256||H(fs.readFileSync(path.join(directory,'bumble-protected-execution.mjs')))!==p.executor_sha256)fail();
 };
 // Refuse expired/code-mismatched authority before baseline reads, graph capture
 // or the broker's durable authorization-binding publication.
 approvalCurrent();
 const connection=fields(b.connection,['connect_address','port','tls_identity','certificate_file','certificate_sha256','credential_file','model','credential_epoch']);
 const connection_sha256=H(JSON.stringify(connection));
 const baseline=openBumbleBaseline({project_root:b.project_root,run_id:p.run_id});
 if(baseline.report_sha256!==p.baseline_report_sha256||baseline.input_sha256!==p.input_sha256)fail();
 const executor=captureBumbleWorker({source_root:directory,files:p.files,manifest_sha256:p.manifest_sha256,runProcess:b.runProcess});
 // The governor supplies the existing supervisor only once. The legacy broker's
 // exact worker invocation is intercepted; no disk module path reaches the child.
 const broker=createBumbleShadowBroker({...b,connection,runProcess:async(command,args,opts)=>{
   current();
   if(command!==process.execPath||!Array.isArray(args)||args.length!==1||args[0]!==path.join(directory,'bumble-peer-worker.mjs'))fail();
   const job=parseBumbleJSON(opts.input),material=materialForBumbleStage(baseline);
   if(job.frame?.artifact!==material.source||job.connection_sha256!==connection_sha256)fail();
   const timeoutMs=Math.min(opts.timeoutMs,p.expires_at-Date.now());
   return executor.execute(job,{timeoutMs});
 }});
 const current=()=>{
   approvalCurrent();
   materialForBumbleStage(baseline);
 };
 current();
 return Object.freeze({
   readiness:()=>{current();return {...broker.readiness(),protected_execution:'captured_pinned_graph',baseline_report_sha256:baseline.report_sha256,manifest_sha256:executor.manifest_sha256,operator_evidence:'not_attested_by_coordinator'};},
   async dispatch(fixture_id){current();return broker.dispatch(fixture_id);}
 });
}
