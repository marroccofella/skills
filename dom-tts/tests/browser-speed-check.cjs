const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {create}=require('../assets/browser/player');
const {createSession}=require('../scripts/experimental/browser-session');
const {planMigration}=require('../scripts/migrate-browser-settings');
(async()=>{
 let utterance;const voice={voiceURI:'local-test',name:'Local fixture',lang:'en-US',localService:true};
 const synth={getVoices:()=>[voice],speak:u=>{utterance=u;u.onstart();queueMicrotask(()=>u.onend());},cancel(){}};
 const player=create({synth,Utterance:function(text){this.text=text;}});
 for(const rate of [0.5,0.9,1.8,2]){assert.equal((await player.speak('Supplied fixture.',voice.voiceURI,rate)).state,'completed');assert.equal(utterance.rate,rate);}
 for(const rate of [0.49,2.01,NaN,Infinity])await assert.rejects(player.speak('Supplied fixture.',voice.voiceURI,rate),/invalid-input/);
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'dom-tts-speed-'));let session;
 try{session=createSession({dir,persist:true});const client='a'.repeat(32);session.enable({client,voice:voice.voiceURI,rate:1.8});assert.equal(session.status().rate,1.8);assert.equal(session.getPreferences().rate,1.8);
  const fresh=createSession({dir,persist:true});try{assert.equal(fresh.getPreferences().rate,1.8);assert.equal(fresh.status().connected,false);}finally{fresh.close();}
  for(const rate of [0.49,2.01,NaN,Infinity])assert.throws(()=>session.enable({client,voice:voice.voiceURI,rate}),/invalid-enable/);
  assert.equal(planMigration({speed:1.8},{voice:voice.voiceURI,rate:0.9},{useCurrentVoice:true}).preferences.rate,1.8);
  assert.throws(()=>planMigration({speed:2.01},{voice:voice.voiceURI,rate:0.9},{useCurrentVoice:true}),/out-of-range/);
 }finally{session?.close();const resolved=fs.realpathSync(dir);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!path.basename(resolved).startsWith('dom-tts-speed-'))throw Error('Unexpected cleanup path');fs.rmSync(resolved,{recursive:true});}
 console.log('PASS: 1.8 rate reaches the speech engine and persists without autoplay; bounds and migration agree. Injected speech; no acoustic timing claim.');
})().catch(e=>{console.error(e);process.exitCode=1;});
