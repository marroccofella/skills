const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT}=require('../scripts/runtime'),{verify}=require('../scripts/package'),{archive,build,crc32}=require('../scripts/build');
// A second reader checks complete archive structure and per-file hashes, rather
// than trusting the builder's receipt or merely searching for file names.
function inspectZip(bytes){
 const files=new Map();let at=0;
 while(bytes.readUInt32LE(at)===0x04034b50){assert.equal(bytes.readUInt16LE(at+8),0);assert.equal(bytes.readUInt32LE(at+18),bytes.readUInt32LE(at+22));const size=bytes.readUInt32LE(at+18),nl=bytes.readUInt16LE(at+26),xl=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+nl).toString('utf8'),start=at+30+nl+xl,data=bytes.subarray(start,start+size);assert.equal(data.length,size);assert(!files.has(name));assert.equal(crc32(data),bytes.readUInt32LE(at+14));files.set(name,{data,offset:at});at=start+size;}
 const centralStart=at;let count=0;
 while(bytes.readUInt32LE(at)===0x02014b50){const nl=bytes.readUInt16LE(at+28),xl=bytes.readUInt16LE(at+30),cl=bytes.readUInt16LE(at+32),name=bytes.subarray(at+46,at+46+nl).toString('utf8'),file=files.get(name);assert(file);assert.equal(bytes.readUInt32LE(at+42),file.offset);assert.equal(bytes.readUInt32LE(at+20),file.data.length);at+=46+nl+xl+cl;count++;}
 assert.equal(bytes.readUInt32LE(at),0x06054b50);assert.equal(bytes.readUInt16LE(at+10),count);assert.equal(bytes.readUInt16LE(at+8),files.size);assert.equal(bytes.readUInt32LE(at+16),centralStart);assert.equal(bytes.readUInt32LE(at+12),at-centralStart);assert.equal(at+22,bytes.length);return files;
}
const temporaryRoot=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(temporaryRoot,'dom-build-'));
try{
 assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
 const source=verify(),copy=path.join(dir,'source');fs.mkdirSync(copy);
 for(const file of [...source.files.map(x=>x.path),'manifest.json']){const target=path.join(copy,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,file),target);}
 const canaries=Array.from({length:5},()=>crypto.randomBytes(24).toString('hex'));
 const privateFiles=['assets/settings.json','state/private.json','recordings/test.wav','.dom-tts-install.json','release-evidence.json'];
 privateFiles.forEach((file,i)=>{const target=path.join(copy,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,canaries[i]);});
 const first=archive(),second=archive(copy);assert(first.bytes.equals(second.bytes));for(const canary of canaries)assert(!second.bytes.includes(Buffer.from(canary)));
 const entries=inspectZip(second.bytes);assert.equal(entries.size,source.files.length+1);
 const packedManifest=JSON.parse(entries.get('dom-tts/manifest.json').data);assert.deepEqual(packedManifest,source);
 for(const item of source.files){const file=entries.get('dom-tts/'+item.path);assert(file);assert.equal(crypto.createHash('sha256').update(file.data).digest('hex'),item.sha256);}
 assert(entries.has('dom-tts/assets/browser/browser.html'));assert(entries.has('dom-tts/scripts/reply-stream.js'));for(const file of privateFiles)assert(!entries.has('dom-tts/'+file));
 const out=path.join(dir,'candidate.zip'),receipt=build({out,root:copy});assert.equal(receipt.fileCount,source.files.length+1);assert.equal(receipt.sha256,crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'));assert.equal(receipt.signed,false);assert.equal(receipt.releaseStatus,'development');assert.equal(receipt.nativeAcceptance,'not-certified');assert.throws(()=>build({out,root:copy}),/preserved/);
 fs.appendFileSync(path.join(copy,'README.md'),'tampered');assert.throws(()=>archive(copy),/manifest mismatch/);
 console.log('PASS: reproducible source ZIP, independent local/central-directory round trip, per-entry CRC and manifest hashes, browser/stream payload, private settings/state/audio/install/evidence exclusion, artifact receipt, overwrite refusal and tamper refusal. No install, playback or signing claim.');
}finally{const resolved=fs.realpathSync(dir);if(path.dirname(resolved)!==temporaryRoot||!/^dom-build-[A-Za-z0-9]+$/.test(path.basename(resolved)))throw Error('Unexpected cleanup path');fs.rmSync(resolved,{recursive:true,force:true});}
