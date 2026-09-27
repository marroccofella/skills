import {steps,stateAt} from './workflow-data.mjs';
export function bindWorkflow(root,env=globalThis){
 if(!root)return null;
 const doc=root.ownerDocument, get=q=>root.querySelector(q);
 const play=get('[data-wf-play]'),back=get('[data-wf-back]'),next=get('[data-wf-next]'),gov=get('[data-wf-governor]'),scenario=get('[data-wf-scenario]');
 const reduced=env.matchMedia?.('(prefers-reduced-motion: reduce)');
 let index=0,playing=false,timer=null;
 const stop=()=>{playing=false;if(timer!==null)env.clearTimeout(timer);timer=null;root.classList.remove('wf-playing');play.textContent=reduced?.matches?'Step through workflow':'▶ Play the workflow';play.setAttribute('aria-pressed','false');};
 function render(announce=true){
  const state=stateAt(index,scenario.value,gov.value);
  root.dataset.path=scenario.value;root.dataset.step=String(index);
  for(const node of root.querySelectorAll('[data-wf-node]')){
   node.classList.toggle('wf-active',node.dataset.wfNode===state.activeNode);
   node.classList.toggle('wf-done',steps.findIndex(s=>s.id===node.dataset.wfNode)<index&&!state.stopped);
   const button=node.querySelector('button');button.removeAttribute('aria-current');
   button.disabled=scenario.value==='shortage'&&Number(button.dataset.wfStep)>5;
   if(node.dataset.wfNode===state.activeNode)button.setAttribute('aria-current','step');
  }
  get('[data-wf-title]').textContent=state.title;get('[data-wf-detail]').textContent=state.detail;get('[data-wf-example]').textContent=state.example;
  get('[data-wf-actor]').textContent=index===1||index===6||index===7?`${gov.value} · governor only`:steps[index].actor;
  get('[data-wf-count]').textContent=`${String(index+1).padStart(2,'0')} / 09`;
  get('[data-wf-quorum]').textContent=index<5?'Reviews not counted yet':`${state.achieved} / ${state.required} required${state.met?' · minimum met':' · not met'}`;
  const panel=get('[data-wf-peers]');panel.replaceChildren();
  for(const peer of state.peers){
   const card=doc.createElement('article');card.className='wf-peer';card.dataset.status=peer.status;
   const heading=doc.createElement('h4');heading.textContent=peer.name;
   const badge=doc.createElement('span');badge.className='wf-peer-status';badge.textContent=peer.status;
   const angle=doc.createElement('p');angle.className='wf-peer-angle';angle.textContent=`${peer.angle} · ${peer.description}`;
   const claim=doc.createElement('p');claim.textContent=peer.claim;
   card.append(heading,badge,angle,claim);panel.append(card);
  }
  const blocked=scenario.value==='shortage';
  get('[data-wf-success-output]').hidden=blocked;get('[data-wf-blocked-output]').hidden=!blocked;
  get('[data-wf-output-heading]').textContent=blocked?'An honest stop, not a thin pass.':'A result with a reason to trust the change.';
  get('[data-wf-rejected]').hidden=scenario.value!=='disagreement';
  back.disabled=index===0;next.disabled=index===(blocked?5:8);
  if(announce)get('[data-wf-announcement]').textContent=`Step ${index+1}. ${state.title}`;
 }
 function schedule(){timer=env.setTimeout(()=>{timer=null;if(!playing)return;index++;render();if(index===(scenario.value==='shortage'?5:8))stop();else schedule();},5500);}
 play.addEventListener('click',()=>{
  if(reduced?.matches){stop();index=index===(scenario.value==='shortage'?5:8)?0:index+1;render();return;}
  if(playing){stop();return;}
  if(index===(scenario.value==='shortage'?5:8))index=0;
  playing=true;root.classList.add('wf-playing');play.textContent='Pause';play.setAttribute('aria-pressed','true');render();schedule();
 });
 function go(value){stop();index=Math.min(value,scenario.value==='shortage'?5:8);render();}
 back.addEventListener('click',()=>go(Math.max(0,index-1)));next.addEventListener('click',()=>go(index+1));get('[data-wf-reset]').addEventListener('click',()=>go(0));
 for(const button of root.querySelectorAll('[data-wf-step]')){button.disabled=false;button.addEventListener('click',()=>go(Number(button.dataset.wfStep)));}
 gov.addEventListener('change',()=>go(0));scenario.addEventListener('change',()=>go(0));
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stop();});
 reduced?.addEventListener?.('change',stop);
 if(env.IntersectionObserver){const observer=new env.IntersectionObserver(entries=>{if(!entries[0].isIntersecting)stop();});observer.observe(root);}
 get('[data-wf-controls]').hidden=false;get('[data-wf-live]').hidden=false;stop();render(false);
 return {getState:()=>({index,playing,scenario:scenario.value,governor:gov.value}),stop};
}
if(typeof document!=='undefined')bindWorkflow(document.querySelector('.workflow'));
