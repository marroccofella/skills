const fs=require('node:fs'),path=require('node:path'),{spawn,spawnSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('SKIP: Windows native checks require Windows');process.exit(0);}
const root=path.resolve(__dirname,'..'),dir=process.env.DOM_TTS_STATE_DIR;
if(!dir)throw new Error('Set DOM_TTS_STATE_DIR to an isolated private test directory');
const {stateDir,readObject}=require('../scripts/runtime'),{stop}=require('../scripts/stop');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
function speak(text,extra=[]){const child=spawn(process.execPath,[path.join(root,'scripts/speak.js'),'--text',text,...extra],{windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',x=>error+=x);return {child,done:new Promise(resolve=>child.on('exit',code=>resolve({code,error}))) };}
async function waitSpeaking(){for(let i=0;i<400;i++){const status=readObject(path.join(stateDir,'status.json'));if(status.state==='speaking')return;await sleep(25);}throw new Error('Speech did not reach speaking state');}
(async()=>{
 const first=speak('Dom TTS version zero point four is running locally.');results.push({test:'short playback',...await first.done});
 const long=speak('This is synthetic speech to verify fast stopping and exclusive ownership. '.repeat(50));await waitSpeaking();
 const busy=spawnSync(process.execPath,[path.join(root,'scripts/speak.js'),'--text','Second playback.'],{encoding:'utf8',timeout:10000});results.push({test:'exclusive lock',code:busy.status,error:busy.stderr.trim()});
 const start=Date.now(),reply=await stop(),exit=await long.done;results.push({test:'stop',reply,exit,latencyMs:Date.now()-start,lockRemains:fs.existsSync(path.join(stateDir,'playback.lock')),textRemains:fs.readdirSync(stateDir).some(x=>/^speech-/.test(x))});
 const dummy=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(path.join(stateDir,'current.pid'),String(dummy.pid));await stop();let survives=true;try{process.kill(dummy.pid,0);}catch{survives=false;}dummy.kill();fs.unlinkSync(path.join(stateDir,'current.pid'));results.push({test:'unrelated PID survives',survives});
 const sentinel=path.join(stateDir,'INJECTION-SENTINEL'),hostile="'; New-Item -Path '"+sentinel+"'; $(1+1) ";
 const injection=speak(hostile);results.push({test:'speech text injection',...await injection.done,sentinelCreated:fs.existsSync(sentinel)});
 const badVoice=speak('Synthetic voice validation.',['--voice',hostile]);results.push({test:'voice injection and invalid selection',...await badVoice.done,sentinelCreated:fs.existsSync(sentinel)});
 const archive=require('../scripts/support-bundle').buildArchive();results.push({test:'support diagnostics',containsPrivate:fs.readFileSync(archive,'utf8').includes(sentinel),file:archive});
 const passed=results[0].code===0&&busy.status!==0&&exit.code===0&&reply.state==='stopped'&&!results[2].lockRemains&&!results[2].textRemains&&survives&&!fs.existsSync(sentinel)&&results[4].code===0&&results[5].code!==0;
 console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,results,passed,audibleConfirmation:'Human listening and audio latency measurements remain separate'},null,2));if(!passed)process.exitCode=1;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

