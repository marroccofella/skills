// Governor-authored synthetic reproductions; peer snippets are not executed.
import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {discoverBumbleOAuth} from '../scripts/bumble-oauth-http.mjs';
import {validateBumbleOAuthMetadata,validateBumbleOAuthTokenEnvelope} from '../scripts/bumble-oauth-contract.mjs';

delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),cert=Buffer.from('synthetic-public-certificate');
const profile={schema:'momm-bumble-oauth-profile/1',issuer:'https://issuer.example.test:5441',resource:'https://100.64.0.42:5441/v1',client_id:'momm-synthetic-repro',redirect_uri:'http://127.0.0.1:54321/momm/oauth/callback',scopes:['momm.infer'],config_epoch:'synthetic-1'};
const config=()=>({socket_address:'100.64.0.42',port:5441,server_name:'issuer.example.test',certificate_sha256:H(cert),deadline:Date.now()+20000});
const authorize=q=>({schema:'momm-bumble-oauth-http-approval/1',operation:q.operation,endpoint:q.endpoint,profile_sha256:q.profile_sha256,connection_sha256:q.connection_sha256,request_sha256:q.request_sha256,valid_until:q.deadline});
const cases={
 async 'request-binding'(){
  const text=fs.readFileSync(new URL('../scripts/bumble-oauth-http.mjs',import.meta.url),'utf8'),start=text.indexOf('export async function exchangeBumbleOAuthCode(');assert(start>=0);
  const bytes=Buffer.from('SYNTHETIC_UNAPPROVED_BODY'),contract={profile,token_endpoint:profile.issuer+'/token'},descriptor={token_endpoint:contract.token_endpoint,request_sha256:H('SYNTHETIC_APPROVED_BODY')};let calls=0;
  const fn=vm.runInNewContext('('+text.slice(start).replace(/^export /,'')+')',{URL,Object,Buffer,H,https:{request(){}},wall:Date.now,describeBumbleOAuthExchange:()=>descriptor,connection:()=>config(),approved(){},certificate:()=>Buffer.from(cert),takeBumbleOAuthExchange:()=>({body:bytes}),fetchPrivate:async()=>{calls++;return '{}';},validateBumbleOAuthTokenEnvelope:()=>({access_token:Buffer.from('SYNTHETIC_TOKEN'),expires_at:Date.now()+300000}),fail:code=>{throw Object.assign(Error('synthetic refusal'),{code});}});
  await assert.rejects(fn(contract,{},config(),{certificate:cert},{authorize,request(){}}),{code:'request_binding'});assert.equal(calls,0);assert(bytes.every(b=>b===0));
 },
 async 'hash-type'(){let coercions=0,calls=0;const hash={toString(){coercions++;return H(cert);},toJSON(){coercions++;return H(cert);}};await assert.rejects(discoverBumbleOAuth(profile,{...config(),certificate_sha256:hash},{certificate:cert},{authorize,request(){calls++;}}),{code:'invalid_connection'});assert.equal(coercions,0);assert.equal(calls,0);},
 async 'invalid-issuer'(){let calls=0;await assert.rejects(discoverBumbleOAuth({...profile,issuer:'not a URL'},config(),{certificate:cert},{authorize,request(){calls++;}}),{code:'invalid_issuer'});assert.equal(calls,0);},
 async 'request-type'(){await assert.rejects(discoverBumbleOAuth(profile,config(),{certificate:cert},{authorize,request:42}),{code:'invalid_request_fn'});},
 async 'canonical-server-name'(){await assert.rejects(discoverBumbleOAuth(profile,{...config(),server_name:'Issuer.Example.Test'},{certificate:cert},{authorize,request(){throw Error('must not call');}}),{code:'invalid_connection'});},
 async 'token-envelope-shape'(){const contract=validateBumbleOAuthMetadata(profile,{issuer:profile.issuer,authorization_endpoint:profile.issuer+'/authorize',token_endpoint:profile.issuer+'/token',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],authorization_response_iss_parameter_supported:true});const material=validateBumbleOAuthTokenEnvelope(JSON.stringify({access_token:'fixture01'.repeat(600),token_type:'Bearer',expires_in:300,scope:'momm.infer',refresh_token:'fixture01_REFRESH',id_token:'fixture01_ID'}),{contract,now:Date.now()});assert(Object.isExtensible(material));assert(Buffer.isBuffer(material.access_token));assert.equal(Object.hasOwn(material,'refresh_token'),false);assert.equal(Object.hasOwn(material,'id_token'),false);assert.equal(material.refresh_material_withheld,true);material.access_token.fill(0);assert(material.access_token.every(b=>b===0));},
 async 'tests-exist'(){const test=fs.readFileSync(new URL('../scripts/bumble-oauth-http.test.mjs',import.meta.url),'utf8');for(const check of ['mismatched socket','certificate hash mismatch','HTTP error never retries','malformed, duplicate, oversized','non-JSON content type','ambiguous token exchange'])assert(test.includes(check));}
};
const mode=process.argv[2]??'all';if(mode!=='all'&&!Object.hasOwn(cases,mode))throw Error('Known reproduction mode required.');let passed=0;
for(const [name,fn]of Object.entries(cases))if(mode==='all'||mode===name){await fn();passed++;console.log(JSON.stringify({name,passed:true}));}
assert(passed>0);console.log(JSON.stringify({passed,scope:'synthetic local checks; request-binding mode fault-injects the dependency seam, not an exploit of the current branded exchange implementation'}));
