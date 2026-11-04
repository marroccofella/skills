// Capture only after the caller's explicit Record action. Audio stays in memory.
(function(root){
 function createCapture({mediaDevices,Recorder,onState=()=>{},onAudio=()=>{},maxBytes=5*1024*1024,maxMs=60000,expiryMs=120000}={}){
  let epoch=0,stream=null,recorder=null,chunks=[],bytes=0,timer=null,expiry=null,recording=null;
  const tracks=()=>{stream?.getTracks().forEach(track=>track.stop());stream=null;};
  function clear(){clearTimeout(timer);timer=null;tracks();chunks=[];bytes=0;}
  function discard(){epoch++;clearTimeout(expiry);expiry=null;if(recorder&&recorder.state!=='inactive')try{recorder.stop();}catch{}recorder=null;recording=null;clear();onState('idle');}
  async function start(){
   discard();const expected=epoch;onState('requesting');
   try{
    const selected=await mediaDevices.getUserMedia({audio:true,video:false});
    if(epoch!==expected){selected.getTracks().forEach(track=>track.stop());return;}
    stream=selected;const options=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>Recorder.isTypeSupported(type));if(!options)throw Error('recording-unavailable');
    recorder=new Recorder(stream,{mimeType:options});
    recorder.ondataavailable=event=>{if(epoch!==expected||!event.data.size)return;bytes+=event.data.size;if(bytes>maxBytes){discard();onState('recording-too-large');return;}chunks.push(event.data);};
    recorder.onstop=()=>{if(epoch!==expected)return;const type=recorder.mimeType;recording=new Blob(chunks,{type});clear();recorder=null;if(recording.size){expiry=setTimeout(()=>{discard();onState('recording-expired');},expiryMs);onAudio(recording);onState('recorded');}else onState('empty-recording');};
    recorder.onerror=()=>{if(epoch===expected){discard();onState('recording-failed');}};
    recorder.start(250);timer=setTimeout(stop,maxMs);onState('recording');
   }catch{if(epoch===expected){discard();onState('microphone-unavailable');}}
  }
  function stop(){if(recorder?.state==='recording'){recorder.stop();tracks();onState('finishing');}}
  return {start,stop,discard,recording:()=>recording};
 }
 if(typeof module==='object'&&module.exports)module.exports={createCapture};else root.createDomCapture=createCapture;
})(typeof globalThis==='object'?globalThis:this);
