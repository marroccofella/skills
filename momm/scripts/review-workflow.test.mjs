// Offline CI/documentation contract. Does not claim the matrix has actually run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/self-test.yml'),'utf8').replace(/\r\n/g,'\n');
assert.match(workflow,/self-test:\s+timeout-minutes: 25/,'the existing job is bounded, not the 360-minute default');
for(const name of ['Media byte validation','Installation completion boundary','Capability expiry refusal','Attempt accounting and tool-produced checks','Fail-closed Windows PATH identity']) {
  const step=workflow.split('      - name: ').find(s=>s.startsWith(name+'\n'));
  assert(step,`missing step ${name}`);assert.match(step,/^\s*timeout-minutes: 2[ \t]*$/m,`missing short per-step limit: ${name}`);
}
// The signed release must not be a weaker gate than a pull request. Eleven suites, including every
// one that verifies 1.16.1's own behaviour, ran on PRs but not in the release job (committed-range
// self-review rev_20260922084714, release-list-omits-patch-gates).
{
  const names=f=>[...new Set([...fs.readFileSync(path.join(root,f),'utf8').matchAll(/node ([\w./-]+\.test\.mjs)/g)].map(m=>m[1]))];
  const missing=names('.github/workflows/self-test.yml').filter(n=>!names('.github/workflows/momm-release.yml').includes(n));
  assert.deepEqual(missing,[],'the signed release workflow must run every suite the safety matrix runs');
}
const catalog=fs.readFileSync(path.join(root,'momm/references/test-catalog-1.16.1.md'),'utf8');
const gates=fs.readFileSync(path.join(root,'momm/references/gates-1.16.1.md'),'utf8');
assert.match(gates,/Node 18 and Node 24 lifecycle drills remain required/,'primary targets must not silently remove the charter\'s legacy lifecycle drill');
for(const directory of ['momm/scripts','scripts']) for(const name of fs.readdirSync(path.join(root,directory))) {
  if(name.endsWith('.test.mjs'))assert(catalog.includes('`'+directory+'/'+name+'`'),`missing catalog entry: ${directory}/${name}`);
}
console.log('PASS: short new CI step limits, bounded whole job, and every repository/MOMM suite is catalogued');
