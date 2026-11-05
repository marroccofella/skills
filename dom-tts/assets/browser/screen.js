'use strict';
const byId=id=>document.getElementById(id),key='dom-tts-browser-access';
const fragment=location.hash.slice(1),token=/^[a-f0-9]{64}$/.test(fragment)?fragment:null;
try{sessionStorage.removeItem(key);}catch{}if(token)history.replaceState(null,'',location.pathname);
const browserCrypto=globalThis.crypto,client=browserCrypto?.getRandomValues?Array.from(browserCrypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''):'';
let rpc=null;try{if(token)rpc=DomBrowserRpc.create({token,port:Number(location.port),crypto:browserCrypto});}catch{}
let enabled=false,job=null,opening=false,openingEpoch=null,openingInvalidated=false,preferences=null,preferencesApplied=false,preferencesLoaded=false,intent=0,idleFailures=0;
let pendingReceipt=null,stopRequested=false,cycling=false,pollTimer=null,wakePending=false;
let identityProofRequired=false,identityProofFailures=0,identityFaultVersion=0,retainOwnedReceipt=false;
const supported='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
async function api(route,data,options){if(!rpc)throw Error('browser-server-identity-unverified');const requestIntent=intent;try{return await rpc.request(route,data,options);}catch(error){if(enabled&&requestIntent===intent&&unverifiedIdentity(error)&&route!=='/api/status')quarantineIdentity();throw error;}finally{if(job&&job.controlEpoch<rpc.epoch()&&!job.epochCancelRequested){job.epochCancelRequested=true;engine.stop();}if(opening&&openingEpoch<rpc.epoch()&&!openingInvalidated){openingInvalidated=true;if(!job&&engine.busy())engine.stop();byId('status').textContent='Introduction stopped. Enable again when ready.';}}}
function display(value){byId('receipt').textContent=JSON.stringify(value,null,2);byId('status').textContent={queued:'Reply queued. Waiting for speech to start.',speaking:'Speaking through your local voice.',completed:'The browser reports speech completed.',cancelled:'Speech stopped.',failed:'Speech failed: '+(value.code||'browser-error')}[value.state]||'Ready for spoken replies.';}
const engine=DomBrowserSpeech.create({synth:supported?window.speechSynthesis:null,Utterance:supported?window.SpeechSynthesisUtterance:null,onState:value=>{display(value);if(value.state==='speaking'&&job){const attempt=intent;api('/api/receipt',{client,id:job.id,state:'speaking'}).catch(error=>{if(enabled&&attempt===intent)transportFault(error);});}}});
const unverifiedIdentity=error=>error?.message==='browser-server-identity-unverified';
function quarantineIdentity(){identityProofRequired=true;identityFaultVersion++;retainOwnedReceipt=true;if(job||engine.busy())engine.stop();byId('status').textContent='Revalidating spoken replies… Interrupted speech will not be replayed.';}
function fail(preserveOwned=false){enabled=false;idleFailures=0;if(!preserveOwned){pendingReceipt=null;identityProofRequired=false;identityProofFailures=0;retainOwnedReceipt=false;}engine.stop();byId('enable').disabled=opening||!engine.voices().length||!preferencesLoaded;byId('voice').disabled=false;byId('rate').disabled=false;byId('status').textContent=preserveOwned?'Voice connection could not be verified. Enable again or open a fresh companion link.':'Voice authorization or session changed. Enable again to reconnect.';}
function transportFault(error,proof=false){
 if(unverifiedIdentity(error)){if(!identityProofRequired)quarantineIdentity();if(proof&&++identityProofFailures>=3){fail(true);return;}idleFailures=Math.min(16,idleFailures+1);byId('status').textContent='Revalidating spoken replies… Interrupted speech will not be replayed.';return;}
 const transient=error instanceof TypeError||error.name==='TimeoutError'||error.name==='AbortError';if(!transient){fail();return;}idleFailures=Math.min(16,idleFailures+1);if(job||engine.busy())engine.stop();byId('status').textContent='Reconnecting spoken replies… Interrupted speech will not be replayed.';
}
async function revalidateIdentity(attempt,manual=false){
 const version=identityFaultVersion;let status;
 try{status=await api('/api/status');}catch(error){if(attempt===intent&&(enabled||manual)){if(manual)fail(true);else transportFault(error,true);}return false;}
 if(attempt!==intent||!enabled&&!manual||version!==identityFaultVersion)return false;
 const state=status?.health?.browserState;
 const recognized=status?.connected===true&&state==='connected'||status?.connected===false&&['lease-expired','disabled','not-enabled'].includes(state);
 if(!recognized||!Number.isSafeInteger(status.stopEpoch)||status.stopEpoch!==rpc.epoch()){
  if(manual)fail(true);else transportFault(Error('browser-server-identity-unverified'),true);return false;
 }
 if(!status.connected&&state!=='lease-expired'){if(!manual){fail();return false;}pendingReceipt=null;}
 identityProofRequired=false;identityProofFailures=0;retainOwnedReceipt=false;return true;
}
function refresh(){if(enabled||opening)return;const old=byId('voice').value;byId('voice').replaceChildren();const voices=engine.voices();for(const voice of voices){const option=document.createElement('option');option.value=voice.voiceURI;option.textContent=voice.name+' · '+voice.lang;byId('voice').append(option);}const saved=preferences&&!preferencesApplied&&preferences.voice;const selected=voices.find(v=>v.voiceURI===(saved||old))||voices.find(v=>/^en/i.test(v.lang)&&/David/i.test(v.name))||voices.find(v=>/^en/i.test(v.lang))||voices[0];if(selected)byId('voice').value=selected.voiceURI;const missing=saved&&voices.length&&!voices.some(v=>v.voiceURI===saved);if(missing)byId('voice').value='';if(preferences&&!preferencesApplied){byId('rate').value=preferences.rate??0.9;if(voices.length)preferencesApplied=true;}byId('enable').disabled=!byId('voice').value||!token||!rpc||!preferencesLoaded;byId('status').textContent=!token?'Open the freshly printed companion link provided by Dom TTS.':!rpc?'Browser encryption is unavailable. Reopen the updated companion with a supported browser.':missing?'Saved voice unavailable. Choose a local voice.':voices.length?'Local voice ready. Enable spoken replies.':'No local browser voice is available.';}
byId('voice').addEventListener('change',()=>{preferencesApplied=true;byId('enable').disabled=!byId('voice').value||!token||!rpc||!preferencesLoaded;byId('status').textContent='Local voice selected. Enable spoken replies.';});
byId('enable').addEventListener('click',async()=>{if(!rpc||opening||enabled||engine.busy()||job)return;opening=true;const attempt=++intent,epoch=rpc.epoch();let recoveryCleanup=false;openingEpoch=epoch;openingInvalidated=false;byId('enable').disabled=true;try{
 if(identityProofRequired||pendingReceipt||stopRequested){recoveryCleanup=true;if(!await revalidateIdentity(attempt,true)||attempt!==intent||openingInvalidated)return;if(stopRequested){await api('/api/stop',{});if(attempt!==intent)return;stopRequested=false;if(openingInvalidated)return;}if(pendingReceipt){const owned=pendingReceipt;await api('/api/receipt',owned);if(attempt!==intent||openingInvalidated)return;if(pendingReceipt===owned)pendingReceipt=null;}recoveryCleanup=false;}
 const voice=byId('voice').value,rate=Number(byId('rate').value);const receipt=await engine.speak('Hal here. Spoken replies are ready.',voice,rate);if(attempt!==intent||openingInvalidated)return;if(receipt.state!=='completed'||!receipt.startObserved)throw Error('preview-failed');await api('/api/enable',{client,voice,rate},{epoch});if(attempt!==intent){await api('/api/disable',{client}).catch(()=>{});return;}if(openingInvalidated)return;if(epoch!==rpc.epoch()){fail();return;}enabled=true;byId('voice').disabled=byId('rate').disabled=true;byId('status').textContent='Spoken replies enabled. Keep this page open.';}catch(error){if(attempt===intent&&!openingInvalidated){if(unverifiedIdentity(error)||recoveryCleanup&&(error instanceof TypeError||error.name==='TimeoutError'||error.name==='AbortError')){quarantineIdentity();fail(true);}else fail();}}finally{opening=false;openingEpoch=null;byId('enable').disabled=enabled||!engine.voices().length||!preferencesLoaded;}});
