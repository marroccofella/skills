import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {providers} from './reviewer-providers.mjs';
import {createStandardInstallJob} from './standard-install-job.mjs';
import {setupReviewerClis as installReviewers} from './reviewer-install.mjs';

delete process.env.MOMM_EVIDENCE_HOME; // this suite owns its fixtures

const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-test-install-lock-'));
const lockFile = path.join(lockRoot, 'reviewer-install');
const setupReviewerClis = options => installReviewers({...options, lockFile});
process.on('exit', () => fs.rmSync(lockRoot,{recursive:true,force:true}));
const known = (agent, version = '1.2.3') => ({agent,installed:true,version});
const missing = agent => ({agent,installed:false,readiness_status:'launcher_not_found'});
const calls = [];
const states = {codex:known('codex'), claude:missing('claude'), copilot:{agent:'copilot',installed:null},
  antigravity:{agent:'antigravity',installed:true,status:'unsupported'}, grok:missing('grok')};
const inspect = agents => agents.map(agent => states[agent] || missing(agent));
const preview = await setupReviewerClis({inspect, execute:()=>assert.fail('preview launched an installer')});
assert.deepEqual(preview.reviewers.map(row => row.status), ['already_installed','would_install','discovery_inconclusive','discovery_inconclusive','would_install']);
assert.equal(preview.reviewers.length,5);
const apply = await setupReviewerClis({apply:true, inspect, execute(command) {
  calls.push(command);
  if (command.includes('@anthropic-ai/claude-code')) { states.claude = known('claude','2.3.4'); return null; }
  return 'exit 7';
}});
assert.equal(calls.length,2);
assert.deepEqual(apply.reviewers.map(row => row.status), ['already_installed','installed_verified','discovery_inconclusive','discovery_inconclusive','install_failed']);
assert.equal(apply.reviewers[1].version,'2.3.4');
assert.equal(apply.reviewers[4].reason,'exit 7');
assert.equal(apply.complete,false);
const stayedMissing = await setupReviewerClis({apply:true,inspect:agents=>agents.map(a=>a==='claude'?missing(a):known(a)),execute:()=>null});
assert.equal(stayedMissing.reviewers[1].status,'version_unverified');
const raced = await setupReviewerClis({apply:true, includeGemini:true, inspect:agents=>agents.map(a=>agents.length>1 && a==='grok'?missing(a):known(a)), execute:()=>assert.fail('already installed by another process')});
assert.equal(raced.reviewers.length,6);
assert.equal(raced.complete,true);
// Exercise the actual shell handoff without contacting vendors or changing the user's programs.
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-fixture-bin-'));
const windows = process.platform === 'win32';
const previousPath = process.env.PATH;
const marker = path.join(bin, 'installed-version');
const previousCanary = process.env.MOMM_INSTALL_PRIVATE_CANARY;
const originalGrokInstall = providers.grok.install.win32;
try {
  fs.writeFileSync(path.join(bin, windows ? 'npm.cmd' : 'npm'), windows
    ? '@echo off\r\nif not "%*"=="install -g @anthropic-ai/claude-code" exit /b 4\r\n> "%~dp0installed-version" echo 2.3.4\r\n'
    : '#!/bin/sh\n[ "$*" = "install -g @anthropic-ai/claude-code" ] || exit 4\nprintf 2.3.4 > "${0%/*}/installed-version"\n', {mode:0o700});
  process.env.PATH = bin;
  const inspectFixture = agents => agents.map(a => a !== 'claude' ? known(a)
    : fs.existsSync(marker) ? known(a, fs.readFileSync(marker,'utf8').trim()) : missing(a));
  const first = await setupReviewerClis({apply:true,inspect:inspectFixture});
  assert.equal(first.complete,true,JSON.stringify(first));
  assert.equal(first.reviewers[1].status,'installed_verified');
  const second = await setupReviewerClis({apply:true,inspect:inspectFixture,execute:()=>assert.fail('repeat install')});
  assert.equal(second.reviewers[1].status,'already_installed');
  if (windows) {
    // Exercise a native installer in Windows PowerShell itself. A 64-bit
    // PowerShell normalizes synthetic WOW64 values when the process starts.
    process.env.MOMM_INSTALL_PRIVATE_CANARY = 'fixture-only';
    const cpu = process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE;
    assert.match(cpu,/^(?:AMD64|ARM64|x86)$/i);
    const nativeMarker = path.join(bin,'native-version');
    providers.grok.install.win32 = [
      "$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }",
      "if ($arch -ne '" + cpu + "') { exit 41 }",
      "if (!$env:PROCESSOR_ARCHITECTURE) { exit 42 }",
      "if ($env:MOMM_INSTALL_PRIVATE_CANARY) { exit 43 }",
      "Set-Content -Encoding ASCII -LiteralPath '" + nativeMarker.replaceAll("'","''") + "' -Value '1.2.3'"
    ].join('; ');
    const native = await setupReviewerClis({apply:true,onlyStandardReviewer:'grok',
      inspect:()=>[fs.existsSync(nativeMarker) ? known('grok') : missing('grok')]});
    assert.equal(native.reviewers[0].status,'installed_verified',JSON.stringify(native));
  }
} finally {
  process.env.PATH = previousPath;
  providers.grok.install.win32 = originalGrokInstall;
  if (previousCanary === undefined) delete process.env.MOMM_INSTALL_PRIVATE_CANARY;
  else process.env.MOMM_INSTALL_PRIVATE_CANARY = previousCanary;
  fs.rmSync(bin,{recursive:true,force:true});
}
console.log('Passed reviewer installation, discovery, preview, repair, verification and missing-only repeat checks.');

