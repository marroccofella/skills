// Repository test entry point; the installed skill's self-test shares this helper.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {privateTestFixture} from '../momm/scripts/private-test-fixture.mjs';
export {privateTestFixture};
// argv[1] need not be a path (node -e ... -- argument); an unresolvable one is simply not this file.
const isEntrypoint=()=>{try{return !!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url));}catch{return false;}};
if(isEntrypoint()) {
  process.stdout.write(privateTestFixture(process.argv[2])+'\n');
}