byId('stop').addEventListener('click',()=>{if(opening){intent++;openingInvalidated=true;}stopRequested=true;engine.stop();const attempt=intent;api('/api/stop',{}).then(()=>{if(attempt===intent)stopRequested=false;}).catch(error=>{if(enabled&&attempt===intent)transportFault(error);});});
byId('disable').addEventListener('click',()=>{if(opening)openingInvalidated=true;intent++;enabled=false;idleFailures=0;pendingReceipt=null;identityProofRequired=false;identityProofFailures=0;retainOwnedReceipt=false;engine.stop();api('/api/disable',{client}).catch(()=>{});byId('voice').disabled=byId('rate').disabled=false;byId('enable').disabled=opening||!engine.voices().length||!preferencesLoaded;byId('status').textContent='Spoken replies disabled.';});
async function cycle(){if(cycling)return;cycling=true;const attempt=intent;try{if(enabled){
 if(identityProofRequired){if(!await revalidateIdentity(attempt)||identityProofRequired)return;}
 if(stopRequested){await api('/api/stop',{});if(!enabled||attempt!==intent)return;stopRequested=false;}
 if(identityProofRequired)return;
 if(pendingReceipt){const owned=pendingReceipt;await api('/api/receipt',owned);if(!enabled||attempt!==intent||identityProofRequired)return;if(pendingReceipt===owned)pendingReceipt=null;}
 const command=await api('/api/poll',{client});if(!enabled||attempt!==intent||identityProofRequired)return;
 if(!Number.isSafeInteger(command.controlEpoch)||command.controlEpoch!==rpc.epoch()){idleFailures=0;return;}
 if(command.reconnected||idleFailures)byId('status').textContent='Spoken replies reconnected. Ready for your next reply.';idleFailures=0;
 if(command.action==='disconnect'){fail();}
 else if(command.action==='cancel'){if(job&&job.id===command.id)engine.stop();else pendingReceipt={client,id:command.id,state:'cancelled',startObserved:false,elapsedMs:0,localService:true};}
 else if(command.action==='speak'&&!job&&!pendingReceipt){job=command;const owned=job;engine.speak(command.text,command.voice,command.rate).catch(()=>({state:'failed',startObserved:false,elapsedMs:0,localService:true})).then(receipt=>{if((enabled||retainOwnedReceipt)&&attempt===intent)pendingReceipt={client,id:owned.id,...receipt};if(job===owned)job=null;});}
 }}catch(error){if(enabled&&attempt===intent)transportFault(error);}finally{cycling=false;const delay=wakePending?0:idleFailures?Math.min(10000,250*2**Math.min(idleFailures,6)):250;wakePending=false;pollTimer=setTimeout(cycle,delay);}}
