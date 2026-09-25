// Zero-provider regressions for the 1.16.1 scope audit; synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {privateTestFixture} from './private-test-fixture.mjs';
import {inspectEvidencePermissions} from './evidence-permissions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
async function test(name, work) {
  try { await work(); results.push({name, passed:true}); }
  catch (e) { results.push({name, passed:false, error:String(e.message).slice(0,500)}); }
}
await test('clock success, failure, recovery and synchronous throw stay coherent', async () => {
  const code = fs.readFileSync(path.join(root,'momm/scripts/setup-ui.mjs'),'utf8');
  const start = code.indexOf('const clockActivity ='), end = code.indexOf('// Only constant command tables',start);
  assert(start >= 0 && end > start);
  const c = vm.runInNewContext(code.slice(start,end)+';({runClockActivity,clockActivity})',{safeDetail:String,Date,Promise});
  await c.runClockActivity('success',async()=>({ok:true}));
  assert.equal(c.clockActivity.last_result.ok,true);
  await assert.rejects(c.runClockActivity('failure',async()=>{throw Error('synthetic failure');}));
  assert.equal(c.clockActivity.last_result,null,'old success must not survive a failure');
  assert.equal(c.clockActivity.last_error,'synthetic failure');
  assert.equal(c.clockActivity.running,false);
  await c.runClockActivity('recovery',async()=>({ok:true}));
  assert.equal(c.clockActivity.last_error,null);
  await assert.rejects(c.runClockActivity('sync',()=>{throw Error('synthetic sync failure');}));
  assert.equal(c.clockActivity.last_result,null);
  assert.equal(c.clockActivity.running,false);
});

const fixture = privateTestFixture('momm-scope-closure-');
const exportTo = (file, force=false) => spawnSync(process.execPath,[path.join(root,'momm/scripts/scorecard.mjs'),'--dir',fixture,'--export-training',file,...(force?['--force']:[])],{encoding:'utf8',windowsHide:true,timeout:60000});
function broaden(directory) {
  if(process.platform === 'win32') {
    const r = spawnSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[directory,'/grant','*S-1-5-32-545:(OI)(CI)RX'],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(r.status,0,'synthetic ACL fixture preparation');
  } else fs.chmodSync(directory,0o755);
}
try {
  await test('existing broad output refuses both files without permission repair', () => {
    const directory = path.join(fixture,'broad'); fs.mkdirSync(directory,{mode:0o700}); broaden(directory);
    assert.equal(inspectEvidencePermissions(directory).verified,false);
    const out = path.join(directory,'train.jsonl'), r = exportTo(out);
    assert.equal(r.status,1,'broad export must refuse');
    assert.match(r.stderr,/private|owner-only/i);
    assert.equal(fs.existsSync(out),false); assert.equal(fs.existsSync(out+'.README.md'),false);
    assert.equal(inspectEvidencePermissions(directory).verified,false,'no permission repair');
  });
  await test('new destination and both files are private; overwrite is explicit', () => {
    const directory = path.join(fixture,'new'), out = path.join(directory,'train.jsonl');
    assert.equal(exportTo(out).status,0);
    assert.equal(inspectEvidencePermissions(directory).verified,true);
    assert(fs.existsSync(out+'.README.md'));
    assert.equal(exportTo(out).status,1);
    assert.equal(exportTo(out,true).status,0);
    assert.equal(inspectEvidencePermissions(directory).verified,true);
  });
  await test('force cannot overwrite a broadly accessible companion', () => {
    const directory = path.join(fixture,'companion'), out = path.join(directory,'train.jsonl');
    assert.equal(exportTo(out).status,0);
    fs.writeFileSync(out,'synthetic dataset to preserve\n',{mode:0o600});
    const dataBefore = fs.readFileSync(out);
    const card = out+'.README.md', before = fs.readFileSync(card);
    if(process.platform === 'win32') {
      const r = spawnSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[card,'/grant','*S-1-5-32-545:R'],{encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(r.status,0);
    } else fs.chmodSync(card,0o644);
    assert.equal(exportTo(out,true).status,1);
    assert.deepEqual(fs.readFileSync(out),dataBefore,'refusal preserves the primary dataset');
    assert.deepEqual(fs.readFileSync(card),before);
  });
} finally {
  assert(path.basename(fixture).startsWith('momm-scope-closure-'));
  fs.rmSync(fixture,{recursive:true,force:true,maxRetries:3});
}
await test('current acceptance guide specifies invalid retry and unused ticket expiry', () => {
  const plan = fs.readFileSync(path.join(root,'momm/references/third-party-test-plan-1.16.1.md'),'utf8');
  assert(plan.includes('--retry-invalid')); assert(plan.includes('/api/ledger-ticket'));
  assert(plan.includes('X-MOMM-Token')); assert(plan.includes('60 seconds'));
});
console.log(JSON.stringify({passed:results.every(x=>x.passed),results},null,2));
if(results.some(x=>!x.passed)) process.exitCode=1;
