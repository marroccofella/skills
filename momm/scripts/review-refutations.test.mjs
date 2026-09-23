// Governor-authored probes: exercise disputed boundaries, not peer-proposed commands.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {privateTestFixture} from './private-test-fixture.mjs';
import {preparePrivateEvidence} from './evidence-permissions.mjs';
import {digest,inspectCompletion} from './governor.mjs';
import {attemptRecord,persistAttempt} from './attempts.mjs';
import {auditAttempts} from './attempt-audit.mjs';
import {readMedia} from './media-bytes.mjs';
import {fixturePng} from './media-fixtures.mjs';
if (process.platform !== 'win32') process.umask(0o077); // fixture files must be owner-only: the evidence gate inspects their modes on POSIX
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>fs.readFileSync(path.join(repo,name),'utf8');
const root=privateTestFixture('momm-review-refutations-');
const write=(name,value)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
const extract=(source,first,last)=>{const a=source.indexOf(first),b=source.indexOf(last,a);assert(a>=0&&b>a);return source.slice(a,b);};
try {
  // Configuration requests twelve matrix combinations and a distinct pinned Windows version.
  const workflow=read('.github/workflows/self-test.yml');
  assert.match(workflow,/os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(workflow,/node-version: \[18.x, 20.x, 22.x, 24.x\]/);
  assert.match(workflow,/include:\s+- os: windows-latest\s+node-version: '24\.15\.0'/);
  assert.match(read('CONTRIBUTING.md'),/test-catalog-1\.16\.1\.md/);
  assert.match(read('momm/references/plan-1.16.1.md'),/13 cells/);
  assert.match(read('momm/scripts/review-workflow.test.mjs'),/test-catalog-1\.16\.1\.md/);
  assert(fs.existsSync(path.join(repo,'momm/scripts/installations.mjs')));
  assert.notDeepEqual(fixturePng('one'),fixturePng('two'));
  write('source.png',fixturePng('one'));
  assert(Buffer.isBuffer(readMedia(path.join(root,'source.png')).buffer));
  assert.equal(digest(readMedia(path.join(root,'source.png')).buffer),digest(fs.readFileSync(path.join(root,'source.png'))));
  // A staging collision is a refusal, not permission to overwrite another file.
  const stage=vm.runInNewContext(extract(read('momm/scripts/modality.mjs'),'function stageCopy(','// ---- runner')+';stageCopy',{
    fs,path,process,randomBytes,readMedia,sha256:digest,hashFile:p=>digest(fs.readFileSync(p)),fail:(message,code)=>Object.assign(new Error(message),{code})
  });
  const dir=path.join(root,'stage');fs.mkdirSync(dir);
  // Until 1.16.1 the temporary name was the target plus the pid, so a temp left behind by an earlier
  // crashed stage made every later stage of that artefact fail with EEXIST. That refusal was asserted
  // here as if it were the contract. The name now carries a per-call nonce, so a leftover is inert.
  const stale=path.join(dir,`01-source.png.${process.pid}.tmp`);fs.writeFileSync(stale,'left behind by an earlier run');
  assert.equal(stage(path.join(root,'source.png'),dir,0).sha256,digest(fixturePng('one')),'a stale temporary file does not block staging');
  assert.equal(fs.readFileSync(stale,'utf8'),'left behind by an earlier run','staging does not touch a file it did not create');
  fs.unlinkSync(stale);
  // A stage that fails part way removes its own temporary file rather than leaving the bytes behind.
  const blocked=path.join(dir,'01-source.png');fs.rmSync(blocked,{force:true});fs.mkdirSync(blocked);
  assert.throws(()=>stage(path.join(root,'source.png'),dir,0));
  assert.deepEqual(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')),[],'a failed stage leaves no staged bytes behind');
  fs.rmSync(blocked,{recursive:true,force:true});
  assert.equal(stage(path.join(root,'source.png'),dir,0).sha256,digest(fixturePng('one')));
  const cycle=path.join(root,'cycle');fs.mkdirSync(cycle);
  fs.symlinkSync(cycle,path.join(cycle,'alias'),process.platform==='win32'?'junction':'dir');
  fs.rmSync(cycle,{recursive:true,force:true});assert(fs.existsSync(path.join(root,'source.png')));
  // Evidence persistence is a prerequisite: failure must not produce a successful run.
  const retry=vm.runInNewContext(extract(read('momm/scripts/multi-review.mjs'),'const PROVIDER_RETRY_DELAY_MS','function createUi(')+';invokeWithRetry',{setTimeout});
  let calls=0;
  await assert.rejects(retry(async()=>{calls++;return {agent:'claude',status:'success'};},'claude','fixture',{onAttemptStart(){throw Error('start persistence refused');}},null),/start persistence/);
  assert.equal(calls,0);
  await assert.rejects(retry(async()=>{calls++;return {agent:'claude',status:'success'};},'claude','fixture',{onAttempt(){throw Error('terminal persistence refused');}},null),/terminal persistence/);
  assert.equal(calls,1);
  preparePrivateEvidence(path.join(root,'.ensemble_reviews'));
  write('source.mjs','export const value=1;\n');
  const input=digest('same synthetic input');
  const seal=(id,change=()=>{})=>{
    const row=attemptRecord({agent:'claude',status:'success'},{runId:id,inputHash:input,pieceHash:input,ordinal:1,durationMs:1,startedAt:new Date().toISOString()});
    const report={run_id:id,input_sha256:input,governor:'codex',findings:[],source_snapshot:{complete:true,files:[{path:'source.mjs',sha256:digest(fs.readFileSync(path.join(root,'source.mjs')))}]},gate_policy:{quorum_required:1,strict:false,requested_routes:['claude']},reviewers:[{agent:'claude',status:'success',review_contract:'momm-peer-review/2',reviewed_scope:[{quote:'same',assessment:'fixture'}]}],attempt_evidence:[row]};
    change(report,row);row.evidence=persistAttempt(root,row);
    const name=`.ensemble_reviews/reports/${id}.json`;write(name,report);
    fs.appendFileSync(path.join(root,'.ensemble_reviews/review-log.jsonl'),JSON.stringify({run_id:id,input_sha256:input,report_path:name,report_sha256:digest(fs.readFileSync(path.join(root,name)))})+'\n');
  };
  seal('rev_refutation_base');
  seal('rev_refutation_no_split',(_r,row)=>{row.piece='piece-01';});
  seal('rev_refutation_bad_split',(r,row)=>{row.piece='piece-01';r.split={};});
  for(const id of ['rev_refutation_no_split','rev_refutation_bad_split']){
    let state;assert.doesNotThrow(()=>{state=inspectCompletion(root,id);});
    assert.equal(state.complete,false);assert(state.errors.length>0);
  }
  assert(inspectCompletion(root,'rev_refutation_no_split').errors.some(x=>/unknown piece/.test(x)));
  const changes={policy:r=>{r.gate_policy.quorum_required=2;},governor:r=>{r.governor='grok';},attachments:r=>{r.attachments=[{sha256:digest('different attachment')}];},source:r=>{r.source_snapshot.files[0].sha256=digest('different source');}};
  for(const [name,change] of Object.entries(changes)){
    const id=`rev_refutation_${name}`;seal(id,change);
    assert.throws(()=>auditAttempts(root,['rev_refutation_base',id]),/different source/);
  }
  console.log('PASS: 13 configured cells, catalog link, fixture identity, exclusive staging, link cleanup, evidence failure, malformed split refusal, independent policy/governor/source/attachment bindings');
} finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
