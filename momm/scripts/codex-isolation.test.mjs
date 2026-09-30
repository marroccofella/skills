// MOMM 1.17 A2: Codex runs isolated from the user's configuration, with the model and reasoning effort
// read (never written) from that configuration and passed explicitly. Zero providers: every Codex run
// here is a fake runProcess, every configuration file lives under a synthetic home in the temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {PEER_CONTRACT,reviewProblem} from './review-contract.mjs';
import {assemblePrompt} from './guidance.mjs';
import * as isolation from './route-isolation.mjs';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const start=source.indexOf('function extractJsonObjects('),end=source.indexOf('\nfunction fingerprint(',start);
assert(start>0&&end>start,'adapter extraction boundaries moved');
let grokStream={};try{grokStream=await import('./grok-stream.mjs');}catch{/* absent before A4.3 */}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'momm-codex-isolation-test-'));
const checks=[];let sequence=0;
async function test(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
const codexIsolationArgs=(...a)=>{assert.equal(typeof isolation.codexIsolationArgs,'function','route-isolation.mjs must export codexIsolationArgs');return isolation.codexIsolationArgs(...a);};
// A synthetic home; CODEX_HOME is never taken from the real environment in these tests.
function home(config){const dir=path.join(root,`home-${++sequence}`);fs.mkdirSync(path.join(dir,'.codex'),{recursive:true});if(config!==undefined)fs.writeFileSync(path.join(dir,'.codex','config.toml'),config);return dir;}
// Records every fs call the reader makes, so a write, lock or non-read open is caught.
function spyFs(){
  const calls=[];
  const spy=new Proxy(fs,{get(target,name){const value=target[name];if(typeof value!=='function')return value;return (...args)=>{calls.push({name:String(name),args});return value.apply(target,args);};}});
  return {spy,calls};
}
const WRITERS=/^(write|append|rename|unlink|rm|mkdir|copy|cp|truncate|ftruncate|chmod|fchmod|chown|utimes|futimes|symlink|link|createWriteStream|mkdtemp|open(?!Sync$|$))/i;
function readOnly(calls){
  for(const call of calls){
    assert.ok(!WRITERS.test(call.name),`the reader must never call fs.${call.name}`);
    if(/^open/.test(call.name)){const flag=call.args[1]??'r';assert.equal(flag,'r',`config opened with flag ${String(flag)}, not read-only`);}
  }
}
const plain=v=>JSON.parse(JSON.stringify(v));
const pairs=(args,flag)=>plain(args.flatMap((a,k,all)=>(all[k-1]===flag?[a]:[])));
try{
  // ---- the shared definition ----
  await test('isolation always adds --ignore-user-config and --ignore-rules, and keeps the 1.16.1 switches',()=>{
    const r=codexIsolationArgs({home:home(),env:{},fs});
    assert.ok(r.args.includes('--ignore-user-config'));assert.ok(r.args.includes('--ignore-rules'));
    assert.ok(pairs(r.args,'-c').includes('project_doc_max_bytes=0'));
    for(const feature of ['hooks','plugins','apps','multi_agent'])assert.ok(pairs(r.args,'--disable').includes(feature),`--disable ${feature}`);
  });
  await test('model and effort are passed explicitly when the user set them at top level',()=>{
    const r=codexIsolationArgs({home:home('# user settings\nmodel = "gpt-6-astra"\nmodel_reasoning_effort = "high" # comment\npersonality = "friendly"\n\n[projects.\'D:\\\\work\']\ntrust_level = "trusted"\nmodel = "table-model"\n'),env:{},fs});
    assert.deepEqual(pairs(r.args,'-m'),['gpt-6-astra']);
    assert.ok(pairs(r.args,'-c').includes('model_reasoning_effort=high'));
    assert.equal(r.model,'gpt-6-astra');assert.equal(r.reasoning_effort,'high');
    assert.deepEqual(r.from_user_config,{model:true,reasoning_effort:true});
    assert.deepEqual(r.notices,[]);
  });
  await test('nothing is passed when the configuration names neither, or does not exist',()=>{
    for(const config of [undefined,'personality = "friendly"\n[profiles.fast]\nmodel = "o3"\nmodel_reasoning_effort = "low"\n']){
      const r=codexIsolationArgs({home:home(config),env:{},fs});
      assert.ok(!r.args.includes('-m')&&!r.args.includes('--model'),'no model flag');
      assert.ok(!pairs(r.args,'-c').some(v=>v.startsWith('model_reasoning_effort')),'no effort override');
      assert.equal(r.model,null);assert.equal(r.reasoning_effort,null);
      assert.deepEqual(r.from_user_config,{model:false,reasoning_effort:false});
      assert.deepEqual(r.notices,[]);
    }
  });
  await test('only the model set: the effort is omitted, and the other way round',()=>{
    const m=codexIsolationArgs({home:home('model = \'o4-mini\'\n'),env:{},fs});
    assert.deepEqual(pairs(m.args,'-m'),['o4-mini']);assert.ok(!pairs(m.args,'-c').some(v=>v.startsWith('model_reasoning_effort')));
    const e=codexIsolationArgs({home:home('model_reasoning_effort = "xhigh"\n'),env:{},fs});
    assert.ok(!e.args.includes('-m'));assert.ok(pairs(e.args,'-c').includes('model_reasoning_effort=xhigh'));
  });
  await test('invalid or non-string values are refused and omitted with a notice that names neither the value nor the path',()=>{
    const cases=['model = "gpt 6; rm -rf /"\nmodel_reasoning_effort = "HIGH=1"\n','model = 6\nmodel_reasoning_effort = ["high"]\n','model = "a\\u0022b"\nmodel_reasoning_effort = """\nhigh\n"""\n','model = "x"\nmodel = "y"\n','model = "-c"\nmodel_reasoning_effort = "--dangerously-bypass-approvals-and-sandbox"\n'];
    for(const config of cases){
      const dir=home(config);const r=codexIsolationArgs({home:dir,env:{},fs});
      assert.ok(!r.args.includes('-m'),`model refused for ${JSON.stringify(config)}`);
      assert.ok(!pairs(r.args,'-c').some(v=>v.startsWith('model_reasoning_effort')),`effort refused for ${JSON.stringify(config)}`);
      assert.ok(r.notices.length>=1,'a notice says what was omitted');
      const text=JSON.stringify(r.notices);
      for(const leak of ['rm -rf','HIGH=1','dangerously',dir,'config.toml'])assert.ok(!text.includes(leak),`notice leaks ${leak}`);
    }
  });
  await test('a multi-line string or array cannot smuggle a top-level model',()=>{
    const r=codexIsolationArgs({home:home('notes = """\nmodel = "smuggled"\n"""\nnotify = [\n  "model = \\"x\\"",\n]\nmodel_reasoning_effort = "medium"\n'),env:{},fs});
    assert.ok(!r.args.includes('smuggled'));assert.equal(r.model,null);assert.equal(r.reasoning_effort,'medium');
  });
  await test('CODEX_HOME is honoured when absolute; a relative one reads nothing',()=>{
    const codexHome=path.join(root,'codex-home');fs.mkdirSync(codexHome);fs.writeFileSync(path.join(codexHome,'config.toml'),'model = "from-codex-home"\n');
    const r=codexIsolationArgs({home:home('model = "from-home"\n'),env:{CODEX_HOME:codexHome},fs});
    assert.equal(r.model,'from-codex-home');
    const rel=codexIsolationArgs({home:home('model = "from-home"\n'),env:{CODEX_HOME:'relative/codex'},fs});
    assert.equal(rel.model,null);assert.ok(rel.notices.length===1&&!rel.notices[0].includes('relative/codex'));
  });
  await test('the configuration file is opened read-only and never written, locked or touched',()=>{
    const dir=home('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n');const file=path.join(dir,'.codex','config.toml');
    const before={bytes:fs.readFileSync(file),stat:fs.statSync(file)};
    const {spy,calls}=spyFs();
    const r=codexIsolationArgs({home:dir,env:{},fs:spy});
    assert.equal(r.model,'gpt-6-astra');
    assert.ok(calls.length>0,'the reader goes through the supplied fs');
    readOnly(calls);
    const after=fs.statSync(file);
    assert.deepEqual(fs.readFileSync(file),before.bytes,'bytes unchanged');
    assert.equal(after.mtimeMs,before.stat.mtimeMs,'mtime unchanged');assert.equal(after.size,before.stat.size);
    assert.deepEqual(fs.readdirSync(path.join(dir,'.codex')),['config.toml'],'no lock or temp file beside it');
  });
  await test('an oversized or unreadable configuration passes nothing, with a notice',()=>{
    const big=codexIsolationArgs({home:home('model = "x"\n'+'#'.repeat(300*1024)),env:{},fs});
    assert.equal(big.model,null);assert.equal(big.notices.length,1);
    const dir=home();fs.mkdirSync(path.join(dir,'.codex','config.toml'));
    const odd=codexIsolationArgs({home:dir,env:{},fs});
    assert.equal(odd.model,null);assert.equal(odd.notices.length,1);
  });
  // ---- the review adapter ----
  function adapter(fakeHome,env={}){
    const temporary=path.join(root,`adapter-${++sequence}`);fs.mkdirSync(temporary);
    const ctx=vm.createContext({fs,os:{tmpdir:()=>temporary,homedir:()=>fakeHome},path,process,Buffer,PEER_CONTRACT,reviewProblem,assemblePrompt,
      createEvidenceWorkspace:prefix=>fs.mkdtempSync(path.join(temporary,prefix)),requirePrivateScratch:()=>{},
      VALID_VERDICTS:new Set(['ACCEPT','MODIFY','REJECT']),VALID_SEVERITIES:new Set(['CRITICAL','WARNING','NITPICK']),
      attachmentRouting:()=>[],attachmentContractSection:()=>'',buildContract:()=> 'Synthetic contract',
      agentTimeoutMs:(_a,ms)=>ms,cleanOauthEnv:()=>({...env}),parseUsage:()=>({reported:null}),LOGIN_HINTS:{},
      sanitizeText:s=>({value:s}),clipped:(s,n)=>String(s).slice(0,n),antigravityCommand:()=> 'agy',grokCommand:()=> 'grok',REVIEW_JSON_SCHEMA:{type:'object'},
      grokIsolationEnv:isolation.grokIsolationEnv,codexIsolationArgs:isolation.codexIsolationArgs,codexReviewArgs:isolation.codexReviewArgs,...grokStream});
    vm.runInContext(source.slice(start,end)+';this.invoke=invokeReviewer;',ctx);
    return ctx;
  }
  const artifact='export const synthetic = 1;\n';
  const review=JSON.stringify({review_status:'complete',reviewed_scope:[{quote:'export const synthetic = 1;',assessment:'Checked.'}],verdict:'ACCEPT',confidence:0.9,findings:[],summary:'Synthetic.',suggested_improvements:[]});
  async function codexRun(ctx,stdout=review){let seen=null;const r=await ctx.invoke('codex',artifact,{governor:'other',timeoutMs:1000,runProcess:async(_c,args,o)=>{seen={args,env:o.env};return {code:0,stdout,stderr:''};}});return {r,seen};}
  await test('the codex review passes --ignore-user-config, --ignore-rules and the user\'s model and effort',async()=>{
    const {r,seen}=await codexRun(adapter(home('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n')));
    assert.equal(r.status,'success',r.detail);
    for(const flag of ['--ignore-user-config','--ignore-rules'])assert.ok(seen.args.includes(flag),flag);
    assert.deepEqual(pairs(seen.args,'-m'),['gpt-6-astra']);assert.ok(pairs(seen.args,'-c').includes('model_reasoning_effort=high'));
    assert.ok(pairs(seen.args,'-c').includes('project_doc_max_bytes=0'));
    for(const feature of ['hooks','plugins','apps','multi_agent','image_generation'])assert.ok(pairs(seen.args,'--disable').includes(feature));
    assert.deepEqual(plain(seen.args.slice(0,6)),['exec','--sandbox','read-only','--color','never','--skip-git-repo-check']);
    assert.equal(seen.args.at(-1),'-');
    assert.deepEqual(plain(r.route_settings),{model:'gpt-6-astra',model_from:'user_config',reasoning_effort:'high',reasoning_effort_from:'user_config',notices:[]});
  });
  await test('with no user choice the review passes neither and records the Codex default',async()=>{
    const {r,seen}=await codexRun(adapter(home()));
    assert.ok(seen.args.includes('--ignore-user-config'));assert.ok(!seen.args.includes('-m'));
    assert.ok(!pairs(seen.args,'-c').some(v=>v.startsWith('model_reasoning_effort')));
    assert.deepEqual(plain(r.route_settings),{model:null,model_from:'codex_default',reasoning_effort:null,reasoning_effort_from:'codex_default',notices:[]});
  });
  await test('the adapter reads CODEX_HOME from the environment the child will get, and records failures too',async()=>{
    const codexHome=path.join(root,'adapter-codex-home');fs.mkdirSync(codexHome);fs.writeFileSync(path.join(codexHome,'config.toml'),'model = "gpt-codex-home"\nmodel_reasoning_effort = "bad value"\n');
    const ctx=adapter(home('model = "wrong"\n'),{CODEX_HOME:codexHome});
    let seen;const r=await ctx.invoke('codex',artifact,{governor:'other',timeoutMs:1000,runProcess:async(_c,args)=>{seen=args;return {code:1,stdout:'',stderr:'authentication required'};}});
    assert.deepEqual(pairs(seen,'-m'),['gpt-codex-home']);assert.ok(!pairs(seen,'-c').some(v=>v.startsWith('model_reasoning_effort')));
    assert.equal(r.status,'authentication_required');
    assert.equal(r.route_settings.model,'gpt-codex-home');assert.equal(r.route_settings.reasoning_effort_from,'codex_default');
    assert.equal(r.route_settings.notices.length,1);assert.ok(!JSON.stringify(r.route_settings).includes(codexHome));
  });
  await test('grok, claude, gemini, copilot and antigravity arguments are unchanged by the codex isolation',async()=>{
    const ctx=adapter(home('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n'));
    for(const route of ['grok','claude','gemini','copilot','antigravity']){
      let seen=null;
      const r=await ctx.invoke(route,artifact,{governor:'other',timeoutMs:60000,grokModelProbe:Promise.resolve(null),runProcess:async(_c,args)=>{seen=args;return {code:1,stdout:'',stderr:'authentication required'};}});
      assert.ok(seen,`${route} was dispatched`);
      for(const flag of ['--ignore-user-config','--ignore-rules','project_doc_max_bytes=0','gpt-6-astra','model_reasoning_effort=high'])assert.ok(!seen.includes(flag),`${route} gained ${flag}`);
      assert.ok(!('route_settings' in r),`${route} records no codex settings`);
    }
  });
  await test('the report row and the merged split result carry route_settings',()=>{
    const settings={model:'gpt-6-astra',model_from:'user_config',reasoning_effort:null,reasoning_effort_from:'codex_default',notices:[]};
    const c=source.indexOf('results.map((result) => ({',source.indexOf('source_snapshot: sourceSnapshot'));const d=source.indexOf('    })),',c);
    const clean=source.slice(source.indexOf('function sanitizeText('),source.indexOf('function platformCommand('));
    const rows=vm.runInNewContext(clean+'\n'+source.slice(c,d+7),{results:[{agent:'codex',status:'success',review:{verdict:'ACCEPT',findings:[]},route_settings:settings}],options:{governor:'claude'},personaFor:()=>null,clipped:(s,n)=>s.slice(0,n)});
    assert.deepEqual(plain(rows[0].route_settings),settings);
    const other=vm.runInNewContext(clean+'\n'+source.slice(c,d+7),{results:[{agent:'grok',status:'timeout'}],options:{governor:'claude'},personaFor:()=>null,clipped:(s,n)=>s.slice(0,n)});
    assert.ok(!('route_settings' in other[0]),'absent for other routes');
    const m0=source.indexOf('function mergePieceResults(');const m1=source.indexOf('\nfunction looksLikeDiff(',m0);
    const merged=vm.runInNewContext(source.slice(m0,m1)+';mergePieceResults',{STATUS_RANK:{},VERDICT_RANK:{},SCRATCH_ACCESS_NOTE:''})(
      [{id:'piece-01',results:[{agent:'codex',status:'timeout',route_settings:settings}]},{id:'piece-02',results:[{agent:'codex',status:'timeout',route_settings:settings}]}],['codex'],'claude');
    assert.deepEqual(plain(merged[0].route_settings),settings);
  });
  await test('the stale ".ensemble_reviews" working-directory wording is gone from the codex adapter',()=>{
    const a=source.indexOf('} else if (agent === "codex") {');const b=source.indexOf('} else if (agent === "claude") {',a);
    assert.ok(a>0&&b>a);assert.ok(!/\.ensemble_reviews/.test(source.slice(a,b)),'the codex adapter runs in a private temporary directory from createEvidenceWorkspace');
    const cleanup=fs.readFileSync(new URL('./adapter-cleanup.test.mjs',import.meta.url),'utf8');
    assert.ok(!/Codex's private directory sits in the reviewed project's \.ensemble_reviews/.test(cleanup),'adapter-cleanup test wording corrected');
  });
  // ---- probe and fingerprint parity (owner decision, 29 September 2026) ----
  let probes={};try{probes=await import('./probes.mjs');}catch{/* import failure is itself a failing check below */}
  const codexConfig='model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n';
  async function reviewArgs(fakeHome,staging=null){
    let seen=null;
    await adapter(fakeHome).invoke('codex',artifact,{governor:'other',timeoutMs:1000,...(staging?{staging}:{}),runProcess:async(_c,args)=>{seen=args;return {code:1,stdout:'',stderr:'authentication required'};}});
    return plain(seen);
  }
  await test('codex probe vectors send exactly the command the review sends, text and image',async()=>{
    const fakeHome=home(codexConfig);
    const settings=codexIsolationArgs({home:fakeHome,env:{},fs});
    const text=await reviewArgs(fakeHome);
    assert.deepEqual(plain(probes.reviewVector('codex',{promptPath:'P',projectDir:'D',prompt:'X',codexIsolation:settings.args}).args),text);
    assert.deepEqual(plain(probes.containmentVector('codex',{canaryPath:'C',promptPath:'P',projectDir:'D',prompt:'X',codexIsolation:settings.args}).args),text);
    const image=path.join(root,'probe.png');fs.writeFileSync(image,'synthetic');
    const withImage=await reviewArgs(fakeHome,{directory:root,attachments:[{name:'probe.png',modality:'image',staged_path:image}]});
    assert.deepEqual(plain(probes.inputProbeVector('codex',{filePath:image,projectDir:'D',prompt:'P',codexIsolation:settings.args}).args),withImage);
    // The variadic -i is closed by the next flag, never followed directly by the "-" prompt marker.
    const at=withImage.indexOf('-i');assert.ok(at>0&&withImage[at+2].startsWith('--'),'-i <file> is followed by a flag');
    // Without a reading the vector carries the fixed isolation only: no model, no effort.
    const bare=probes.reviewVector('codex',{promptPath:'P',projectDir:'D',prompt:'X'}).args;
    for(const flag of ['--ignore-user-config','--ignore-rules','project_doc_max_bytes=0','image_generation'])assert.ok(bare.includes(flag),flag);
    assert.ok(!bare.includes('-m')&&!bare.some(a=>a.startsWith('model_reasoning_effort')));
  });
  await test('runProbes and runModalityProbes read the user\'s Codex configuration read-only and pass it',async()=>{
    const fakeHome=home(codexConfig);const calls=[];
    const exec=async(_c,args,o)=>{calls.push(args);if(args[0]==='--version')return {code:0,stdout:'codex-cli 9.9.9',stderr:''};return {code:0,stdout:'NO-TOOLS',stderr:''};};
    await probes.runProbes('codex',{exec,command:'codex',tmpdir:root,timeoutMs:5000,home:fakeHome,env:{}});
    const sent=calls.filter(a=>a[0]==='exec');
    assert.equal(sent.length,2,'containment and review');
    for(const args of sent){assert.ok(args.includes('--ignore-user-config')&&args.includes('--ignore-rules'));assert.deepEqual(plain(args.slice(args.indexOf('-m'),args.indexOf('-m')+2)),['-m','gpt-6-astra']);assert.ok(args.includes('model_reasoning_effort=high'));}
    const modal=[];const registry={effective:()=>({schema:'momm-capabilities/1',routes:{codex:{input:{image:{level:'documented'}}}}}),writeOverlayEntry:()=>{},routable:()=>true};
    await probes.runModalityProbes('codex',{registry,exec:async(_c,args)=>{modal.push(args);return args[0]==='--version'?{code:0,stdout:'codex-cli 9.9.9',stderr:''}:{code:0,stdout:'Red.',stderr:''};},command:'codex',tmpdir:root,timeoutMs:5000,home:fakeHome,env:{},colour:'red',disclose:()=>{}});
    const imageRun=modal.find(a=>a.includes('-i'));
    assert.ok(imageRun,'the image cell was probed');
    assert.ok(imageRun.includes('--ignore-user-config')&&imageRun.includes('-m')&&imageRun.includes('model_reasoning_effort=high'));
  });
  await test('the command shape for codex input cells carries the isolation; legacy and generation shapes are unchanged',()=>{
    for(const modality of ['text','image','pdf']){
      assert.equal(isolation.shapeChangedSinceLegacy('codex','input',modality),true,`codex input ${modality} changed since 1.16.1`);
      const shape=isolation.commandShapeFor('codex','input',modality);
      for(const flag of ['--ignore-user-config','--ignore-rules','project_doc_max_bytes=0'])assert.ok(shape.args.includes(flag),flag);
      assert.ok(!shape.args.includes('-m')&&!shape.args.some(a=>String(a).startsWith('model_reasoning_effort')),'the user-chosen model and effort are not part of the shape');
    }
    assert.equal(isolation.shapeChangedSinceLegacy('codex','output','image_gen'),false,'codex generation is unchanged');
    // The 1.16.1 shape of a codex input cell, written out: no arguments, grants or environment.
    const legacy={schema:'momm-command-shape/2',route:'codex',direction:'input',modality:'image',permission:null,args:[],grants:[],env:{}};
    assert.equal(isolation.legacyCommandShapeSha256('codex','input','image'),createHash('sha256').update(JSON.stringify(legacy)).digest('hex'));
    for(const route of ['grok','claude','gemini','copilot','antigravity'])assert.equal(isolation.shapeChangedSinceLegacy(route,'input','image'),false,`${route} input unchanged`);
  });
}finally{
  const resolved=path.resolve(root);
  assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('momm-codex-isolation-test-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
console.log(JSON.stringify({node:process.version,passed:checks.filter(c=>c.passed).length,total:checks.length,checks},null,2));
process.exitCode=checks.every(c=>c.passed)?0:1;
