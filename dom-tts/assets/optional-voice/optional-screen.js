'use strict';
const $=id=>document.getElementById(id),token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
let caps={},generation=0,request=null,url=null,outputExpiry=null;
function revokeAudio(){$('audio').pause();$('audio').removeAttribute('src');$('audio').load();if(url)URL.revokeObjectURL(url);url=null;}
function showAudio(blob){revokeAudio();url=URL.createObjectURL(blob);$('audio').src=url;clearTimeout(outputExpiry);outputExpiry=setTimeout(discard,120000);}
function buttons(){const clip=!!capture.recording(),busy=!!request;$('preview').disabled=!clip||busy;$('speak').disabled=!caps.stockSpeech||!$('consent').checked||busy;$('transcribe').disabled=!caps.transcription||!$('consent').checked||!clip||busy;$('turn').disabled=!caps.twoWay||!$('consent').checked||!clip||busy;}
const capture=createDomCapture({mediaDevices:navigator.mediaDevices,Recorder:window.MediaRecorder,onState:state=>{if(state==='recording-expired')revokeAudio();$('status').textContent=state.replaceAll('-',' ');$('record').disabled=['requesting','recording','finishing'].includes(state);$('finish').disabled=state!=='recording';buttons();},onAudio:showAudio});
function discard(){generation++;clearTimeout(outputExpiry);outputExpiry=null;request?.abort();request=null;capture.discard();revokeAudio();$('consent').checked=false;$('text').value='';$('transcript').textContent='';$('answer').textContent='';buttons();}
$('record').onclick=()=>{generation++;request?.abort();request=null;revokeAudio();capture.start();};$('finish').onclick=()=>capture.stop();$('discard').onclick=discard;
$('preview').onclick=()=>{const clip=capture.recording();if(clip)showAudio(clip);};
$('consent').onchange=()=>{if(!$('consent').checked){generation++;clearTimeout(outputExpiry);outputExpiry=null;request?.abort();request=null;revokeAudio();$('transcript').textContent='';$('answer').textContent='';$('status').textContent='Cloud permission cleared. Your local clip remains until Discard or expiry.';}buttons();};
async function run(action){
 const expected=++generation;request=new AbortController();const signal=request.signal;buttons();$('status').textContent='Working on the selected cloud request…';
 try{
  const clip=capture.recording(),body=action==='speak'?JSON.stringify({text:$('text').value}):clip;
  const response=await fetch('/api/'+action,{method:'POST',headers:{'X-Dom-TTS-Token':token,'X-Dom-TTS-Consent':'true','Content-Type':action==='speak'?'application/json':clip.type},body,signal});
  if(!response.ok)throw Error();
  if(action==='speak'){const blob=await response.blob();if(generation===expected)showAudio(blob);}else{const result=await response.json();if(generation===expected){$('transcript').textContent='You: '+result.transcript;if(action==='turn'){$('answer').textContent='Hal: '+result.answer;const bytes=Uint8Array.from(atob(result.audio),char=>char.charCodeAt(0));showAudio(new Blob([bytes],{type:'audio/mpeg'}));}}}
  if(generation===expected){clearTimeout(outputExpiry);outputExpiry=setTimeout(discard,120000);$('status').textContent=action==='transcribe'?'Transcription ready.':'Ready. Press Play to hear the audio.';}
 }catch{if(generation===expected)$('status').textContent='Request stopped or unavailable. No automatic retry.';}finally{if(generation===expected){request=null;buttons();}}
}
for(const action of ['speak','transcribe','turn'])$(action).onclick=()=>run(action);
window.addEventListener('pagehide',discard);
fetch('/api/capabilities',{headers:{'X-Dom-TTS-Token':token}}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(value=>{caps=value;$('capabilities').textContent=value.cloudEnabled?'Cloud provider selected: OpenAI. Each action needs your permission below.':'Cloud services are disabled. Local microphone recording and playback remain available.';buttons();}).catch(()=>{$('capabilities').textContent='Private connection unavailable. Reopen the studio link.';$('record').disabled=true;});
