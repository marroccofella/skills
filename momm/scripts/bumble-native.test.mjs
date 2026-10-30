import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {runNativeBumbleStage,nativeBumbleReadiness} from './bumble-native.mjs';
import {ReviewerRegistry} from './reviewer-registry.mjs';import {privateTestFixture} from './private-test-fixture.mjs';
import vm from 'node:vm';
delete process.env.MOMM_EVIDENCE_HOME;
let touched=0;const options=new Proxy({},{get(){touched++;throw Error('Blocked native stage must not inspect credentials, transport or caller hooks.');}});
const result=await runNativeBumbleStage(options);
assert.equal(result.status,'policy_required');assert.equal(result.dispatched,0);assert.equal(result.quorum_votes,0);assert.equal(result.completion,false);assert.equal(touched,0);
assert.equal(nativeBumbleReadiness().credentials_read,false);
const dispatcher=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const persisted=dispatcher.indexOf('evidence.persisted = true'),native=dispatcher.indexOf('await runNativeBumbleStage(');
assert(persisted>=0&&native>persisted,'native stage must follow original-report persistence, not feed baseline reviewers');
if(process.argv[2]!=='gateFailure'){
const parent=privateTestFixture('momm-native-selection-');
try{
  const project=path.join(parent,'project'),settings=path.join(parent,'settings');fs.mkdirSync(project,{mode:0o700});
  fs.writeFileSync(path.join(project,'control.txt'),'const value = 1;\n',{mode:0o600});
  const registry=new ReviewerRegistry({root:settings,project});registry.command({op:'exclude_cli',route:'copilot',revision:0});
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./multi-review.mjs',import.meta.url)),'--governor','codex','--reviewers','codex','--min-success','1','--input','control.txt','--no-ui'],{cwd:project,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2_000_000,env:{...process.env,MOMM_REVIEWER_HOME:settings,NO_UPDATE_CHECK:'1',MOMM_NO_UPDATE_CHECK:'1',DO_NOT_TRACK:'1',MULTI_LLM_REVIEW_DEPTH:'0'}});
  assert.equal(child.status,3,'a governor-only synthetic run retains its failed-quorum exit');
  const report=JSON.parse(child.stdout);assert.equal(report.quorum.met,false);assert(report.reviewers.every(r=>r.status==='self_excluded'));
  assert.deepEqual(report.reviewer_selection,{applied:true,excluded:['copilot'],removed_from_selection:[],registry_revision:1},'saved baseline selection must survive in the report');
  assert.equal(report.bumble.status,'policy_required');assert.equal(report.bumble.dispatched,0);
  assert.equal(report.evidence.persisted,true);
  const saved=JSON.parse(fs.readFileSync(path.resolve(project,report.evidence.report_path),'utf8'));assert.deepEqual(saved.reviewer_selection,report.reviewer_selection,'original private evidence carries the same selection');
}finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-native-selection-'));fs.rmSync(parent,{recursive:true,force:true});}
}
if(process.argv[2]!=='selection'){
  const start=dispatcher.indexOf('  const bumble =',persisted),replacement=dispatcher.indexOf('  let bumble',persisted),begin=start>=0?start:replacement;
  const end=dispatcher.indexOf('  emitEvent(options.stream, {',begin);assert(begin>=0&&end>begin);
  for(const evidence of [{persisted:false},{persisted:true,error:'failed'},{persisted:true,report_sha256:'a'.repeat(64)}]){
    let calls=0,received=null;const baselineRun='rev_synthetic_native_context',projectRoot=path.resolve('synthetic-native-project');
    const context=vm.createContext({evidence,report:{input_sha256:'b'.repeat(64)},runId:baselineRun,process:{cwd:()=>projectRoot},runProcess(){throw Error('No subprocess');},runNativeBumbleStage:async options=>{calls++;received=options;throw Error('PRIVATE_PROVIDER_DIAGNOSTIC');}});
    const outcome=await vm.runInContext('(async()=>{'+dispatcher.slice(begin,end)+';return bumble;})()',context);
    assert.equal(calls,evidence.persisted&&!evidence.error?1:0);assert.equal(outcome.dispatched,calls?null:0);assert.equal(outcome.completion,false);
    if(calls){assert.equal(received.run_id,baselineRun,'native entry must receive the sealed baseline run ID');assert.equal(received.project_root,projectRoot,'native entry must receive its owning project');assert.equal(outcome.credentials_read,null);assert.equal(outcome.remote_outcome,'unknown');}
    assert.equal(outcome.status,calls?'supplementary_failed':'baseline_not_sealed');assert(!JSON.stringify(outcome).includes('PRIVATE_PROVIDER_DIAGNOSTIC'));
  }
}
console.log(JSON.stringify({passed:true,network_calls:0,credentials_read:false,scope:'native closed-policy gate and baseline-first dispatcher wiring; not live integration'}));
