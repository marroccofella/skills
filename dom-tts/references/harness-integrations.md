# Explicit assistant event integrations

These adapters consume a source the operator has explicitly supplied. They do not
attach to the desktop app, enumerate chats, locate transcripts, configure hooks,
start a model, or grant browser playback consent. Keep the companion open and
enabled. The local browser voice remains the speech provider.

## Named event stream

For an already selected supplied JSONL stream:

```
node scripts/stream.js --source codex-exec --sessions KNOWN_THREAD_ID --provider browser
node scripts/stream.js --source codex-app-server --sessions KNOWN_THREAD_ID --provider browser --incremental-markdown true
```

`--dry-run` verifies conversion without opening the voice connection. The output
contains metadata receipts, never reply bodies. For a newly launched Codex exec
process, its thread ID is only known after `thread.started`: a caller that owns
that explicitly authorized process can construct the observer with that ID after
receiving its first event. Do not choose the ID by scanning stored chats. The
provided stream CLI deliberately requires the known ID before reading its input.

Programmatic callers use `scripts/experimental/harness-observer.js`:

```
const {createHarnessObserver} = require('./scripts/experimental/harness-observer');
const {createBrowserPlayer} = require('./scripts/experimental/browser-player');
const voice = createHarnessObserver({
  source: 'codex-app-server',
  selectedSessions: [theExplicitlySelectedThreadId],
  play: createBrowserPlayer(),
  incrementalMarkdown: true,
  onReceipt: showSanitizedSpeechReceipt
});
function onSelectedHostEvent(event) {
  renderHostEvent(event);
  voice.observe(event); // synchronous admission; no await of audio
}
```

The caller owns host subscriptions and displays text independently. `close()`
revokes the selected speech source and aborts its owned playback. `settle()` is an
optional terminal diagnostic that waits for audio; never put it on the text
display path. Multiple independent stream processes do not share a scheduler;
use one observer for explicitly selected sources or the companion's central
manual queue. A busy voice is a visible failure, never an interruption or retry.

| Source | Eligible text and lifecycle |
| --- | --- |
| Codex exec JSONL | Select exact `thread.started.thread_id`. Hold the last completed agent message until a successful turn completes. Explicit commentary is excluded. The public exec contract does not promise phase metadata, so unphased text is eligible only at the successful terminal boundary. Failed or unfinished turns do not speak held text. |
| Codex app-server notifications | Select exact `threadId`. Begin from the turn lifecycle and admit deltas only for agent messages explicitly classified as final. Hold authoritative item text until successful turn completion. Missing/unknown phase is withheld; failure or interruption cancels the owned generation. |
| Generic versioned Dom TTS JSONL | Existing explicit session, generation, message and sequence contract. No host identification is inferred. |

Upstream protocol references: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [Codex app-server](https://learn.chatgpt.com/docs/app-server).

## Claude Code Stop hook

An operator may register this supplied command as an **asynchronous Stop hook**,
with the exact session ID selected outside this process:

```
node ABSOLUTE_SKILL_PATH/scripts/harness-hook.js --source claude-stop --sessions EXACT_SESSION_ID
```

The host supplies one JSON object on stdin, including pretty-printed JSON. The
adapter uses the hook's final text directly and ignores its transcript path. It
excludes SubagentStop, failed-turn hooks and continued Stop hooks. It returns an
empty JSON object to Claude; sanitized admission metadata goes to stderr.
Admission can fail while the written assistant output continues. A queued receipt
is not completed or heard audio. The helper never emits a blocking hook decision.

No Claude settings file has been changed. Register the hook only for a consenting
session, follow the host's asynchronous hook support, and test it on that actual
installation. Stop has no guaranteed message/turn identifier, so separate helper
invocations cannot promise durable exactly-once delivery. The helper does not retry.
Reference: [Claude Code hooks](https://code.claude.com/docs/en/hooks).

## OpenClaw sent-message hook

`scripts/experimental/openclaw-hook.js` exports `createOpenClawHook` for a trusted
operator-installed **internal `message:sent` handler**, not a typed plugin hook.
Supply `selectedSessions` as exact OpenClaw session keys. It filters unrelated
sources and unsuccessful sends, requires a delivery message ID, and admits the
supplied outgoing content. The callback receives queue metadata, not text.

The handler keeps at most 64 event fingerprints in memory, suppresses overlapping
duplicates, refuses conflicting replays, and retains failed/uncertain admission
fingerprints to prevent automatic replay. Restart loses that history. This is not
durable delivery or proof that a channel recipient read the message. The helper
does not install or globally enable itself. Source: [OpenClaw internal event types](https://docs.openclaw.ai/automation/hooks/event-types).

## Bounds and richer content

Host text is bounded to 64 KiB per retained turn, with 64 turns and 64 messages per
turn at most; the downstream narrator and queue impose their own stricter bounds.
Hook replies must fit the companion's 6000-character and HTTP byte bounds. There
is no automatic retry or truncation. Retained reply text is cleared at settlement
or source revocation; diagnostic metadata is bounded in-memory history.

Progressive Markdown handles completed blank-line blocks. Open code fences,
HTML comments/scripts/styles/preformatted blocks, and reference-link tails wait
for closure or final authority. Informative mode removes reference-definition
URLs, reads reference labels, excludes indented code and hidden HTML content,
and reads table rows with their headers. A final edit to an already admitted raw
prefix cancels the generation instead of replaying it. This remains a conservative
subset renderer: nested container semantics and arbitrary CommonMark/HTML are
not certified. Full mode intentionally includes code and HTML source.

## Evidence and release limitations

On 5 October 2026, actual installed **codex-cli 0.160.0** generated its protocol
schema and accepted an isolated app-server initialize request. A separate single
public Codex exec request in an empty, ephemeral, read-only fixture emitted one
agent message and a successful turn completion. Its exact public sentence passed
the named adapter with an injected player, one completed segment and no retained
text. The model name was not exposed in stdout. The probe observed no tools.
Those checks do not certify the desktop app's event subscription or acoustic
latency. Restricted sandbox initialization failed; authorized local execution
succeeded, so sandbox portability is not established.

Claude Code and OpenClaw executables were absent here. Their adapters and actual
local hook CLI were tested with supplied documented event fixtures and injected
HTTP/player implementations, without a live host or audio. “Agent” and “Open
Claude” remain unidentified products; no compatibility claim is made for them.
Other-platform listening, real host configuration, interruption/close/sleep
acceptance and independent review remain release gates.
