// Mutation of a test-local helper, never worker output or production qualification.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {privateTestFixture} from './private-test-fixture.mjs';import {defaultExec} from './probes.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
const root=fs.realpathSync.native(privateTestFixture('momm-qualification-sensitivity-')),parent=path.dirname(root),source=fs.readFileSync(new URL('./bumble-qualification-regressions.test.mjs',import.meta.url),'utf8');
try{
 const module=fs.readFileSync(new URL('./bumble-qualification.mjs',import.meta.url));fs.writeFileSync(path.join(root,'bumble-qualification.mjs'),module,{flag:'wx',mode:0o600});
 const marker="const recordDigest=value=>digest(JSON.stringify(source.includes('canonicalValue')?canonical(value):value));";assert.equal(source.split(marker).length,2,'inspect exactly one test-local digest seam');
 const baseline=path.join(root,'baseline.test.mjs'),mutant=path.join(root,'mutant.test.mjs');fs.writeFileSync(baseline,source,{flag:'wx',mode:0o600});fs.writeFileSync(mutant,source.replace(marker,"const recordDigest=value=>'0'.repeat(64);"),{flag:'wx',mode:0o600});
 const options={cwd:process.cwd(),timeout:10000,input:''},control=await defaultExec(process.execPath,[baseline,'integrity'],options),altered=await defaultExec(process.execPath,[mutant,'integrity'],options);
 assert.equal(control.code,0,'unmodified canonical integrity control must pass');assert.equal(Boolean(control.timedOut),false);
 assert.equal(Boolean(altered.timedOut),false,'observation timeout is not detection');assert(Number.isInteger(altered.code)&&altered.code>0,'the canonical test must detect a broken test-local digest');
 assert.match(altered.stderr,/unmodified re-digested record must remain eligible/,'failure must be the positive digest control, not syntax/import/refusal');
 console.log(JSON.stringify({passed:true,controls:1,detected_test_local_mutants:1,scope:'actual test sensitivity, no change to production qualification or live worker fitness'}));
}finally{if(path.dirname(root)!==parent||!path.basename(root).startsWith('momm-qualification-sensitivity-')||fs.realpathSync.native(root)!==root)throw Error('Owned cleanup target changed');fs.rmSync(root,{recursive:true,force:true});}
