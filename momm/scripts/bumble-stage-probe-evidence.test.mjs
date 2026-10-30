// Governor-authored evidence regressions. Bounded isolated fixture programs;
// no transport counters or remote/backend qualification are claimed.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
delete process.env.MOMM_EVIDENCE_HOME; // each test owns its synthetic evidence stores
const selected=process.argv[2]??'all';assert(['all','original_refusal','reported_metrics','mirror_context'].includes(selected));
const scripts=fileURLToPath(new URL('./',import.meta.url));
const refusalMarker='momm-evidence-injected-refusal';
function execute(kind){
 let program=fs.readFileSync(new URL('./bumble-stage-review-probes.test.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');assert(Buffer.byteLength(program)<65536);
 program=program.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,(_all,_quote,relative)=>"from '"+pathToFileURL(path.resolve(scripts,relative)).href+"'");
 if(kind==='mirror_context')program=program.replaceAll('import.meta.url',JSON.stringify(new URL('../development-tests/bumble-stage-review-probes.test.mjs',import.meta.url).href));
 if(kind==='original_refusal'){
  const anchor='\ndelete process.env.MOMM_EVIDENCE_HOME;\n';assert.equal(program.split(anchor).length,2,'one exact trusted mutation anchor');
  program=program.replace(anchor,"\nBumbleStage.prototype.markTransmissionPossible=function(){process.stderr.write("+JSON.stringify(refusalMarker+'\n')+");throw new TypeError('Unrelated synthetic probe failure');};"+anchor);
 }
 const r=spawnSync(process.execPath,['--input-type=module','-','--case',kind==='original_refusal'?'terminal_send':kind==='mirror_context'?'capacity_quality_metadata':'denied_output'],{input:program,encoding:'utf8',cwd:path.resolve(scripts,'../..'),env:{...process.env,MOMM_NO_UPDATE_CHECK:'1',NO_UPDATE_CHECK:'1'},timeout:180000,maxBuffer:1000000,windowsHide:true});
 assert.equal(r.error,undefined,'fixture process must finish within its fixed deadline');
 if(kind==='mirror_context'){assert.equal(r.status,0,'mirrored canonical context must execute: '+r.stderr);const output=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(output.case,'capacity_quality_metadata');assert.equal(output.passed,true);return;}
 assert(r.stdout.trim(),'fixture produced no JSON (status '+r.status+'): '+r.stderr.slice(-1000));
 const output=JSON.parse(r.stdout.trim().split('\n').at(-1));
 if(kind==='original_refusal'){assert.equal(r.status,1,'an unrelated TypeError must fail the terminal-refusal probe');assert.equal(r.stderr.trim(),refusalMarker,'injected refusal must actually execute');assert.equal(output.selected,'terminal_send');assert.equal(output.passed,0);assert.equal(output.failed,1);assert.equal(output.observations.length,1);assert.equal(output.observations[0].name,'sealed known-not-sent result excludes later transmission permission');assert.equal(output.observations[0].status,'failed');}
 else{assert.equal(r.status,0,r.stderr);assert.equal(output.selected,'denied_output','denial fixture must identify the selected case');assert.equal(output.passed,1);assert.equal(output.failed,0);assert.equal(output.observations.length,1);assert.equal(output.observations[0].name,'a closed admission denial cannot consume future output headroom');assert.equal(output.observations[0].status,'passed');for(const key of ['network_calls','model_calls','credentials_read'])assert.equal(Object.hasOwn(output,key),false,'do not emit unmeasured '+key);}
}
const cases=selected==='all'?['original_refusal','reported_metrics','mirror_context']:[selected];for(const kind of cases)execute(kind);
console.log(JSON.stringify({passed:cases.length,cases,scope:'Actual bounded local test-evidence discrimination; not transport instrumentation or backend release'}));
