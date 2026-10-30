// Synthetic OAuth contract checks only, not a browser/token/network qualification.
import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {validateBumbleOAuthMetadata,prepareBumblePKCE,consumeBumbleOAuthCallback,validateBumbleOAuthTokenEnvelope} from './bumble-oauth-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // this synthetic suite owns its fixtures
const profile={schema:'momm-bumble-oauth-profile/1',issuer:'https://issuer.example.test',resource:'https://node.example.test/v1',client_id:'momm-public-fixture',scopes:['momm.models.read','momm.infer'],redirect_uri:'http://127.0.0.1:54321/momm/oauth/callback',config_epoch:'1'};
const metadata={issuer:profile.issuer,authorization_endpoint:profile.issuer+'/authorize',token_endpoint:profile.issuer+'/token',response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],authorization_response_iss_parameter_supported:true};
const contract=validateBumbleOAuthMetadata(profile,metadata);assert.equal(contract.owner_approval_required,true);assert.equal(contract.quorum_votes,0);
for(const change of [{issuer:'https://other.example.test'},{authorization_endpoint:'http://issuer.example.test/authorize'},{code_challenge_methods_supported:['plain']},{token_endpoint_auth_methods_supported:['client_secret_basic']},{response_types_supported:['token']}])assert.throws(()=>validateBumbleOAuthMetadata(profile,{...metadata,...change}));
for(const change of [{scopes:['admin']},{client_secret:'forbidden'},{redirect_uri:'http://localhost:54321/momm/oauth/callback'},{redirect_uri:'https://other.example.test/callback'}])assert.throws(()=>validateBumbleOAuthMetadata({...profile,...change},metadata));
const pending=()=>prepareBumblePKCE(contract,{now:1000,deadline:61000});
const callback=i=>profile.redirect_uri+'?'+new URLSearchParams({state:i.state,code:'synthetic-code',iss:profile.issuer});
const intent=pending(),url=new URL(intent.authorization_uri);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(!url.searchParams.has('code_verifier'));
const exchange=consumeBumbleOAuthCallback(intent,callback(intent),{now:2000});assert.equal(exchange.body.get('grant_type'),'authorization_code');assert.equal(url.searchParams.get('code_challenge'),crypto.createHash('sha256').update(exchange.body.get('code_verifier')).digest('base64url'));assert.throws(()=>consumeBumbleOAuthCallback(intent,callback(intent),{now:2001}));
const wrong=pending();assert.throws(()=>consumeBumbleOAuthCallback(wrong,callback(wrong).replace(wrong.state,'wrong-state'),{now:2000}));assert.doesNotThrow(()=>consumeBumbleOAuthCallback(wrong,callback(wrong),{now:2001}));
const late=pending();assert.throws(()=>consumeBumbleOAuthCallback(late,callback(late),{now:61000}));
const mixed=pending();assert.throws(()=>consumeBumbleOAuthCallback(mixed,callback(mixed).replace(encodeURIComponent(profile.issuer),encodeURIComponent('https://other.example.test')),{now:2000}));
const doubled=pending();assert.throws(()=>consumeBumbleOAuthCallback(doubled,callback(doubled)+'&state='+doubled.state,{now:2000}));
const denied=pending();assert.throws(()=>consumeBumbleOAuthCallback(denied,profile.redirect_uri+'?'+new URLSearchParams({state:denied.state,iss:profile.issuer,error:'access_denied',error_description:'never echo provider diagnostics'}),{now:2000}));assert.throws(()=>consumeBumbleOAuthCallback(denied,callback(denied),{now:2001}));
const opaque=crypto.randomBytes(32).toString('base64url'),token={access_token:opaque,token_type:'Bearer',expires_in:3600,scope:profile.scopes.join(' ')};
const good=validateBumbleOAuthTokenEnvelope(JSON.stringify(token),{contract,now:2000,minimum_lifetime_ms:300000});assert.equal(good.access_token.toString(),opaque);assert.equal(good.protected_storage_required,true);assert.equal(good.identity,'unverified');good.access_token.fill(0);
for(const change of [{token_type:'Basic'},{expires_in:0},{scope:'momm.infer admin'},{expires_in:1}])assert.throws(()=>validateBumbleOAuthTokenEnvelope(JSON.stringify({...token,...change}),{contract,now:2000,minimum_lifetime_ms:300000}));
assert.throws(()=>validateBumbleOAuthTokenEnvelope(JSON.stringify(token)+'}',{contract,now:2000}));
// Ownership and mutation controls, each paired with real valid operations above.
const ownershipChecks=[];function check(name,fn){try{fn();ownershipChecks.push({name,passed:true});}catch(e){ownershipChecks.push({name,passed:false,reason:e.message.slice(0,200)});}}
check('nested contract immutable',()=>assert(Object.isFrozen(contract.profile)&&Object.isFrozen(contract.profile.scopes)));
check('copied contract refused',()=>assert.throws(()=>prepareBumblePKCE(JSON.parse(JSON.stringify(contract)),{now:1000,deadline:61000})));
check('copied intent refused without burning owner flow',()=>{const owned=pending(),copied=JSON.parse(JSON.stringify(owned));assert.throws(()=>consumeBumbleOAuthCallback(copied,callback(owned),{now:2000}));assert.doesNotThrow(()=>consumeBumbleOAuthCallback(owned,callback(owned),{now:2001}));});
check('immutable descriptor without verifier',()=>{const owned=pending();assert(Object.isFrozen(owned));assert(!Object.hasOwn(owned,'verifier'));});
check('issuer-support mandatory for shared callback',()=>assert.throws(()=>validateBumbleOAuthMetadata(profile,{...metadata,authorization_response_iss_parameter_supported:false})));
check('missing issuer refused',()=>{const i=pending();assert.throws(()=>consumeBumbleOAuthCallback(i,profile.redirect_uri+'?'+new URLSearchParams({state:i.state,code:'synthetic-code'}),{now:2000}));});
check('success/error ambiguity refused',()=>{const i=pending();assert.throws(()=>consumeBumbleOAuthCallback(i,callback(i)+'&error=access_denied',{now:2000}));});
check('copied token contract refused',()=>assert.throws(()=>validateBumbleOAuthTokenEnvelope(JSON.stringify(token),{contract:JSON.parse(JSON.stringify(contract)),now:2000})));
check('invalid bearer grammar refused',()=>assert.throws(()=>validateBumbleOAuthTokenEnvelope(JSON.stringify({...token,access_token:'fixture:invalid:bearer'}),{contract,now:2000})));
console.log(JSON.stringify({ownershipChecks}));assert(ownershipChecks.every(c=>c.passed),'OAuth ownership/mutation controls failed');
console.log(JSON.stringify({passed:true,model_calls:0,network_calls:0,real_credentials_read:false,qualified:false,scope:'pure OAuth metadata/PKCE/callback/token-contract foundations; owner trust/browser/transport/protected storage still required'}));
