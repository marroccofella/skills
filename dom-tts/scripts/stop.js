const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {stateDir,readObject,writeObject,endpoint}=require('./runtime');
async function stop(dir=stateDir){
 // Never kill a recorded PID. Only the authenticated live owner interrupts its own child.
 if(!fs.existsSync(dir))return {state:'idle'};
 const lock=readObject(path.join(dir,'playback.lock'));writeObject(path.join(dir,'stop.flag'),{request:crypto.randomBytes(16).toString('hex')});
 if(!lock.token)return {state:'stopped'};
 return new Promise(resolve=>{
  let settled=false;const socket=net.createConnection(endpoint(lock.token,dir));const finish=state=>{if(settled)return;settled=true;socket.destroy();resolve({state});};
  socket.setTimeout(1500,()=>finish('unreachable'));
  socket.on('connect',()=>socket.write(JSON.stringify({action:'stop',token:lock.token})+'\n'));
  let response='';socket.on('data',data=>{response+=data;if(response.includes('\n'))finish(response.trim()==='stopped'?'stopped':'denied');});
  socket.on('error',()=>finish('unreachable'));socket.on('end',()=>finish('unreachable'));
 });
}
if(require.main===module)stop().then(result=>{console.log(result.state);if(['unreachable','denied'].includes(result.state))process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={stop};

