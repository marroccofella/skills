import assert from 'node:assert/strict';
import {normalizeEndpoint} from './reviewer-registry.mjs';
delete process.env.MOMM_EVIDENCE_HOME;
assert.equal(normalizeEndpoint('https://ff-model.example/v1').origin,'https://ff-model.example','a hostname beginning ff is not an IPv6 multicast address');
for(const url of ['https://[::ffff:127.0.0.1]/v1','https://[::ffff:169.254.1.1]/v1','https://[fe90::1]/v1','https://[ff02::1]/v1'])assert.throws(()=>normalizeEndpoint(url),undefined,url);
console.log(JSON.stringify({passed:true,checks:5,network_calls:0}));
