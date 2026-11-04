// CLI-source protocol fixture only. The real OS ACL gate is tested separately by
// windows-privacy.cjs; production browser-speak.js never loads this injection.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire,wrap}=require('node:module');
const script=path.resolve(__dirname,'../../scripts/browser-speak.js'),load=createRequire(script),runtime=load('./runtime');
const state=fs.realpathSync(runtime.stateDir),parent=path.dirname(state),temp=fs.realpathSync(os.tmpdir());
if(path.basename(state)!=='private'||path.dirname(parent)!==temp||!path.basename(parent).startsWith('dom-browser-commands-'))throw Error('Refused non-fixture state');
const fixtureRuntime={...runtime,ensurePrivate(dir=state){if(path.resolve(dir)!==state||fs.lstatSync(state).isSymbolicLink()||!fs.lstatSync(state).isDirectory())throw Error('Fixture state changed');return state;}};
const entry={exports:{}};function fixtureRequire(name){return name==='./runtime'?fixtureRuntime:load(name);}fixtureRequire.main=entry;
vm.runInThisContext(wrap(fs.readFileSync(script,'utf8')),{filename:script})(entry.exports,fixtureRequire,entry,script,path.dirname(script));
