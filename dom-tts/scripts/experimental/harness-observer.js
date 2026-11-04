const {HarnessAdapter,stableId}=require('./harness-adapter');
const {DeltaNarrator}=require('./delta-narrator');const {NarrationQueue}=require('./narration-queue');
// Tap an explicitly supplied host stream after the caller renders text. observe()
// is synchronous admission, never a promise tied to speech completion.
function createHarnessObserver({source,selectedSessions,play,mode='informative',incrementalMarkdown=false,onReceipt=()=>{}}={}){
 if(!Array.isArray(selectedSessions)||typeof play!=='function'||typeof onReceipt!=='function')throw Error('explicit observer, source selection and player required');
 const sessions=selectedSessions.map(stableId),queue=new NarrationQueue({selectedSessions:sessions,play}),narrator=new DeltaNarrator({queue,selectedSessions:sessions,mode,incrementalMarkdown});
 const host=new HarnessAdapter({source,selectedSessions,emit:event=>narrator.accept(event)});let closed=false;
 const close=()=>{if(closed)return;closed=true;try{host.revoke();}catch{}for(const session of sessions)try{narrator.revokeSession(session);}catch{}};
 return {
  observe(record){if(closed)return {state:'closed'};let receipt;try{receipt=host.accept(record);}catch{close();receipt={state:'refused',code:'selected-event-refused'};}try{onReceipt(receipt);}catch{}return receipt;},
  close,
  async settle(){const before=host.finish();if(before.unfinished)close();await queue.idle();const stream=narrator.status(),status=queue.status(),incomplete=before.unfinished||stream.pending||stream.unfinished||stream.revisions||status.failed;if(incomplete)close();return {state:incomplete?'incomplete':closed||before.cancelledTurns?'cancelled':'complete',queue:queue.status(),stream:narrator.status(),host:host.status(),humanHearing:'unconfirmed'};},
  status(){return {closed,queue:queue.status(),stream:narrator.status(),host:host.status()};}
 };
}
module.exports={createHarnessObserver};
