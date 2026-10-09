// Governor-authored production-listener regression; no real clipboard or account calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../assets/setup-ui/app.js', import.meta.url), 'utf8');
const start = source.indexOf('maintenanceGrid.addEventListener("click",');
const end = source.indexOf('maintenanceGrid.addEventListener("change",', start);
assert(start >= 0 && end > start, 'production maintenance listener exists');
let listener;
const copies = [], actions = [];
const context = vm.createContext({
  maintenanceGrid: {addEventListener(type, fn) {assert.equal(type, 'click'); listener = fn;}},
  copySetupText: (text, kind) => {copies.push([text, kind]);},
  receiptCopy: provider => JSON.stringify({provider,action:'update',status:'launch_requested',completion:'unobserved'}),
  launchAction: (...args) => actions.push(args), clockAction() {}, timerAction() {}, runBatchUpdate() {}, runAllUpdates() {}
});
vm.runInContext(source.slice(start, end), context);
const receiptButton = {dataset: {copyReceipt: 'codex'}};
await listener({target: {closest: selector => selector === '[data-copy-receipt]' ? receiptButton : null}});
assert.equal(copies.length, 1, 'maintenance receipt click reaches the copy handler exactly once');
assert.equal(copies[0][1], 'receipt');
assert.equal(JSON.parse(copies[0][0]).provider, 'codex');
assert.equal(actions.length, 0, 'copying a receipt never launches an action');
const actionButton = {dataset: {maintProvider:'copilot',maintAction:'update'}};
await listener({target: {closest: selector => selector === '[data-maint-action]' ? actionButton : null}});
assert.deepEqual(actions, [['copilot','update']], 'ordinary maintenance launch remains delegated');
assert.equal(copies.length, 1, 'ordinary action is not copied');
console.log(JSON.stringify({passed:true,checks:'production maintenance receipt-copy delegation and no launch on copy'}));
