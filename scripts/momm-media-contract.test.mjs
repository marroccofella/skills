import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewProblem } from '../momm/scripts/review-contract.mjs';
import * as contract from '../momm/scripts/review-contract.mjs';
import * as media from '../momm/scripts/media-bytes.mjs';
import { JPEG } from '../momm/scripts/media-fixtures.mjs';
import { syntheticPng } from '../momm/scripts/probes.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-media-contract-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
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

// 1.17 B2: claim_type is an optional enum in the provider schema that agrees with the local validator.
const claimType = schema.properties.findings.items.properties.claim_type;
assert.ok(claimType, 'The provider schema must advertise the optional claim_type');
assert.equal(claimType.type, 'string');
assert.equal(JSON.stringify(claimType.enum), JSON.stringify(contract.CLAIM_TYPES), 'schema enum and validator types must agree, most blocking first');
assert.equal(JSON.stringify(contract.CLAIM_TYPES), JSON.stringify(['DEFECT', 'RISK', 'QUESTION', 'IDEA', 'NOISE']));
assert.equal(schema.properties.findings.items.required.includes('claim_type'), false, 'An untyped answer stays valid');
console.log('claim_type agrees across the provider schema and local validator and stays optional.');

// 1.17 A3: reviewers may cite what they saw in an attachment actually sent, by its sha256.
const png = syntheticPng('red', 64), pngSha = createHash('sha256').update(png).digest('hex');
const sent = [{ sha256: pngSha, width: 64, height: 64, modality: 'image' }];
const brief = 'Draw a red square that fills the frame.';
const quoteEntry = { quote: 'red square', assessment: 'The brief asks for a filled red square.' };
const seen = (extra = {}) => ({ attachment_sha256: pngSha, observation: 'A uniform red square fills the frame.', assessment: 'Matches the brief.', ...extra });
const scoped = (...entries) => ({ ...reply(finding), reviewed_scope: entries, findings: [] });
const check = (name, value, expected) => {
  const got = value;
  if (expected === null) assert.equal(got, null, `${name}: ${got}`);
  else assert.match(got ?? 'accepted', expected, name);
};
check('accepted observation of a sent image', contract.reviewProblem(scoped(quoteEntry, seen({ region: [0, 0, 64, 64] })), brief, { attachments: sent }), null);
check('accepted observation without a region', contract.reviewProblem(scoped(quoteEntry, seen()), brief, { attachments: sent }), null);
check('accepted region when the bounds are unknown (recorded unchecked)', contract.reviewProblem(scoped(quoteEntry, seen({ region: [900, 900, 5, 5] })), brief, { attachments: [{ sha256: pngSha }] }), null);
check('refused unknown digest', contract.reviewProblem(scoped(quoteEntry, seen({ attachment_sha256: 'b'.repeat(64) })), brief, { attachments: sent }), /attachment/);
check('refused truncated digest', contract.reviewProblem(scoped(quoteEntry, seen({ attachment_sha256: pngSha.slice(0, 12) })), brief, { attachments: sent }), /attachment/);
check('refused region outside the image bounds', contract.reviewProblem(scoped(quoteEntry, seen({ region: [60, 0, 8, 8] })), brief, { attachments: sent }), /region/);
check('refused region below the image bounds', contract.reviewProblem(scoped(quoteEntry, seen({ region: [0, 1, 1, 64] })), brief, { attachments: sent }), /region/);
for (const bad of [[1, 2, 3], [-1, 0, 1, 1], [0.5, 0, 1, 1], '0,0,1,1']) check(`refused malformed region ${JSON.stringify(bad)}`, contract.reviewProblem(scoped(quoteEntry, seen({ region: bad })), brief, { attachments: sent }), /region/);
check('refused region on a non-image attachment', contract.reviewProblem(scoped(quoteEntry, seen({ region: [0, 0, 1, 1] })), brief, { attachments: [{ sha256: pngSha, modality: 'pdf' }] }), /region/);
check('refused observation-only scope when the text artifact is non-empty', contract.reviewProblem(scoped(seen()), brief, { attachments: sent }), /quote/);
check('refused observations in a run with no attachments', contract.reviewProblem(scoped(quoteEntry, seen()), brief, { attachments: [] }), /attachment/);
check('refused observations when no attachment list is supplied', contract.reviewProblem(scoped(quoteEntry, seen()), brief), /attachment/);
check('refused oversized observation', contract.reviewProblem(scoped(quoteEntry, seen({ observation: 'x'.repeat(501) })), brief, { attachments: sent }), /observation/);
check('refused empty observation', contract.reviewProblem(scoped(quoteEntry, seen({ observation: ' ' })), brief, { attachments: sent }), /observation/);
check('refused entry that is both a quote and an observation', contract.reviewProblem(scoped(quoteEntry, seen({ quote: 'red square' })), brief, { attachments: sent }), /either/);
check('quote rule unchanged: a fabricated quote is still refused with attachments present', contract.reviewProblem(scoped({ quote: 'blue circle', assessment: 'x' }, seen()), brief, { attachments: sent }), /quote/);
check('quote rule unchanged: text-only review still valid with the old two-argument call', contract.reviewProblem(scoped(quoteEntry), brief), null);
const observationItems = schema.properties.reviewed_scope.items.anyOf;
assert.ok(Array.isArray(observationItems) && observationItems.some(s => s.required?.includes('attachment_sha256') && s.properties?.observation?.maxLength === 500 && s.properties?.region),
  'The provider schema must allow an observation entry');
