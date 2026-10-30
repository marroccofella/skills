// Development-only code custody, not an OS sandbox or native activation.
// Capture a closed, independently pinned worker graph once. The supervised child
// links only captured native ESM modules and Node builtins, never project paths.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const BUMBLE_WORKER_FILES=Object.freeze(['bumble-peer-worker.mjs','launch-guard.mjs','bumble-peer-review.mjs','review-contract.mjs','review-contract-schema.mjs','bumble-contract.mjs','bumble-http-worker.mjs','reviewer-registry.mjs','evidence-permissions.mjs','evidence-location.mjs'].sort());
export const BUMBLE_OAUTH_WORKER_FILES=Object.freeze(BUMBLE_WORKER_FILES.map(name=>name==='bumble-peer-worker.mjs'?'bumble-oauth-peer-worker.mjs':name).sort());
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const refuse=()=>{throw Error('Protected worker graph refused; no child authorized.');};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const own=(v,keys)=>{
  if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))refuse();
  const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);
  if(names.length!==keys.length||names.some(k=>!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))refuse();
  return Object.fromEntries(keys.map(k=>[k,d[k].value]));
};
const EXECUTION_BOOTSTRAP=String.raw`
import crypto from 'node:crypto';
import vm from 'node:vm';
let length=0;const chunks=[];
const emit=process.stdout.write.bind(process.stdout);let finishing=false;
function finish(line,code){
 if(finishing)return;finishing=true;process.exitCode=code;
 const hard=setTimeout(()=>process.exit(code),2000);
 const drained=()=>{clearTimeout(hard);setTimeout(()=>process.exit(code),process.platform==='win32'?250:0);};
 try{emit(line,drained);}catch{process.exit(code);}
}
const timer=setTimeout(()=>finish('{"transport":"refused","payload":"stdin_deadline"}\n',2),5000);
try {
 for await(const chunk of process.stdin){length+=chunk.length;if(length>2000000){chunk.fill(0);throw Error();}chunks.push(chunk);}
 if(finishing)throw Error();
 clearTimeout(timer);
 const packet=Buffer.concat(chunks);let v;
 try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packet));}
 finally{packet.fill(0);for(const chunk of chunks)chunk.fill(0);}
 if(v.schema!=='momm-bumble-captured-worker/2'||typeof v.graph!=='string'||crypto.createHash('sha256').update(v.graph).digest('hex')!==EXPECTED_GRAPH_SHA256)throw Error();
 // The graph is trusted pinned code, not a sandbox. Keep incidental logging off
 // the sole protocol channel; the saved emitter owns the final line and flush.
 process.stdout.write=(...args)=>process.stderr.write(...args);
 const graph=JSON.parse(v.graph),modules=new Map(),builtins=new Map();
 const allowed=new Set(['node:fs','node:path','node:net','node:https','node:tls','node:crypto','node:perf_hooks','node:child_process','node:url','node:dns/promises','node:os']);
 for(const row of graph.files){
  if(modules.has(row.file)||!/^[-a-z]+\.mjs$/.test(row.file)||typeof row.source!=='string')throw Error();
  modules.set(row.file,new vm.SourceTextModule(row.source,{identifier:row.file,initializeImportMeta(meta){meta.url='momm-captured:'+row.file;},importModuleDynamically(){throw Error('Dynamic module loading refused.');}}));
 }
 // Native parsing, not text rewriting. Reject unknown static dependencies before
 // evaluating any module. Comments and strings retain their exact meaning.
 for(const module of modules.values())for(const spec of module.dependencySpecifiers){if(!allowed.has(spec)&&(!/^\.\/[-a-z]+\.mjs$/.test(spec)||!modules.has(spec.slice(2))))throw Error();}
 async function link(spec){
  if(spec.startsWith('./'))return modules.get(spec.slice(2));
  if(!allowed.has(spec))throw Error();
  if(!builtins.has(spec))builtins.set(spec,(async()=>{const ns=await import(spec),names=Object.keys(ns);return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,ns[name]);},{identifier:spec});})());
  return builtins.get(spec);
 }
 const worker=modules.get(ENTRY_NAME);if(!worker)throw Error();
 await worker.link(link);await worker.evaluate();
 let result;
 if(OAUTH){
  if(typeof v.job!=='string'||v.job.length>266668)throw Error();
  const privateBytes=Buffer.from(v.job,'base64');
  try{if(privateBytes.length<1||privateBytes.length>200000||privateBytes.toString('base64')!==v.job)throw Error();v.job=null;result=await worker.namespace.runBumbleOAuthPeerWorker(privateBytes);}
  finally{privateBytes.fill(0);}
 }else result=await worker.namespace.runPeerShadowWorker(v.job);
 const line=JSON.stringify(result);if(typeof line!=='string')throw Error();finish(line+'\n',0);
}catch{clearTimeout(timer);finish('{"transport":"refused","payload":"captured_execution_refused"}\n',1);}
finally{for(const chunk of chunks)chunk.fill(0);}
`;
// The closed family is pinned by the separately trusted owner. Native ESM
// parsing/linking occurs in the child before worker evaluation. This is custody,
// not confinement: pinned code and the host supervisor remain trusted.
// The existing governor supervisor must write and close stdin, honor timeoutMs
// using its layered process-tree termination, pass this env without ambient
// inheritance, and return bounded stdout plus code/timedOut/outputLimited axes.
// The broker validates that output; this capture handle does not certify a
// caller-supplied supervisor. Stable nonzero file identity is required: volumes
// unable to supply it fail closed. Both family and manifest use code-point order.
export function captureBumbleWorker(options){
  try{return capture(options,false);}catch{refuse();}
}
// A distinct closed graph and entry point; an OAuth frame never enters the
// issued-key worker. The supplied supervisor is still the original parent.
export function captureBumbleOAuthWorker(options){
  try{return capture(options,true);}catch{refuse();}
}
function capture(options,oauth){
  const family=oauth?BUMBLE_OAUTH_WORKER_FILES:BUMBLE_WORKER_FILES,entry=oauth?'bumble-oauth-peer-worker.mjs':'bumble-peer-worker.mjs',jobLimit=oauth?300000:65536;
  const o=own(options,['source_root','files','manifest_sha256','runProcess']);
  if(typeof o.runProcess!=='function'||typeof o.source_root!=='string'||!path.isAbsolute(o.source_root)||!sha(o.manifest_sha256)||!Array.isArray(o.files)||o.files.length!==family.length)refuse();
  const root=fs.realpathSync.native(o.source_root);if(root!==o.source_root)refuse();
  const rows=o.files.map(v=>own(v,['file','sha256'])).sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
  if(rows.some((r,i)=>r.file!==family[i]||!sha(r.sha256))||H(JSON.stringify(rows))!==o.manifest_sha256)refuse();
  const sources=new Map();let total=0;
  for(const row of rows){
    const file=path.join(root,row.file);
    for(let at=file;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())refuse();if(path.dirname(at)===at)break;}
    const before=fs.lstatSync(file,{bigint:true});
    const same=s=>s.isFile()&&s.nlink===1n&&s.ino>0n&&s.ino===before.ino&&(process.platform==='win32'||s.dev===before.dev)&&s.size===before.size&&s.mtimeNs===before.mtimeNs;
    if(!same(before)||before.size<1n||before.size>1000000n||(total+=Number(before.size))>1000000)refuse();
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
    try{
      if(!same(fs.fstatSync(fd,{bigint:true})))refuse();bytes=Buffer.alloc(Number(before.size)+1);let offset=0;
      while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)break;offset+=n;}
      if(offset!==Number(before.size)||!same(fs.fstatSync(fd,{bigint:true}))||!same(fs.lstatSync(file,{bigint:true})))refuse();bytes=bytes.subarray(0,offset);
    }finally{fs.closeSync(fd);}
    if(H(bytes)!==row.sha256)refuse();const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    sources.set(row.file,source);
  }
  const graph=JSON.stringify({files:rows.map(row=>({file:row.file,source:sources.get(row.file)}))}),graph_sha256=H(graph);
  // Measure the actual encoding before admission can consume a reservation.
  // Reserve a complete bounded worker handoff, not an estimated raw-source size.
  if(Buffer.byteLength(JSON.stringify({schema:'momm-bumble-captured-worker/2',graph,job:null}))+jobLimit>2000000)refuse();
  // Anchor the child to the captured digest outside the stdin data it checks.
  // A malicious supervisor can replace argv too; it is a trusted host boundary.
  const bootstrap='const EXPECTED_GRAPH_SHA256='+JSON.stringify(graph_sha256)+';const ENTRY_NAME='+JSON.stringify(entry)+';const OAUTH='+JSON.stringify(oauth)+';\n'+EXECUTION_BOOTSTRAP;
  // No ambient loader, preload, proxy or account session environment in child.
  const env=Object.create(null);env.NoDefaultCurrentDirectoryInExePath='1';
  for(const name of ['SystemRoot','WINDIR','TEMP','TMP'])if(typeof process.env[name]==='string')env[name]=process.env[name];
  const supervisor=o.runProcess;
  return Object.freeze({
    manifest_sha256:o.manifest_sha256,
    worker_sha256:rows.find(r=>r.file===entry).sha256,
    graph_sha256,
    async execute(job,options={}){
      try{
      const {timeoutMs}=own(options,['timeoutMs']);
      if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000)refuse();
      if(oauth&&(!Buffer.isBuffer(job)||job.length<1||job.length>200000))refuse();
      const serialized=JSON.stringify(oauth?job.toString('base64'):job);if(typeof serialized!=='string'||Buffer.byteLength(serialized)>jobLimit)refuse();
      const input=JSON.stringify({schema:'momm-bumble-captured-worker/2',graph,job:JSON.parse(serialized)});
      if(Buffer.byteLength(input)>2000000)refuse();
      return await supervisor(process.execPath,['--experimental-vm-modules','--input-type=module','--eval',bootstrap],{input,timeoutMs,env:Object.assign(Object.create(null),env)});
      }catch{refuse();}
    }
  });
}
