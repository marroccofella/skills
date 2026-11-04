const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ROOT}=require('../scripts/runtime');
const docs=['SKILL.md','README.md','EVOLUTION.md','COMPATIBILITY.md',...fs.readdirSync(path.join(ROOT,'references')).filter(x=>x.endsWith('.md')).map(x=>'references/'+x)];
let links=0;
for(const file of docs){
 const text=fs.readFileSync(path.join(ROOT,file),'utf8');
 for(const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)){
  const link=match[1].trim();if(/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link))continue;
  const relative=decodeURIComponent(link.split('#')[0]);
  const resolved=path.resolve(ROOT,path.dirname(file),relative),inside=path.relative(ROOT,resolved);
  assert(inside&&!inside.startsWith('..'+path.sep)&&!path.isAbsolute(inside),file+': local documentation link escapes source');
  assert(fs.statSync(resolved).isFile(),file+': local documentation link is not a file: '+relative);links++;
 }
}
const version=require('../package.json').version;
for(const file of ['README.md','EVOLUTION.md','COMPATIBILITY.md','references/release-candidate.md'])assert(fs.readFileSync(path.join(ROOT,file),'utf8').slice(0,900).includes(version),file+': current version must be identified before historical evidence');
console.log('PASS: '+links+' local documentation links resolve inside the published source; current version is explicit before historical acceptance.');
