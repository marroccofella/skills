// Synthetic replies only: cancellation is a terminal fact, stderr warnings
// are not proof that billing/quota caused it. No real generation or providers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isolateReply,runModalityProbes} from '../momm/scripts/probes.mjs';
import * as modality from '../momm/scripts/modality.mjs';
import {loadBaseline,effective} from '../momm/scripts/capabilities.mjs';

const {privateTestFixture}=await import('./private-test-fixture.mjs');
process.umask(0o077);
const root=privateTestFixture('momm-cancel-regression-');
const results=[];
try {
  for (const [name, stdout] of [
    ['bare terminal cancellation without text', JSON.stringify({stopReason:'cancelled'})],
    ['terminal cancellation without text overrides earlier answer', JSON.stringify({text:'Earlier answer',stopReason:'end_turn'})+'\n'+JSON.stringify({stopReason:'cancelled'})],
  ]) {
    const isolated=isolateReply('grok',{code:0,stdout,stderr:''},'Synthetic terminal-envelope check');
    results.push({name,passed:isolated.isolated===false&&isolated.terminal_status==='cancelled'});
  }
  for(const cancelled of [true,false]) {
    const reply={code:0,stdout:JSON.stringify({text:'Red',stopReason:cancelled?'cancelled':'end_turn'}),stderr:'auxiliary HTTP 429 RESOURCE_EXHAUSTED; auxiliary HTTP 402'};
    const isolated=isolateReply('grok',reply,'Describe the image');
    results.push({name:cancelled?'cancelled reply refused':'successful reply survives auxiliary warnings',passed:isolated.isolated===!cancelled});
    const registry={
      effective:()=>({routes:{grok:{input:{image:{level:'documented'}},output:{}}}}),
      writeOverlayEntry:()=>{},
    };
    const report=await runModalityProbes('grok',{registry,command:'grok',tmpdir:root,home:root,colour:'red',exec:async(_command,args)=>args[0]==='--version'?{code:0,stdout:'1.0.0',stderr:''}:reply});
    const image=report.cells.find(c=>c.modality==='image');
    results.push({name:cancelled?'cancelled input not certified':'end-turn input verified despite warnings',passed:image.status===(cancelled?'probe_failed':'verified')});
    if(cancelled)results.push({name:'safe cancellation explanation',passed:/cancelled/.test(image.reason)&&!image.reason.includes('quota')});
  }
  const registry={effective:()=>({routes:{grok:{input:{},output:{image_gen:{level:'documented',harvest:'~/.grok/synthetic/**/*.png'}}}}}),writeOverlayEntry:()=>{}};
  const generation=await runModalityProbes('grok',{registry,command:'grok',tmpdir:root,home:root,consent:true,inputs:false,disclose:()=>{},exec:async(_command,args)=>args[0]==='--version'?{code:0,stdout:'1.0.0',stderr:''}:{code:0,stdout:JSON.stringify({text:'Starting generation',stopReason:'cancelled'}),stderr:'auxiliary HTTP 429 RESOURCE_EXHAUSTED'}});
  const generated=generation.cells.find(c=>c.modality==='image_gen');
  results.push({name:'cancelled generation explains terminal cause, not generic missing output',passed:generated.status==='probe_failed'&&generated.terminal_status==='cancelled'&&/cause not established/.test(generated.reason)});
  const matrix=effective({baseline:loadBaseline(),machine:'synthetic',overlay:{path:null,entries:[],invalidated:[],stale:[]}});
  const plan=modality.plan(matrix,{chain:['text','image']},{prompt:'Synthetic cancellation control; do not generate.'});
  plan.steps[0].chosen='grok';
  const chain=await modality.run(plan,{consent:true,cwd:root,home:root,effective:matrix,exec:async()=>({code:0,stdout:JSON.stringify({text:'Starting generation',stopReason:'cancelled'}),stderr:'auxiliary HTTP 429'})});
  results.push({name:'media runner reports cancelled rather than only no_new_output',passed:chain.report.status==='failed'&&chain.report.failure==='cancelled'&&/cause not established/.test(chain.report.failure_detail)});
  console.log(JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
  assert(results.every(r=>r.passed),'Media cancellation regression');
} finally {
  assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
  fs.rmSync(root,{recursive:true,force:true});
}
