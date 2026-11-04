// Reproducible stored ZIP; verify reviewed source instead of silently rebuilding it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,parseCli}=require('./runtime');
const {verify}=require('./package');
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function archive(root=ROOT){
 const source=verify(root),parts=[],central=[];let offset=0;
 const hashes=new Map(source.files.map(item=>[item.path,item.sha256]));
 const manifestBytes=fs.readFileSync(path.join(root,'manifest.json'));
 if(JSON.stringify(JSON.parse(manifestBytes))!==JSON.stringify(source))throw Error('Source changed during build');
 const files=[...source.files.map(x=>x.path),'manifest.json'].sort();
 if(files.length>65535)throw Error('Archive entry limit');
 for(const file of files){
  if(file.startsWith('/')||file.split('/').some(part=>!part||part==='.'||part==='..')||file.includes('\\'))throw Error('Unsafe source path');
  const name=Buffer.from('dom-tts/'+file),data=file==='manifest.json'?manifestBytes:fs.readFileSync(path.join(root,file)),crc=crc32(data);
  if(file!=='manifest.json'&&crypto.createHash('sha256').update(data).digest('hex')!==hashes.get(file))throw Error('Source changed during build');
  if(name.length>65535||offset+data.length>33554432)throw Error('Archive size limit');
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  parts.push(header,name,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(0x314,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE((0o100644<<16)>>>0,38);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=header.length+name.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return {bytes:Buffer.concat([...parts,directory,end]),version:source.version,fileCount:files.length};
}
function build({out,root=ROOT}={}){
 if(!out||!path.isAbsolute(out)||path.extname(out).toLowerCase()!=='.zip')throw Error('Choose a new absolute --out ZIP path');
 const receipt=out+'.sha256.json';if(fs.existsSync(out)||fs.existsSync(receipt))throw Error('Output already exists; existing artifacts were preserved');
 const result=archive(root);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,result.bytes,{flag:'wx'});
 const metadata={schema:'dom-tts-build/1',version:result.version,fileCount:result.fileCount,sha256:crypto.createHash('sha256').update(result.bytes).digest('hex'),signed:false,releaseStatus:'development',nativeAcceptance:'not-certified'};
 fs.writeFileSync(receipt,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});return {...metadata,artifact:out};
}
if(require.main===module){try{console.log(JSON.stringify(build(parseCli(process.argv.slice(2),{},['out'])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={archive,build,crc32};
