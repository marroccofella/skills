// Per-user reviewer settings. No model calls, secrets or project-controlled overrides.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {createPrivateDirectory, requirePrivateEvidence} from './evidence-permissions.mjs';
export const BUILTIN_ROUTES = Object.freeze(['codex','claude','antigravity','copilot','grok','gemini']);
export const REGISTRY_SCHEMA = 'momm-reviewer-registry/1';
export const REMOTE_POLICY_ACTIVE = false; // No credentialed operation before reviewed protocol acceptance.
const MAX_BYTES=32_000_000, MAX_PROFILES=1000, MAX_CONNECTORS=500;
const RECENT_EVENTS=500, MAX_EVENT_ARCHIVES=1000, MAX_AUDIT_BYTES=100_000_000;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const id=()=>crypto.randomUUID();
const copy=value=>JSON.parse(JSON.stringify(value));
const fault=(code,message)=>Object.assign(new Error(message),{code});
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
function fields(value,keys){if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))throw fault('invalid_configuration','Unsupported configuration fields.');}
function text(value,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b-\x1f]/.test(value))throw fault('invalid_configuration','Invalid text field.');return value.trim();}
export function normalizeEndpoint(value){
  const url=new URL(text(value,2048));
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9/_-]*$/.test(url.pathname))throw fault('invalid_endpoint','Use an HTTPS API base with no credentials, query or fragment.');
  const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  const mapped=host.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
  const address=mapped?[parseInt(mapped[1],16)>>8,parseInt(mapped[1],16)&255,parseInt(mapped[2],16)>>8,parseInt(mapped[2],16)&255].join('.'):host;
  const first16=net.isIP(host)===6?(parseInt(host.split(':')[0],16)||0):0;
  if(host==='localhost'||host.endsWith('.localhost')||host==='::1'||host==='::'||(net.isIP(host)===6&&((first16&0xffc0)===0xfe80||(first16&0xff00)===0xff00))||host.includes('%')
    ||(net.isIP(address)===4&&(/^(0|127|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(address))))throw fault('invalid_endpoint','Loopback, link-local, metadata and non-unicast destinations are not model endpoints.');
  url.pathname=url.pathname.replace(/\/+$/,'')||'/v1';
  return {base:url.toString().replace(/\/$/,''),origin:url.origin,resource_group:digest(url.origin)};
}
export function defaultRegistryHome(env=process.env){return env.MOMM_REVIEWER_HOME||path.join(os.homedir(),'.momm-reviewers');}
function ensurePrivate(root,project){
  if(!path.isAbsolute(root))throw fault('invalid_store','Reviewer storage must be absolute.');
  // Resolve the existing parent before creating storage or a writer lock.
  const ancestor=fs.existsSync(root)?root:path.dirname(root),actual=fs.realpathSync(ancestor),relative=path.relative(project,actual);
  if(!relative||(!(relative==='..'||relative.startsWith('..'+path.sep))&&!path.isAbsolute(relative)))throw fault('invalid_store','Reviewer settings must resolve outside the project before creation.');
  if(!fs.existsSync(root)){
    if(!fs.existsSync(path.dirname(root)))throw fault('invalid_store','Reviewer storage parent does not exist.');
    if(process.platform==='win32'){if(!createPrivateDirectory(root))throw fault('privacy_refused','Private reviewer storage could not be created.');}
    else fs.mkdirSync(root,{mode:0o700});
  }
  requirePrivateEvidence(root);
}
function checkState(state){
  if(state.schema!==REGISTRY_SCHEMA||!Number.isSafeInteger(state.revision)||!Array.isArray(state.profiles)||!Array.isArray(state.connectors)||!Array.isArray(state.events)||!Array.isArray(state.reservations))throw fault('unsupported_schema','Unsupported registry. Previous configuration retained.');
  if(state.profiles.length>MAX_PROFILES*2||state.profiles.filter(p=>p.state!=='purged').length>MAX_PROFILES||state.connectors.length>MAX_CONNECTORS||state.reservations.length>MAX_PROFILES)throw fault('registry_full','Registry capacity reached.');
  state.event_archives??=[];
  if(!Array.isArray(state.event_archives)||state.event_archives.length>MAX_EVENT_ARCHIVES||state.event_archives.some(a=>!plain(a)||Object.keys(a).sort().join(',')!=='bytes,count,sha256'||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.count)||a.count<1||a.count>RECENT_EVENTS||!Number.isSafeInteger(a.bytes)||a.bytes<1)||state.event_archives.reduce((n,a)=>n+a.bytes,0)>MAX_AUDIT_BYTES)throw fault('storage_budget','Private settings history budget reached or its metadata is invalid.');
  for(const e of state.events){fields(e,['id','at','action','profile_id']);if(typeof e.id!=='string'||e.id.length>100||typeof e.at!=='string'||e.at.length>40||!Number.isFinite(Date.parse(e.at))||typeof e.action!=='string'||e.action.length>80||typeof e.profile_id!=='string'||e.profile_id.length>200)throw fault('invalid_configuration','Invalid settings event.');}
  const ids=new Set();for(const p of state.profiles){p.auth_mode??='oauth';if(!['oauth','api_key'].includes(p.auth_mode)||(p.kind==='cli'&&p.auth_mode!=='oauth'))throw fault('invalid_configuration','Unsupported saved authentication choice.');if(!p.id||ids.has(p.id)||p.quorum_eligible!==false||!['draft','disabled','active','archived','purged'].includes(p.state))throw fault('invalid_configuration','Invalid profile state.');ids.add(p.id);}
  if(!Array.isArray(state.baseline_excluded)||!state.baseline_excluded.every(r=>BUILTIN_ROUTES.includes(r)))throw fault('invalid_configuration','Unknown baseline exclusions.');
  for(const c of state.connectors){fields(c,['id','revision','label','base_url','resource_group','pod_id','certificate','credential_state','policy_receipt']);if(normalizeEndpoint(c.base_url).resource_group!==c.resource_group||c.credential_state!=='missing'||c.policy_receipt!==null)throw fault('invalid_configuration','Unverified connector authority is not accepted.');}
  return state;
}
const blank=()=>({schema:REGISTRY_SCHEMA,revision:0,profiles:[],connectors:[],events:[],event_archives:[],reservations:[],baseline_excluded:[]});
export class ReviewerRegistry {
  constructor({root=defaultRegistryHome(),project=process.cwd(),now=()=>Date.now()}={}){
    if(!path.isAbsolute(root))throw fault('invalid_store','Reviewer storage must be an absolute owner-selected path.');
    this.root=path.resolve(root);this.project=fs.realpathSync(project);this.now=now;
    const relative=path.relative(this.project,this.root);
    if(!relative||(!(relative==='..'||relative.startsWith('..'+path.sep))&&!path.isAbsolute(relative)))throw fault('invalid_store','Reviewer settings belong outside the project.');
    this.file=path.join(this.root,'registry.json');
  }
  read(){
    ensurePrivate(this.root,this.project);
    const actual=fs.realpathSync(this.root),relative=path.relative(this.project,actual);
    if(!relative||(!(relative==='..'||relative.startsWith('..'+path.sep))&&!path.isAbsolute(relative)))throw fault('invalid_store','Reviewer settings resolve inside the project.');
    if(!fs.existsSync(this.file))return blank();
    const stat=fs.lstatSync(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)throw fault('invalid_store','Registry is not a bounded regular private file.');
    return checkState(JSON.parse(fs.readFileSync(this.file,'utf8')));
  }
  mutate(expected,operation){
    ensurePrivate(this.root,this.project);const lock=path.join(this.root,'writer.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw fault('registry_busy','Reviewer settings are busy; reload before retrying. No stale lock is removed automatically.');}
    let temp,own;let result,failure;
    try{
      own=fs.fstatSync(fd,{bigint:true});
      const state=this.read();if(expected!==state.revision)throw fault('stale_revision','Settings changed in another window. Reload before retrying.');
      result=operation(state);state.revision++;
      // Purging metadata is distinct from deleting review/attempt evidence.
      state.profiles=state.profiles.filter(p=>p.state!=='purged'||state.reservations.some(r=>r.profile_id===p.id&&!r.released));
      const used=new Set(state.profiles.map(p=>p.connector_id).filter(Boolean));
      state.connectors=state.connectors.filter(c=>used.has(c.id)||state.reservations.some(r=>r.connector_id===c.id&&!r.released));
      checkState(state);this.archiveEvents(state);
      const bytes=JSON.stringify(state,null,2)+'\n';if(Buffer.byteLength(bytes)>MAX_BYTES)throw fault('storage_budget','Reviewer storage budget reached. Nothing committed.');
      temp=path.join(this.root,`registry-${id()}.tmp`);const file=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(file,bytes);fs.fsyncSync(file);}finally{fs.closeSync(file);}
      requirePrivateEvidence(this.root);fs.renameSync(temp,this.file);temp=null;
      result={revision:state.revision,result};
    }catch(error){failure=error;}
    let cleanupFailed=false;
    try{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);}catch{cleanupFailed=true;}
    try{if(!own)throw Error('Lock identity was not verified.');const stat=fs.lstatSync(lock,{bigint:true});if(stat.ino!==own.ino||(process.platform!=='win32'&&stat.dev!==own.dev)||stat.nlink!==1n||stat.isSymbolicLink())throw Error('Lock changed.');fs.unlinkSync(lock);}catch{cleanupFailed=true;}
    try{fs.closeSync(fd);}catch{cleanupFailed=true;}
    if(failure)throw failure;
    if(cleanupFailed)throw fault('registry_reconcile','Settings write outcome requires reconciliation; cleanup could not be verified. Do not blindly resend.');
    return result;
  }
  archiveEvents(state){
    const files=fs.readdirSync(this.root).filter(name=>/^events-[a-f0-9]{64}\.json$/.test(name));
    let stored=0;for(const name of files){const stat=fs.lstatSync(path.join(this.root,name));if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw fault('invalid_store','Private settings history is not a regular file.');stored+=stat.size;}
    if(files.length>MAX_EVENT_ARCHIVES||stored>MAX_AUDIT_BYTES)throw fault('storage_budget','Private settings history budget reached. Original files retained.');
    while(state.events.length>RECENT_EVENTS){
      const events=state.events.splice(0,RECENT_EVENTS);
      const bytes=Buffer.from(JSON.stringify({schema:'momm-reviewer-settings-events/1',events})+'\n'),sha256=digest(bytes),file=path.join(this.root,`events-${sha256}.json`);
      if(!fs.existsSync(file)){
        if(files.length>=MAX_EVENT_ARCHIVES||stored+bytes.length>MAX_AUDIT_BYTES)throw fault('storage_budget','Private settings history budget reached. Original files retained.');
        const writer=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(writer,bytes);fs.fsyncSync(writer);}finally{fs.closeSync(writer);}files.push(path.basename(file));stored+=bytes.length;
      }else if(digest(fs.readFileSync(file))!==sha256)throw fault('invalid_store','An original settings-history archive changed.');
      if(!state.event_archives.some(a=>a.sha256===sha256))state.event_archives.push({sha256,count:events.length,bytes:bytes.length});
    }
    checkState(state);
  }
  snapshot({query='',state='visible',offset=0,limit=25}={}){
    const store=this.read(),term=String(query).slice(0,200).toLowerCase();
    const list=store.profiles.filter(p=>p.state!=='purged'&&(state==='visible'?p.state!=='archived':p.state===state)&&`${p.label} ${p.model_id||''}`.toLowerCase().includes(term));
    const page=list.slice(Math.max(0,offset),Math.max(0,offset)+Math.min(100,Math.max(1,limit))).map(p=>({...copy(p),quorum_eligible:false,qualified:false}));
    return {schema:REGISTRY_SCHEMA,revision:store.revision,total:list.length,profiles:page,connectors:copy(store.connectors),baseline_excluded:store.baseline_excluded,
      counts:{registered:store.profiles.filter(p=>p.state!=='purged').length,enabled:store.profiles.filter(p=>p.state==='active').length,active_jobs:store.reservations.filter(r=>!r.released).length},
      remote_policy:{active:REMOTE_POLICY_ACTIVE,reason:'Credential policy and live adapter qualification are not activated in this development build.'}};
  }
  command(body){
    fields(body,['op','revision','id','profile','connector','route','wording','hash']);
    if(!Number.isSafeInteger(body.revision))throw fault('stale_revision','A current settings revision is required.');
    return this.mutate(body.revision,store=>{
      const find=()=>{const p=store.profiles.find(p=>p.id===body.id&&p.state!=='purged');if(!p)throw fault('not_found','Reviewer not found.');return p;};
      const event=(action,profile)=>{store.events.push({id:id(),at:new Date(this.now()).toISOString(),action,profile_id:profile.id});};
      const invalidate=p=>{p.qualification=null;p.overlay_approved=false;if(p.state==='active')p.state='disabled';p.revision++;};
      if(body.op==='save'){
        fields(body.profile,['label','kind','model_id','connector_id','route','task_type','auth_mode']);
        const input=body.profile,label=text(input.label,80),kind=input.kind||'bumbler';
        if(!['bumbler','remote_api','cli'].includes(kind))throw fault('invalid_configuration','Unsupported reviewer kind.');
        if(kind==='cli'&&!BUILTIN_ROUTES.includes(input.route))throw fault('adapter_required','This CLI needs a reviewed adapter; arbitrary commands are not accepted.');
        const previousProfile=body.id?find():null;
        const auth_mode=input.auth_mode??previousProfile?.auth_mode??'oauth';
        if(!['oauth','api_key'].includes(auth_mode))throw fault('invalid_configuration','Choose OAuth or an explicit optional API-key mode; automatic fallback is not supported.');
        if(kind==='cli'&&auth_mode!=='oauth')throw fault('adapter_required','CLI reviewers use their OAuth sessions. A provider API key requires a separate qualified API connector, never shell arguments.');
        let connector_id=input.connector_id||null;
        if(connector_id&&body.connector)throw fault('invalid_configuration','Choose either a saved connection or a new connection, not both.');
        if(kind==='cli'&&(body.connector||connector_id||input.model_id))throw fault('invalid_configuration','CLI profiles do not carry remote connection or model settings.');
        if(body.connector){
          fields(body.connector,['base_url','label','pod_id','certificate']);
          const endpoint=normalizeEndpoint(body.connector.base_url);let certificate=body.connector.certificate||null;
          if(certificate){if(typeof certificate!=='string'||certificate.length>32768||/PRIVATE\s+KEY/i.test(certificate))throw fault('invalid_certificate','Only a bounded public certificate is accepted.');try{certificate=new crypto.X509Certificate(certificate).toString();}catch{throw fault('invalid_certificate','The public certificate could not be parsed.');}}
          let connector=store.connectors.find(c=>c.base_url===endpoint.base);
          const pod_id=body.connector.pod_id?text(body.connector.pod_id,80):null;
          if(connector&&(connector.certificate!==certificate||connector.pod_id!==pod_id))throw fault('connector_conflict','The existing connection has different certificate or pod settings. Nothing changed; choose its saved settings or a distinct connection.');
          if(!connector){connector={id:id(),revision:1,label:text(body.connector.label||label,80),base_url:endpoint.base,resource_group:endpoint.resource_group,
            pod_id,certificate,credential_state:'missing',policy_receipt:null};store.connectors.push(connector);}
          connector_id=connector.id;
        }
        if(connector_id&&!store.connectors.some(c=>c.id===connector_id))throw fault('invalid_configuration','Connection is not owned by this registry.');
        const previous=previousProfile;
        if(previous&&previous.state==='archived')throw fault('invalid_state','Restore an archived reviewer before editing it.');
        const p=previous||{id:id(),revision:0,wording:'',overlay_hash:digest(''),overlay_approved:false,quorum_eligible:false,qualification:null};
        Object.assign(p,{label,kind,auth_mode,model_id:input.model_id?text(input.model_id,160):null,connector_id,route:kind==='cli'?input.route:null,
          task_type:input.task_type?text(input.task_type,120):'source-grounded-check',state:connector_id||kind==='cli'?'disabled':'draft'});
        invalidate(p);if(!previous)store.profiles.push(p);event(previous?'edit':'add',p);return {id:p.id};
      }
      if(body.op==='exclude_cli'||body.op==='restore_cli'){
        if(!BUILTIN_ROUTES.includes(body.route))throw fault('invalid_configuration','Unknown builtin route.');
        store.baseline_excluded=body.op==='exclude_cli'?[...new Set([...store.baseline_excluded,body.route])]:store.baseline_excluded.filter(r=>r!==body.route);
        event(body.op,{id:'builtin:'+body.route});
        return {route:body.route,baseline_gate:'removal cannot reduce required quorum'};
      }
      const p=find();
      if(p.state==='archived'&&!['undo','purge'].includes(body.op))throw fault('invalid_state','Archived reviewers require explicit Undo; archive time is not reset.');
      if(body.op==='wording'){
        if(typeof body.wording!=='string'||body.wording.length>2000||/[\x00-\x08\x0b-\x1f]/.test(body.wording))throw fault('invalid_configuration','Wording must be bounded plain text.');
        p.wording=body.wording;p.overlay_hash=digest(body.wording);invalidate(p);event('wording',p);return {id:p.id,hash:p.overlay_hash};
      }
      if(body.op==='approve_wording'){if(body.hash!==p.overlay_hash)throw fault('stale_revision','Preview hash changed.');p.overlay_approved=true;p.revision++;event('approve_wording',p);return {id:p.id};}
      if(body.op==='duplicate'){if(store.profiles.filter(p=>p.state!=='purged').length>=MAX_PROFILES)throw fault('registry_full','Registry limit reached.');const twin={...copy(p),id:id(),label:`${p.label.slice(0,70)} copy`,state:'disabled',qualification:null,overlay_approved:false,revision:1};store.profiles.push(twin);event('duplicate',twin);return {id:twin.id};}
      if(body.op==='archive'){p.state='archived';p.archived_at=this.now();invalidate(p);event('archive',p);return {id:p.id};}
      if(body.op==='undo'){const now=this.now();if(p.state!=='archived'||!Number.isSafeInteger(p.archived_at)||p.archived_at<0||!Number.isSafeInteger(now)||now<0||now<p.archived_at||now-p.archived_at>30*86400_000)throw fault('invalid_state','Undo is unavailable; history and reservations remain.');p.state='disabled';invalidate(p);event('undo',p);return {id:p.id};}
      if(body.op==='purge'){if(p.state!=='archived')throw fault('invalid_state','Archive before purging.');Object.assign(p,{state:'purged',label:'Removed reviewer',model_id:null,wording:'',overlay_hash:digest(''),connector_id:null});invalidate(p);event('purge',p);return {id:p.id};}
      if(body.op==='disable'){p.state='disabled';invalidate(p);event('disable',p);return {id:p.id};}
      if(['enable','test','qualify','rotate','revoke'].includes(body.op))throw fault('policy_required','Live remote operations are blocked pending protocol approval and adapter qualification. No request or credential operation was performed.');
      throw fault('invalid_configuration','Unsupported reviewer operation.');
    });
  }
}
