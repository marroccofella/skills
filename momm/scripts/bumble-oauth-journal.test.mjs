// Owner-private synthetic metadata only; no actual login, token, issuer or model.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {realTempDir} from './private-test-fixture.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const url=new URL('./bumble-oauth-journal.mjs',import.meta.url),module=fs.existsSync(url)?await import(url):{};
assert.equal(typeof module.BumbleOAuthJournal,'function','Durable OAuth operation journal is not implemented');
const H=v=>crypto.createHash('sha256').update(v).digest('hex'),parent=realTempDir('momm-oauth-journal-test-'),ownerParent=path.dirname(parent);
const config={schema:'momm-bumble-oauth-journal-config/1',scope_binding:H('scope'),policy_sha256:H('policy'),trust_sha256:H('trust'),disclosure_sha256:H('disclosure'),logging_sha256:H('logging'),max_attempts:2,max_bytes:32768,deadline:1000};
let ownerPermits=true,approvalCalls=0;
const authorize=({operation,request_binding})=>{approvalCalls++;return ownerPermits?{schema:'momm-bumble-oauth-operation-approval/1',scope_binding:config.scope_binding,operation,request_binding,policy_sha256:config.policy_sha256,trust_sha256:config.trust_sha256,disclosure_sha256:config.disclosure_sha256,logging_sha256:config.logging_sha256,valid_until:1000}:null;};
const make=(name,extra={})=>new module.BumbleOAuthJournal({root:path.join(parent,name),config,authorize,...extra});
const begin=(extra={})=>({attempt_id:crypto.randomUUID(),operation:'code_exchange',request_binding:H(crypto.randomUUID()),previous_reference:null,now:10,deadline:500,...extra});
function duplicates(){
  const j=make('duplicate-boundary'),r=begin();j.begin(r);j.markPossible(r.attempt_id,11);j.finish(r.attempt_id,{outcome:'outcome_unknown',protected_reference:null,now:12});assert.equal(j.summary().quarantined,true);
  const file=path.join(parent,'duplicate-boundary',fs.readdirSync(path.join(parent,'duplicate-boundary')).filter(f=>f.startsWith('event-')).sort().at(-1)),original=fs.readFileSync(file);
  fs.writeFileSync(file,original.toString('utf8').trimEnd().replace(/}$/,',"outcome":"refused"}')+'\n');
  assert.throws(()=>j.summary(),{code:'invalid_journal_event'},'Duplicate outcome must not reinterpret the original unknown attempt');
  fs.writeFileSync(file,original);assert.equal(j.summary().quarantined,true);console.log(JSON.stringify({passed:true,case:'duplicates',network_calls:0,model_calls:0}));
}
function refreshLineage(){
  const j=make('refresh-lineage',{config:{...config,max_attempts:3}}),old=crypto.randomUUID(),r=begin({operation:'refresh',previous_reference:old});j.begin(r);j.markPossible(r.attempt_id,11);j.finish(r.attempt_id,{outcome:'success',protected_reference:crypto.randomUUID(),now:12});
  assert.throws(()=>j.begin(begin({operation:'refresh',previous_reference:old,now:13})),{code:'original_refresh_reference_not_reused'},'New attempt ID must not reuse the old refresh reference');
  console.log(JSON.stringify({passed:true,case:'refresh-lineage',network_calls:0,model_calls:0}));
}
try{
 const selected=process.argv[2];if(selected){assert(['duplicates','refresh-lineage'].includes(selected));if(selected==='duplicates')duplicates();else refreshLineage();}else{
 const denied=make('denied',{authorize:null});let reads=0;const hostile={};Object.defineProperty(hostile,'code',{enumerable:true,get(){reads++;throw Error('Must not read');}});
 assert.throws(()=>denied.begin(hostile),{code:'owner_approval_required'});assert.equal(reads,0);assert(!fs.existsSync(path.join(parent,'denied')));
 const live=make('positive'),a=begin();assert.equal(live.begin(a).recorded,true);const original=live.observe(a.attempt_id);assert.equal(original.state,'prepared');
 assert.throws(()=>live.begin({...a,attempt_id:crypto.randomUUID()}),{code:'original_operation_not_replayed'});
 const marked=live.markPossible(a.attempt_id,11);assert.equal(marked.original_transition,true);assert.equal(live.markPossible(a.attempt_id,12).original_transition,false);
 const reference=crypto.randomUUID();assert.equal(live.finish(a.attempt_id,{outcome:'success',protected_reference:reference,now:13}).state,'success');
 const count=live.summary().events;assert.equal(live.finish(a.attempt_id,{outcome:'success',protected_reference:reference,now:13}).recorded,false);assert.equal(live.summary().events,count);
 assert.throws(()=>live.finish(a.attempt_id,{outcome:'success',protected_reference:reference,now:14}),{code:'original_outcome_not_relabelled'});
 const second=begin({now:14,operation:'refresh',previous_reference:reference});live.begin(second);live.markPossible(second.attempt_id,15);
 const restarted=make('positive');assert.equal(restarted.summary().quarantined,true);assert.equal(restarted.observe(second.attempt_id).state,'possible');
 assert.throws(()=>restarted.begin(begin({now:16})),{code:'scope_quarantined_or_busy'});
 ownerPermits=false;assert.equal(restarted.finish(second.attempt_id,{outcome:'outcome_unknown',protected_reference:null,now:16}).state,'quarantined');ownerPermits=true;
 assert.equal(restarted.retire(17).retired,true);assert.equal(restarted.retire(18).recorded,false);assert.equal(restarted.summary().quarantined,true);assert.equal(restarted.summary().physical_release_verified,false);
 assert.throws(()=>restarted.begin(begin({now:19})),{code:'scope_retired'});
 const unsent=make('unsent'),b=begin();unsent.begin(b);assert.equal(unsent.finish(b.attempt_id,{outcome:'known_not_sent',protected_reference:null,now:11}).state,'known_not_sent');assert.equal(unsent.summary().quarantined,false);
 const c=begin({now:12});unsent.begin(c);unsent.markPossible(c.attempt_id,13);assert.throws(()=>unsent.finish(c.attempt_id,{outcome:'known_not_sent',protected_reference:null,now:14}),{code:'original_outcome_not_relabelled'});
 assert.equal(unsent.finish(c.attempt_id,{outcome:'cancelled',protected_reference:null,now:14}).state,'quarantined');
 const late=make('late'),d=begin();late.begin(d);late.markPossible(d.attempt_id,11);const observed=late.finish(d.attempt_id,{outcome:'success',protected_reference:crypto.randomUUID(),now:500});assert.equal(observed.state,'quarantined');assert.equal(observed.reported_outcome,'success');
 const noBudget=make('budget'),e=begin();noBudget.begin(e);noBudget.finish(e.attempt_id,{outcome:'known_not_sent',protected_reference:null,now:11});const f=begin({now:12});noBudget.begin(f);noBudget.finish(f.attempt_id,{outcome:'known_not_sent',protected_reference:null,now:13});assert.throws(()=>noBudget.begin(begin({now:14})),{code:'attempt_budget'});
 assert.throws(()=>make('positive',{config:{...config,scope_binding:H('different')}}).summary(),{code:'journal_configuration_changed'});
 const protectedRoot=path.join(parent,'late'),files=fs.readdirSync(protectedRoot).filter(f=>f.startsWith('event-')).sort(),first=path.join(protectedRoot,files[0]),bytes=fs.readFileSync(first),changed=JSON.parse(bytes);changed.request_binding=H('tamper');fs.writeFileSync(first,JSON.stringify(changed)+'\n');assert.throws(()=>late.summary());fs.writeFileSync(first,bytes);assert.equal(late.summary().quarantined,true);
 const bad=make('invalid');assert.throws(()=>bad.begin({...begin(),access_token:'fixture-not-used'}));assert(!fs.existsSync(path.join(parent,'invalid')));
 assert.throws(()=>make('bad-budget',{config:{...config,max_bytes:1000}}));
 duplicates();refreshLineage();
 console.log(JSON.stringify({passed:true,approvalCalls,network_calls:0,model_calls:0,real_credentials_read:false,scope:'metadata attempts/restart/quarantine/retirement/replay/storage bounds only; actual browser/vault/refresh/transport wiring and owner receipts remain required'}));
 }
}finally{if(path.dirname(parent)!==ownerParent||!path.basename(parent).startsWith('momm-oauth-journal-test-')||fs.realpathSync.native(parent)!==parent)throw Error('Cleanup target outside owned fixture');fs.rmSync(parent,{recursive:true,force:true});}
