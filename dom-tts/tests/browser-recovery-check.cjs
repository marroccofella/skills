const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createSession}=require('../scripts/experimental/browser-session');
const source=fs.readFileSync(path.resolve(__dirname,'../assets/browser/screen.js'),'utf8');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(){
 let clock=0,current=null,plays=0;const session=createSession({leaseMs:30,now:()=>clock}),calls=[],timers=[],events={},faults={poll:0,terminalAfterAccept:0,network:false,auth:false};
 const nodes=new Map(['voice','rate','enable','stop','disable','status','receipt'].map(id=>[id,{value:id==='rate'?'1.8':'',disabled:false,textContent:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},replaceChildren(){this.value='';},append(v){this.value||=v.value;}}]));
 const engine={voices:()=>[{voiceURI:'David',name:'David',lang:'en-US'}],busy:()=>!!current,speak:()=>{plays++;return new Promise(resolve=>{current=resolve;});},stop(){if(current){const end=current;current=null;end({state:'cancelled',startObserved:true,elapsedMs:1,localService:true});}},finish(){const end=current;current=null;end({state:'completed',startObserved:true,elapsedMs:1,localService:true});}};
 function timeout(){const e=Error('injected timeout');e.name='TimeoutError';throw e;}
 const context={document:{visibilityState:'visible',getElementById:id=>nodes.get(id),createElement:()=>({}),addEventListener:(k,fn)=>events[k]=fn},location:{hash:'#'+'a'.repeat(64),pathname:'/'},history:{replaceState(){}},sessionStorage:{getItem:()=> 'a'.repeat(64),setItem(){}},crypto:{getRandomValues:a=>a.fill(1)},AbortSignal,DomBrowserSpeech:{create:()=>engine},window:{speechSynthesis:{addEventListener(){}},SpeechSynthesisUtterance:function(){},addEventListener:(k,fn)=>events[k]=fn},setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},fetch:async(route,options)=>{
  calls.push(route);if(faults.network)timeout();const data=options.body?JSON.parse(options.body):{};if(faults.auth&&route==='/api/poll')return {ok:false,json:async()=>({error:'authentication-required'})};let value;
  if(route==='/api/preferences')value={voice:'David',rate:1.8};
  else if(route==='/api/enable')value=session.enable(data);
  else if(route==='/api/disable')value=session.disable(data);
  else if(route==='/api/stop'){session.queue.command('stop');value=session.stop();}
  else if(route==='/api/poll'){if(faults.poll>0){faults.poll--;timeout();}value=session.poll(data);}
  else if(route==='/api/receipt'){value=session.accept(data);if(data.state!=='speaking'&&faults.terminalAfterAccept>0){faults.terminalAfterAccept--;timeout();}}
  else throw Error('Unexpected fixture route');return {ok:true,json:async()=>value};
 }};
 vm.runInNewContext(source,context);
 return {session,calls,timers,events,faults,nodes,engine,advance:ms=>clock+=ms,plays:()=>plays,async enable(){await flush();const pending=nodes.get('enable').listeners.click();engine.finish();await pending;await flush();},async tick(){const t=timers.shift();assert(t);assert(t.ms<=10000);await t.fn();await flush();},close:()=>session.close()};
}
(async()=>{
 const f=fixture();try{
  await f.enable();f.advance(40);assert.equal(f.session.status().health.browserState,'lease-expired');f.faults.poll=12;for(let i=0;i<12;i++)await f.tick();assert.match(f.nodes.get('status').textContent,/Reconnecting/);assert.equal(f.calls.filter(x=>x==='/api/enable').length,1);await f.tick();assert.equal(f.session.status().connected,true);assert.equal(f.plays(),1);
  const active=f.session.submit({text:'Supplied fixed cancellation fixture.'});await f.tick();assert.equal(f.plays(),2);f.faults.poll=1;await f.tick();f.faults.terminalAfterAccept=1;await f.tick();assert.equal(f.session.receipt(active.id).state,'cancelled');await f.tick();assert.equal(f.plays(),2,'lost terminal acknowledgement must not replay');assert.equal(f.session.status().active,null);
  f.faults.network=true;f.nodes.get('stop').listeners.click();await flush();f.faults.network=false;const mark=f.calls.length;await f.tick();assert.equal(f.calls[mark],'/api/stop','Stop must settle before another poll');assert.equal(f.session.queue.status().stopped,true);
  f.nodes.get('disable').listeners.click();await flush();const count=f.calls.length;f.events.online();f.events.visibilitychange();await f.tick();assert.equal(f.calls.length,count);assert.equal(f.session.status().health.browserState,'disabled');
  assert(!JSON.stringify(f.session.status().health).includes('Supplied fixed'));assert(f.session.status().health.transitions.length<=24);
 }finally{f.close();}
 const denied=fixture();try{await denied.enable();denied.faults.auth=true;await denied.tick();const n=denied.calls.length;denied.events.online();await denied.tick();assert.equal(denied.calls.length,n);assert.match(denied.nodes.get('status').textContent,/Enable again/);}finally{denied.close();}
 const wake=fixture();try{await wake.enable();wake.faults.poll=6;for(let i=0;i<6;i++)await wake.tick();wake.faults.poll=0;wake.events.visibilitychange();await flush();assert.equal(wake.session.status().connected,true);assert.equal(wake.timers.length,1,'wake must not duplicate polling loops');wake.events.pagehide();await flush();const n=wake.calls.length;wake.events.pageshow();wake.events.online();await wake.tick();assert.equal(wake.calls.length,n);}finally{wake.close();}
 console.log('PASS: actual screen survives12 transient failures, renews same-document lease, cancels interrupted audio without replay after lost acknowledgement, reconciles offline Stop before polling, honors Disable/auth/pagehide, and wakes without duplicate loops. Injected browser events; no sleep/audio certification.');
})().catch(error=>{console.error(error);process.exitCode=1;});
