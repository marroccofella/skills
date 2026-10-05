// An IPC-connected owner keeps native speech from surviving a crashed caller.
const {spawn}=require('node:child_process');
const {safeEnv}=require('../runtime');
let child,started=false,cancelling=false;
// Parent cancellation stops renewal even if stop and disconnect both fail.
// A parent event-loop stall longer than this lease also cancels playback.
let lease=setTimeout(()=>cancel(true),3000);
function renew(){if(cancelling)return;clearTimeout(lease);lease=setTimeout(()=>cancel(true),3000);}
function cancel(expired=false){if(cancelling)return;cancelling=true;clearTimeout(lease);if(child)child.kill();else process.exit(expired?1:0);}
if(!process.send){console.error('Native worker requires an IPC parent');process.exit(1);}
process.on('disconnect',cancel);
process.on('message',message=>{
 if(message?.action==='heartbeat'){renew();return;}
 if(message?.action==='stop'){cancel();return;}
 if(message?.action!=='start'||started)return;
 started=true;renew();
 // The command is created by the same-version governor process, never from stdin or user config.
 child=spawn(message.command.file,message.command.args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:safeEnv(),shell:false});
 child.stdin.on('error',()=>{});child.stdin.end(message.input||'');
 child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
 child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code===0?0:1));
});
