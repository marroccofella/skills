import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ReviewerRegistry,normalizeEndpoint} from './reviewer-registry.mjs';
import {applyReviewerSettings} from './reviewer-selection.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'momm-registry-test-'));
const root=path.join(fixture,'private');const registry=new ReviewerRegistry({root});let count=0;
const test=(name,fn)=>{fn();count++;};
const command=value=>registry.command({...value,revision:registry.read().revision});
try {
  test('save and restart preserve a disabled Bab',()=>{command({op:'save',profile:{label:'Bab',kind:'bumbler'}});const p=new ReviewerRegistry({root}).snapshot().profiles[0];assert.equal(p.label,'Bab');assert.equal(p.state,'draft');assert.equal(p.quorum_eligible,false);});
  const bab=registry.read().profiles[0].id;
  test('no arbitrary fields or credential imports',()=>{assert.throws(()=>command({op:'save',profile:{label:'Forged',quorum_eligible:true}}));assert.throws(()=>command({op:'save',profile:{label:'Forged'},connector:{base_url:'https://example.test/v1',secret_ref:'foreign'}}));});
  test('stale revisions never overwrite',()=>{assert.throws(()=>registry.command({op:'archive',id:bab,revision:0}),/another window/);assert.equal(registry.snapshot().profiles[0].state,'draft');});
  test('unknown CLI cannot become arbitrary shell execution',()=>{assert.throws(()=>command({op:'save',profile:{label:'Bad',kind:'cli',route:'custom-command'}}),/reviewed adapter/);});
  test('shared normalized connectors have one resource identity',()=>{for(const label of ['One','Two'])command({op:'save',profile:{label},connector:{base_url:'https://EXAMPLE.test:443/v1/'}});const state=registry.read();assert.equal(state.connectors.length,1);assert.equal(state.profiles[1].connector_id,state.profiles[2].connector_id);});
  test('unsafe addresses and certificates refused',()=>{for(const url of ['http://example.test/v1','https://localhost/v1','https://127.0.0.1/v1','https://169.254.169.254/v1','https://u:p@example.test/v1','https://example.test/v1?x=1'])assert.throws(()=>normalizeEndpoint(url));assert.throws(()=>command({op:'save',profile:{label:'Bad'},connector:{base_url:'https://example.test/v1',certificate:'BEGIN PRIVATE KEY'}}));});
  test('wording approval binds exact saved hash',()=>{command({op:'wording',id:bab,wording:'Focus on boundary cases.'});const p=registry.read().profiles[0];assert.equal(p.overlay_approved,false);assert.throws(()=>command({op:'approve_wording',id:bab,hash:'old'}));command({op:'approve_wording',id:bab,hash:p.overlay_hash});assert.equal(registry.read().profiles[0].overlay_approved,true);});
  test('duplicate is a new disabled identity without approval',()=>{command({op:'duplicate',id:bab});const p=registry.read().profiles.at(-1);assert.notEqual(p.id,bab);assert.equal(p.state,'disabled');assert.equal(p.overlay_approved,false);});
  test('archive and Undo retain original events',()=>{const before=registry.read().events.length;command({op:'archive',id:bab});assert(!registry.snapshot().profiles.some(p=>p.id===bab));assert(registry.snapshot({state:'archived'}).profiles.some(p=>p.id===bab));command({op:'undo',id:bab});assert.equal(registry.read().profiles[0].state,'disabled');assert(registry.read().events.length>before);});
  test('remote tests cannot perform any credential operation',()=>{const bytes=fs.readFileSync(registry.file);for(const op of ['test','qualify','enable','rotate','revoke'])assert.throws(()=>command({op,id:bab}),/No request or credential operation/);assert.deepEqual(fs.readFileSync(registry.file),bytes);});
  test('exclusion retains quorum and rejects explicit bypass',()=>{command({op:'exclude_cli',route:'copilot'});const options={governor:'codex',reviewers:['claude','copilot'],minSuccess:2};assert.throws(()=>applyReviewerSettings(options,{root}),/quorum/);assert.throws(()=>applyReviewerSettings({governor:'codex',reviewers:['copilot'],reviewersExplicit:true},{root}),/excluded/);command({op:'restore_cli',route:'copilot'});});
  test('one thousand saved profiles stay bounded and paged',()=>{registry.mutate(registry.read().revision,state=>{const p=state.profiles[0];for(let n=state.profiles.length;n<1000;n++)state.profiles.push({...p,id:`fixture-profile-${n}`,label:`Bee ${n}`});});assert.equal(registry.snapshot().profiles.length,25);assert.equal(registry.snapshot().counts.registered,1000);assert.throws(()=>command({op:'duplicate',id:bab}),/limit/);});
  test('unsupported migration retains original bytes',()=>{const original=fs.readFileSync(registry.file);const data=JSON.parse(original);data.schema='unsupported/99';fs.writeFileSync(registry.file,JSON.stringify(data));const unsupported=fs.readFileSync(registry.file);assert.throws(()=>registry.read(),/Unsupported registry/);assert.deepEqual(fs.readFileSync(registry.file),unsupported);fs.writeFileSync(registry.file,original);});
  console.log(JSON.stringify({passed:true,checks:count,network_calls:0,live_fleet:false}));
}finally{assert(path.resolve(fixture).startsWith(path.resolve(os.tmpdir())+path.sep+'momm-registry-test-'));fs.rmSync(fixture,{recursive:true,force:true});}
