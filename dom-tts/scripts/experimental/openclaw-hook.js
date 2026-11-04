const {admitHook}=require('./harness-hook');
const {HarnessAdapter}=require('./harness-adapter');const {createHash}=require('node:crypto');
// Operator passes an exact session list at registration. No source discovery.
function createOpenClawHook({selectedSessions,dryRun=false,onReceipt=()=>{},admit=admitHook}={}){
 if(!Array.isArray(selectedSessions)||!selectedSessions.length||typeof onReceipt!=='function'||typeof admit!=='function')throw Error('explicit selected sessions and receipt handler required');
 const sessions=[...selectedSessions];new HarnessAdapter({source:'openclaw-message-sent',selectedSessions:sessions,emit(){}});const seen=new Map();
 const report=receipt=>{try{onReceipt(receipt);}catch{}};
 return async event=>{if(event?.type!=='message'||event?.action!=='sent'||!sessions.includes(event.sessionKey)||event.context?.success!==true)return;
  const id=event.context.messageId,text=event.context.content;if(typeof id!=='string'||!id||id.length>256||typeof text!=='string'||Buffer.byteLength(text)>65536){report({state:'failed',code:'hook-admission-refused',audio:false});return;}
  const key=JSON.stringify([event.sessionKey,id]),hash=createHash('sha256').update(text).digest('hex');
  if(seen.has(key)){report({state:seen.get(key)===hash?'duplicate':'failed',code:seen.get(key)===hash?'previous-event-retained':'conflicting-hook-replay',audio:false});return;}
  if(seen.size>=64){report({state:'failed',code:'hook-history-limit',audio:false});return;}
  // Reserve before awaiting admission: overlapping retries cannot speak twice.
  // A failed/uncertain admission is retained too; never retry it automatically.
  seen.set(key,hash);
  try{const receipt=await admit(event,{source:'openclaw-message-sent',selectedSessions:sessions,dryRun});report(receipt);}catch{report({state:'failed',code:'hook-admission-refused',audio:false});}
 };
}
module.exports={createOpenClawHook};