const completed = [];
let nextWorker;
const job = createStandardInstallJob('win32', agent => new Promise(resolve => {
  completed.push(agent);
  nextWorker = (status) => resolve({code:0,stdout:JSON.stringify({agent,version:'1.2.3',status})});
}));
const request = {previous_id:0, commands:job.snapshot().plan.map(item=>item.command)};
assert.equal(job.start({...request,commands:[]}).status,409);
assert.equal(job.start(request).status,202);
assert.equal(job.start(request).status,200);
for (const status of ['already_installed','installed_verified','install_failed','discovery_inconclusive','version_unverified']) {
  nextWorker(status);
  await new Promise(resolve=>setImmediate(resolve));
}
assert.deepEqual(completed,['codex','claude','copilot','antigravity','grok']);
assert.equal(job.snapshot().status,'needs_attention');
assert.equal(job.start(request).value.id,1);
assert.equal(completed.length,5);
console.log('Passed one-confirmation setup, partial results and duplicate-request recovery.');

const failedAgents = ['copilot','antigravity','grok'];
const retry = {previous_id:1,retry_failed:true,commands:job.snapshot().plan.filter(p => failedAgents.includes(p.agent)).map(p => p.command)};
assert.equal(job.start({...retry,commands:request.commands}).status,409);
assert.equal(job.start(retry).status,202);
assert.equal(job.start(retry).status,200);
for (const agent of failedAgents) {
  assert.equal(completed.at(-1),agent);
  nextWorker('installed_verified');
  await new Promise(resolve=>setImmediate(resolve));
}
assert.deepEqual(completed.slice(5),failedAgents);
assert.equal(job.snapshot().status,'complete');
assert.equal(job.start(retry).value.id,2);
assert.equal(job.start({...retry,previous_id:2}).status,409);

const errors = [
  {code:0,stdout:JSON.stringify({agent:'codex',status:'install_failed',reason:'exit 1'}),stderr:'private EACCES'},
  {code:0,stdout:JSON.stringify({agent:'claude',status:'install_failed',reason:'exit 1'}),stderr:'private EAI_AGAIN'},
  {code:0,stdout:JSON.stringify({agent:'copilot',status:'install_failed',reason:'exit 7'})},
  {code:0,stdout:JSON.stringify({agent:'antigravity',status:'install_failed',reason:'exit 1'}),stderr:'ENOSPC private location'},
  {code:0,stdout:JSON.stringify({agent:'grok',status:'install_failed',reason:'ETIMEDOUT',version:'1.2.3'})}
];
const recovery = createStandardInstallJob('win32', async () => errors.shift());
recovery.start({previous_id:0,commands:recovery.snapshot().plan.map(p=>p.command)});
await new Promise(resolve=>setImmediate(resolve));
const outcomes = recovery.snapshot().rows;
assert.deepEqual(outcomes.map(r=>r.status),Array(5).fill('install_failed'));
assert.deepEqual(outcomes.map(r=>r.reason),['permission','network','exit 7','disk_full','timeout']);
assert(outcomes.every(r=>r.finished_at>=r.started_at));
assert(!JSON.stringify(outcomes).includes('private'));

