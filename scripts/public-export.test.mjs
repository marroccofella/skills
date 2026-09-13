// Synthetic export fixtures only. No private ledgers or network services.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'momm-public-export-')),results=[];
function test(name,fn){try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
function fixture(name){const dir=path.join(temp,name);fs.mkdirSync(path.join(dir,'docs/evidence'),{recursive:true});fs.cpSync(path.join(root,'momm/references'),path.join(dir,'momm/references'),{recursive:true});fs.copyFileSync(path.join(root,'versions.json'),path.join(dir,'versions.json'));
 fs.mkdirSync(path.join(dir,'docs/momm'),{recursive:true});fs.copyFileSync(path.join(root,'docs/momm/tour.json'),path.join(dir,'docs/momm/tour.json'));
 fs.writeFileSync(path.join(dir,'docs/index.html'),'<html><span data-momm-version>fixture</span></html>');
 fs.writeFileSync(path.join(dir,'docs/evidence/index.html'),'<html><script id="data" type="application/json">{}</script></html>');fs.writeFileSync(path.join(dir,'docs/evidence/momm-evidence.json'),'original public bytes');return dir;}
function input(dir,name,rows,report){const er=path.join(dir,name);fs.mkdirSync(path.join(er,'reports'),{recursive:true});fs.writeFileSync(path.join(er,'review-log.jsonl'),rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n');if(report)fs.writeFileSync(path.join(er,'reports/rev_fixture.json'),JSON.stringify(report));return er;}
const run=(dir,from)=>spawnSync(process.execPath,[path.join(root,'export-public-evidence.mjs'),...from.flatMap(er=>['--from',er,'--label','synthetic fixture'])],{cwd:dir,encoding:'utf8',timeout:20000,windowsHide:true});
try{
 test('overlapping imports count identical raw decisions once',()=>{
   const dir=fixture('overlap-decisions'),a=input(dir,'a',[{run_id:'rev_fixture'}]),b=input(dir,'b',[{run_id:'rev_fixture'}]);
   const d={run_id:'rev_fixture',timestamp:'2026-01-01',reviewer:'claude',suggestion:'Check input',disposition:'rejected',reason:'Reproduced as safe'};
   fs.writeFileSync(path.join(a,'dispositions.jsonl'),JSON.stringify(d)+'\n');
   fs.writeFileSync(path.join(b,'dispositions.jsonl'),JSON.stringify(Object.fromEntries(Object.entries(d).reverse()))+'\n'+JSON.stringify({...d,timestamp:'2026-01-02',reason:'A distinct later decision'})+'\n');
   const r=run(dir,[a,b]);assert.equal(r.status,0,r.stderr);
   const data=JSON.parse(fs.readFileSync(path.join(dir,'docs/evidence/momm-evidence.json')));
   assert.equal(data.dispositions.length,2);assert.equal(data.import_diagnostics.identical_dispositions,1);
 });
 test('published CSV column names remain compatible',()=>{
   const dir=fixture('csv-compat'),er=input(dir,'er',[{run_id:'rev_fixture',reviewer_status:{claude:'success'},findings_count:2,corroborated_count:1}],{reviewers:[{agent:'claude',status:'success',verdict:'ACCEPT',confidence:0.8,duration_ms:1000}],findings:[]});
   const r=run(dir,[er]);assert.equal(r.status,0,r.stderr);
   const routes=fs.readFileSync(path.join(dir,'docs/momm/data/routes.csv'),'utf8').split('\n');
   assert.equal(routes[0].split(',').slice(0,13).join(','),'route,completed_reviews,timeouts,other_failures,median_seconds,p90_seconds,accept_verdicts,modify_verdicts,reject_verdicts,mean_confidence,suggestions_applied,suggestions_rejected,governor_acceptance_rate');
   assert.deepEqual(routes.find(x=>x.startsWith('claude,')).split(',').slice(1,10),['1','0','0','1','1','1','0','0','0.8']);
   const runs=fs.readFileSync(path.join(dir,'docs/momm/data/runs.csv'),'utf8');
   assert.equal(runs.split('\n')[0],'run_id,timestamp,governor,input_bytes,findings,corroborated,reviewer_status,subject');
   assert.match(runs,/,2,1,claude:success,/);
 });
 test('validation failure does not modify existing public artifacts',()=>{const dir=fixture('invalid-count'),er=input(dir,'er',[{run_id:'rev_fixture',reviewer_status:{}}],{input_bytes:10,reviewers:[{agent:'claude',status:'success'}]});const file=path.join(dir,'docs/evidence/momm-evidence.json'),html=path.join(dir,'docs/evidence/index.html'),before=fs.readFileSync(file),oldHtml=fs.readFileSync(html);const r=run(dir,[er]);assert.notEqual(r.status,0);assert.match(r.stderr,/Stored successes exceed/);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(html),oldHtml);});
 test('legacy sparse report renders without inventing zero-second success',()=>{const dir=fixture('sparse'),er=input(dir,'er',[{run_id:'rev_fixture',reviewer_status:{}}],{input_bytes:10});const r=run(dir,[er]);assert.equal(r.status,0,r.stderr);assert.match(fs.readFileSync(path.join(dir,'docs/momm/data/input-size-vs-time.csv'),'utf8'),/0,0,0,\n/);});
 test('duplicate rows ignore object key order, not differing values',()=>{const dir=fixture('duplicate'),a=input(dir,'a',[{run_id:'rev_fixture',timestamp:'2026-01-01'}]),b=input(dir,'b',[{timestamp:'2026-01-01',run_id:'rev_fixture'}]);const r=run(dir,[a,b]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).import_diagnostics.identical_duplicates,1);input(dir,'b',[{timestamp:'2026-02-01',run_id:'rev_fixture'}]);const file=path.join(dir,'docs/evidence/momm-evidence.json'),before=fs.readFileSync(file);const bad=run(dir,[a,b]);assert.notEqual(bad.status,0);assert.match(bad.stderr,/Conflicting duplicate/);assert.deepEqual(fs.readFileSync(file),before);});
 test('malformed imports fail before output writes',()=>{const dir=fixture('malformed'),er=input(dir,'er',['{bad']);const file=path.join(dir,'docs/evidence/momm-evidence.json'),before=fs.readFileSync(file);const r=run(dir,[er]);assert.notEqual(r.status,0);assert.match(r.stderr,/Malformed/);assert.deepEqual(fs.readFileSync(file),before);});
 test('preview accepts an aliased docs root but not outside files',()=>{
   const dir=path.join(temp,'alias-preview'),real=path.join(temp,'real-docs'),outside=path.join(temp,'outside');fs.mkdirSync(dir);fs.mkdirSync(real);fs.mkdirSync(outside);fs.writeFileSync(path.join(real,'index.html'),'inside');fs.writeFileSync(path.join(outside,'index.html'),'outside');
   fs.symlinkSync(real,path.join(dir,'docs'),process.platform==='win32'?'junction':'dir');fs.symlinkSync(outside,path.join(real,'escape'),process.platform==='win32'?'junction':'dir');
   const source=fs.readFileSync(path.join(root,'scripts/preview-momm-site.mjs'),'utf8').replace(/^#![^\n]*\n/,'').replace(/^import .+;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify('fixture'));let handler;
   vm.runInNewContext(source,{http:{createServer(fn){handler=fn;return {listen(){}};}},fs,path,fileURLToPath:()=>path.join(dir,'scripts/preview-momm-site.mjs'),process:{argv:['node','fixture','8849'],stdout:{write(){}}},URL},{timeout:2000});
   const status=url=>{let code;handler({method:'HEAD',url},{writeHead(c){code=c;},end(){}});return code;};assert.equal(status('/index.html'),200);assert.equal(status('/escape/index.html'),404);
 });
 console.log(JSON.stringify({passed:results.every(r=>r.passed),tests:results},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
}finally{assert(path.basename(temp).startsWith('momm-public-export-'));assert.equal(fs.realpathSync(path.dirname(temp)),fs.realpathSync(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});}