function wake(){if(!enabled)return;idleFailures=0;if(cycling){wakePending=true;return;}if(pollTimer!==null)clearTimeout(pollTimer);pollTimer=null;cycle();}
window.addEventListener('online',wake);
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')wake();});
let pageLeaving=false;
function leavePage(){if(pageLeaving)return;pageLeaving=true;if(opening)openingInvalidated=true;enabled=false;intent++;idleFailures=0;pendingReceipt=null;identityProofRequired=false;identityProofFailures=0;retainOwnedReceipt=false;engine.stop();byId('voice').disabled=byId('rate').disabled=false;byId('enable').disabled=opening||!engine.voices().length||!preferencesLoaded;byId('status').textContent='Spoken replies disabled. Enable again after returning to this page.';if(rpc)api('/api/disable',{client},{keepalive:true}).catch(()=>{});}
window.addEventListener('pagehide',leavePage);
window.addEventListener('beforeunload',leavePage);
window.addEventListener('pageshow',()=>{pageLeaving=false;});
if(supported)window.speechSynthesis.addEventListener('voiceschanged',refresh);refresh();if(token&&rpc)api('/api/preferences').then(value=>{preferences=value;preferencesLoaded=true;refresh();}).catch(()=>{byId('enable').disabled=true;byId('status').textContent='Voice settings unavailable. Reopen the current companion link.';});cycle();
