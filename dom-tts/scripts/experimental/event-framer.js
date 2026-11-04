// Experimental byte framing only. No source reads, consent discovery or speech.
const { TextDecoder } = require('node:util');
class JsonlFramer {
  constructor({ maxLineBytes = 32768, maxChunkBytes = 65536, maxRecordsPerPush = 256 } = {}) {
    for (const [name, value, cap] of [['line',maxLineBytes,1048576],['chunk',maxChunkBytes,1048576],['records',maxRecordsPerPush,4096]])
      if (!Number.isSafeInteger(value) || value < 1 || value > cap) throw new Error('invalid '+name+' bound');
    this.maxLineBytes=maxLineBytes;this.maxChunkBytes=maxChunkBytes;this.maxRecordsPerPush=maxRecordsPerPush;
    this.reset();
  }
  reset() { this.carry=Buffer.alloc(0);this.failed=false;this.committedBytes=0; }
  result(records=[],error=null) { return {records,error,committedBytes:this.committedBytes}; }
  fail(records,error) { this.failed=true;this.carry=Buffer.alloc(0);return this.result(records,error); }
  push(chunk) {
    if (this.failed) return this.result([],'stream-failed');
    if (!Buffer.isBuffer(chunk)) return this.fail([],'byte-buffer-required');
    if (chunk.length>this.maxChunkBytes) return this.fail([],'chunk-byte-limit');
    const bytes=Buffer.concat([this.carry,chunk]),records=[];let offset=0;
    while (offset<bytes.length) {
      const end=bytes.indexOf(10,offset);
      if (end<0) break;
      if (end-offset>this.maxLineBytes) return this.fail(records,'record-byte-limit');
      let line;
      try { line=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,end)); }
      catch { return this.fail(records,'invalid-utf8'); }
      if (line.endsWith('\r')) line=line.slice(0,-1);
      if (line.trim()) {
        if (records.length>=this.maxRecordsPerPush) return this.fail(records,'batch-record-limit');
        let record;try { record=JSON.parse(line); } catch { return this.fail(records,'invalid-json'); }
        if (!record || typeof record!=='object' || Array.isArray(record)) return this.fail(records,'invalid-record-shape');
        records.push(record);
      }
      this.committedBytes+=end-offset+1;offset=end+1;
    }
    if (bytes.length-offset>this.maxLineBytes) return this.fail(records,'record-byte-limit');
    this.carry=Buffer.from(bytes.subarray(offset));
    return this.result(records);
  }
  finish() {
    if (this.failed) return this.result([],'stream-failed');
    if (this.carry.length) return this.fail([],'incomplete-record');
    return this.result();
  }
}
module.exports={JsonlFramer};
