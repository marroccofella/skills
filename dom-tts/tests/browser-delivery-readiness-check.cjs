const assert=require('node:assert/strict');const {browserQueueReadiness}=require('../scripts/doctor');
assert.equal(browserQueueReadiness(undefined).code,'browser-queue-unobservable');
assert.equal(browserQueueReadiness({stopped:true,paused:true,queue:{failed:1}}).code,'browser-queue-stopped');
assert.equal(browserQueueReadiness({paused:true}).code,'browser-queue-paused');
assert.equal(browserQueueReadiness({queue:{failed:1}}).code,'browser-queue-failed');
assert.equal(browserQueueReadiness({admission:{state:'backpressure',code:'browser-queue-backpressure'}}).code,'browser-queue-backpressure');
assert.equal(browserQueueReadiness({queue:{failed:0,completed:128},stream:{messages:64},admission:{state:'ready',code:'browser-queue-ready'}}).state,'ready');
console.log('PASS: delivery readiness distinguishes stopped/paused/failed/congested queues from a connected browser and accepts retireable completed history. No playback claim.');
