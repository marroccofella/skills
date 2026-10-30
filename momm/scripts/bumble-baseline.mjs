// Trusted native preparation: original independent report/log seal, quorum,
// artifact identity and actual source bytes precede any supplementary work.
// An owned baseline is not owner permission, worker qualification or a vote.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {evidenceDir} from './evidence-location.mjs';import {requirePrivateEvidence} from './evidence-permissions.mjs';
import {readSealedReport,recoverArtifact} from './second-look.mjs';
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=/^[a-f0-9]{64}$/,owned=new WeakMap();
const fail=code=>{throw Object.assign(Error('Bumble baseline refused: '+code),{code});};
const routes=new Set(['codex','claude','antigravity','copilot','grok','gemini']);
function closed(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);return k.length===keys.length&&k.every(x=>typeof x==='string'&&keys.includes(x)&&d[x].enumerable&&Object.hasOwn(d[x],'value'));}
function verifySources(root,snapshot){
 if(snapshot?.complete!==true||!Array.isArray(snapshot.files)||!snapshot.files.length||snapshot.files.length>2000)fail('source_snapshot_required');
 const seen=new Set();
 for(const f of snapshot.files){
  if(!f||typeof f.path!=='string'||!f.path||f.path.length>1000||path.isAbsolute(f.path)||f.path.split('/').some(x=>!x||x==='.'||x==='..'||x.includes('\\')||x.includes(':'))||typeof f.sha256!=='string'||!SHA.test(f.sha256)||seen.has(f.path.toLowerCase()))fail('invalid_source_manifest');seen.add(f.path.toLowerCase());
  let file=root;for(const part of f.path.split('/')){file=path.join(file,part);const s=fs.lstatSync(file);if(s.isSymbolicLink())fail('linked_source');}
  const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>8000000n)fail('source_file_refused');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  try{const actual=fs.fstatSync(fd,{bigint:true});if(actual.ino!==before.ino||(process.platform!=='win32'&&actual.dev!==before.dev)||actual.nlink!==1n||!actual.isFile())fail('source_identity_changed');const bytes=fs.readFileSync(fd),after=fs.lstatSync(file,{bigint:true});if(after.ino!==actual.ino||(process.platform!=='win32'&&after.dev!==actual.dev)||after.nlink!==1n||after.isSymbolicLink()||H(bytes)!==f.sha256)fail('source_bytes_changed');}finally{fs.closeSync(fd);}
 }
}
function verifyQuorum(r){
 const required=r.gate_policy?.quorum_required;if(!routes.has(r.governor)||!Number.isSafeInteger(required)||required<2||required>5||r.quorum?.required!==required||r.quorum.met!==true)fail('whole_piece_quorum_required');
 const count=a=>new Set(a.filter(x=>routes.has(x)&&x!==r.governor)).size;
 if(r.split){const p=r.split.pieces;if(!Array.isArray(p)||!p.length||p.length>1000||(Object.hasOwn(r.split,'governor_direct')&&(!Array.isArray(r.split.governor_direct)||r.split.governor_direct.length!==0))||p.some(p=>!p||p.quorum_met!==true||count(Object.entries(p.reviewers??{}).filter(([,s])=>s==='success').map(([x])=>x))<required))fail('whole_piece_quorum_required');}
 else if(!Array.isArray(r.reviewers)||count(r.reviewers.filter(x=>x?.status==='success').map(x=>x.agent))<required)fail('whole_piece_quorum_required');
 return required;
}
export function openBumbleBaseline(options){
 if(!closed(options,['project_root','run_id'])||typeof options.project_root!=='string'||!path.isAbsolute(options.project_root)||typeof options.run_id!=='string'||!/^rev_[A-Za-z0-9_]{1,200}$/.test(options.run_id))fail('invalid_baseline_request');
 const root=fs.realpathSync.native(options.project_root),dir=evidenceDir({cwd:root,env:process.env});requirePrivateEvidence(dir);
 const sealed=readSealedReport(root,options.run_id),r=sealed.report,required=verifyQuorum(r);
 if(Object.hasOwn(r,'bumble_candidates'))fail('baseline_contains_supplementary_candidates');
 verifySources(root,r.source_snapshot);const artifact=recoverArtifact({root,report:r}),bytes=fs.readFileSync(path.join(dir,'reports',options.run_id+'.json'));
 if(H(bytes)!==sealed.reportSha256||H(artifact.text)!==r.input_sha256)fail('original_seal_changed');
 const value=Object.freeze({schema:'momm-bumble-owned-baseline/1',run_id:r.run_id,report_sha256:sealed.reportSha256,input_sha256:r.input_sha256,source_files:r.source_snapshot.files.length,quorum_required:required,permission_granted:false,worker_qualification_granted:false,quorum_votes:0,completion:false});
 owned.set(value,{root,run_id:r.run_id,report_sha256:sealed.reportSha256,input_sha256:r.input_sha256,snapshot:r.source_snapshot,source:artifact.text});return value;
}
export function materialForBumbleStage(value){
 const v=owned.get(value);if(!v)fail('owned_baseline_required');requirePrivateEvidence(evidenceDir({cwd:v.root,env:process.env}));const sealed=readSealedReport(v.root,v.run_id);
 if(sealed.reportSha256!==v.report_sha256||sealed.report.input_sha256!==v.input_sha256)fail('original_seal_changed');verifyQuorum(sealed.report);verifySources(v.root,v.snapshot);
 const bytes=fs.readFileSync(path.join(evidenceDir({cwd:v.root,env:process.env}),'reports',v.run_id+'.json'));if(H(bytes)!==v.report_sha256)fail('original_seal_changed');
 return Object.freeze({source:v.source,baseline_bytes:bytes,private_material:true,toJSON(){throw Error('Private baseline material is not serializable.');}});
}
