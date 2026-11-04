// One explicitly selected host hook payload on stdin; never a transcript watcher.
const {parseCli}=require('./runtime');const {admitHook}=require('./experimental/harness-hook');
async function main(){
 const args=parseCli(process.argv.slice(2),{},['source','sessions','dryRun']);if(!['claude-stop','openclaw-message-sent'].includes(args.source)||!args.sessions)throw Error('explicit supported hook source and sessions required');
 let bytes=0,chunks=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>65536)throw Error('hook payload too large');chunks.push(chunk);}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const record=JSON.parse(raw);
 const result=await admitHook(record,{source:args.source,selectedSessions:args.sessions.split(','),dryRun:args.dryRun===undefined?false:args.dryRun});
 // Claude consumes stdout as hook protocol. An empty object leaves its decision
 // unchanged; sanitized delivery metadata goes to stderr for the operator.
 process.stdout.write('{}\n');process.stderr.write(JSON.stringify(result)+'\n');
}
if(require.main===module)main().catch(()=>{process.stdout.write('{}\n');console.error('Selected speech hook was refused. Written assistant output remains available.');process.exitCode=1;});
module.exports={main};
