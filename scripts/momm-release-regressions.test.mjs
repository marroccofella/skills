import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2];
const read = p => fs.readFileSync(p, 'utf8');
if (mode === 'envelope' || mode === 'rejection') {
  const source = read('momm/scripts/multi-review.mjs');
  const helpers = source.slice(source.indexOf('function extractJsonObjects('), source.indexOf('\nfunction clipped('));
  const classifierStart = source.indexOf('  const transportOutput = agent === "copilot" ?');
  const classifierEnd = source.indexOf('  const problem = result.outputLimited ?', classifierStart);
  assert(classifierStart >= 0 && classifierEnd > classifierStart, 'Inspect changed classification boundaries; never test an empty extraction');
  const classifier = source.slice(classifierStart, classifierEnd);
  const ctx = vm.createContext({ Buffer, sanitizeText: value => ({value}), result: {}, agent: 'claude' });
  vm.runInContext(helpers + '\nfunction classify(result) {' + classifier + '\nreturn {status:"success"};}', ctx);
  const review = JSON.stringify({review_status:'complete', verdict:'ACCEPT', confidence:1, findings:[], summary:'Synthetic evidence'});
  const envelopes = [{status:'ERROR',response:review},{status:'FAILED',response:review},{is_error:true,type:'result',result:review},{error:{message:'synthetic'},response:review}];
  for (const envelope of envelopes) {
    const tails = mode === 'envelope' ? ['', '\n{"event":"telemetry"}'] : [''];
    for (const tail of tails) {
      ctx.result = {stdout:JSON.stringify(envelope)+tail,stderr:''};
      const actual = vm.runInContext('classify(result)',ctx);
      assert.equal(actual.status,'error', JSON.stringify({envelope:Object.keys(envelope),tail:!!tail,actual:actual.status}));
      assert.equal(actual.verdict,undefined);
    }
  }
  console.log('Real unwrap/classification source rejects explicit errors without accepting nested findings; mode='+mode);
} else if (mode === 'privacy') {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(),'momm-private-regression-'));
  try {
    for (const file of ['momm/references/cli/modalities.md','momm/scripts/capabilities.test.mjs','momm/scripts/modality.test.mjs']) {
      const dest=path.join(fixture,file); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,'safe placeholder');
    }
    fs.mkdirSync(path.join(fixture,'docs/new-guide'),{recursive:true});
    fs.writeFileSync(path.join(fixture,'docs/new-guide/index.html'),'Synthetic leak: '+['C:', 'Users', 'synthetic-person', 'private'].join('/'));
    fs.mkdirSync(path.join(fixture,'scripts'),{recursive:true});
    fs.copyFileSync('scripts/momm-release-privacy.test.mjs',path.join(fixture,'scripts/momm-release-privacy.test.mjs'));
    const r=spawnSync(process.execPath,['scripts/momm-release-privacy.test.mjs'],{cwd:fixture,encoding:'utf8',timeout:15000,windowsHide:true});
    assert.equal(r.error,undefined); assert.notEqual(r.status,0,'New public guide escaped the privacy scanner');
    assert.match(r.stderr,/placeholder homes|machine identities/);
    console.log('New public guide with a synthetic private home was refused.');
  } finally {
    assert.equal(fs.realpathSync(path.dirname(fixture)),fs.realpathSync(os.tmpdir()));
    assert(path.basename(fixture).startsWith('momm-private-regression-')); fs.rmSync(fixture,{recursive:true,force:true});
  }
} else if (mode === 'sitemap') {
  const source=read('scripts/render-momm-site.mjs');
  const block=source.slice(source.indexOf('  // Sibling skill guides'),source.indexOf('  urls.sort();',source.indexOf('  // Sibling skill guides')));
  assert(block.length>20);
  const ctx=vm.createContext({urls:[],root:'/fixture',path,fs:{existsSync:()=>true,readdirSync:()=>['scratch','myrepo'].map(name=>({name,isDirectory:()=>true}))}});
  vm.runInContext(block,ctx);
  assert(!ctx.urls.some(url=>url.endsWith('/scratch/')),'An unlisted scratch page leaked into the sitemap');
  assert(ctx.urls.some(url=>url.endsWith('/myrepo/')),'Published guides must remain discoverable');
  console.log('Sitemap includes the published guide but ignores scratch directories.');
 } else if (!mode) {
  for (const probe of ['envelope', 'privacy', 'sitemap', 'rejection']) {
    const run = spawnSync(process.execPath, [process.argv[1], probe], {cwd:process.cwd(),encoding:'utf8',timeout:30000,windowsHide:true});
    assert.equal(run.status,0,probe+': '+run.stdout+run.stderr);
    console.log('PASS '+probe);
  }
} else throw new Error('Unknown probe');
