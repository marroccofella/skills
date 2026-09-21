import assert from 'node:assert/strict';
import { windowsTool, windowsChildEnv } from './process-scope.mjs';
const root = 'C:\\project', trusted = 'C:\\trusted';
for (const alias of ['C:\\junction', 'C:\\symlink', 'C:\\PROJEC~1']) {
  const files = { statSync: () => ({isFile:()=>true}), realpathSync: { native: p => p.replace(alias, root) } };
  const env = {PATH:`${alias};.;relative;;${trusted}`,SystemRoot:'C:\\Windows'};
  assert.equal(windowsTool('git',{cwd:root,env,platform:'win32',fs:files}), trusted + '\\git.exe');
  assert.equal(windowsChildEnv(env,{cwd:root,fs:files}).PATH,trusted);
  assert.equal(windowsTool('taskkill',{cwd:root,env,platform:'win32',fs:files}),'C:\\Windows\\System32\\taskkill.exe');
}
const files = { statSync: () => ({isFile:()=>true}), realpathSync: {native:p=> {if(p.startsWith('C:\\unresolved')) throw new Error('EACCES'); return p;}}};
const env = {PATH:`C:\\unresolved;${trusted}`};
assert.equal(windowsTool('git',{cwd:root,env,platform:'win32',fs:files}),trusted+'\\git.exe','unresolvable executable must not fall back to a lexical path');
assert.equal(windowsChildEnv(env,{cwd:root,fs:files}).PATH,trusted,'unresolvable PATH entry must be removed');
console.log('PASS: junction, symlink, 8.3 aliases, dot, relative, empty and unresolvable PATH entries are excluded');
