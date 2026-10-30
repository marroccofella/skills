// Governor-authored probes for rev_20261009234202_a22c43776260; zero model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {makeBumbleTask,validateBumbleResponse as validateResponse,retainCandidates} from './bumble-contract.mjs';
import {BumbleFixtureLedger} from './bumble-fixtures.mjs';
import {qualificationBinding,fixtureFrameBinding} from './bumble-qualification.mjs';
import {qualifyBumbleWithLedger,qualificationStatusWithLedger} from './bumble-qualification-ledger.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
// Explicit completion of synthetic fixture bodies, never a production fallback.
const validateBumbleResponse=(task,bytes,options)=>validateResponse(task,bytes,{transport:'success',finished:true,...options});
const H=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const task=()=>makeBumbleTask({run_id:'r',piece_id:'p',source:'const total = price * count;',scope:[{file:'a.js',start_line:1,text:'const total = price * count;'}],check:'Check multiplication',deadline:1000,budget:{response_bytes:4096,candidates:2}});
const c=(quote,location='1')=>({file:'a.js',location,quote,hypothesis:'Hypothesis',trigger:'Boundary',missing_information:[]});
const reply=(t,candidates)=>JSON.stringify({task_id:t.task_id,result:'candidate',candidates,limitations:[]});
const cases={
  location(){const t=task();for(const location of ['1.0','1e0','0x1','+1',' 1','01'])assert.equal(validateBumbleResponse(t,reply(t,[c(t.source,location)]),{now:1}).payload,'invalid_schema',location);assert.equal(retainCandidates(t,[c(t.source),c(t.source)]).length,1);},
  inline(){const t=task();assert.equal(validateBumbleResponse(t,reply(t,[c('price * count')]),{now:1}).payload,'valid');const multiline=makeBumbleTask({run_id:'r',piece_id:'p',source:'alpha\nbeta\ngamma',scope:[{file:'a.js',start_line:1,text:'alpha\nbeta\ngamma'}],check:'Check span',deadline:1000,budget:{response_bytes:4096,candidates:2}});assert.equal(validateBumbleResponse(multiline,reply(multiline,[c('beta','1')]),{now:1}).payload,'invalid_schema','quote cannot silently start on another line');assert.equal(validateBumbleResponse(multiline,reply(multiline,[c('pha\nbeta')]),{now:1}).payload,'valid','midline multiline quote must keep its exact span');},
  async freshness(){
    const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-bound-review-test-'));
    try{
      const frame=[{id:'d',kind:'defect',sha256:H('d'),split:'qualification'},{id:'c',kind:'control',sha256:H('c'),split:'qualification'}];
      const identity={worker_id:'w',connector_id:'c',endpoint_id:'e',adapter_sha256:H('a'),model_lineage_sha256:H('m'),task_type:'t',role_version:'1',role_sha256:H('r'),schema_sha256:H('s'),fixture_suite_sha256:fixtureFrameBinding(frame),config_epoch:'1',credential_epoch:'1',trust_sha256:H('trust')};
      const policy={schema:'momm-bumble-qualification-policy/1',policy_id:'p',task_type:'t',required_defects:1,required_controls:1,max_missed_defects:0,max_false_candidates:0,lifetime_ms:100,max_observations:2};
      const scope_binding=H('scope'),ledger=new BumbleFixtureLedger({root:path.join(parent,'private'),frame,scope_binding,budget:{max_total_attempts:2,max_transmissions:2,deadline:1000}}),observations=[];
      for(let n=0;n<2;n++){const f=frame[n],a=ledger.reserve(f.id,{purpose:'qualification',binding:qualificationBinding(identity),now:1+n*3});ledger.markTransmissionPossible(a.attempt_id,2+n*3);ledger.finish(a.attempt_id,{outcome:'success',now:3+n*3});observations.push({fixture_id:f.id,fixture_sha256:f.sha256,attempt_id:a.attempt_id,identity_binding:qualificationBinding(identity),transport:'success',payload:'valid',result:f.kind==='defect'?'candidate':'no_candidate_in_supplied_scope',governor_assessment:f.kind==='defect'?'reproduced_candidate':'scoped_negative_verified',evidence_sha256:H(f.id+'-e'),observed_at:10});}
      const params={identity,policy,frame,observations,now:10};
      const stale=qualifyBumbleWithLedger({...params,now:1000000,observations:observations.map(o=>({...o,observed_at:1000000}))},{ledger,scope_binding});
      assert.notEqual(stale.qualification.status,'qualified','later adjudication cannot refresh old transmitted evidence');
      const fresh=qualifyBumbleWithLedger(params,{ledger,scope_binding});assert.equal(fresh.qualification.expires_at,103,'expiry starts at earliest original terminal time, not adjudication');
      assert.equal(fresh.qualification.evidence[0].observed_at,10,'original adjudication time remains visible');
      assert.equal(qualificationStatusWithLedger(fresh,{ledger,scope_binding,identity,policy,now:103}).eligible,false);
    }finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-bound-review-test-'));fs.rmSync(parent,{recursive:true,force:true});}
  },
  async ancestor(){
    const parent=fs.mkdtempSync(path.join(os.tmpdir(),'momm-bound-review-test-'));
    try{const project=path.join(parent,'project'),src=path.join(project,'src'),link=path.join(parent,'link');fs.mkdirSync(src,{recursive:true});fs.symlinkSync(src,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>new BumbleFixtureLedger({root:path.join(link,'private'),project_root:project,scope_binding:H('scope'),frame:[{id:'d',kind:'defect',sha256:H('d'),split:'qualification'}],budget:{max_total_attempts:1,max_transmissions:1,deadline:1000}}));assert(!fs.existsSync(path.join(src,'private')),'a refused linked-parent store must not create anything inside source');}
    finally{assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-bound-review-test-'));fs.rmSync(parent,{recursive:true,force:true});}
  }
};
const selected=process.argv[2];if(selected){assert(cases[selected]);await cases[selected]();}else for(const test of Object.values(cases))await test();
console.log(JSON.stringify({passed:true,case:selected||'all',network_calls:0,scope:'source-bound material-claim reproductions'}));
