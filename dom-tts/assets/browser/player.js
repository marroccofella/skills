(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DomBrowserSpeech=factory();})(typeof window==='object'?window:null,function(){
 'use strict';
 const codes=new Set(['audio-busy','audio-hardware','network','synthesis-unavailable','synthesis-failed','language-unavailable','voice-unavailable','text-too-long','invalid-argument','not-allowed','interrupted','canceled']);
 function create({synth,Utterance,onState=()=>{},deadlineMs=45000}={}){
  let active=null;
  const emit=value=>{try{onState(value);}catch{}};
  const voices=()=>synth&&typeof synth.getVoices==='function'?synth.getVoices().filter(v=>v.localService===true):[];
  function stop(){if(!active)return {state:'idle'};const current=active;current.finish({state:'cancelled',code:'owned-stop'});try{synth.cancel();}catch{}return {state:'cancelled',code:'owned-stop'};}
  function speak(text,voiceURI,rate=0.9){
   if(!synth||typeof Utterance!=='function')return Promise.reject(Error('browser-speech-unavailable'));
   if(typeof text!=='string'||!text.trim()||text.length>1000||!Number.isFinite(rate)||rate<0.5||rate>2)return Promise.reject(Error('invalid-input'));
   if(active||synth.speaking||synth.pending)return Promise.reject(Error('speech-busy'));
   const voice=voices().find(v=>v.voiceURI===voiceURI);if(!voice)return Promise.reject(Error('local-voice-required'));
   return new Promise(resolve=>{
    const utterance=new Utterance(text);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=rate;utterance.pitch=1;utterance.volume=1;
    const began=Date.now();let started=false,timer;
    const current={utterance,finish(value){if(active!==current)return;clearTimeout(timer);active=null;utterance.onstart=utterance.onend=utterance.onerror=null;const receipt={...value,startObserved:started,elapsedMs:Date.now()-began,localService:true,humanHearing:'unconfirmed'};emit(receipt);resolve(receipt);}};
    active=current;
    utterance.onstart=()=>{if(active!==current)return;started=true;emit({state:'speaking',localService:true,voice:voice.name,rate});};
    utterance.onend=()=>current.finish({state:'completed'});
    utterance.onerror=event=>current.finish({state:'failed',code:codes.has(event.error)?event.error:'speech-error'});
    timer=setTimeout(()=>{current.finish({state:'failed',code:'speech-timeout'});try{synth.cancel();}catch{}},deadlineMs);
    emit({state:'queued',localService:true,voice:voice.name,rate});
    try{synth.speak(utterance);}catch{current.finish({state:'failed',code:'speech-launch-failed'});}
   });
  }
  return {voices,speak,stop,busy:()=>!!active};
 }
 return {create};
});
