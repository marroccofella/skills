// Internal trusted-owner-host attestation, NOT a proposed BAB wire protocol.
// The host must verify exact-job/backend/lease evidence before signing. This
// module never signs, contacts a service, reads secrets or grants dispatch.
import crypto from 'node:crypto';
import {parseBumbleJSON} from './bumble-contract.mjs';
const authorities=new WeakMap(),SHA=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9_.:-]{1,200}$/;
const uint=v=>Number.isSafeInteger(v)&&v>=0;
const fail=()=>{throw Error('Physical release receipt refused; original hold retained.');};
function data(v,keys){
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
 const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
export function createBumbleReleaseVerifier(input){
 const p=data(input,['public_key_pem','public_key_sha256','configuration_sha256']);
 if(typeof p.public_key_pem!=='string'||Buffer.byteLength(p.public_key_pem)>4096||!p.public_key_pem.startsWith('-----BEGIN PUBLIC KEY-----')||typeof p.public_key_sha256!=='string'||!SHA.test(p.public_key_sha256)||typeof p.configuration_sha256!=='string'||!SHA.test(p.configuration_sha256))fail();
 let key;try{key=crypto.createPublicKey(p.public_key_pem);}catch{fail();}
 if(key.asymmetricKeyType!=='ed25519'||crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')!==p.public_key_sha256)fail();
 const token=Object.freeze({});authorities.set(token,{key,key_sha256:p.public_key_sha256,configuration_sha256:p.configuration_sha256});return token;
}
export const isBumbleReleaseVerifier=value=>authorities.has(value);
export function verifyBumbleReleaseReceipt(verifier,input,expected,mode='new'){
 const authority=authorities.get(verifier);if(!authority)fail();
 const e=data(expected,['configuration_sha256','reservation_id','reservation_sha256','earliest_at']);
 if(e.configuration_sha256!==authority.configuration_sha256||typeof e.reservation_id!=='string'||!ID.test(e.reservation_id)||typeof e.reservation_sha256!=='string'||!SHA.test(e.reservation_sha256)||!uint(e.earliest_at)||!['new','stored'].includes(mode))fail();
 const envelope=data(input,['payload','signature']);
 if(typeof envelope.payload!=='string'||Buffer.byteLength(envelope.payload)>8192||typeof envelope.signature!=='string'||! /^[A-Za-z0-9_-]{86}$/.test(envelope.signature))fail();
 const signature=Buffer.from(envelope.signature,'base64url');if(signature.length!==64||signature.toString('base64url')!==envelope.signature||!crypto.verify(null,Buffer.from(envelope.payload),authority.key,signature))fail();
 let p;try{p=data(parseBumbleJSON(envelope.payload),['schema','authority_sha256','configuration_sha256','reservation_id','reservation_sha256','remote_session_id','remote_request_id','backend_lease_id','backend_outcome','backend_terminal_at','lease_released_at','observed_at','evidence_sha256']);}catch{fail();}
 const now=Date.now();
 if(p.schema!=='momm-bumble-owner-release/1'||p.authority_sha256!==authority.key_sha256||p.configuration_sha256!==e.configuration_sha256||p.reservation_id!==e.reservation_id||p.reservation_sha256!==e.reservation_sha256||!['remote_session_id','remote_request_id','backend_lease_id'].every(k=>typeof p[k]==='string'&&ID.test(p[k]))||!['completed','cancelled','failed','refused'].includes(p.backend_outcome)||!['backend_terminal_at','lease_released_at','observed_at'].every(k=>uint(p[k]))||p.backend_terminal_at<e.earliest_at||p.lease_released_at<p.backend_terminal_at||p.observed_at<p.lease_released_at||p.observed_at>now||(mode==='new'&&now-p.observed_at>300000)||typeof p.evidence_sha256!=='string'||!SHA.test(p.evidence_sha256))fail();
 return Object.freeze({...p});
}
