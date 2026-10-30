import assert from 'node:assert/strict';
import fs from 'node:fs';
delete process.env.MOMM_EVIDENCE_HOME;
const script=fs.readFileSync(new URL('../assets/setup-ui/bumblers.js',import.meta.url),'utf8');
assert(!script.includes('window.confirm('),'Bumbler operations must use a testable in-page confirmation, not native browser modal');
assert(script.includes('No network request or credential operation'),'saving disclosure');
assert(script.includes('private dashboard session'),'private session');
// Revision authority belongs to the rendered view, not whichever snapshot is
// newest at dispatch. Exercise actual purge/edit/wording races, not that spelling.
await import('./bumblers-boundaries.test.mjs');
assert(script.includes('esc(p.label)'),'profile labels are escaped');
// Inspect what the actual initializer generates, not a disabled rejected mechanism.
await import('./bumble-oauth-panel.test.mjs');
console.log(JSON.stringify({passed:true,scope:'static safety plus synthetic production-client session/view-revision checks; real browser walkthrough is separate'}));
