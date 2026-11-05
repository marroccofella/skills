(function(root){
 'use strict';
 const SCHEMA='dom-tts-browser-rpc/2',ROUTE='/api/browser-rpc',MAX_DATA=32768,MAX_PLAIN=33280,MAX_RESPONSE=8192;
 const fail=()=>Error('browser-server-identity-unverified');
 function create({token,port,fetch:send=root.fetch.bind(root),crypto:engine=root.crypto,now=()=>Date.now()}={}){
  if(!engine?.subtle||typeof engine.getRandomValues!=='function'||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Browser encryption is unavailable. Reopen the updated companion with a supported browser.');
  const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const encode=bytes=>{let text='';for(const value of bytes)text+=String.fromCharCode(value);return btoa(text);};
  function decode(value,min,max){if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||value.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw fail();let bytes;try{bytes=Uint8Array.from(atob(value),value=>value.charCodeAt(0));}catch{throw fail();}if(bytes.length<min||bytes.length>max||encode(bytes)!==value)throw fail();return bytes;}
  const aad=(direction,requestNonce='')=>encoder.encode(SCHEMA+'\0'+port+'\0'+direction+(direction==='response'?'\0'+requestNonce:''));
  const key=engine.subtle.importKey('raw',Uint8Array.from(token.match(/../g),byte=>parseInt(byte,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);let stopEpoch=0;
  async function read(response){
   let reader;try{if(!response.body?.getReader)throw fail();reader=response.body.getReader();}catch{throw fail();}
   const chunks=[];let bytes=0,transport;
   try{
    for(;;){
     let next;try{next=await reader.read();}catch(error){
      // Only the body read can establish a transport interruption. UTF-8
      // decoding also throws TypeError and must remain an identity failure.
      if(error?.name==='TypeError')transport=new TypeError('browser-response-transport-interrupted');
      else if(error?.name==='AbortError'||error?.name==='TimeoutError'){transport=Error('browser-response-transport-interrupted');transport.name=error.name;}
      throw fail();
     }
     if(next.done)break;bytes+=next.value.byteLength;if(bytes>12288)throw fail();chunks.push(next.value);
    }
    const all=new Uint8Array(bytes);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.byteLength;}return JSON.parse(decoder.decode(all));
   }catch{try{await reader.cancel();}catch{}throw transport||fail();}
   finally{try{reader.releaseLock();}catch{throw fail();}}
  }
  async function request(route,data,{keepalive=false,epoch=stopEpoch}={}){
   if(typeof route!=='string'||!/^\/api\/[a-z0-9/-]{1,160}$/.test(route)||[ROUTE,'/api/server-proof'].includes(route)||data!==undefined&&(!data||typeof data!=='object'||Array.isArray(data)||encoder.encode(JSON.stringify(data)).byteLength>MAX_DATA))throw fail();
   if(!Number.isSafeInteger(epoch)||epoch<0)throw fail();const nonce=engine.getRandomValues(new Uint8Array(12)),nonceText=encode(nonce),plain=encoder.encode(JSON.stringify({route,method:data===undefined?'GET':'POST',timestamp:now(),epoch,...(data===undefined?{}:{data})}));if(plain.byteLength>MAX_PLAIN)throw fail();
   let ciphertext;try{ciphertext=new Uint8Array(await engine.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad('request'),tagLength:128},await key,plain));}catch{throw fail();}
   const response=await send(ROUTE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:SCHEMA,nonce:nonceText,ciphertext:encode(ciphertext)}),signal:AbortSignal.timeout(8000),...(keepalive?{keepalive:true}:{})});
   if(response.status!==200||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))throw fail();const value=await read(response);
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='ciphertext,nonce,schema'||value.schema!==SCHEMA)throw fail();
   let result;try{const decrypted=new Uint8Array(await engine.subtle.decrypt({name:'AES-GCM',iv:decode(value.nonce,12,12),additionalData:aad('response',nonceText),tagLength:128},await key,decode(value.ciphertext,16,MAX_RESPONSE+16)));if(decrypted.byteLength>MAX_RESPONSE)throw fail();result=JSON.parse(decoder.decode(decrypted));}catch{throw fail();}
   if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='data,epoch,status'||!Number.isSafeInteger(result.status)||result.status<200||result.status>599||!Number.isSafeInteger(result.epoch)||result.epoch<0)throw fail();stopEpoch=Math.max(stopEpoch,result.epoch);
   if(result.status>=400)throw Error(typeof result.data?.error==='string'?result.data.error:'request-refused');return route==='/api/poll'&&result.data&&typeof result.data==='object'&&!Array.isArray(result.data)?{...result.data,controlEpoch:result.epoch}:result.data;
  }
  return {request,epoch:()=>stopEpoch};
 }
 root.DomBrowserRpc={create};
})(globalThis);
