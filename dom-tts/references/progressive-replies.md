# Speech during a supplied reply

Use `node scripts/reply-stream.js --format plain --wait false` with a producer
that flushes UTF-8 prose to its stdin while generating it. This command consumes
only that supplied reply, checks the enabled companion's exact build, opens one
manual-source generation, and admits sentence punctuation followed by whitespace
or a blank-line paragraph boundary. It starts playback before stdin ends. EOF
seals the already retained input and admits only its unsaid suffix, without
resending or rereading the reply. `--wait true` collects terminal playback for an
explicit test; keep audio waiting off the normal text display path.

For Markdown, use `--format markdown` (the default): completed blank-line blocks
are admitted while open code fences, HTML and reference-link tails are held by
the existing conservative renderer. Plain mode is only for supplied spoken prose,
not unfiltered code or Markdown. Sentence boundaries are punctuation heuristics,
not complete linguistic segmentation. No arbitrary incomplete-word timer is used.

An owning JavaScript client can use:

```js
const {createReplyRelay} = require('./scripts/reply-stream');
const speech = await createReplyRelay({format:'plain'});
async function onSelectedProseDelta(delta) {
  renderText(delta);                 // display first
  await speech.append(delta);        // waits for admission, never audio
}
await speech.finish();               // input ended; never reread the final
```

Use a bounded caller queue if the host dispatches events faster than HTTP
admission. Calls to append/finish are sequential. Failure does not authorize
replay. Cancel the owned reply with `speech.cancel()`; global Stop remains
`node scripts/browser-speak.js --command stop` and requires explicit restart.
The raw CLI accepts at most 16,000 UTF-8 input bytes, with 2 KiB event bodies and
the companion's existing queue/history/two-minute-expiry bounds. Input is retained
only in the bounded in-memory narrator until sealed/cancelled/expired. No text is
written to disk, included in receipts, read from other chats, or sent to a model.
`reply-receipt` distinguishes an input still open from terminal audio completion.

This skill cannot manufacture a host event subscription. Codex app-server clients
can attach the existing selected-thread observer to agent-message deltas; see
[harness integrations](harness-integrations.md). This chat exposes tool calls, not
a live subscription to its own final-answer tokens. Here, after explicit user
request, send each written commentary paragraph to the enabled queue immediately,
then continue composing. Label that as agent-driven paragraph submission. A single
tool call containing a finished paragraph is not a token-stream measurement.
Avoid repeating already spoken paragraphs at the final response; speak only new
final information, while keeping the written final complete.

Version: **0.5.0-dev.2-hal.6**, local development candidate. No automatic Desktop
attachment, transcript watcher, microphone, cloud provider or stable-release claim.
