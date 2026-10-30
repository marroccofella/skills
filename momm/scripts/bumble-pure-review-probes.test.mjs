// Governor-authored minimal probes for sealed review claims; source-module reads
// only, no private-store, credential, browser, network or worker operations.
// Not yet in the frozen pack.
import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {BumblePlan} from './bumble-plan.mjs';import {bumbleOAuthVaultScope} from './bumble-oauth-vault.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=s=>crypto.createHash('sha256').update(s).digest('hex');
const cases={
 vaultDigest(){
  const scope={schema:'momm-bumble-oauth-vault-scope/1',connector_id:'c',endpoint_id:'e',issuer:'https://issuer.example.test',resource:'https://node.example.test/v1',client_id:'public-fixture',profile_sha256:H('profile'),trust_sha256:H('trust'),configuration_epoch:'1',credential_epoch:'1'};
  assert.match(bumbleOAuthVaultScope(scope),/^[a-f0-9]{64}$/,'Valid string-digest scope must remain accepted');
  assert.throws(()=>bumbleOAuthVaultScope({...scope,profile_sha256:[scope.profile_sha256]}),{code:'invalid_scope'},'Array digest must not be coerced into an accepted string');
  let touched=0;const hostile={toString(){touched++;return scope.trust_sha256;},toJSON(){touched++;return 'changed';}};
  assert.throws(()=>bumbleOAuthVaultScope({...scope,trust_sha256:hostile}),{code:'invalid_scope'});assert.equal(touched,0,'Refuse non-string digest before coercion');
 },
 independentGroups(){
  const p=new BumblePlan({deadline:50,global:5,per_group:2});
  assert(p.admit({task_id:'one',resource_group:'A',source_ip_group:'X'},1));assert(p.admit({task_id:'two',resource_group:'B',source_ip_group:'Y'},1));
  assert(p.admit({task_id:'three',resource_group:'A',source_ip_group:'Y'},1),'Two separate partially occupied groups must not be merged into one union budget');
  assert.equal(p.admit({task_id:'four',resource_group:'A',source_ip_group:'Z'},1),null,'Physical-group cap still applies');
  assert(p.admit({task_id:'five',resource_group:'B',source_ip_group:'X'},1),'Distinct under-capacity group pair remains usable');
  assert.equal(p.admit({task_id:'six',resource_group:'C',source_ip_group:'Y'},1),null,'Source-IP cap still applies');
 },
 accountingOverflow(){
  const M=Number.MAX_SAFE_INTEGER,p=new BumblePlan({deadline:50,global:2,per_group:2,max_bytes:M,max_candidates:M}),a=p.admit({task_id:'one',resource_group:'A',source_ip_group:'X'},1),b=p.admit({task_id:'two',resource_group:'B',source_ip_group:'Y'},1);
  p.terminal(a,'known_not_sent',{bytes:M,candidates:0});const original=p.snapshot();
  assert.throws(()=>p.terminal(b,'known_not_sent',{bytes:1,candidates:0}),/accounting|supported|safe/i,'Reject unsafe sum before mutating a durable plan');assert.deepEqual(p.snapshot(),original);
  assert.deepEqual(new BumblePlan(p.limits,original).snapshot(),original,'A valid boundary state remains restorable');
 }
};
const selected=process.argv[2];if(selected){assert(Object.hasOwn(cases,selected),'Unknown selected probe');cases[selected]();}else for(const test of Object.values(cases))test();
console.log(JSON.stringify({passed:true,case:selected??'all',network_calls:0,model_calls:0,credentials_read:false,scope:'Pure scope/plan invariants; not native dispatch, OAuth login or qualification'}));
