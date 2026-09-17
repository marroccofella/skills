// No generated images or provider calls: synthetic byte fixtures exercise
// inventory/preservation independently of visual correctness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadBaseline,effective} from '../momm/scripts/capabilities.mjs';
import {plan,run} from '../momm/scripts/modality.mjs';
const {privateTestFixture}=await import('./private-test-fixture.mjs');
process.umask(0o077);
const root=privateTestFixture('momm-media-preservation-');
const rows=[];
try {
 for(const outcome of ['complete','cancelled','timeout','exit_code']) {
  const cwd=path.join(root,outcome);fs.mkdirSync(cwd);
  const route=outcome==='cancelled'?'grok':'codex';
  const m=effective({baseline:loadBaseline(),machine:'synthetic',overlay:{entries:[],invalidated:[],stale:[]}});
  const p=plan(m,{input:['text'],output:['image']},{prompt:'Synthetic preservation control. No provider call.'});
  p.steps[0].chosen=route;
  const source=path.join(cwd,route==='grok'?'.grok/sessions/fixture/images/output.jpg':'.codex/generated_images/fixture/output.png');
  const bytes=Buffer.from('SYNTHETIC ARTEFACT INVENTORY FIXTURE '+outcome);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const value=await run(p,{consent:true,cwd,home:cwd,effective:m,exec:async()=>{
   fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,bytes);
   return {code:outcome==='exit_code'?1:0,timedOut:outcome==='timeout',stdout:route==='grok'?JSON.stringify({text:'Interrupted',stopReason:'cancelled'}):'Synthetic output written',stderr:''};
  }});
  const files=value.report.steps[0].files;
  const stateOkay=outcome==='complete'?value.report.status==='complete':value.report.status==='failed'&&value.report.failure===outcome;
  const retained=files.length===1&&files[0].sha256===hash&&fs.readFileSync(path.join(cwd,files[0].path)).equals(bytes)&&fs.readFileSync(source).equals(bytes);
  rows.push({outcome,passed:stateOkay&&retained});
 }
 console.log(JSON.stringify({passed:rows.every(r=>r.passed),rows},null,2));
 assert(rows.every(r=>r.passed),'Failed media output must remain inventoried without turning failure into success');
} finally {
 assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
 fs.rmSync(root,{recursive:true,force:true});
}
