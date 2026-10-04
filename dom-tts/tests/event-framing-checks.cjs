const assert = require('node:assert/strict');
const { JsonlFramer } = require('../scripts/experimental/event-framer');
module.exports = function(check = fn => fn()) {
  const record = { role: 'assistant', text: 'First 😀 é reply.' };
  const wire = Buffer.from(JSON.stringify(record) + '\r\n' + JSON.stringify({ sequence: 2 }) + '\n');
  for (let split = 0; split <= wire.length; split++) {
    const parser = new JsonlFramer();
    const a = parser.push(wire.subarray(0, split)), b = parser.push(wire.subarray(split));
    check(() => assert.deepEqual([...a.records, ...b.records], [record, { sequence: 2 }]));
    check(() => assert.equal(parser.finish().error, null));
  }
  const partial = new JsonlFramer();
  check(() => assert.deepEqual(partial.push(Buffer.from('{"text":')).records, []));
  check(() => assert.equal(partial.finish().error, 'incomplete-record'));
  check(() => assert.equal(partial.push(Buffer.from('"late"}\n')).error, 'stream-failed'));
  partial.reset(); check(() => assert.deepEqual(partial.push(Buffer.from('{}\n')).records, [{}]));
  const malformed = new JsonlFramer();
  const result = malformed.push(Buffer.from('{}\nprivate invalid data\n'));
  check(() => assert.deepEqual(result.records, [{}]));
  check(() => assert.equal(result.error, 'invalid-json'));
  check(() => assert(!JSON.stringify(result).includes('private invalid')));
  check(() => assert.equal(result.committedBytes, 3));
  const invalid = new JsonlFramer();
  check(() => assert.equal(invalid.push(Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d,0x0a])).error,'invalid-utf8'));
  const bounded = new JsonlFramer({ maxLineBytes: 8, maxChunkBytes: 32 });
  check(() => assert.equal(bounded.push(Buffer.from('123456789')).error,'record-byte-limit'));
  const chunks = new JsonlFramer({ maxLineBytes: 8, maxChunkBytes: 8 });
  check(() => assert.equal(chunks.push(Buffer.alloc(9)).error,'chunk-byte-limit'));
  const shapes = new JsonlFramer();
  check(() => assert.equal(shapes.push(Buffer.from('[]\n')).error,'invalid-record-shape'));
  const empty = new JsonlFramer();
  check(() => assert.deepEqual(empty.push(Buffer.from('\n\r\n{}\n')).records,[{}]));
  const records = new JsonlFramer({ maxRecordsPerPush: 1 });
  check(() => assert.equal(records.push(Buffer.from('{}\n{}\n')).error,'batch-record-limit'));
};
if (require.main === module) { let count=0; try { module.exports(fn=>{fn();count++;});
  console.log('PASS: '+count+' framing assertions; every UTF-8 split, no harness/audio');
} catch(error) { console.error(error.message);process.exitCode=1; } }
