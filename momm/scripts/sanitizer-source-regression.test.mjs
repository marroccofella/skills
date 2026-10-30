// Governor preservation checks for the owner-approved narrow sanitizer repair.
// Synthetic strings only. No CLI dispatch, settings or real credential access.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';

delete process.env.MOMM_EVIDENCE_HOME;
const source=fs.readFileSync(new URL('./multi-review.mjs',import.meta.url),'utf8');
const begin=source.indexOf('function sanitizeText(text) {'),end=source.indexOf('\nfunction platformCommand(',begin);
assert(begin>=0&&end>begin);const actual=vm.runInNewContext('('+source.slice(begin,end)+')');
// Historical pre-repair behavior is the literal-preservation oracle, rather
// than duplicating the new exception implementation in the test.
function historical(text){let value=text;for(const p of [
 /\b(?:sk-ant-|sk-proj-|xai-|ghp_|gho_|ghu_|ghs_|github_pat_)[A-Za-z0-9._-]{12,}\b/g,
 /\bsk-[A-Za-z0-9]{20,}\b/g,/\bAKIA[0-9A-Z]{16}\b/g,
 /((?:api[_-]?key|password|secret|bearer)\s*[:=]\s*["']?)[^\s"']{8,}/gi])value=value.replace(p,(_match,prefix)=>(typeof prefix==='string'?prefix:'')+'[REDACTED]');return value;}
let passed=0;
for(const key of ['api_key','apiKey','PASSWORD','secret','bearer'])for(const separator of ['=',':',' = ',' : '])for(const quote of ['',"'",'"'])for(const tail of ['abcdefghijk','abc(defghijk)','abc[defghijk]','abc{defghijk}','abc.defghijk','abc+defghijk','abc/defghijk','abc;defghijk','abc,defghijk','abc=>defghijk','abc\\defghijk']){
 const text=key+separator+quote+'SYNTHETIC_'+tail+quote;assert.equal(actual(text).value,historical(text));passed++;
}
for(const prefix of ['const ','let ','var ','+const ','export const '])for(const key of ['secret','password','bearer','api_key'])for(const expression of ['own(privateInput,[\'access_token\',\'certificate\']);','()=>({access_token:Buffer.from(x)});','headers.authorization.slice(7);']){
 const text=prefix+key+'='+expression;assert.notEqual(historical(text),text);assert.equal(actual(text).value,text);passed++;
}
for(const prefix of ['const ','let ','var '])for(const quote of ["'",'"']){
 const text=prefix+'secret='+quote+'SYNTHETIC_function(value)'+quote+';';assert.equal(actual(text).value,historical(text));assert.notEqual(actual(text).value,text);passed++;
}
for(const word of ['Bearer','bearer','BEARER'])for(const whitespace of [' ','\t'])for(const token of ['SYNTHETIC'.repeat(2),'SYNTHETIC.abcd_efgh-0123','SYNTHETIC+abcd/efgh==']){
 const text='Authorization: '+word+whitespace+token;assert.equal(actual(text).value,'Authorization: '+word+whitespace+'[REDACTED]');passed++;
}
for(const fragments of [['gh','p_'],['github','_pat_'],['sk','-ant-'],['sk','-proj-'],['xai','-']]){
 const value=fragments.join('')+'SYNTHETIC'.repeat(4);assert.equal(actual(value).value,'[REDACTED]');passed++;
}
for(const text of ['password: hashPassword(input.password),','secret=SYNTHETIC_call(value)','const secret=SYNTHETIC_UNQUOTED_VALUE;']){
 assert.equal(actual(text).value,historical(text));assert.notEqual(actual(text).value,text);passed++;
}
console.log(JSON.stringify({passed,scope:'synthetic preservation cases plus explicit declaration/call controls; conservative ambiguous-value redaction retained; no claim of complete language parsing or universal secret detection'}));
