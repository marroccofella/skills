const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {acquireOwner}=require('../scripts/experimental/browser-owner');
const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'dom-browser-owner-')),lock=path.join(root,'browser-session.lock'),recovery=path.join(root,'browser-session.recovery.lock'),a='a'.repeat(64),b='b'.repeat(64);
try{
 let first=acquireOwner({dir:root,token:a,isAlive:()=>true});assert.throws(()=>acquireOwner({dir:root,token:b,isAlive:()=>true}),/owner-live/);assert.equal(JSON.parse(fs.readFileSync(lock)).token,a);first.release();
 fs.writeFileSync(lock,JSON.stringify({pid:123,token:a}));let competitors=0;
 const next=acquireOwner({dir:root,token:b,isAlive:()=>false,onBeforeClaim(){competitors++;assert.throws(()=>acquireOwner({dir:root,token:a,isAlive:()=>false}),/recovery-busy/);assert.equal(JSON.parse(fs.readFileSync(lock)).token,a);}});assert.equal(competitors,1);assert.equal(JSON.parse(fs.readFileSync(lock)).token,b);assert(!fs.existsSync(recovery));
 fs.writeFileSync(lock,JSON.stringify({pid:123,token:a}));next.release();assert.equal(JSON.parse(fs.readFileSync(lock)).token,a);
 fs.writeFileSync(recovery,'interrupted recovery');assert.throws(()=>acquireOwner({dir:root,token:b,isAlive:()=>false}),/inspection/);assert.equal(JSON.parse(fs.readFileSync(lock)).token,a);fs.unlinkSync(recovery);
 fs.writeFileSync(lock,'incomplete');assert.throws(()=>acquireOwner({dir:root,token:b,isAlive:()=>false}),/inspection/);assert.equal(fs.readFileSync(lock,'utf8'),'incomplete');assert(!fs.existsSync(recovery));
 console.log('PASS: browser owner live-lock preservation, serialized stale takeover, competing claimant refusal, token-bound release and interrupted/malformed fail-closed inspection; no PID killed.');
}finally{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert(path.basename(resolved).startsWith('dom-browser-owner-'));fs.rmSync(resolved,{recursive:true,force:true});}
