const assert=require('node:assert/strict');const native=require('../scripts/providers/native');
for(const value of ['running scripts is disabled','running scripts is\r\ndisabled','execution\tpolicy','PSSecurityException'])assert.match(native.failureMessage(value),/blocked by execution policy/);
assert.match(native.failureMessage('SelectVoice'),/requested voice is unavailable/);assert.match(native.failureMessage('unrelated failure'),/check doctor and your audio device/);
const command=native.commandFor('sapi',{speed:1},'public-input.json');assert.ok(command.args.includes('-File'));assert.ok(!command.args.includes('-Command'));assert.ok(!command.args.includes('-ExecutionPolicy'));console.log('PASS: wrapped policy diagnostics and policy-respecting launch');
