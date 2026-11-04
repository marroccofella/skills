const assert=require('node:assert/strict');const {applyMode}=require('../scripts/summarize');const {DeltaNarrator,markdownBoundary}=require('../scripts/experimental/delta-narrator');
const examples=[
 ['Read [the documentation][docs].\n\n[docs]: https://example.test/private-path','Read the documentation.'],
 ['Image ![A local diagram][figure].\n\n[figure]: https://example.test/diagram','Image A local diagram.'],
 ['<p>A <strong>clear</strong> reply &amp; safe symbols.</p>','A clear reply & safe symbols.'],
 ['Before.\n\n<!-- hidden private note\n\nnever narrate -->\n\nAfter.','Before.\n\nAfter.'],
 ['Before.\n\n<script>privateCode();\n\nsecretState();</script>\n\nAfter.','Before.\n\nAfter.'],
 ['Before.\n\n    privateCode();\n      secretState();\n\nAfter.','Before.\n\nAfter.\nI skipped a code block.'],
 ['| Item | Result |\n| --- | --- |\n| **Voice** | Clear |\n| Queue | [Passed](https://example.test) |','Item: Voice, Result: Clear.\nItem: Queue, Result: Passed.']
];for(const [input,expected] of examples)assert.equal(applyMode(input),expected,input);
assert(applyMode('    explicitCode();','full').includes('explicit Code'));assert(applyMode('<script>explicitCode();</script>','full').includes('explicit Code'));
assert.equal(markdownBoundary('Before.\n\n<!-- hidden\n\nprivate tail'),9);assert.equal(markdownBoundary('Before.\n\n<script>hidden\n\nprivate tail'),9);assert.equal(markdownBoundary('Before.\n\n<style>hidden\n\nprivate tail'),9);
const spoken=[],queue={accept:e=>spoken.push(e.text),cancel(){},revokeSession(){}};const adapter=new DeltaNarrator({queue,selectedSessions:['selected'],incrementalMarkdown:true});const base={schema:'dom-tts-text/1',role:'assistant',phase:'final_answer',format:'markdown',sessionId:'selected',turnId:'t',generationId:'g',messageId:'m'};let sequence=0;const event=(kind,text)=>({...base,kind,sequence:sequence++,...(text===undefined?{}:{text})});
adapter.accept(event('start'));adapter.accept(event('delta','Before.\n\n<!-- hidden\n\n'));assert.deepEqual(spoken,['Before.']);adapter.accept(event('delta','private tail -->\n\nAfter.'));assert(!spoken.join('').includes('private'));adapter.accept(event('complete','Before.\n\n<!-- hidden\n\nprivate tail -->\n\nAfter.'));assert.deepEqual(spoken,['Before.','After.']);assert.equal(adapter.status().retainedBytes,0);
console.log('PASS: practical Markdown corpus covers reference labels without definition URLs, visible HTML/entities, hidden comments/scripts, indented-code exclusion, table row labels and progressive hidden-block boundaries. Existing subset renderer, not complete CommonMark.');
