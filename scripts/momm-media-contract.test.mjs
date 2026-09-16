import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { reviewProblem } from '../momm/scripts/review-contract.mjs';
const source = fs.readFileSync(new URL('../momm/scripts/multi-review.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const REVIEW_JSON_SCHEMA = '), end = source.indexOf('\nfunction normalizeAgentName', start);
assert.ok(start >= 0 && end > start);
const schema = vm.runInNewContext(source.slice(start, end) + '\nREVIEW_JSON_SCHEMA');
const finding = { id: 'hat-contact', severity: 'WARNING', target_file: 'cat.png', line_range: null, issue: 'The brim intersects an ear.', rationale: 'The request specifies natural anatomy.', test_suggestion: null, region: [20, 30, 40, 50] };
const reply = f => ({ review_status: 'complete', reviewed_scope: [{ quote: 'natural anatomy', assessment: 'Check the visible ear.' }], verdict: 'MODIFY', confidence: 0.8, summary: 'Image has a contact artifact.', suggested_improvements: [], findings: [f] });
const region = schema.properties.findings.items.properties.region;
assert.ok(region, 'The attachment prompt advertises region, but the strict provider schema forbids it');
assert.equal(region.type, 'array'); assert.equal(region.minItems, 4); assert.equal(region.maxItems, 4);
assert.equal(region.items.type, 'integer'); assert.equal(region.items.minimum, 0);
assert.equal(schema.properties.findings.items.required.includes('region'), false, 'Existing text reviewers must not need a region');
assert.equal(reviewProblem(reply(finding), 'natural anatomy'), null);
const { region: ignored, ...withoutRegion } = finding;
assert.equal(reviewProblem(reply(withoutRegion), 'natural anatomy'), null);
for (const bad of [null, [], [1, 2, 3], [1, 2, 3, 4, 5], [-1, 2, 3, 4], [0.5, 2, 3, 4], ['1', 2, 3, 4]]) {
  assert.ok(reviewProblem(reply({ ...finding, region: bad }), 'natural anatomy'), 'Malformed region must not be silently discarded');
}
console.log('Optional image regions agree across the provider schema and local validator; malformed regions fail closed.');
