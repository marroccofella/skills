// Selected-source, append-only text events -> existing stable-segment queue.
// Admission never awaits audio. Opt-in Markdown admits completed blocks only.
const {createHash}=require('node:crypto');
const {applyMode}=require('../summarize');
const validId=value=>typeof value==='string'&&/^[\w.-]{1,128}$/.test(value);
const identity=e=>JSON.stringify([e.sessionId,e.turnId,e.generationId,e.messageId]);
const byteLength=text=>Buffer.byteLength(text,'utf8');
function validUnicode(text){return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);}
// Admit complete blank-line-delimited blocks, never an open fenced block.
// Reference-style link definitions can affect earlier rendering: defer that tail.
function markdownBoundary(text){
 let fence=null,html=null,boundary=0,offset=0;
 for(const line of text.match(/[^\n]*\n|[^\n]+$/g)||[]){
  const marker=line.match(/^\s{0,3}(`{3,}|~{3,})([^\n]*)/);
  if(marker&&!html){if(!fence)fence={char:marker[1][0],count:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.count&&!marker[2].trim())fence=null;}
  if(!fence){let cursor=0;while(cursor<line.length){
   const fragment=line.slice(cursor);
   if(html){const ending=fragment.match(html==='comment'?/-->/:new RegExp('</'+html+'\\s*>','i'));if(!ending)break;cursor+=ending.index+ending[0].length;html=null;}
   else{const opening=fragment.match(/<!--|<(script|style|pre)\b[^>]*>/i);if(!opening)break;html=opening[0]==='<!--'?'comment':opening[1].toLowerCase();cursor+=opening.index+opening[0].length;}
  }}
  if(/^\s*\[[^\]]+\]:/.test(line)||/\[[^\]]+\]\s*\[[^\]]*\]/.test(line))return boundary;
  offset+=line.length;if(!fence&&!html&&/^\s*\n$/.test(line))boundary=offset;
 }
 return boundary;
}
function splitGraphemes(text,limit){
 const segments=[];let current='';
 for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)){
  if(byteLength(segment)>limit)throw new Error('grapheme exceeds segment limit');
  if(byteLength(current)+byteLength(segment)>limit){segments.push(current);current='';}
  current+=segment;
 }
 if(current)segments.push(current);return segments;
}
class DeltaNarrator{
 constructor({queue,selectedSessions,mode='informative',maxBytes=65536,maxMessages=64,maxEvents=1024,segmentBytes=420,maxSegments=Number.MAX_SAFE_INTEGER,incrementalMarkdown=false}={}){
  if(!queue||typeof queue.accept!=='function'||typeof queue.cancel!=='function'||!Array.isArray(selectedSessions)||!selectedSessions.length||selectedSessions.length>32||selectedSessions.some(id=>!validId(id)))throw new Error('explicit queue and selected sessions required');
  applyMode('',mode);
  for(const [value,min,max] of [[maxBytes,1,1048576],[maxMessages,1,128],[maxEvents,1,4096],[segmentBytes,40,4096]])if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('invalid adapter bounds');
  if(typeof incrementalMarkdown!=='boolean')throw Error('invalid Markdown option');this.incrementalMarkdown=incrementalMarkdown;
  if(!Number.isSafeInteger(maxSegments)||maxSegments<1)throw Error('invalid segment bound');this.maxSegments=maxSegments;
  this.queue=queue;this.sessions=new Set(selectedSessions);this.mode=mode;
  Object.assign(this,{maxBytes,maxMessages,maxEvents,segmentBytes});this.messages=new Map();this.bytes=0;
 }
 accept(event){
  if(!event||event.schema!=='dom-tts-text/1'||event.role!=='assistant'||event.phase!=='final_answer'||!['start','delta','complete','cancel'].includes(event.kind))throw new Error('unsupported assistant event');
  for(const field of ['sessionId','turnId','generationId','messageId'])if(!validId(event[field]))throw new Error('invalid event identity');
  if(!this.sessions.has(event.sessionId))throw new Error('session not selected');
  if(!Number.isSafeInteger(event.sequence)||event.sequence<0||!['plain','markdown'].includes(event.format)||event.text!==undefined&&typeof event.text!=='string')throw new Error('invalid text event');
  if(['delta','complete'].includes(event.kind)&&typeof event.text!=='string')throw new Error('text required');
  if(['start','cancel'].includes(event.kind)&&event.text!==undefined)throw new Error('control event must not contain text');
  if(event.text&&byteLength(event.text)>this.maxBytes)throw new Error('adapter byte limit');
  const normalized=Object.fromEntries(['schema','role','phase','kind','sessionId','turnId','generationId','messageId','sequence','format','text'].map(k=>[k,event[k]]));
  const hash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const id=identity(event);let message=this.messages.get(id);
  if(message?.history.has(event.sequence)){
   if(message.history.get(event.sequence)!==hash)throw new Error('conflicting replay');
   return {state:'duplicate',pending:message.pending.length,adapterState:message.state};
  }
  if(!message){
   if(event.sequence!==0||event.kind!=='start'||this.messages.size>=this.maxMessages)throw new Error('start event or adapter history limit');
   message={base:normalized,format:event.format,text:'',admittedPrefix:'',nextSegment:0,history:new Map(),pending:[],state:'streaming',next:0};
   this.messages.set(id,message);
  }
  if(event.sequence!==message.next||event.format!==message.format||!['streaming','completing'].includes(message.state)||event.kind!=='cancel'&&(message.state!=='streaming'||message.pending.length))throw new Error('event requires reconciliation');
  if(message.history.size>=this.maxEvents)throw new Error('event history limit');
  if(event.kind==='cancel'){
   this.queue.cancel(event);this.bytes-=byteLength(message.text);message.text='';message.admittedPrefix='';message.pending=[];delete message.pendingPrefix;message.state='cancelled';
  }else if(event.kind==='delta'||event.kind==='complete'){
   const text=event.kind==='delta'?message.text+event.text:event.text;
   if(this.bytes-byteLength(message.text)+byteLength(text)>this.maxBytes)throw new Error('adapter byte limit');
   if(event.kind==='complete'&&(!validUnicode(text)||!text.startsWith(message.admittedPrefix))){
    this.queue.cancel(event);this.bytes-=byteLength(message.text);message.text='';message.state='revision-refused';
    message.history.set(event.sequence,hash);message.next++;
    return {state:'revision-refused',pending:0};
   }
   const previous=message.text;
   this.bytes+=byteLength(text)-byteLength(message.text);message.text=text;
   const tail=text.slice(message.admittedPrefix.length);
   let boundary=0;
   if(event.kind==='complete')boundary=tail.length;
   else if(message.format==='markdown'&&this.incrementalMarkdown&&['informative','full'].includes(this.mode))boundary=markdownBoundary(tail);
   else if(message.format==='plain'&&['informative','full'].includes(this.mode)){
    for(const match of tail.matchAll(/[.!?]["'”’)\]]*\s+/gu))boundary=match.index+match[0].length;
    // A supplied prose paragraph need not end in punctuation. Admit it as soon
    // as its blank-line boundary arrives, without waiting for final authority.
    for(const match of tail.matchAll(/\r?\n[\t ]*\r?\n/gu))boundary=Math.max(boundary,match.index+match[0].length);
   }
   if(boundary){
    const raw=tail.slice(0,boundary);
    const speech=message.format==='markdown'||!['informative','full'].includes(this.mode)?applyMode(raw,this.mode):raw;
    // Prepare every segment before admission, so an oversized grapheme cannot
    // leave partial adapter mutation disguised as success.
    let chunks;
    try{if(!validUnicode(raw))throw new Error('invalid Unicode in stable sentence');chunks=splitGraphemes(speech,this.segmentBytes).filter(text=>text.trim());if(message.nextSegment+chunks.length>this.maxSegments)throw Error('reply-segment-limit');}
    catch(error){this.bytes+=byteLength(previous)-byteLength(message.text);message.text=previous;throw error;}
    message.pending=chunks.map((text,offset)=>({schema:'dom-tts-segment/1',role:'assistant',phase:'final_answer',
     ...Object.fromEntries(['sessionId','turnId','generationId','messageId'].map(k=>[k,event[k]])),
     segmentId:'segment-'+(message.nextSegment+offset),sequence:message.nextSegment+offset,text}));
    message.pendingPrefix=message.admittedPrefix+raw;
   }
   if(event.kind==='complete')message.state='completing';
  }
  message.history.set(event.sequence,hash);message.next++;
  return this.flushMessage(message);
 }
 flushMessage(message){
  while(message.pending.length){
   try{this.queue.accept(message.pending[0]);message.nextSegment++;message.pending.shift();}
   catch{return {state:'backpressure',pending:message.pending.length};}
  }
  if(message.pendingPrefix!==undefined){message.admittedPrefix=message.pendingPrefix;delete message.pendingPrefix;}
  if(message.state==='completing'){
   this.bytes-=byteLength(message.text);message.text='';message.admittedPrefix='';message.state='sealed';
  }
  return {state:message.state,pending:0};
 }
 flush(event){const message=this.messages.get(identity(event));if(!message)throw new Error('unknown message');return this.flushMessage(message);}
 revokeSession(sessionId){
  if(!validId(sessionId))throw new Error('invalid session identity');this.sessions.delete(sessionId);
  for(const message of this.messages.values())if(message.base.sessionId===sessionId){this.bytes-=byteLength(message.text);message.text='';message.admittedPrefix='';message.pending=[];delete message.pendingPrefix;message.state='cancelled';}
  return this.queue.revokeSession(sessionId);
 }
 cancelGeneration(identity){for(const message of this.messages.values())if(['sessionId','turnId','generationId'].every(k=>message.base[k]===identity[k])){this.bytes-=byteLength(message.text);message.text='';message.admittedPrefix='';message.pending=[];delete message.pendingPrefix;message.state='cancelled';}return this.queue.cancel(identity);}
 status(){return {messages:this.messages.size,retainedBytes:this.bytes,pending:[...this.messages.values()].reduce((n,m)=>n+m.pending.length,0),unfinished:[...this.messages.values()].filter(m=>['streaming','completing'].includes(m.state)).length,revisions:[...this.messages.values()].filter(m=>m.state==='revision-refused').length};}
}
module.exports={DeltaNarrator,splitGraphemes,markdownBoundary};
