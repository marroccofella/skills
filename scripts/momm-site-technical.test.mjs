import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stackingModel,bindStackingModel} from '../docs/momm/stacking-model.mjs';
import {routeBrands,brandBadge,ensembleObservations,technicalBody} from './momm-site-technical.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
assert.equal(stackingModel({reviewers:10,blindSpot:0}).missReduction,512);
assert.equal(stackingModel({reviewers:4}).miss,0.15625);
assert.equal(stackingModel({reviewers:10,blindSpot:1}).miss,1);
assert.equal(stackingModel({detection:0}).miss,1);
assert.equal(stackingModel({detection:1,blindSpot:0}).missReduction,null);
for(const args of [{reviewers:0},{reviewers:11},{reviewers:1.1},{reviewers:NaN},{detection:Infinity},{detection:-0.1},{blindSpot:1.1}])assert.throws(()=>stackingModel(args),RangeError);
for(let n=2;n<=10;n++)assert(stackingModel({reviewers:n}).miss<=stackingModel({reviewers:n-1}).miss);
let listener,submitted=false;
const controls={reviewers:{value:'4'},detection:{value:'50'},blindSpot:{value:'10'}};
const output={textContent:''},form={elements:controls,addEventListener:(name,fn)=>{if(name==='input')listener=fn;else fn({preventDefault:()=>submitted=true});}};
bindStackingModel({getElementById:id=>id==='stacking-controls'?form:output});
assert(output.textContent.includes('15.63%'));assert(output.textContent.includes('not a MOMM benchmark'));assert(submitted);
controls.blindSpot.value='0';controls.reviewers.value='10';listener();assert(output.textContent.includes('512.00×'));
controls.detection.value='';listener();assert(output.textContent.startsWith('Enter'));
controls.detection.value='100';listener();assert(output.textContent.includes('undefined'));
bindStackingModel({getElementById:()=>null});

const data=JSON.parse(read('docs/evidence/momm-evidence.json')),s=JSON.parse(read('docs/momm/data/public-stats.json'));
const obs=ensembleObservations(data);
assert.equal(Object.values(obs.distribution).reduce((a,b)=>a+b,0),s.stored_reports);
assert.equal(obs.successful_route_results,s.stored_successes);
assert.deepEqual(obs,JSON.parse(read('docs/momm/data/ensemble-observations.json')));
assert.equal(obs.rows.length,new Set(obs.rows.map(r=>r.run_id)).size);
const sparse=ensembleObservations({generated:'fixture',reports:{a:{report:{}},b:{report:{reviewers:[{status:'self_excluded'},{status:'timeout'}]}}}});
assert.deepEqual(sparse.distribution,{'0':2});assert.equal(sparse.successful_route_results,0);
assert.equal(sparse.rows[1].stored_external_results,1);

const html=read('docs/momm/technical.html');
assert.equal((html.match(/<figure /g)||[]).length,7);
assert(html.includes('not a measured MOMM result')||html.includes('Neither figure is a measured MOMM result'));
assert(html.includes('1.15.1'));assert(html.includes('not describe unreleased 1.16 features'));
assert(html.includes('independently defined oracle'));assert(html.includes('existing CLI account routes'));
const future=technicalBody(data,s,'9.9.9');assert(future.includes('current catalogue version: 9.9.9'));assert(future.includes('Architecture baseline: released MOMM 1.15.1'));
for(const [,file] of html.matchAll(/https:\/\/github\.com\/marroccofella\/skills\/blob\/momm-1\.15\.1\/([^"#]+)/g))assert(fs.existsSync(path.join(root,file)),'source link missing: '+file);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
assert(!/(?:fetch\(|localStorage|sendBeacon|XMLHttpRequest)/.test(read('docs/momm/stacking-model.mjs')));

const provenance=JSON.parse(read('docs/momm/brands/provenance.json'));
assert.equal(provenance.assets.length,4);assert.equal(provenance.text_fallbacks.length,2);
for(const entry of provenance.assets){
  const bytes=fs.readFileSync(path.join(root,'docs/momm/brands',entry.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file+': brand bytes changed');
  assert(entry.source.startsWith('https://'));assert(entry.guidelines.startsWith('https://'));
  if(entry.file.endsWith('.svg'))assert(!/<script|<foreignObject|\bon\w+=|(?:href|src)\s*=/i.test(bytes.toString()),'unexpected active SVG');
}
for(const r of routeBrands){const badge=brandBadge(r.id);assert(badge.includes(r.label));if(r.asset)assert(provenance.assets.some(a=>a.file===r.asset));else assert(!badge.includes('<img'));}
assert.throws(()=>brandBadge('invented-model'));
const ledger=read('docs/evidence/index.html');assert(ledger.includes("const marks = {codex:'openai.svg'"));assert(!ledger.includes('visible only to you'));
assert(!read('docs/index.html').includes('visible only to you'));
assert(read('docs/momm/index.html').includes('brands/openai.svg'));
// Check every static HTML page, not just the new paper. Script strings are not
// DOM links, and fragment targets are checked in the destination's static body.
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const staticHtml=f=>fs.readFileSync(f,'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'');
let pagesChecked=0, linksChecked=0;
for(const file of walk(path.join(root,'docs')).filter(f=>f.endsWith('.html'))){
  pagesChecked++;
  for(const [,value] of staticHtml(file).matchAll(/(?:href|src)="([^"]+)"/g)){
    if(/^(?:https?:|mailto:|data:)/.test(value))continue;
    const [relative,fragment]=value.split('#');
    const relativePath=relative.split('?')[0];
    const dest=relativePath?path.resolve(path.dirname(file),decodeURIComponent(relativePath)):file;
    assert(fs.existsSync(dest),file+': missing '+value);
    const resolved=fs.statSync(dest).isDirectory()?path.join(dest,'index.html'):dest;
    assert(fs.existsSync(resolved),file+': directory index missing '+value);
    if(fragment&&resolved.endsWith('.html'))assert(staticHtml(resolved).includes(`id="${decodeURIComponent(fragment)}"`),file+': missing anchor '+value);
    linksChecked++;
  }
}
console.log(`Whole-site static link audit: ${pagesChecked} pages and ${linksChecked} local references pass.`);
console.log('Technical paper: probability boundaries, controls, observed counts, source paths, 7 diagrams and 4 original-logo hashes pass.');
