import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {summary,managedBody,intact,publish,observe} from './momm-release-observer.mjs';
const tag='momm-1.16.0', commit='a'.repeat(40), checker='b'.repeat(40);
const text=summary({tag,commit,checker,manifestVersion:'1.16.0',assets:2}), body=managedBody(tag,text);
assert(intact(body));assert(!intact(body+'Human change'));
assert(!text.includes('READY'));assert(text.includes('Not a review verdict'));
assert(!summary({tag,commit,checker,manifestVersion:'1.16.0',assets:0}).includes('Needs investigation'),'signed Git-tag distribution needs no uploaded assets');
assert.throws(()=>summary({tag:'../../x',commit,checker}));
const bot={login:'github-actions[bot]',type:'Bot'};
let writes=[];
function apiWith(issues){return async(method,url,data)=>{
  if(method==='GET')return issues; writes.push({method,url,data});return {};
};}
assert.equal(await publish(apiWith([]),tag,text),'created');assert.equal(writes.length,1);
writes=[];
const issue={number:22,user:bot,state:'open',body};
assert.equal(await publish(apiWith([issue]),tag,text),'unchanged');assert.equal(writes.length,0);
assert.equal(await publish(apiWith([{...issue,state:'closed'}]),tag,text+'new'),'closed: skipped (no issue update)');
assert.equal(writes.length,0);
await assert.rejects(publish(apiWith([{...issue,body:body+'edited'}]),tag,text),/refusing to overwrite/);
await assert.rejects(publish(apiWith([{...issue,body:body.replaceAll('\n','\r\n')}]),tag,text),/refusing to overwrite/);
assert.equal(writes.length,0,'CRLF editing must not create a duplicate issue');
await publish(apiWith([issue]),tag,text+'changed');assert.equal(writes[0].method,'PATCH');
writes=[];
await publish(apiWith([{...issue,user:{login:'other',type:'User'}}]),tag,text);assert.equal(writes[0].method,'POST');
await assert.rejects(publish(apiWith(Array.from({length:100},()=>({body:'unrelated'}))),tag,text),/scan limit/);
let calls=[];
const fixture=async(method,url,data)=>{
  calls.push({method,url,data});
  if(url.endsWith('releases?per_page=100'))return [{tag_name:tag,assets:[{name:'secret-looking text never rendered'}]}];
  if(url.includes('/commits/'))return {sha:commit};
  if(url.includes('/contents/'))return {encoding:'base64',size:20,content:Buffer.from('{"momm":"1.16.0"}').toString('base64')};
  if(method==='GET')return [];return {};
};
assert.equal(await observe(fixture,{checker}),'created');
const posted=calls.find(c=>c.method==='POST').data.body;
assert(!posted.includes('secret-looking'));assert(posted.includes(commit));
calls=[];
await assert.rejects(observe(async(method,url,data)=>{
  if(url.includes('/contents/')){const e=Error('quota');e.status=403;throw e;}
  return fixture(method,url,data);
},{checker}),/quota/);
assert(!calls.some(c=>c.method==='POST'));
assert.equal(await observe(async()=>[{tag_name:'other-1.2.3'}],{checker}),'no stable MOMM release in bounded catalogue');
// Import boundaries: host arguments cannot narrow tests; a seeded failure must reject.
const suite=new URL('./momm-improvement-regressions.test.mjs',import.meta.url);
const importCheck=spawnSync(process.execPath,['--input-type=module','-e',`process.argv[2]='unrelated-host-argument';await import(${JSON.stringify(suite.href)});`],{encoding:'utf8',windowsHide:true});
assert.equal(importCheck.status,0,importCheck.stderr);assert(importCheck.stdout.includes('PASS pinned-ideas'));
let seeded=fs.readFileSync(suite,'utf8');
assert(seeded.includes("'nav-shape':()=>{"));
seeded=seeded.replace("'nav-shape':()=>{","'nav-shape':()=>{ throw Error('SEEDED_CASE_FAILURE');").replaceAll('import.meta.url',JSON.stringify(suite.href));
seeded=seeded.replace(/from '(\.\/[^']+)'/g,(_m,p)=>`from ${JSON.stringify(new URL(p,suite).href)}`);
const failCheck=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify('data:text/javascript;base64,'+Buffer.from(seeded).toString('base64'))});process.exitCode=0;console.log('FAILURE_WAS_MASKED');`],{encoding:'utf8',windowsHide:true});
assert.notEqual(failCheck.status,0);assert(!failCheck.stdout.includes('FAILURE_WAS_MASKED'));
const cwdCheck=spawnSync(process.execPath,[fileURLToPath(suite),'missing-token'],{cwd:new URL('../docs/',import.meta.url),encoding:'utf8',windowsHide:true});
assert.equal(cwdCheck.status,0,cwdCheck.stdout+cwdCheck.stderr);
console.log('Observer tests: identities, privacy, idempotency, closed issues, human edits, bounded scans, failure handling pass.');
