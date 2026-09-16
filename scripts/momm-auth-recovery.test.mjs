import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../momm/scripts/multi-review.mjs',import.meta.url),'utf8');
const extract=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
const context=vm.createContext({});
vm.runInContext(extract('function extractJsonObjects(', '\nfunction clipped(')
 +extract('function clipped(', '\nfunction normalizeReview(')
 +extract('function classifyFailure(', '\nasync function invokeReviewer('),context);
const result={code:1,stdout:JSON.stringify({type:'result',is_error:true,result:'Failed to authenticate: OAuth session expired and could not be refreshed',session_id:'synthetic-private-marker'}),stderr:''};
context.input=result;
const failure=vm.runInContext('classifyFailure(input)',context);
assert.equal(failure.status,'authentication_required','Expired OAuth sessions need official browser-login guidance');
assert(!failure.detail.includes('synthetic-private-marker'),'Auth diagnostics must not echo the provider envelope');
for(const [text,status] of [['OAuth session refreshed successfully; unrelated failure','error'],['OAuth session expired; 503 service unavailable','provider_unavailable'],['Please sign in to continue','authentication_required']]){
 context.input={code:1,stdout:text,stderr:''};assert.equal(vm.runInContext('classifyFailure(input).status',context),status);
}
context.input={...result,timedOut:true};assert.equal(vm.runInContext('classifyFailure(input).status',context),'timeout');
console.log('Expired OAuth sessions receive safe browser-login guidance; outage and timeout precedence remain unchanged.');
