'use strict';
// One explicitly supplied reply on stdin, never a transcript reader or model.
const crypto=require('node:crypto');
const {connection,request}=require('./browser-speak');
const {splitGraphemes}=require('./experimental/delta-narrator');
const {parseCli}=require('./runtime');

async function createReplyRelay({format='markdown',sessionId='manual',connect=connection,send=request,expected,maxBytes=16000,onReceipt=()=>{}}={}){
 if(!['plain','markdown'].includes(format)||typeof sessionId!=='string'||! /^[\w.-]{1,128}$/.test(sessionId)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16000||typeof onReceipt!=='function')throw Error('invalid-reply-options');
 const conn=connect(),status=await send(conn,'/api/status');
 if(!status.connected)throw Error('browser-not-connected');
 if(expected&&(status.version!==expected.version||status.sourceManifestSha256!==expected.sourceManifestSha256))throw Error('browser-build-mismatch');
 if(sessionId!=='manual')await send(conn,'/api/queue/select-source',{sessionId});
 const id=crypto.randomBytes(16).toString('hex'),base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',sessionId,turnId:id,generationId:id,messageId:id,format};
 let sequence=0,bytes=0,state='open',busy=false,hasContent=false;const started=performance.now();
 const emit=receipt=>{try{onReceipt({id,...receipt,sinceStartMs:Math.round(performance.now()-started)});}catch{}};
 async function reconcile(){const until=Date.now()+125000;while(Date.now()<until){const receipt=await send(conn,'/api/queue/reply-receipt',base);if(['cancelled','revision-refused'].includes(receipt.inputState)||['failed','cancelled'].includes(receipt.state))throw Error('reply-admission-refused');if(receipt.pendingSegments===0)return receipt;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('reply-admission-timeout');}
 const event=async(kind,text)=>{const result=await send(conn,'/api/queue/event',{...base,kind,sequence,...(text===undefined?{}:{text})});if(['cancelled','revision-refused'].includes(result.state))throw Error('reply-admission-refused');sequence++;if(result.state==='backpressure')await reconcile();return result;};
 await event('start');emit({state:'opened',format});
 async function cancel(){if(state==='cancelled')return {id,state,cancellation:'already-requested'};state='cancelled';const result=await send(conn,'/api/queue/cancel-reply',base);emit({state:'cancelled'});return {id,...result};}
 return {
  id,
  async append(text){if(state!=='open'||busy)throw Error('reply-not-open');if(typeof text!=='string'||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw Error('invalid-reply-text');const size=Buffer.byteLength(text);if(bytes+size>maxBytes)throw Error('reply-byte-limit');busy=true;try{for(const chunk of splitGraphemes(text,2048)){await event('delta',chunk);}bytes+=size;hasContent=hasContent||!!text.trim();emit({state:'admitted',inputBytes:bytes});return {id,state:'admitted',inputBytes:bytes};}catch(error){state='failed';throw error;}finally{busy=false;}},
  async finish(){if(state!=='open'||busy||!hasContent)throw Error('reply-not-sealable');busy=true;try{const receipt=await send(conn,'/api/queue/seal',base);if(!receipt.inputSealed)throw Error('reply-admission-refused');state='sealed';emit({state:'sealed',inputBytes:bytes});return {id,...receipt};}catch(error){state='failed';throw error;}finally{busy=false;}},
  async receipt(){return {id,...await send(conn,'/api/queue/reply-receipt',base)};},
  cancel,
  status(){return {id,state,inputBytes:bytes};}
 };
}

async function main(){
 const args=parseCli(process.argv.slice(2),{format:'markdown',wait:'false'},['format','wait','sessionId']);if(!['true','false'].includes(args.wait))throw Error('invalid-wait');
 const fs=require('node:fs'),path=require('node:path'),{ROOT}=require('./runtime');const manifest=require('./package').verify();
 const expected={version:manifest.version,sourceManifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'manifest.json'))).digest('hex')};
 const emit=value=>process.stdout.write(JSON.stringify(value)+'\n'),relay=await createReplyRelay({format:args.format,sessionId:args.sessionId||'manual',expected,onReceipt:emit});
 const decoder=new TextDecoder('utf-8',{fatal:true});let stopped=false;
 const stop=()=>{stopped=true;process.stdin.destroy();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  for await(const chunk of process.stdin){if(stopped)break;const text=decoder.decode(chunk,{stream:true});if(text)await relay.append(text);}
  if(stopped){await relay.cancel();emit({id:relay.id,state:'cancelled'});return;}
  const tail=decoder.decode();if(tail)await relay.append(tail);await relay.finish();
  if(args.wait==='true'){const until=Date.now()+125000;while(Date.now()<until){if(stopped){await relay.cancel();return;}const receipt=await relay.receipt();if(receipt.terminal){emit({...receipt,humanHearing:'unconfirmed'});if(receipt.state!=='completed')process.exitCode=1;return;}if(receipt.inputState==='cancelled')throw Error('reply-cancelled');await new Promise(r=>setTimeout(r,100));}throw Error('reply-receipt-timeout');}
 }catch(error){let cancellation='unconfirmed';try{await relay.cancel();cancellation='requested';}catch{}emit({id:relay.id,state:'failed',code:error.message&&/^[a-z-]+$/.test(error.message)?error.message:'reply-stream-refused',cancellation});process.exitCode=1;
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(require.main===module)main().catch(error=>{console.error(error.message&&/^[a-z-]+$/.test(error.message)?error.message:'reply-stream-configuration-refused');process.exitCode=1;});
module.exports={createReplyRelay,main};
