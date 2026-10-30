import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareBumblePeerRequest, validateBumblePeerContent, peerSchemaMatches, BUMBLE_PEER_DEFAULT_ENABLED} from './bumble-peer-review.mjs';
import {REVIEW_JSON_SCHEMA} from './review-contract-schema.mjs';
import {PEER_CONTRACT, CLAIM_TYPES} from './review-contract.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: fixtures choose their own evidence home
const artifact = 'export function sum(values) { return values.reduce((a, b) => a + b, 0); }';
const review = {review_status: 'complete', reviewed_scope: [{quote: artifact, assessment: 'The explicit zero seed handles an empty array.'}], verdict: 'ACCEPT', confidence: 0.9, findings: [], summary: 'No concrete defect found in the supplied function.', suggested_improvements: []};
let cases = 0;
const check = (name, fn) => {fn(); cases++;};
const validate = value => validateBumblePeerContent(JSON.stringify(value), artifact, true);
check('default disabled and no independent vote', () => {assert.equal(BUMBLE_PEER_DEFAULT_ENABLED, false); const result = validate(review); assert.equal(result.status, 'advisory_valid'); assert.equal(result.quorum_votes, 0); assert.equal(result.completion, false); assert.equal(result.gates.finding_accuracy, 'unverified');});
check('shared schema and ordinary request', () => { const prepared = prepareBumblePeerRequest({artifact, model: 'synthetic-model', max_tokens: 1024, role: 'architect', role_version: '1'}); const body = JSON.parse(prepared.request_body); assert.equal(prepared.peer_contract, PEER_CONTRACT); assert.deepEqual(body.response_format.schema, REVIEW_JSON_SCHEMA); assert.deepEqual(body.tools, []); assert.equal(body.stream, false); assert.equal(body.reasoning_effort, 'low'); assert.deepEqual(REVIEW_JSON_SCHEMA.properties.findings.items.properties.claim_type.enum, CLAIM_TYPES);});
check('unknown top-level authority refused', () => assert.equal(validate({...review, execute: true}).status, 'invalid_schema'));
check('unknown nested scope refused', () => assert.equal(validate({...review, reviewed_scope: [{...review.reviewed_scope[0], allow_tools: true}]}).status, 'invalid_schema'));
for(const name of ['constructor','__proto__','toString','valueOf']) {
  check('prototype-name top-level field refused',()=>{const value=JSON.parse(JSON.stringify(review));Object.defineProperty(value,name,{value:{untrusted:true},enumerable:true});assert.equal(validate(value).status,'invalid_schema');});
  check('prototype-name nested scope field refused',()=>{const value=JSON.parse(JSON.stringify(review));Object.defineProperty(value.reviewed_scope[0],name,{value:{untrusted:true},enumerable:true});assert.equal(validate(value).status,'invalid_schema');});
}
check('duplicate keys refused', () => assert.equal(validateBumblePeerContent(JSON.stringify(review).replace('"verdict":"ACCEPT"', '"verdict":"ACCEPT","verdict":"REJECT"'), artifact, true).status, 'invalid_json'));
for (const wrap of [value => '```json\n' + value + '\n```', value => '<think>analysis</think>' + value, value => value + '{}', value => 'Here is the answer: ' + value]) check('whole response only', () => assert.equal(validateBumblePeerContent(wrap(JSON.stringify(review)), artifact, true).status, 'invalid_json'));
check('truncation cannot ACCEPT', () => assert.equal(validateBumblePeerContent(JSON.stringify(review), artifact, false).status, 'truncated'));
check('unknown enum refused', () => assert.equal(validate({...review, verdict: 'APPROVE'}).status, 'invalid_schema'));
check('quoted confidence refused', () => assert.equal(validate({...review, confidence: '0.9'}).status, 'invalid_schema'));
check('out of scope quote refused', () => assert.equal(validate({...review, reviewed_scope: [{quote: 'return 42;', assessment: 'Not in artifact.'}]}).status, 'invalid_scope_or_contract'));
check('incomplete remains explicit failure', () => assert.equal(validate({...review, review_status: 'incomplete'}).status, 'invalid_scope_or_contract'));
check('nonfinite JSON number refused structurally', () => assert.equal(validateBumblePeerContent(JSON.stringify(review).replace('0.9', '1e400'), artifact, true).status, 'invalid_schema'));
check('accessor request refuses before credential access', () => { let read = 0; const input = {artifact, model: 'synthetic-model', max_tokens: 1024, role: 'architect', role_version: '1'}; Object.defineProperty(input, 'artifact', {get(){read++; throw Error('synthetic');}, enumerable: true}); assert.throws(() => prepareBumblePeerRequest(input)); assert.equal(read, 0); });
check('unknown credential fields refuse', () => assert.throws(() => prepareBumblePeerRequest({artifact, model: 'synthetic-model', max_tokens: 1024, role: 'architect', role_version: '1', api_key: ['synthetic', 'not', 'a', 'credential'].join('-')})));
check('no verdict or finding encoded in generation hint', () => {assert.equal(Object.hasOwn(REVIEW_JSON_SCHEMA.properties.verdict, 'const'), false); assert.equal(Object.hasOwn(REVIEW_JSON_SCHEMA.properties.findings, 'const'), false); assert(Object.isFrozen(REVIEW_JSON_SCHEMA.properties.findings.items));});
check('a fabricated finding is retained unverified, not executed', () => {const result = validate({...review, verdict:'MODIFY', findings:[{id:'unverified', severity:'WARNING', target_file:null, line_range:null, issue:'A claim needing reproduction.', rationale:'Model evidence is untrusted.', test_suggestion:'never execute this automatically', claim_type:'RISK'}]}); assert.equal(result.status, 'advisory_valid'); assert.equal(result.gates.finding_accuracy, 'unverified'); assert.equal(result.review.findings.length, 1);});
check('request has no credential or local transport metadata', () => { const body = prepareBumblePeerRequest({artifact, model:'synthetic-model', max_tokens:512, role:'architect', role_version:'1'}).request_body; assert(!body.includes('credential_file')); assert(!body.includes('connect_address')); });
check('unknown schema keyword fails closed', () => assert.equal(peerSchemaMatches(1, {type:'integer', magic:true}), false));
check('CLI and shadow share actual generation schema', () => { const dispatcher = fs.readFileSync(new URL('./multi-review.mjs', import.meta.url), 'utf8'); assert(dispatcher.includes('import {REVIEW_JSON_SCHEMA} from \'./review-contract-schema.mjs\'')); assert(!dispatcher.includes('const REVIEW_JSON_SCHEMA =')); });
console.log(JSON.stringify({passed: cases, network_calls: 0, credential_reads: 0, release_votes: 0, scope: 'pure peer-contract bridge, not native transport or qualification'}));