for (const [reply,expected] of [
  [{timedOut:true,code:null},'timed_out'],
  [{code:1,stderr:'private worker log'},'worker_failed'],
  [{code:0,stdout:'malformed private result'},'worker_failed'],
  [{code:0,stdout:JSON.stringify({agent:'codex',status:'install_failed',reason:'cleanup_unconfirmed'})},'install_failed']
]) {
  let calls = 0;
  const stop = createStandardInstallJob('win32', async () => { calls++; return reply; });
  stop.start({previous_id:0,commands:stop.snapshot().plan.map(p=>p.command)});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.deepEqual(stop.snapshot().rows.map(r=>r.status),[expected,...Array(4).fill('deferred')]);
}
const archJob = createStandardInstallJob('win32', async agent => ({
  code:0,stdout:JSON.stringify({agent,status:'install_failed',reason:'exit 1'}),
  stderr:agent === 'grok' ? 'Unsupported architecture: private' : 'Fatal: Unsupported CPU architecture.'
}));
archJob.start({previous_id:0,commands:archJob.snapshot().plan.map(p=>p.command)});
await new Promise(resolve=>setImmediate(resolve));
assert(archJob.snapshot().rows.every(row=>row.reason === 'architecture'));
assert(!JSON.stringify(archJob.snapshot()).includes('private'));
const single = {apply:true,onlyStandardReviewer:'claude'};
let probes = 0;
let installs = 0;
let fixtureInstalled = false;
const check = () => { probes++; return [fixtureInstalled ? known('claude') : missing('claude')]; };
const perform = () => { installs++; fixtureInstalled = true; return null; };
fs.writeFileSync(lockFile+'.lock',JSON.stringify({pid:process.pid}));
assert.equal((await setupReviewerClis({...single,inspect:check,execute:perform})).reviewers[0].status,'installer_busy');
assert.equal(probes,0);
fs.unlinkSync(lockFile+'.lock');
const dead = spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});
assert.equal(dead.status,0);
fs.writeFileSync(lockFile+'.lock',JSON.stringify({pid:Number(dead.stdout)}));
assert.equal((await setupReviewerClis({...single,inspect:check,execute:perform})).reviewers[0].status,'installed_verified');
assert.equal(probes,2,'one before and one after a missing program');
assert.equal((await setupReviewerClis({...single,inspect:check,execute:perform})).reviewers[0].status,'already_installed');
assert.equal(probes,3,'one check when reopening with a healthy install');
assert.equal(installs,1);

const stalledBin = fs.mkdtempSync(path.join(os.tmpdir(),'momm-stalled-install-'));
try {
  const started = path.join(stalledBin,'started');
  const escaped = path.join(stalledBin,'escaped');
  const script = path.join(stalledBin,'stall.cjs');
  fs.writeFileSync(script,"const fs=require('node:fs');fs.writeFileSync("+JSON.stringify(started)+",'started');setTimeout(()=>fs.writeFileSync("+JSON.stringify(escaped)+",'escaped'),3000);");
  const invocation = '"' + process.execPath + '" "' + script + '"';
  fs.writeFileSync(path.join(stalledBin,windows?'npm.cmd':'npm'),windows?'@echo off\r\n'+invocation+'\r\n':'#!/bin/sh\n'+invocation+'\n',{mode:0o700});
  process.env.PATH = stalledBin + path.delimiter + previousPath;
  const timed = await setupReviewerClis({...single,inspect:()=>[missing('claude')],installerTimeoutMs:1500});
  const reason = timed.reviewers[0].reason;
  assert(['ETIMEDOUT','cleanup_unconfirmed'].includes(reason));
  assert(fs.existsSync(started),'fixture process actually started');
  await new Promise(resolve=>setTimeout(resolve,3200));
  if (fs.existsSync(escaped)) assert.equal(reason,'cleanup_unconfirmed','a surviving child must pause further installation');
  console.log('Timed-out process tree: ' + reason + ', child survived: ' + fs.existsSync(escaped));
  assert(!fs.existsSync(lockFile+'.lock'));
} finally {
  process.env.PATH = previousPath;
  fs.rmSync(stalledBin,{recursive:true,force:true});
}
console.log('Passed selective retry, worker failures, stale/live lock recovery, probe counts and real stalled installer cleanup.');
