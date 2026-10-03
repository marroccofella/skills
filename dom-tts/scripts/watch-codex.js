const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {ROOT,stateDir,ensurePrivate,writeObject,parseCli,safeEnv}=require('./runtime');
function parseArgs(argv){const args=parseCli(argv,{format:'codex',phase:'final_answer',pollMs:750,speakStartup:'false',dryRun:false},['file','format','phase','includeCommentary','pollMs','mode','profile','provider','voice','speed','maxChunkChars','dryRun','once','speakStartup','includeCodeBlocks','includeCommandBlocks']);if(!['codex','claude','generic'].includes(args.format))throw new Error('format must be codex, claude or generic');if(!['final','final_answer','all'].includes(args.phase))throw new Error('phase must be final_answer or all');if(args.phase==='all'&&!args.includeCommentary)throw new Error('Commentary requires --include-commentary true');if(args.speakStartup!=='false')throw new Error('Startup speech is disabled in 0.5');return args;}
function outputTextFromRecord(record,phase='final_answer',includeCommentary=false,format='codex'){
 if(!record||typeof record!=='object'||Array.isArray(record))return '';
 let role,actualPhase,text='';
 if(format==='codex'){const p=record.payload||{};if(record.type!=='response_item'||p.type!=='message')return '';role=p.role;actualPhase=p.phase;text=(Array.isArray(p.content)?p.content:[]).filter(x=>x&&x.type==='output_text'&&typeof x.text==='string').map(x=>x.text).join('\n');}
 if(format==='claude'){if(record.type!=='assistant')return '';role=record.message?.role;actualPhase='final_answer';const msg=record.message;if(msg?.stop_reason!=='end_turn')return '';text=(Array.isArray(msg?.content)?msg.content:[]).filter(x=>x&&x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n');}
 if(format==='generic'){role=record.role;actualPhase=record.phase;text=typeof record.text==='string'?record.text:'';}
 if(role!=='assistant')return '';
 if(!['final','final_answer'].includes(actualPhase)&&!(phase==='all'&&includeCommentary===true&&actualPhase==='commentary'))return '';
 return text.trim();
}
function textKey(text){return crypto.createHash('sha256').update(String(text)).digest('hex');}
function completeLines(buffer){const end=buffer.lastIndexOf(10);if(end<0){if(buffer.length>=1048576)throw new Error('Transcript record exceeds 1 MB');return {bytes:0,lines:[]};}return {bytes:end+1,lines:buffer.subarray(0,end+1).toString('utf8').split(/\r?\n/).filter(Boolean)};}
function speechArgs(args){
 const options=['--wait-ms','30000','--stdin','true'];
 for(const key of ['provider','profile','mode','voice','speed','maxChunkChars','includeCodeBlocks','includeCommandBlocks']){
  if(args[key]!==undefined)options.push('--'+key,String(args[key]));
 }
 return options;
}
function speaker(text,args){return new Promise(resolve=>{const options=speechArgs(args);const env={...safeEnv(),DOM_TTS_STATE_DIR:stateDir};const child=spawn(process.execPath,[path.join(ROOT,'scripts','speak.js'),...options],{windowsHide:true,stdio:['pipe','ignore','pipe'],env});child.stdin.on('error',()=>{});child.stdin.end(text);child.stderr.resume();child.on('error',()=>resolve(false));child.on('exit',code=>resolve(code===0));});}
async function processNewLines(file,cursor,args,keys,{speak=speaker,dir=stateDir}={}){
 let stat;try{stat=fs.statSync(file);}catch(e){if(e.code==='ENOENT')return {cursor,spoken:0};throw e;}
 const size=stat.size;if(size<cursor)return {cursor:size,spoken:0};if(size===cursor)return {cursor,spoken:0};
 const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(Math.min(size-cursor,1048576));let count;try{count=fs.readSync(fd,buffer,0,buffer.length,cursor);}finally{fs.closeSync(fd);}
 const complete=completeLines(buffer.subarray(0,count));let offset=0,spoken=0;
 // Track byte offsets before each line: failed speech remains pending, never deduplicated.
 for(const raw of buffer.subarray(0,complete.bytes).toString('utf8').split('\n').slice(0,-1)){
 const bytes=Buffer.byteLength(raw+'\n','utf8');if(fs.existsSync(path.join(dir,'stop.flag')))return {cursor:size,spoken};
 let record;try{record=JSON.parse(raw.replace(/\r$/,''));}catch{offset+=bytes;continue;}
 const text=outputTextFromRecord(record,args.phase,args.includeCommentary,args.format||'codex');
 if(!text){offset+=bytes;continue;}const key=record.uuid||record.id||textKey(text);if(keys.has(key)){offset+=bytes;continue;}
 const ok=args.dryRun===true||await speak(text,args);
 if(!ok){if(fs.existsSync(path.join(dir,'stop.flag')))return {cursor:size,spoken};return {cursor:cursor+offset,spoken,failed:true};}
 keys.add(key);if(keys.size>1200)keys.delete(keys.values().next().value);spoken++;offset+=bytes;
 }
 return {cursor:cursor+complete.bytes,spoken};
}
async function main(){
 const args=parseArgs(process.argv.slice(2));if(!args.file)throw new Error('Specify one consented transcript with --file');
 if(!Number.isFinite(Number(args.pollMs))||Number(args.pollMs)<250||Number(args.pollMs)>60000)throw new Error('pollMs must be between 250 and 60000');
 ensurePrivate();try{fs.unlinkSync(path.join(stateDir,'stop.flag'));}catch{}
 let cursor=fs.existsSync(args.file)?fs.statSync(args.file).size:0,identity=fs.existsSync(args.file)?String(fs.statSync(args.file).ino):null;const keys=new Set();let stopped=false;
 const signal=()=>{stopped=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
 try{do{
  if(fs.existsSync(args.file)){const stat=fs.statSync(args.file),next=String(stat.ino);if(identity!==null&&(next!==identity||stat.size<cursor)){cursor=stat.size;keys.clear();}identity=next;}
  const result=await processNewLines(args.file,cursor,args,keys);cursor=result.cursor;
  writeObject(path.join(stateDir,'watcher-status.json'),{state:result.failed?'error':'watching',spoken:result.spoken,error:result.failed?'playback-failed':undefined,updatedAt:new Date().toISOString()});
  if(result.failed)console.error('Watcher playback failed; message retained for retry');
  if(!args.once&&!stopped)await new Promise(r=>setTimeout(r,result.failed?Math.max(1000,Number(args.pollMs)):Number(args.pollMs)));
 }while(!args.once&&!stopped);}finally{process.off('SIGINT',signal);process.off('SIGTERM',signal);}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parseArgs,outputTextFromRecord,textKey,completeLines,processNewLines,speechArgs};

