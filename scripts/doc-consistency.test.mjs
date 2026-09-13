import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
assert(!read('README.md').includes('POSIX process-group coverage remains open work'),'README contradicts implemented supervised process groups');
assert(!read('momm/references/release-1.15.0.md').includes('POSIX descendant cleanup and unsupported'),'release notes must distinguish detached processes from supervised descendants');
for(const file of ['momm/scripts/process-scope.test.mjs','momm/scripts/entrypoint.test.mjs','momm/scripts/setup-maintenance.test.mjs','scripts/momm-release-pages.test.mjs','scripts/public-export.test.mjs','scripts/doc-consistency.test.mjs'])assert(read('CONTRIBUTING.md').includes('node '+file),'local verification list omits '+file);
console.log(JSON.stringify({passed:true,checks:'supervised-vs-detached process limitations and local verification checklist'}));
