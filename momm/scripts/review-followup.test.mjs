// Governor-authored regression controls. Synthetic data only; no provider calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as score from './scorecard.mjs';
import { recordCheck } from './checks.mjs';
import { digest } from './governor.mjs';
import { privateTestFixture } from './private-test-fixture.mjs';
import { preparePrivateEvidence } from './evidence-permissions.mjs';
if (process.platform !== 'win32') process.umask(0o077); // fixture files must be owner-only: the evidence gate inspects their modes on POSIX
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] ?? 'all';
const source = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const tests = {};
tests.quorum = () => {
  const code = source('momm/scripts/multi-review.mjs');
  const build = vm.runInNewContext(code.slice(code.indexOf('function buildOutstanding('), code.indexOf('function buildInsights(')) + ';buildOutstanding', {fs, path, process});
  const rows = ['claude', 'grok'].map(agent => ({agent, status:'success'}));
  const failed = build([], rows, 'rev_synthetic', root, 2, null, {met:false, required:2, achieved:1});
  assert.equal(failed.review_quorum_met, false, 'merged route successes do not satisfy every split piece');
  assert.equal(failed.review_phase_complete, false);
  assert(failed.required_next_actions.some(x => /quorum not met/i.test(x)));
  assert.equal(build([], rows, 'rev_synthetic', root, 2, null, {met:true}).review_quorum_met, true);
};
tests.stdin = async () => {
  const code = source('momm/scripts/multi-review.mjs');
  const stream = new PassThrough();
  const read = vm.runInNewContext(code.slice(code.indexOf('async function readAllStdin('), code.indexOf('async function collectArtifact(')) + ';readAllStdin', {process:{stdin:stream}, Buffer, setTimeout, clearTimeout});
  let timer;
  try {
    await assert.rejects(Promise.race([read(25), new Promise((_, reject) => {timer=setTimeout(()=>reject(Error('test guard: stdin did not settle')), 1000);})]), /stdin.*deadline|stdin.*timed out/i);
  } finally {clearTimeout(timer); stream.destroy();}
};
tests.cap = async () => {
  const dir = privateTestFixture('momm-check-cap-');
  try {
    preparePrivateEvidence(path.join(dir,'.ensemble_reviews'));
    fs.mkdirSync(path.join(dir,'.ensemble_reviews/reports'));
    const files=[];
    for(let i=0;i<201;i++){const name=`f${i}.mjs`, body='export default 1;\n';fs.writeFileSync(path.join(dir,name),body);files.push({path:name,sha256:digest(body)});}
    fs.writeFileSync(path.join(dir,'test.mjs'),'console.log("synthetic check");');
    fs.writeFileSync(path.join(dir,'.ensemble_reviews/reports/rev_cap.json'),JSON.stringify({run_id:'rev_cap',input_sha256:'a'.repeat(64),source_snapshot:{complete:true,kind:'git_range',files}}));
    const result=await recordCheck(dir,{runId:'rev_cap',test:'test.mjs'});
    assert.equal(result.exit_code,0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,result.path))).artifacts.length,201);
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});}
};
tests.scrub = () => {
  const original=os.homedir;
  try {os.homedir=()=>'/';assert.equal(score.scrub('src/a.mjs and 6 / 2'),'src/a.mjs and 6 / 2');}
  finally {os.homedir=original;}
};
tests.calibration = () => {
  assert.equal(score.scoreOf({acceptance_rate:1,valid_rate:1,unique_share:0,severity_inflation:null,ruled:8}).score,null,'unknown calibration must not receive full credit');
};
function evidenceFixture(fn){
  const dir=privateTestFixture('momm-score-followup-');
  try {
    const er=path.join(dir,'.ensemble_reviews');preparePrivateEvidence(er);fs.mkdirSync(path.join(er,'reports'));
    const report={run_id:'rev_fixture',governor:'codex',quorum:{met:true},reviewers:[{agent:'Claude',status:'success'}],findings:[{id:'f',severity:'WARNING',sources:['claude'],issue:'synthetic'}],attempt_evidence:[{route:'claude',outcome:'succeeded',usage:{reported:{total_tokens:10,cost_usd:0.1}}}]};
    fs.writeFileSync(path.join(er,'reports/rev_fixture.json'),JSON.stringify(report));
    fs.writeFileSync(path.join(er,'dispositions.jsonl'),['deferred','applied'].map(disposition=>JSON.stringify({run_id:'rev_fixture',finding_id:'f',reviewer:'claude',disposition,reason:'synthetic'})).join('\n')+'\n');
    return fn(dir,er);
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});}
}
tests.training = () => evidenceFixture(dir=>{
  const rows=score.trainingRecords(dir);assert.equal(rows.length,1,'export only the latest ruling');assert.equal(rows[0].label,'applied');
});
tests.casing = () => evidenceFixture(dir=>assert.equal(score.buildScorecard(dir).reviewers.find(r=>r.reviewer==='claude').tokens,10));
tests.footer = () => evidenceFixture(dir=>assert.match(score.renderHtml(score.buildScorecard(dir)).split('<blockquote>')[1],/40% acceptance/));
tests.readme = () => evidenceFixture(dir=>{
  const out=path.join(dir,'samples.jsonl');fs.writeFileSync(out+'.README.md','owner text');
  const r=spawnSync(process.execPath,[path.join(root,'momm/scripts/scorecard.mjs'),'--dir',dir,'--export-training',out],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(r.status,1,'existing companion needs explicit force too');assert.equal(fs.readFileSync(out+'.README.md','utf8'),'owner text');assert.equal(fs.existsSync(out),false,'refuse before creating either output');
});
tests.permissions = () => {
  const code=source('momm/scripts/scorecard.mjs');
  let wrote=false;
  const fake={...fs,mkdirSync(){},existsSync(){return true;},lstatSync(){return {isSymbolicLink:()=>false,isFile:()=>true,isDirectory:()=>true,nlink:1,mode:0o100644};},writeFileSync(){wrote=true;}};
  const start=code.indexOf('function prepareWrite(')>=0?code.indexOf('function prepareWrite('):code.indexOf('function writePrivate(');
  const write=vm.runInNewContext(code.slice(start,code.indexOf('function entrypoint('))+';writePrivate',{fs:fake,path,process:{platform:'linux'}});
  assert.throws(()=>write('/synthetic/export.jsonl','private',true),/permissions|owner-only/i);
  assert.equal(wrote,false,'do not expose data before refusing a broad existing file');
};
tests.hygiene = () => {
  const code=source('scripts/source-hygiene.test.mjs').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../../scripts/source-hygiene.test.mjs',import.meta.url).href));
  const processStub={exitCode:0};let report;
  vm.runInNewContext(code,{fs:{readFileSync(){throw Object.assign(Error('synthetic unreadable'),{code:'EACCES'});}},path,assert,fileURLToPath,resolveGit:()=>'/synthetic/git',process:processStub,console:{log(text){report=JSON.parse(text);}},spawnSync(_cmd,args){return {status:0,stdout:args[0]==='ls-files'?Array.from({length:60},(_,i)=>`f${i}.mjs`).join('\0'):'',stderr:''};}});
  assert.equal(report.results.find(x=>/raw control byte/.test(x.name)).passed,false,'unreadable source is not clean source');
};
const failures=[];
for(const [name,fn] of Object.entries(tests))if(mode==='all'||mode===name){try{await fn();console.log(`PASS ${name}`);}catch(e){failures.push(name);console.error(`FAIL ${name}: ${e.message}`);}}
assert(mode==='all'||Object.hasOwn(tests,mode),'unknown test case');
if(failures.length)process.exitCode=1;
