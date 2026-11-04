// A Bumbler is an ordinary pool reviewer: a lower-powered open model the owner
// runs on their own tailnet. Saved settings say where it answers. This route
// carries no credential, so it refuses any address outside the tailnet range.
import {randomBytes} from 'node:crypto';import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {defaultRegistryHome} from './reviewer-registry.mjs';
import {preparePrivateEvidence,requirePrivateEvidence} from './evidence-permissions.mjs';
export const BUMBLER_CLIENT=fileURLToPath(new URL('./bumbler-client.mjs',import.meta.url));
export const BUILT_IN_ROUTES=new Set(['codex','gemini','claude','antigravity','copilot','grok']);
// General guidance from the first real Bumbler runs: lower-powered models accepted bugs they had noticed,
// ran out of tokens thinking, spliced quotes and raised findings with no failing input.
export const BUMBLER_GUIDANCE='\n\n## How to review as a Bumbler\nThink in at most ten short steps, because your whole reply shares one token limit and time is limited. Never restate a line or a thought. Stop thinking and answer once you have tried the values. Work in this order:\n1. Find what the code must do: a stated contract, comment, function name or test. If nothing says, state the intent you assumed in your summary.\n2. For every condition and return, try real values and work out the result: zero, one, the exact boundary, just past it, a negative, an empty input, and each side of every || and &&.\n3. If any value breaks what the code must do, report a finding that names that value, and use MODIFY or REJECT. Never answer ACCEPT while your own notes say a condition is wrong or always true.\n4. If every value holds, answer ACCEPT with no findings. Do not invent problems: code you would write differently, or two names computed differently, is not a defect unless you can name an input that goes wrong.\n5. A diff shows only part of a file. Compare the lines starting with + with the stated intent, and check that lines starting with - did not remove something still needed. If they do what the intent says and you cannot name an input that goes wrong, answer ACCEPT with no findings. Assume names defined outside the shown text exist: never claim something is undefined, missing or unused unless the supplied text proves it. A + line that adds a value or field is not a defect just because a nearby line differs.\n6. Set confidence from the values you actually tried.\nYour final reply is the JSON object only, starting with { and ending with }, with nothing before or after it. Always include at least one reviewed_scope quote, even when you answer ACCEPT. Each quote is copied exactly from one single line of the artifact, at most 500 characters and part of a long line if needed, without a leading + or -, never joined to another line and never shortened with dots. line_range counts lines of the supplied artifact. target_file is a name that appears in the artifact, otherwise null.';
const NAME=/^[a-z][a-z0-9-]{0,31}$/,FIELDS=new Set(['base_url','model','max_tokens','timeout_seconds','guidance','rest_seconds','parallel','wait_when_busy','enabled']);
const problem=(name,detail)=>Error(`Bumbler ${name}: ${detail}`);
const MAX_CONFIG_BYTES=1_000_000;
const settingsRefused=()=>Object.assign(Error('Bumbler settings must be a bounded regular file in a private reviewer home outside the project; inspection or reading was refused.'),{code:'BUMBLER_SETTINGS_REFUSED'});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a,b)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function canonical(entry){
 const rest=[];
 for(let current=entry;;current=path.dirname(current)){
  try{return path.join(fs.realpathSync.native(current),...rest.reverse());}
  catch(error){if(error?.code!=='ENOENT'||path.dirname(current)===current)throw settingsRefused();rest.push(path.basename(current));}
 }
}
function readBumblers(env){
 const selected=defaultRegistryHome(env);
 if(!path.isAbsolute(selected))throw settingsRefused();
 const root=path.resolve(selected);
 let missing=false;
 for(let entry=root;;entry=path.dirname(entry)){
  try{const stat=fs.lstatSync(entry),systemLink=entry!==root&&process.platform!=='win32'&&stat.isSymbolicLink()&&stat.uid===0;if(!systemLink&&(stat.isSymbolicLink()||!stat.isDirectory()))throw settingsRefused();}
  catch(error){if(error?.code==='ENOENT')missing=true;else throw settingsRefused();}
  if(path.dirname(entry)===entry)break;
 }
 // Links the user controls are refused above, leaving system links such as macOS /var and spellings such as 8.3 short names.
 const relative=path.relative(fs.realpathSync.native(process.cwd()),canonical(root));
 if(!relative||(!(relative==='..'||relative.startsWith('..'+path.sep))&&!path.isAbsolute(relative)))throw settingsRefused();
 if(missing)return null;
 const rootBefore=fs.lstatSync(root,{bigint:true}),file=path.join(root,'bumblers.json');
 let before;
 try{before=fs.lstatSync(file,{bigint:true});}catch(error){if(error?.code!=='ENOENT')throw settingsRefused();}
 if(before&&(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_CONFIG_BYTES)))throw settingsRefused();
 if(!before)return null;
 try{requirePrivateEvidence(root);}catch{throw settingsRefused();}
 let fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  const opened=fs.fstatSync(fd,{bigint:true});
  if(!sameFile(before,opened)||!opened.isFile()||opened.nlink!==1n)throw settingsRefused();
  const bytes=Buffer.alloc(MAX_CONFIG_BYTES+1);let length=0;
  while(length<bytes.length){const count=fs.readSync(fd,bytes,length,bytes.length-length,null);if(count===0)break;length+=count;}
  if(length>MAX_CONFIG_BYTES)throw settingsRefused();
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true}),rootAfter=fs.lstatSync(root,{bigint:true});
  if(!sameFile(opened,after)||!sameFile(after,named)||after.size!==BigInt(length)||after.nlink!==1n||named.isSymbolicLink()||!sameIdentity(rootBefore,rootAfter)||rootAfter.isSymbolicLink())throw settingsRefused();
  return bytes.subarray(0,length).toString('utf8');
 }catch{throw settingsRefused();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function tailnetAddress(host){if(host==='127.0.0.1')return true;if(net.isIP(host)!==4)return false;const [a,b]=host.split('.').map(Number);return a===100&&b>=64&&b<=127;}
export function bumblerBase(value){
 let url;try{url=new URL(value);}catch{throw Error('base_url is not a URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/[?#]/.test(value)||url.pathname!=='/v1')throw Error('base_url must look like http://<tailnet address>:<port>/v1');
 if(!tailnetAddress(url.hostname))throw Error('base_url must be a literal tailnet address, because this route has no credential');
 return url.toString().replace(/\/$/,'');
}
function checked(name,entry){
 if(typeof name!=='string'||!NAME.test(name)||BUILT_IN_ROUTES.has(name))throw problem(name,'invalid or reserved name');
 if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(key=>!FIELDS.has(key)))throw problem(name,'unsupported fields');
 if(typeof entry.model!=='string'||!entry.model.trim()||entry.model.length>200)throw problem(name,'model is required');
 if(entry.guidance!==undefined&&(typeof entry.guidance!=='string'||entry.guidance.length>4000))throw problem(name,'guidance must be text of at most 4000 characters');
 if(entry.rest_seconds!==undefined&&(!Number.isSafeInteger(entry.rest_seconds)||entry.rest_seconds<0||entry.rest_seconds>3600))throw problem(name,'rest_seconds must be a whole number from 0 to 3600');
 if(entry.parallel!==undefined&&(!Number.isSafeInteger(entry.parallel)||entry.parallel<1||entry.parallel>8))throw problem(name,'parallel must be a whole number from 1 to 8');
 if(entry.wait_when_busy!==undefined&&typeof entry.wait_when_busy!=='boolean')throw problem(name,'wait_when_busy must be true or false');
 if(entry.enabled!==undefined&&typeof entry.enabled!=='boolean')throw problem(name,'enabled must be true or false');
 const maxTokens=entry.max_tokens??1024,seconds=entry.timeout_seconds??180;
 if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>65536||!Number.isSafeInteger(seconds)||seconds<1||seconds>3600)throw problem(name,'max_tokens must be 1 to 65536 and timeout_seconds 1 to 3600');
 try{return {base_url:bumblerBase(entry.base_url),model:entry.model.trim(),max_tokens:maxTokens,timeout_seconds:seconds,...(entry.guidance?.trim()?{guidance:entry.guidance.trim()}:{}),...(entry.rest_seconds?{rest_seconds:entry.rest_seconds}:{}),...(entry.parallel>1?{parallel:entry.parallel}:{}),...(entry.wait_when_busy===false?{wait_when_busy:false}:{}),...(entry.enabled===false?{enabled:false}:{})};}catch(error){throw problem(name,error.message);}
}
function savedFile(env){return path.join(defaultRegistryHome(env),'bumblers.json');}
function readSaved(env){
 const text=readBumblers(env);if(text===null)return {};
 let saved;try{saved=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('bumblers.json is not valid JSON');}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('bumblers.json must be an object of named Bumblers');
 return Object.fromEntries(Object.entries(saved).map(([name,entry])=>[name,checked(name,entry)]));
}
function unconfirmedBumblerWrite(){return Object.assign(Error('Bumbler settings may have been saved. Refresh and check saved Bumblers before repeating a change.'),{code:'BUMBLER_WRITE_UNCONFIRMED',uncertain_write:true});}
function listAfterBumblerWrite(env){try{return listBumblers(env);}catch{throw unconfirmedBumblerWrite();}}
function writeSaved(saved,env){
 const file=savedFile(env),temporary=`${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;preparePrivateEvidence(path.dirname(file));
 try{fs.writeFileSync(temporary,JSON.stringify(saved,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
 catch(error){if(error?.code!=="EEXIST")fs.rmSync(temporary,{force:true});throw error;}
}
export function loadBumblers(env=process.env){
 const saved=readSaved(env),routes=Object.create(null),seen=new Set();
 // One model server is one reviewer, so a second name cannot add a second vote.
 // A switched-off Bumbler still holds its server: one model server is saved under one name only.
  for(const [name,entry] of Object.entries(saved)){const key=`${entry.base_url}|${entry.model}`;if(seen.has(key))throw problem(name,'repeats a model server already saved under another name');seen.add(key);routes[name]={base_url:entry.base_url,model:entry.model,max_tokens:entry.max_tokens,timeout_ms:entry.timeout_seconds*1000,guidance:entry.guidance??'',rest_ms:(entry.rest_seconds??0)*1000,parallel:entry.parallel??1,wait_when_busy:entry.wait_when_busy!==false,enabled:entry.enabled!==false};}
 return routes;
}
// How long to wait after a 429. A stated wait, in seconds or as an HTTP date, is honoured in
// full; zero, a past date or anything unreadable gets a positive pause that grows, so a busy
// shared server is never polled in a tight loop. A little jitter spreads many callers out.
export function busyWait(header,waits,now=Date.now(),random=Math.random){
 const text=typeof header==='string'?header.trim():'',date=/^\d+$/.test(text)?NaN:Date.parse(text);
 const stated=/^\d+$/.test(text)?Number(text)*1000:Number.isFinite(date)?date-now:0;
 const base=stated>=1000?stated:Math.min(2000*2**waits,30000);
 return Math.round(base+random()*Math.min(base*0.25,1250));
}
// rest_seconds is a pause for the whole Bumbler, counted from its latest answer. An answer
// can arrive while a piece is resting, so the latest one is read again after every wake.
export async function bumblerRest(last,agent,restMs,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 for(let wait;restMs&&last.has(agent)&&(wait=last.get(agent)+restMs-now())>0;)await sleep(wait);
}
export function listBumblers(env=process.env){return Object.entries(readSaved(env)).map(([name,entry])=>({name,...entry}));}
export function saveBumbler(name,entry,env=process.env){const saved=readSaved(env),next=checked(name,entry);for(const [other,value] of Object.entries(saved))if(other!==name&&value.base_url===next.base_url&&value.model===next.model)throw problem(name,'repeats a model server already saved under another name');saved[name]=next;writeSaved(saved,env);return listAfterBumblerWrite(env);}
export function removeBumbler(name,env=process.env){const saved=readSaved(env);if(!Object.hasOwn(saved,name))throw problem(name,'not saved');delete saved[name];writeSaved(saved,env);return listAfterBumblerWrite(env);}
// A reply that fails the quotation contract still goes to the governor: its findings join the
// report marked quotes_unverified. Like any invalid review it is not a success and gives no vote.
// Models often think aloud before the JSON.
export function bumblerAnswer(text){
 const raw=String(text??'');if(raw.length>1_000_000)return null;
 // The last few object starts, newest first, so preamble braces cost nothing.
 const last=raw.lastIndexOf('}'),before=/\}\s*$/.test(raw.slice(0,Math.max(last,0)))?raw.lastIndexOf('}',last-1):last,ends=[last+1,before+1];let tries=0;
 for(let at=raw.lastIndexOf('{',last+1);at>=0&&tries<256;at=at?raw.lastIndexOf('{',at-1):-1){
  if(!/^\{\s*"/.test(raw.slice(at,at+400)))continue;tries++;
  // Small models sometimes close the object twice.
  let value;for(const end of ends){try{value=JSON.parse(raw.slice(at,end));break;}catch{}}
  if(value===undefined)continue;
  if(!value||typeof value!=='object'||!('verdict' in value||'findings' in value))continue;
  const clip=(item,max=600)=>typeof item==='string'?item.slice(0,max):null;
  return {verdict:clip(value.verdict,20),summary:clip(value.summary),findings:(Array.isArray(value.findings)?value.findings:[]).filter(f=>typeof f?.issue==='string'&&f.issue.trim()).slice(0,50),suggestions:(Array.isArray(value.suggested_improvements)?value.suggested_improvements:[]).slice(0,10).map(s=>clip(s)).filter(Boolean)};
 }
 return null;
}
// Preflight says whether the model answers. Like every route, it is informational.
export function bumblerReadiness(agent,bumbler,timeoutMs=5000){
 return new Promise(resolve=>{
  let timer;const finish=(ready,note)=>{clearTimeout(timer);resolve({agent,installed:true,version:null,ready,auth:'none',modalities:['text'],...(note?{note}:{})});};
  const request=(bumbler.base_url.startsWith('https:')?https:http).get(`${bumbler.base_url}/models`,response=>{response.resume();response.on('error',()=>{});finish(response.statusCode>=200&&response.statusCode<300,response.statusCode<300?null:`model server answered HTTP ${response.statusCode}`);request.destroy();});
  timer=setTimeout(()=>request.destroy(Error('timeout')),timeoutMs);request.on('error',()=>finish(false,'model server did not answer'));
 });
}
