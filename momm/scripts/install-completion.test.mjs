import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {replayResult} from './update.mjs';
const result = body => ({status:1,stdout:JSON.stringify(body)});
const good={results:[{target:'codex',status:'already_linked'}],inventory:{upgrade:{complete:false}}};
assert.equal(replayResult(result(good))[0].status,'already_linked');
assert.throws(()=>replayResult(result({...good,installation:{error:'receipt failed'}})),/receipt/);
assert.throws(()=>replayResult(result({...good,results:[{status:'conflict'}]})),/sole failure/);
assert.throws(()=>replayResult(result({...good,inventory:{upgrade:{complete:true}}})),/sole failure/);
assert.throws(()=>replayResult({status:null,signal:'SIGTERM'}),/failed/);
assert.throws(()=>replayResult({status:1,stdout:'partial'}),/complete JSON/);
// Execute each production main with synthetic link/receipt/inventory boundaries.
// No real discovery folder, account or installed skill is touched.
for (const script of ['../../install.mjs','./install.mjs']) {
  const source=fs.readFileSync(new URL(script,import.meta.url),'utf8');
  for (const dryRun of [false,true]) for (const mode of ['throw','malformed','conflict','complete']) {
    let stdout='',stderr='',seen;
    const processStub={argv:['node','synthetic'],exitCode:0,stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}};
    const customDirs=['synthetic-custom-parent'];
    const context={process:processStub,path,os:{homedir:()=>'/synthetic/home'},repoRoot:'/synthetic/repo',skillRoot:'/synthetic/repo/momm',
      parseArgs:()=>({targets:['codex'],customDirs,dryRun,skills:['momm']}),discoverSkills:()=>['momm'],
      linkAll:()=>[{skill:'momm',status:dryRun?'would_link':'linked'}],linkSkill:()=>({status:dryRun?'would_link':'linked'}),
      readiness:()=>({}),recordInstall:()=>({updater_available:true}),
      installationCompletion:options=>{seen=options;if(mode==='throw')throw new Error('synthetic scan failure');return mode==='malformed'?null:{upgrade:{complete:mode==='complete',reason:'synthetic conflict'}};}};
    vm.runInNewContext(source.slice(source.indexOf('function main()')),context);
    assert(stdout.trim(),`${script}: inventory ${mode} must not discard link results`);
    const output=JSON.parse(stdout);assert(output.results.length>0);assert.equal(output.installation.updater_available,true);
    assert.deepEqual(seen.customDirs,customDirs);
    assert.equal(processStub.exitCode,!dryRun&&mode!=='complete'?1:0);
    if(mode!=='complete')assert.notEqual(output.inventory?.upgrade?.complete,true);
    if(!dryRun&&mode!=='complete')assert.match(stderr,/not complete|inventory/i);
  }
}
console.log('PASS: inventory-only conflict preserves scoped replay; failed links, receipts and partial output refuse');
