#!/usr/bin/env node
// Exact production finalizer: deterministic clocks plus real loopback fetch.
// No external network, provider accounts, installation or runtime changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse as parseUpdateOptions} from './update.mjs';
const source = fs.readFileSync(new URL('./multi-review.mjs', import.meta.url), 'utf8');
const start = source.lastIndexOf('main().catch(');
assert(start > 0, 'production finalizer boundary moved');
const finalizer = source.slice(start);

if (process.argv[2] === '--child' || process.argv[2] === '--information-child') {
  const information = process.argv[2] === '--information-child';
  const code = Number(process.argv[3]);
  if (information) {
    process.argv = [process.argv[0], process.argv[1], 'update'];
    const originalExit = process.exit;
    process.exit = code => { process.stderr.write('FORCED_INFORMATION_EXIT\n'); originalExit(code); };
  }
  const main = async () => {
    const server = http.createServer((_req,res) => {
      res.writeHead(200, {'content-type':'application/json', ...(information ? {'connection':'close'} : {})});
      res.end('{"fixture":true}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    server.unref();
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {signal:AbortSignal.timeout(3000)});
    assert.equal((await response.json()).fixture, true);
    process.exitCode = code;
    process.stdout.write(JSON.stringify({fixture:true,exit_code:code})+'\n');
  };
  vm.runInNewContext(finalizer, {main,process,setTimeout,parseUpdateOptions});
} else {
  const passed=[], failed=[];
  const test=(name,fn)=>{try{fn();passed.push(name);}catch(e){failed.push({name,error:e.message});}};
  function simulate({platform='win32',code=0,stdout='flush',stderr='flush',error=null}={}) {
    const timers=[], exits=[], writes=[], callbacks={};
    const proc={platform,argv:['node','fixture'],exitCode:code,exit:value=>exits.push(value)};
    function write(which,mode) {return (text,done)=>{
      writes.push({which,text,timers:timers.length});
      if(mode==='throw')throw Error('synthetic broken pipe');
      if(mode==='defer')callbacks[which]=done;
      if(mode==='flush')done?.();
    };}
    proc.stdout={write:write('stdout',stdout)};proc.stderr={write:write('stderr',stderr)};
    const main=()=>({catch:handler=>{if(error)handler(error);return {finally:fn=>fn()};}});
    vm.runInNewContext(finalizer,{main,process:proc,setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;}});
    return {timers,exits,writes,proc,callbacks};
  }
  test('Windows flush yields 250ms before forced exit, with an independent 2000ms bound',()=>{
    const r=simulate();assert.deepEqual(r.exits,[]);
    assert.deepEqual(r.timers.map(t=>t.ms),[2000,250]);
    r.timers.find(t=>t.ms===250).fn();assert.deepEqual(r.exits,[0]);
  });
  test('non-Windows retains immediate flushed exit and the hard fallback',()=>{
    const r=simulate({platform:'linux',code:3});assert.deepEqual(r.exits,[3]);
    assert.deepEqual(r.timers.map(t=>t.ms),[2000]);
  });
  test('Windows drain preserves the real nonzero exit status',()=>{
    const r=simulate({code:3});assert.deepEqual(r.exits,[]);
    r.timers.find(t=>t.ms===250).fn();assert.deepEqual(r.exits,[3]);
  });
  for(const pipe of ['stdout','stderr'])test(`stalled ${pipe} cannot disable the hard bound`,()=>{
    const r=simulate({[pipe]:'stall',code:2});assert.deepEqual(r.exits,[]);
    assert.deepEqual(r.timers.map(t=>t.ms),[2000]);r.timers[0].fn();assert.deepEqual(r.exits,[2]);
  });
  test('synchronous broken pipe still has a previously installed forced deadline',()=>{
    const r=simulate({stdout:'throw',code:1});assert.deepEqual(r.exits,[]);
    assert.deepEqual(r.timers.map(t=>t.ms),[2000]);r.timers[0].fn();assert.deepEqual(r.exits,[1]);
  });
  test('the hard timer is installed before the first flush write',()=>{
    const r=simulate();assert.equal(r.writes[0].timers,1);
  });
  test('stderr synchronous throw from a later stdout callback retains the deadline',()=>{
    const r=simulate({stdout:'defer',stderr:'throw',code:1});
    assert.doesNotThrow(()=>r.callbacks.stdout());
    assert.deepEqual(r.timers.map(t=>t.ms),[2000]);r.timers[0].fn();assert.deepEqual(r.exits,[1]);
  });
  test('main rejection remains a failure, never an apparent successful shutdown',()=>{
    const r=simulate({error:Error('synthetic failure')});
    assert.equal(r.proc.exitCode,1);r.timers.find(t=>t.ms===250).fn();assert.deepEqual(r.exits,[1]);
    assert.match(r.writes[0].text,/synthetic failure/);
  });
  for(const code of [0,1,3])test(`real piped loopback fetch drains and exits ${code}`,()=>{
    const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',String(code)],
      {encoding:'utf8',windowsHide:true,timeout:7000,maxBuffer:65536});
    assert.equal(r.error,undefined,r.error?.message);assert.equal(r.signal,null);
    assert.equal(r.status,code,r.stderr);assert(!/UV_HANDLE_CLOSING|Assertion failed/.test(r.stderr));
    assert.deepEqual(JSON.parse(r.stdout),{fixture:true,exit_code:code});
  });
  for(const code of [0,1,3])test(`information-only fetch exits naturally with status ${code}`,()=>{
    const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--information-child',String(code)],
      {encoding:'utf8',windowsHide:true,timeout:7000,maxBuffer:65536});
    assert.equal(r.error,undefined,r.error?.message);assert.equal(r.signal,null);
    assert.equal(r.status,code,r.stderr);assert(!/FORCED_INFORMATION_EXIT|UV_HANDLE_CLOSING|Assertion failed/.test(r.stderr));
    assert.deepEqual(JSON.parse(r.stdout),{fixture:true,exit_code:code});
  });
  console.log(JSON.stringify({node:process.version,platform:process.platform,passed:passed.length,failed:failed.length,checks:passed,failures:failed},null,2));
  process.exitCode=failed.length?1:0;
}
