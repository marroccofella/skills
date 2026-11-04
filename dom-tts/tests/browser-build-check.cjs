const assert=require('node:assert/strict');const {browserReadiness}=require('../scripts/doctor');
const expected={version:'fixture.1',sourceManifestSha256:'a'.repeat(64)},status={connected:true,...expected};
assert.equal(browserReadiness(status,expected).state,'ready');
for(const changed of [{version:'fixture.2'},{sourceManifestSha256:'b'.repeat(64)},{sourceManifestSha256:undefined}])assert.equal(browserReadiness({...status,...changed},expected).code,'browser-build-mismatch');
assert.equal(browserReadiness({...status,connected:false},expected).code,'browser-companion-unavailable');
assert.equal(browserReadiness(undefined,expected).code,'browser-companion-unavailable');
console.log('PASS: browser readiness distinguishes same-version different source bytes, stale protocol/version and disconnected companion; no playback attempted.');
