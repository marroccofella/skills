const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const stateDir=path.resolve(process.env.DOM_TTS_STATE_DIR||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'42uk','DomTTS','0.4'):path.join(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'),'dom-tts')));
const allowedEnv=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','LANG','LC_ALL','LC_CTYPE','XDG_RUNTIME_DIR','DISPLAY','PULSE_SERVER','DBUS_SESSION_BUS_ADDRESS']);
function safeEnv(){return Object.fromEntries(Object.entries(process.env).filter(([key])=>allowedEnv.has(key.toUpperCase())));}
function psQuote(value){return "'"+String(value).replace(/'/g,"''")+"'";}
function readObject(file,fallback={}){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)return fallback;const obj=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));return obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:fallback;}catch{return fallback;}}
function assertNoLinks(dir){let part=path.resolve(dir);while(true){if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw new Error('State directories must not contain links');const parent=path.dirname(part);if(parent===part)break;part=parent;}}
function ensurePrivate(dir=stateDir){
 assertNoLinks(dir);const existed=fs.existsSync(dir);
 if(process.platform==='win32'){
 const command=["$ErrorActionPreference='Stop'","$env:PSModulePath=Join-Path $PSHOME 'Modules'","$dir="+psQuote(dir),"$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User","$allowed=@($owner.Value,'S-1-5-18','S-1-5-32-544')",existed?"$acl=Get-Acl -LiteralPath $dir; foreach($rule in $acl.Access) { if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) { throw 'Existing state directory is not private' } }":"[IO.Directory]::CreateDirectory($dir) | Out-Null; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($owner); $acl.SetAccessRuleProtection($true,$false); foreach($sid in $allowed) { $identity=New-Object System.Security.Principal.SecurityIdentifier($sid); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $dir -AclObject $acl"].join('; ');
 const result=spawnSync(powershell,['-NoProfile','-Command',command],{windowsHide:true,encoding:'utf8',timeout:10000,env:safeEnv()});
 if(result.error||result.status!==0)throw new Error('Private state directory unavailable; choose a new DOM_TTS_STATE_DIR or inspect permissions');
 }else{if(!existed)fs.mkdirSync(dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(dir);if(!stat.isDirectory()||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))throw new Error('State directory must be owner-only (0700)');}
 return dir;
}
function writeObject(file,value){const tmp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}}
function parseCli(argv,defaults={},allowed=[]){
 const result={...defaults},keys=new Set(allowed),booleans=new Set(['dryRun','stdin','includeCodeBlocks','includeCommandBlocks','includeCommentary','recover','once']);
 for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))throw new Error('Expected a named option');const raw=argv[i].slice(2),at=raw.indexOf('='),name=(at<0?raw:raw.slice(0,at)).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(!keys.has(name))throw new Error('Unknown option: --'+name);let value=at<0?undefined:raw.slice(at+1);
 if(value===undefined){if(booleans.has(name)&&(!argv[i+1]||argv[i+1].startsWith('--')))value=true;else{if(argv[i+1]===undefined||argv[i+1].startsWith('--'))throw new Error('Missing value for --'+name);value=argv[++i];}}
 if(booleans.has(name)){if(![true,false,'true','false'].includes(value))throw new Error('--'+name+' requires true or false');value=value===true||value==='true';}result[name]=value;
 }return result;
}
function endpoint(token,dir=stateDir){if(!/^[a-f0-9]{32}$/.test(token))throw new Error('Invalid playback token');const name=crypto.createHash('sha256').update(token).digest('hex').slice(0,24);return process.platform==='win32'?'\\\\.\\pipe\\dom-tts-'+name:path.join(dir,'s-'+name.slice(0,12));}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
module.exports={ROOT,stateDir,powershell,safeEnv,psQuote,readObject,writeObject,ensurePrivate,parseCli,endpoint,alive};

