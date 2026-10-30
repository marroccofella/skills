// Governed public metadata fixtures. No node, issuer, token, network or model call.
import assert from 'node:assert/strict';import crypto from 'node:crypto';import {bumbleOAuthDiscoveryURL,parseBumbleAuthProfile,assessBumbleAuthProfile} from './bumble-oauth-discovery.mjs';
import * as discovery from './bumble-oauth-discovery.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const H=b=>crypto.createHash('sha256').update(b).digest('hex'),resource='https://node.example.test/v1';
const profile={schema:'momm-bumble-auth-profile/1',state:'supported',issuer:'https://issuer.example.test/tenant',resource,client_id:'momm-public-fixture',scopes:['momm.models.read','momm.infer'],redirect:{scheme:'http',hosts:['127.0.0.1','[::1]'],path:'/momm/oauth/callback',port_policy:'ephemeral'},flow:{grant:'authorization_code',pkce:'S256',token_endpoint_auth_method:'none'},profile_epoch:1},raw=JSON.stringify(profile);
const pins={schema:'momm-bumble-auth-trust-pins/1',issuer:profile.issuer,resource,client_id:profile.client_id,scopes:[...profile.scopes],minimum_epoch:1,profile_sha256:H(raw)};
assert.equal(bumbleOAuthDiscoveryURL(profile.issuer),'https://issuer.example.test/.well-known/oauth-authorization-server/tenant');assert.equal(bumbleOAuthDiscoveryURL(profile.issuer,{kind:'oidc'}),'https://issuer.example.test/tenant/.well-known/openid-configuration');
for(const issuer of ['http://issuer.example.test','https://user:password@issuer.example.test','https://issuer.example.test?injected=1'])assert.throws(()=>bumbleOAuthDiscoveryURL(issuer));
const unsupported=JSON.stringify({schema:profile.schema,state:'unsupported',reason:'oauth_not_configured',profile_epoch:1});assert.equal(assessBumbleAuthProfile(unsupported,{resource}).state,'unsupported');assert.throws(()=>parseBumbleAuthProfile(JSON.stringify({...JSON.parse(unsupported),issuer:profile.issuer})));
const discovered=assessBumbleAuthProfile(raw,{resource});assert.equal(discovered.state,'trust_required');assert.equal(discovered.login_allowed,false);assert(Object.isFrozen(discovered.profile.redirect.hosts));
const good=assessBumbleAuthProfile(raw,{resource,trust:pins});assert.equal(good.state,'profile_matches_pins');assert.equal(good.login_allowed,false,'matching advertisements cannot grant login authority');assert.equal(good.qualified,false);assert.equal(good.quorum_votes,0);
assert.equal(assessBumbleAuthProfile(JSON.stringify({...profile,state:'proposed'}),{resource,trust:pins}).state,'proposed');
for(const changed of [{issuer:'https://other.example.test'},{resource:'https://other.example.test/v1'},{client_id:'other'},{minimum_epoch:2},{profile_sha256:H('different')},{scopes:['momm.jobs.cancel']}])assert.equal(assessBumbleAuthProfile(raw,{resource,trust:{...pins,...changed}}).state,'refused');
for(const changed of [{extra:true},{api_key:'fixture-forbidden'},{profile_epoch:0},{scopes:['admin']},{flow:{...profile.flow,pkce:'plain'}},{redirect:{...profile.redirect,hosts:['localhost','[::1]']}},{redirect:{...profile.redirect,path:'/other'}}])assert.throws(()=>parseBumbleAuthProfile(JSON.stringify({...profile,...changed})));
for(const bad of [raw+'}',raw.replace('"state":"supported"','"state":"supported","state":"supported"'),Buffer.from([0xff]),' '.repeat(32001)])assert.throws(()=>parseBumbleAuthProfile(bad));
let reads=0;const maliciousPins={...pins};Object.defineProperty(maliciousPins,'issuer',{enumerable:true,get(){reads++;throw Error('Must not read');}});assert.throws(()=>assessBumbleAuthProfile(raw,{resource,trust:maliciousPins}));assert.equal(reads,0);
const hiddenPins={...pins};Object.defineProperty(hiddenPins,'extra',{value:true});assert.throws(()=>assessBumbleAuthProfile(raw,{resource,trust:hiddenPins}));
const copied=parseBumbleAuthProfile(Buffer.from(raw));assert.equal(copied.raw_sha256,H(Buffer.from(raw)));assert.throws(()=>{copied.profile_epoch=2;});
const regressions=[];function regression(name,fn){try{fn();regressions.push({name,passed:true});}catch(e){regressions.push({name,passed:false,reason:e.message.slice(0,180)});}}
regression('RFC8414 removes terminating issuer slash',()=>assert.equal(bumbleOAuthDiscoveryURL(profile.issuer+'/'),'https://issuer.example.test/.well-known/oauth-authorization-server/tenant'));
regression('scope accessors refused before evaluation',()=>{let reads=0;const s=[...pins.scopes];Object.defineProperty(s,'0',{enumerable:true,get(){reads++;return 'momm.models.read';}});assert.throws(()=>assessBumbleAuthProfile(raw,{resource,trust:{...pins,scopes:s}}));assert.equal(reads,0);});
for(const hosts of [['127.0.0.1'],['[::1]'],['[::1]','127.0.0.1']])regression('explicit advertised loopback subset '+hosts.join(','),()=>{
 const r=JSON.stringify({...profile,redirect:{...profile.redirect,hosts}}),p=assessBumbleAuthProfile(r,{resource,trust:{...pins,profile_sha256:H(r)}});
 assert.equal(p.state,'profile_matches_pins');assert.deepEqual(p.profile.redirect.hosts,hosts);assert.equal(p.login_allowed,false);
});
regression('empty unknown duplicate and mapped hosts refused',()=>{
 for(const hosts of [[],['localhost'],['*'],['0.0.0.0'],['[::]'],['[::ffff:127.0.0.1]'],['127.0.0.1','127.0.0.1'],['[::1]','[::1]'],['127.0.0.1','[::1]','localhost']])assert.throws(()=>parseBumbleAuthProfile(JSON.stringify({...profile,redirect:{...profile.redirect,hosts}})),{code:'unsupported_loopback_rules'});
});
regression('callback decision uses owned matching pins and advertised subset only',()=>{
 assert.equal(typeof discovery.selectBumbleOAuthCallback,'function','Trusted subset callback selection is not implemented');
 for(const hosts of [['127.0.0.1'],['[::1]'],['127.0.0.1','[::1]']]){
  const r=JSON.stringify({...profile,redirect:{...profile.redirect,hosts}}),p=assessBumbleAuthProfile(r,{resource,trust:{...pins,profile_sha256:H(r)}});
  const chosen=discovery.selectBumbleOAuthCallback(p,{port:54321});assert(hosts.includes(chosen.advertised_host));assert.equal(chosen.port,54321);
  assert.equal(chosen.redirect_uri,'http://'+chosen.advertised_host+':54321/momm/oauth/callback');assert.equal(chosen.login_allowed,false);assert.equal(chosen.listener_verified,false);assert.equal(chosen.quorum_votes,0);
  for(const host of ['localhost','*','0.0.0.0','[::]','[::ffff:127.0.0.1]',...['127.0.0.1','[::1]'].filter(h=>!hosts.includes(h))])assert.throws(()=>discovery.selectBumbleOAuthCallback(p,{port:54321,host}));
  for(const port of [0,-1,65536,1.5,'54321',NaN])assert.throws(()=>discovery.selectBumbleOAuthCallback(p,{port}));
  assert.throws(()=>discovery.selectBumbleOAuthCallback({...p},{port:54321}));
 }
 let reads=0;const hostile={};Object.defineProperty(hostile,'port',{enumerable:true,get(){reads++;throw Error('Must not read');}});
 assert.throws(()=>discovery.selectBumbleOAuthCallback({},hostile));assert.equal(reads,0);
 assert.throws(()=>discovery.selectBumbleOAuthCallback(good,hostile));assert.equal(reads,0);
 for(const p of [assessBumbleAuthProfile(raw,{resource}),assessBumbleAuthProfile(unsupported,{resource}),assessBumbleAuthProfile(raw,{resource,trust:{...pins,minimum_epoch:2}})])assert.throws(()=>discovery.selectBumbleOAuthCallback(p,{port:54321}));
 const changed=JSON.stringify({...profile,redirect:{...profile.redirect,hosts:['127.0.0.1']}});
 assert.equal(assessBumbleAuthProfile(changed,{resource,trust:pins}).state,'refused','Original byte pin cannot be reused after host subset changes');
});
console.log(JSON.stringify({regressions}));assert(regressions.every(r=>r.passed),'Discovery regression controls failed');
console.log(JSON.stringify({passed:true,network_calls:0,model_calls:0,credentials_read:false,scope:'closed bounded public profile, RFC discovery paths, separate owner trust and epoch/identity refusals; not real TLS/login/qualification'}));
