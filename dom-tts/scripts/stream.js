// Explicit stdin observer. No transcript discovery, host injection or background watch.
const {parseCli,stateDir}=require('./runtime');
const {JsonlFramer}=require('./experimental/event-framer');
const {NarrationQueue}=require('./experimental/narration-queue');
const {DeltaNarrator}=require('./experimental/delta-narrator');
const {createIsolatedNativePlayer}=require('./experimental/isolated-native-player');
const {HarnessAdapter,SOURCES,stableId}=require('./experimental/harness-adapter');
async function main(){
 const args=parseCli(process.argv.slice(2),{},['sessions','mode','dryRun','provider','incrementalMarkdown','source']);
 if(!args.sessions)throw Error('explicit selected sessions required');
 if(args.dryRun!==undefined&&typeof args.dryRun!=='boolean')throw Error('invalid dry run');
 const selected=args.sessions.split(',');const source=args.source||'generic';if(source!=='generic'&&!SOURCES.includes(source))throw Error('unsupported source');
 const sessions=source==='generic'?selected:selected.map(stableId);const mode=args.mode||'informative';
 if(args.provider!==undefined&&!['native','browser'].includes(args.provider))throw Error('invalid provider');if(args.incrementalMarkdown!==undefined&&typeof args.incrementalMarkdown!=='boolean')throw Error('invalid Markdown option');
 const play=args.dryRun?async()=>({state:'completed'}):args.provider==='browser'?require('./experimental/browser-player').createBrowserPlayer():createIsolatedNativePlayer({dir:stateDir,options:{mode:'full'}});
 const queue=new NarrationQueue({selectedSessions:sessions,play});
 const adapter=new DeltaNarrator({selectedSessions:sessions,queue,mode,incrementalMarkdown:!!args.incrementalMarkdown});
 const host=source==='generic'?null:new HarnessAdapter({source,selectedSessions:selected,emit:event=>adapter.accept(event)});
 const framer=new JsonlFramer();let stopped=false;
 const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
 const stop=()=>{stopped=true;host?.revoke();for(const session of sessions)adapter.revokeSession(session);process.stdin.destroy();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  for await(const chunk of process.stdin){
   if(stopped)break;
   const framed=framer.push(chunk);
   for(const event of framed.records)emit({state:'admitted',receipt:host?host.accept(event):adapter.accept(event),audio:!args.dryRun});
   if(framed.error)throw Error('framing-refused');
  }
  if(!stopped&&framer.finish().error)throw Error('incomplete-input');
  await queue.idle();
  const stream=adapter.status(),status=queue.status();
  const hostStatus=host?.finish();const incomplete=stream.pending||stream.unfinished||stream.revisions||status.failed||hostStatus?.unfinished;
  if(incomplete){host?.revoke();for(const session of sessions)adapter.revokeSession(session);await queue.idle();}
  emit({state:stopped?'cancelled':incomplete?'incomplete':hostStatus?.cancelledTurns?'cancelled':'complete',queue:queue.status(),stream:adapter.status(),...(hostStatus?{host:host.status()}:{}),audio:!args.dryRun,humanHearing:'unconfirmed'});
  if(incomplete)process.exitCode=1;
 }catch{
  host?.revoke();for(const session of sessions)adapter.revokeSession(session);await queue.idle();emit({state:stopped?'cancelled':'failed',code:stopped?'stop-requested':'event-stream-refused',audio:!args.dryRun});if(!stopped)process.exitCode=1;
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(require.main===module)main().catch(()=>{console.error('Stream configuration was refused.');process.exitCode=1;});
module.exports={main};
