// Governor-authored deterministic deadline-crossing control; synthetic bytes only.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
delete process.env.MOMM_EVIDENCE_HOME;
const moduleURL=new URL('../scripts/bumble-oauth-peer-handoff.mjs',import.meta.url).href;
const script=`
import assert from 'node:assert/strict';import crypto from 'node:crypto';
let now=Date.now();Date.now=()=>now;
const m=await import(${JSON.stringify(moduleURL)}),H=b=>crypto.createHash('sha256').update(b).digest('hex'),h=H('synthetic');
const certificate=Buffer.from('synthetic-certificate'),input={artifact:'export const n=1;',model:'synthetic-model',role:'architect',role_version:'1',max_tokens:1024};
const c={base_url:'https://reviewer.example/v1',server_name:'reviewer.example',certificate_sha256:H(certificate),scope_binding:h,baseline_report_sha256:h,association_sha256:h,validator_sha256:h,policy_sha256:h,trust_sha256:h,disclosure_sha256:h,logging_sha256:h,attempt_id:'synthetic-attempt',deadline:now+180000};
const authorize=q=>({schema:'momm-bumble-oauth-peer-approval/1',config_sha256:q.config_sha256,request_sha256:q.request_sha256,scope_binding:h,policy_sha256:h,trust_sha256:h,disclosure_sha256:h,logging_sha256:h,valid_until:c.deadline+1000});
const d=m.sealBumbleOAuthPeerHandoff(input,c,{access_token:Buffer.from(['synthetic','material'].join('-')),certificate},authorize);
const original=Buffer.from;let copied;
// Crossing happens during the final owned copy, after the prior clock check.
Buffer.from=function(...args){const value=Reflect.apply(original,Buffer,args);now=c.deadline;copied=value;return value;};
assert.throws(()=>m.takeBumbleOAuthPeerHandoff(d),{code:'handoff_expired'});
assert(copied&&copied.every(byte=>byte===0),'a late private copy must be zeroed');
assert.throws(()=>m.takeBumbleOAuthPeerHandoff(d),{code:'owned_original_handoff_required'});
`;
const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:20000});
if(r.status!==0)process.stderr.write(r.stderr||'Deadline child did not complete.');
assert.equal(r.status,0,'deadline crossing must withhold and zero private material');
console.log('PASS: deadline crossed during final private copy refuses, zeroes copy and burns original');
