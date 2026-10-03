// Real child-process containment with a Node stand-in, not audible speech certification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChild } = require('../scripts/providers/native');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtn-')));
  let handle;
  try {
    const result = path.join(dir, 'environment.json');
    process.env.DOM_TEST_SECRET = require('node:crypto').randomBytes(16).toString('hex');
    const code = "require('fs').writeFileSync(process.argv[1],JSON.stringify({secret:process.env.DOM_TEST_SECRET,nodeOptions:process.env.NODE_OPTIONS}));";
    await runChild({ file: process.execPath, args: ['-e', code, result] }, '', {
      stopped: () => false, setChild: child => { handle = child; }
    }, () => {});
    assert.deepEqual(JSON.parse(fs.readFileSync(result, 'utf8')), {});
    delete process.env.DOM_TEST_SECRET;
    const ready = path.join(dir, 'ready');
    const linger = "require('fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)";
    let stopped = false;
    const playing = runChild({ file: process.execPath, args: ['-e', linger, ready] }, '', {
      stopped: () => stopped, setChild: child => { handle = child; }
    }, () => {});
    for (let i = 0; i < 400 && !fs.existsSync(ready); i++) await sleep(25);
    assert(fs.existsSync(ready), 'Native stand-in did not start');
    const start = Date.now(); stopped = true; handle.kill(); await playing;
    assert(Date.now() - start <= 1000, 'Owned child stop exceeded 1000 ms');
    console.log('PASS: real worker environment exclusion and owned-child stop; stand-in engine only');
  } finally {
    delete process.env.DOM_TEST_SECRET;
    if (handle) handle.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
