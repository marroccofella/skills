import assert from 'node:assert/strict';
import fs from 'node:fs';
import {steps,routes,governors,scenarios,stateAt,draftTotal,fixedTotal,fixture} from '../docs/momm/workflow-data.mjs';
import {bindWorkflow} from '../docs/momm/workflow.mjs';
import {homeWorkflow} from './momm-site-flow.mjs';
const values=[12,8,5],original=[...values];
assert(Number.isNaN(draftTotal(values)));assert.equal(fixedTotal(values),25);assert.deepEqual(values,original);
assert.equal(fixedTotal([]),0);assert.equal(fixedTotal([9]),9);assert.deepEqual(fixture(),{input:[12,8,5],expected:25,draft:'NaN',fixed:25,unchanged:true,empty:0});
for(const governor of governors)for(const scenario of Object.keys(scenarios))for(let step=0;step<steps.length;step++){
 const state=stateAt(step,scenario,governor);assert.equal(state.peers.length,3);assert(!state.peers.some(p=>p.name===governor));
 if(step>=5){assert.equal(state.met,scenario!=='shortage');assert.equal(state.achieved,state.peers.filter(p=>p.status==='success').length);}
 if(scenario==='shortage'&&step>=5){assert(state.stopped);assert.equal(state.activeNode,'quorum');for(const p of state.peers.filter(p=>p.status!=='success'))assert(p.claim.includes('No valid review'));}
}
assert.throws(()=>stateAt(-1));assert.throws(()=>stateAt(9));assert.throws(()=>stateAt(0,'<script>'));assert.throws(()=>stateAt(0,'fix','not a route'));
const html=homeWorkflow();
assert.equal((html.match(/data-wf-step=/g)||[]).length,9);assert(html.includes('not a live model benchmark'));assert(html.includes('without MOMM can also test'));assert(html.includes('MOMM 1.16.0 protocol'));assert(!html.includes('autoplay'));
assert(html.includes('data-wf-controls hidden'));assert(html.includes('Read the full workflow'));assert(html.includes('without making model calls'));assert(!/zero-model/i.test(html));
for(const row of [steps[0],routes[0]])for(const key of Object.keys(row)){
 const saved=row[key];
 try{row[key]='fixture<&"probe';const markup=homeWorkflow();assert(!markup.includes('fixture<&"probe'));assert(markup.includes('fixture&lt;&amp;&quot;probe'));}
 finally{row[key]=saved;}
}
const home=fs.readFileSync(new URL('../docs/momm/index.html',import.meta.url),'utf8');
for(const asset of ['workflow.css','workflow.mjs'])assert(home.includes(asset));
assert(home.indexOf('id="architecture-library"')<home.indexOf('id="walkthrough"'));

// Minimal DOM harness: test finite playback, keyboard-button actions, reduced motion and route exclusion without dependencies.
class Element{
 constructor(){this.dataset={};this.attrs={};this.listeners={};this.children=[];this.hidden=false;this.disabled=false;this.textContent='';this.classList={toggle(){},add(){},remove(){}};}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,fn){this.listeners[k]=fn;}append(...c){this.children.push(...c);}replaceChildren(){this.children=[];}
 click(){this.listeners.click?.();}
}
const elements=new Map();
for(const name of ['play','back','next','governor','scenario','title','detail','example','actor','count','quorum','peers','success-output','blocked-output','output-heading','rejected','announcement','reset','controls','live'])elements.set(`[data-wf-${name}]`,new Element());
elements.get('[data-wf-governor]').value='Codex';elements.get('[data-wf-scenario]').value='fix';
const buttons=steps.map((_,i)=>{const el=new Element();el.dataset.wfStep=String(i);return el;});
const nodes=steps.map((s,i)=>{const el=new Element();el.dataset.wfNode=s.id;el.querySelector=()=>buttons[i];return el;});
const doc=new Element();doc.createElement=()=>new Element();doc.hidden=false;
const root=new Element();root.ownerDocument=doc;root.querySelector=q=>elements.get(q);root.querySelectorAll=q=>q==='[data-wf-node]'?nodes:buttons;
let timer=null;const media={matches:false,addEventListener(k,fn){this.change=fn;}};
const env={matchMedia:()=>media,setTimeout(fn){assert.equal(timer,null);timer=fn;return 1;},clearTimeout(){timer=null;}};
const controller=bindWorkflow(root,env);assert.equal(controller.getState().playing,false);
elements.get('[data-wf-play]').click();assert(controller.getState().playing);
for(let i=0;i<8;i++){const tick=timer;timer=null;tick();}
assert.equal(controller.getState().index,8);assert.equal(controller.getState().playing,false);assert.equal(timer,null);
elements.get('[data-wf-scenario]').value='shortage';elements.get('[data-wf-scenario]').listeners.change();
assert(buttons.slice(6).every(button=>button.disabled),'Later stages must be visibly and accessibly disabled when the review gate is blocked');
buttons[5].click();assert.equal(controller.getState().index,5);assert(elements.get('[data-wf-next]').disabled);assert(elements.get('[data-wf-success-output]').hidden);
elements.get('[data-wf-scenario]').value='fix';elements.get('[data-wf-scenario]').listeners.change();assert(buttons.every(button=>!button.disabled));
elements.get('[data-wf-governor]').value='Claude Code';elements.get('[data-wf-governor]').listeners.change();
assert.equal(controller.getState().index,0);assert(!elements.get('[data-wf-peers]').children.some(card=>card.children[0].textContent==='Claude Code'));
media.matches=true;media.change();elements.get('[data-wf-play]').click();assert.equal(controller.getState().index,1);assert.equal(timer,null);assert(!controller.getState().playing);
media.matches=false;media.change();elements.get('[data-wf-play]').click();doc.hidden=true;doc.listeners.visibilitychange();assert.equal(timer,null);assert(!controller.getState().playing);
assert.equal(bindWorkflow(null),null);
console.log('Workflow: real synthetic outputs; 189 route/scenario/step states; finite playback; fail-closed path; reduced motion; visibility pause; accessible static fallback pass.');
// Range review rev_20260925004814_1ed9f58c2c3a (codex suggestion 1, grok suggestion 20; governor-error-mislabeled):
// Grok can govern, so the teaching selector offers it, and a wrong governor is named as such.
{
  const data = await import('../docs/momm/workflow-data.mjs');
  assert(data.governors.includes('Grok'), 'Grok is offered as a governor');
  assert.throws(() => data.stateAt(0, 'fix', 'Nobody'), /governor/i);
  assert.throws(() => data.stateAt(0, 'nothing', 'Codex'), /scenario/i);
}
