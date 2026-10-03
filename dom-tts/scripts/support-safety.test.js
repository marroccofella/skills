const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {collectDiagnostics}=require('./support-safety');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dom-support-'));
try{fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'package.json'),'{"version":"0.4.0-dev.1"}');const sentinel='PRIVATE_SENTINEL';fs.writeFileSync(path.join(root,'state','status.json'),JSON.stringify({state:'speaking',provider:'sapi',mode:'informative',chunks:2,text:sentinel,path:os.homedir(),error:sentinel}));const report=collectDiagnostics(root,path.join(root,'state'));assert(!JSON.stringify(report).includes(sentinel));assert(!JSON.stringify(report).includes(os.homedir()));assert.equal(report.statuses.status.hasError,true);assert.equal(report.statuses.status.chunks,2);console.log('PASS: typed diagnostics exclude text, paths, settings and raw errors.');}finally{fs.rmSync(root,{recursive:true,force:true});}

