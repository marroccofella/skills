const {HarnessAdapter}=require('./harness-adapter');
// Admission receipt only. No transcript paths are opened and no audio is awaited.
async function admitHook(record,{source,selectedSessions,dryRun=false,connect,send}={}){
 if(typeof dryRun!=='boolean')throw Error('invalid dry run');
 const finals=[];const adapter=new HarnessAdapter({source,selectedSessions,emit:event=>{if(event.kind==='complete')finals.push(event.text);}});
 const result=adapter.accept(record);if(!finals.length)return {...result,audio:false};
 if(finals.length!==1||finals[0].length>6000||Buffer.byteLength(JSON.stringify({text:finals[0]}))>8192)throw Error('hook reply exceeds browser admission bound');
 if(dryRun)return {state:'preview',messages:1,audio:false};
 const browser=require('../browser-speak');const conn=(connect||browser.connection)();const receipt=await (send||browser.request)(conn,'/api/queue/enqueue',{text:finals[0]});
 if(receipt.state!=='queued'||typeof receipt.id!=='string'||!/^[a-f0-9]{32}$/.test(receipt.id))throw Error('invalid admission receipt');
 return {state:'queued',id:receipt.id,audio:true,completed:false,humanHearing:'unconfirmed'};
}
module.exports={admitHook};