assert.ok(observationItems.some(s => JSON.stringify(s.required) === JSON.stringify(['quote', 'assessment'])), 'The quote entry shape is unchanged');
console.log('Image observations: digest must name a sent attachment, regions stay inside known bounds, and text is still quoted.');

// Pixel bounds come from header bytes only; formats whose header does not state them yield null.
assert.equal(typeof media.imageDimensions, 'function', 'media-bytes.mjs must export imageDimensions');
const dims = b => { const d = media.imageDimensions(b); return d ? `${d.width}x${d.height}` : null; };
assert.equal(dims(png), '64x64');
assert.equal(dims(JPEG), '1x1');
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([20, 0, 10, 0]), Buffer.alloc(4), Buffer.from([0x3b])]);
assert.equal(dims(gif), '20x10');
const riff = (chunk, payload) => { const body = Buffer.concat([Buffer.from('WEBP'), Buffer.from(chunk), Buffer.alloc(4), payload]); body.writeUInt32LE(payload.length, 8); const out = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), body]); out.writeUInt32LE(out.length - 8, 4); return out; };
const vp8x = Buffer.alloc(10); vp8x.writeUIntLE(299, 4, 3); vp8x.writeUIntLE(149, 7, 3);
assert.equal(dims(riff('VP8X', vp8x)), '300x150');
const vp8l = Buffer.alloc(6); vp8l[0] = 0x2f; vp8l.writeUInt32LE((39) | (19 << 14), 1);
assert.equal(dims(riff('VP8L', vp8l)), '40x20');
const vp8 = Buffer.alloc(10); vp8.set([0x9d, 0x01, 0x2a], 3); vp8.writeUInt16LE(33, 6); vp8.writeUInt16LE(17, 8);
assert.equal(dims(riff('VP8 ', vp8)), '33x17');
assert.equal(dims(Buffer.from('not an image')), null);
assert.equal(dims(png.subarray(0, 12)), null, 'a truncated header yields null, never a guess');
for (const [name, bytes] of [['a.png', png], ['a.jpg', JPEG], ['a.gif', gif], ['a.webp', riff('VP8X', vp8x)]]) {
  const file = path.join(scratch, name); fs.writeFileSync(file, bytes);
  const read = media.readMedia(file, { root: scratch });
  assert.equal(`${read.width}x${read.height}`, dims(bytes), `readMedia carries the header bounds for ${name}`);
}
console.log('Header-only pixel bounds for PNG, JPEG, GIF and WebP; unreadable headers yield null.');
