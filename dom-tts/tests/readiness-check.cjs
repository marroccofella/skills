const assert=require('node:assert/strict');
const {windowsReadiness,readiness}=require('../scripts/providers/readiness');
const {failureMessage,commandFor}=require('../scripts/providers/native');
let queries=0;
function check(policy,signature,internetZone){return windowsReadiness({run:(exe,args,options)=>{
 queries++;assert(exe.endsWith('powershell.exe'));assert(!args.includes('-ExecutionPolicy'));assert(!/Set-ExecutionPolicy|Unblock-File/.test(args.at(-1)));assert(options.timeout===10000);
 return {status:0,stdout:JSON.stringify({policy,signature,internetZone})};
}});}
for(const signature of ['Valid','NotSigned'])assert.equal(check('Restricted',signature,false).state,'blocked');
assert.equal(check('AllSigned','NotSigned',false).state,'blocked');
assert.equal(check('AllSigned','Valid',false).state,'unverified');
assert.equal(check('RemoteSigned','NotSigned',true).state,'blocked');
assert.equal(check('RemoteSigned','NotSigned',false).state,'unverified');
assert.equal(check('RemoteSigned','Valid',true).state,'unverified');
assert.equal(check('Unrestricted','NotSigned',true).state,'unverified');
assert.equal(check('HOSTILE_PRIVATE_POLICY','Valid',false).code,'launcher-check-failed');
assert.equal(windowsReadiness({run:()=>({status:1,stderr:'PRIVATE_PATH'})}).code,'launcher-check-failed');
assert.equal(windowsReadiness({run:()=>({error:{code:'ETIMEDOUT'}})}).code,'launcher-check-timeout');
assert.equal(windowsReadiness({run:()=>({status:0,stdout:'PRIVATE_PATH'})}).code,'launcher-check-failed');
assert.equal(readiness('say').state,'unverified');
for(const stderr of ['running scripts is disabled','running scripts is\r\ndisabled','PSSecurityException','execution\r\npolicy'])assert.match(failureMessage(stderr),/blocked by execution policy/);
assert.match(failureMessage('SelectVoice failed'),/voice is unavailable/);
assert(!commandFor('sapi',{},'synthetic.json').args.includes('-ExecutionPolicy'));
console.log('PASS: policy/signature/zone readiness, sanitized refusals, wrapped errors; '+queries+' read-only query fixtures; no audio or settings changes');
