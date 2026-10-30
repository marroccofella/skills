// Synthetic keys and ledgers only. Never load the real pilot or clear real holds.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {BumbleCapacity} from './bumble-capacity.mjs';
import {createBumbleReleaseVerifier,verifyBumbleReleaseReceipt} from './bumble-release-receipt.mjs';
import {privateTestFixture} from './private-test-fixture.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: fixtures choose their own evidence home
const home=privateTestFixture('momm-release-receipt-'),H=v=>crypto.createHash('sha256').update(v).digest('hex');
const keys=crypto.generateKeyPairSync('ed25519'),public_key_pem=keys.publicKey.export({type:'spki',format:'pem'}),public_key_sha256=H(keys.publicKey.export({type:'spki',format:'der'}));
const deadline=Date.now()+3500000,config={schema:'momm-bumble-capacity/1',global_slots:1,max_attempts:4,max_reserved_tokens:4096,deadline,resource_groups:[{id:'physical',slots:1}],source_ip_groups:[{id:'source',slots:1}],endpoints:[{id:'synthetic',resource_group:'physical',source_ip_group:'source'}]};
const options={root:path.join(home,'capacity'),config,project_root:process.cwd()},unprivileged=new BumbleCapacity(options);
const verifier=createBumbleReleaseVerifier({public_key_pem,public_key_sha256,configuration_sha256:unprivileged.summary().configuration_sha256});
const manager=new BumbleCapacity({...options,release_verifier:verifier});
const request=task_id=>({endpoint_id:'synthetic',run_id:'rev_release_test',task_id,worker_binding:'a'.repeat(64),max_tokens:1024,deadline:Date.now()+180000,now:Date.now()});
const reservation=manager.reserve(request('one'));assert(reservation.admitted);manager.markTransmissionPossible(reservation.reservation_id,Date.now());manager.terminal(reservation.reservation_id,{transport:'outcome_unknown',payload:'unavailable',now:Date.now()});
const original=manager.summary(),challenge=manager.releaseChallenge(reservation.reservation_id);
const payload={schema:'momm-bumble-owner-release/1',authority_sha256:public_key_sha256,configuration_sha256:challenge.configuration_sha256,reservation_id:challenge.reservation_id,reservation_sha256:challenge.reservation_sha256,remote_session_id:'synthetic-session',remote_request_id:'synthetic-request',backend_lease_id:'synthetic-lease',backend_outcome:'completed',backend_terminal_at:Date.now(),lease_released_at:Date.now(),observed_at:Date.now(),evidence_sha256:'b'.repeat(64)};
const sign=value=>{const body=JSON.stringify(value);return {payload:body,signature:crypto.sign(null,Buffer.from(body),keys.privateKey).toString('base64url')};};
let cases=0;const check=(name,fn)=>{fn();cases++;console.log(JSON.stringify({case:name,passed:true}));};
check('expected scalar coercion refused',()=>{let reads=0;const expected={...challenge,reservation_id:{toString(){reads++;return 'synthetic';}}};assert.throws(()=>verifyBumbleReleaseReceipt(verifier,sign(payload),expected));assert.equal(reads,0);});
check('default denial before receipt getters',()=>{let reads=0;assert.throws(()=>unprivileged.reconcileRelease(reservation.reservation_id,new Proxy({},{get(){reads++;throw Error('untrusted getter');}})));assert.equal(reads,0);});
check('copied verifier refused',()=>assert.throws(()=>new BumbleCapacity({...options,release_verifier:{...verifier}})));
for(const [name,edit] of [
 ['wrong reservation',p=>({...p,reservation_id:'other'})],
 ['wrong original binding',p=>({...p,reservation_sha256:'c'.repeat(64)})],
 ['gateway cancellation is not lease release',p=>{const v={...p,backend_outcome:'cancelled'};delete v.backend_lease_id;return v;}],
 ['stale observation',p=>({...p,backend_terminal_at:Date.now()-400000,lease_released_at:Date.now()-400000,observed_at:Date.now()-400000})],
 ['future observation',p=>({...p,observed_at:Date.now()+10000})],
 ['authority field',p=>({...p,execute:true})]
])check(name,()=>{assert.throws(()=>manager.reconcileRelease(reservation.reservation_id,sign(edit(payload))));assert.equal(manager.summary().held,1);});
check('tampered signature',()=>{const receipt=sign(payload);receipt.payload=receipt.payload.replace('synthetic-request','different-request');assert.throws(()=>manager.reconcileRelease(reservation.reservation_id,receipt));});
check('receipt accessors refused without invocation',()=>{let reads=0;assert.throws(()=>manager.reconcileRelease(reservation.reservation_id,{get payload(){reads++;return '{}';},signature:'a'.repeat(86)}));assert.equal(reads,0);});
const receipt=sign(payload);
check('exact signed proof releases slot, never relabels original or refunds budget',()=>{const value=manager.reconcileRelease(reservation.reservation_id,receipt);assert.equal(value.released,true);const s=manager.summary();assert.equal(s.held,0);assert.equal(s.attempts,1);assert.equal(s.reserved_tokens,1024);assert.deepEqual(s.reservations[0].terminal,original.reservations[0].terminal);assert.equal(s.quorum_votes,0);assert.equal(s.completion,false);});
check('restart and identical replay are idempotent',()=>{const restarted=new BumbleCapacity({...options,release_verifier:verifier});assert.equal(restarted.reconcileRelease(reservation.reservation_id,receipt).recorded,false);assert.equal(restarted.summary().reserved_tokens,1024);});
check('idempotent malformed payload cannot run serialization hooks',()=>{let reads=0;assert.throws(()=>manager.reconcileRelease(reservation.reservation_id,{payload:{toJSON(){reads++;return receipt.payload;}},signature:receipt.signature}));assert.equal(reads,0);});
check('restart without trusted pin fails closed',()=>assert.throws(()=>new BumbleCapacity(options)));
check('another receipt cannot replace original release',()=>assert.throws(()=>manager.reconcileRelease(reservation.reservation_id,sign({...payload,evidence_sha256:'d'.repeat(64)}))));
check('old proof cannot release another job',()=>{const next=manager.reserve(request('two'));assert(next.admitted);manager.markTransmissionPossible(next.reservation_id,Date.now());manager.terminal(next.reservation_id,{transport:'success',payload:'valid',now:Date.now()});assert.throws(()=>manager.reconcileRelease(next.reservation_id,receipt));assert.equal(manager.summary().held,1);});
check('changed stored proof quarantines without repair',()=>{const file=path.join(options.root,'capacity.json'),bytes=fs.readFileSync(file);fs.writeFileSync(path.join(home,'original-capacity.json'),bytes,{flag:'wx'});const state=JSON.parse(bytes);state.reservations[0].physical_release.receipt.payload=state.reservations[0].physical_release.receipt.payload.replace('synthetic-request','forged-request');fs.writeFileSync(file,JSON.stringify(state));assert.throws(()=>new BumbleCapacity({...options,release_verifier:verifier}));assert(fs.readFileSync(file,'utf8').includes('forged-request'));});
console.log(JSON.stringify({passed:cases,network_calls:0,real_credentials_read:0,real_holds_released:0,qualification:'synthetic pinned-host attestations and local accounting only; not signer provenance, live broker, BAB evidence or native qualification',fixture_retained:home}));
