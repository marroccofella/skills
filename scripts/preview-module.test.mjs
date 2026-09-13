import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import assert from 'node:assert/strict';import{fileURLToPath}from'node:url';
const script=new URL('preview-momm-site.mjs',import.meta.url),source=fs.readFileSync(script,'utf8').replace(/^#![^\n]*\n/,'').replace(/^import .+;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(script.href));let handler;
vm.runInNewContext(source,{http:{createServer(fn){handler=fn;return{listen(){}};}},fs,path,fileURLToPath,process:{argv:['node','fixture','8858'],stdout:{write(){}}},URL});
for(const url of ['/momm/home-player.mjs','/momm/stacking-model.mjs']){
 let code,headers;handler({method:'HEAD',url},{writeHead(c,h){code=c;headers=h;},end(){}});
 assert.equal(code,200);assert.equal(headers['Content-Type'],'text/javascript',url+' must load as a browser module');
}
console.log('PASS: preview serves both browser modules with executable MIME types.');
let headers,code;
const request=range=>{handler({method:'HEAD',url:'/momm/tour/walkthrough.mp4',headers:{range}},{writeHead(c,h){code=c;headers=h;},end(){}});return code;};
assert.equal(request('bytes=0-99'),206);assert.equal(headers['Content-Length'],100);assert.match(headers['Content-Range'],/^bytes 0-99\//);
assert.equal(request('bytes=-32'),206);assert.equal(headers['Content-Length'],32);
for(const range of ['bytes=999999999999999-','bytes=-0','bytes=4-2','bytes=0-1,3-4'])assert.equal(request(range),416);
console.log('PASS: bounded video ranges support seeking; invalid/multiple ranges fail closed.');
