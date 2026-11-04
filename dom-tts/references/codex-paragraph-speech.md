# Live Codex paragraph forwarding

`scripts/codex-paragraph-relay.js` is a callback for a client that already owns
its Codex app-server connection. It accepts only supplied live notifications for
explicitly selected chat IDs. It opens no host socket, reads no transcripts,
enumerates no chats, starts no model and changes no Codex settings. The local
browser companion must already be enabled.

## Wire the existing host dispatch callback

The owning client must call this callback for every live notification from its
selected chats, after displaying the event. Keep that client's existing tool,
approval and rendering handlers; this relay is only an optional speech tap.

```js
const {createCodexParagraphForwarder} = require(
  '/ABSOLUTE/DOM-TTS/scripts/codex-paragraph-relay'
);
const speech = createCodexParagraphForwarder({
  selectedThreads: [firstKnownChatId, secondKnownChatId],
  // Safe with an existing final-only notifier. See final routing below.
  finalReplyRoute: 'completion-notify',
  renderEvent: event => existingHostRenderer(event),
  onReceipt: receipt => displaySpeechStatus(receipt)
});
function onAppServerNotification(event) {
  return speech.onHostEvent(event); // display first, bounded admission immediately
}
// When this selected source closes:
await speech.close();
```

`onHostEvent` returns synchronously. Its work queue waits for local HTTP admission,
never playback. Do not put `flush()` on the rendering path: it waits for pending
admission commands for diagnostics, without waiting for sound. Status and receipt
callbacks contain metadata and hashed identities rather than spoken text.

The host must supply `turn/started`, `item/started`,
`item/agentMessage/delta`, authoritative `item/completed` and `turn/completed`
notifications in the original order. A completed blank-line Markdown paragraph
is admitted before item or turn completion. Item completion admits only the unsaid
suffix. A final edit to the accumulated prefix cancels the owned item instead of
replaying it. Thread closure, turn failure and interruption cancel the owned source.
Shared Stop never implicitly restarts.

Failure and thread closure mark the live queued/inflight turn itself cancelled
and immediately request cancellation of its owned relay, even while HTTP
admission is awaiting capacity. Live cancellation is independent of the rolling
replay cache. A relay whose creation finishes after cancellation is cancelled
without appending text. Unconfirmed cancellation is reported in metadata rather
than silently treated as successful. Whitespace-only completed items cancel any
opened relay so they do not leave an unfinished browser input behind.

Each supplied chat uses a hashed scheduler source ID, registered with the
authenticated companion before its first item. This gives selected chats separate
queue scheduling and failure boundaries while retaining one speech provider.
Source registration is bounded; it never discovers or authorizes chat contents.

`commentary` and `partial_answer` are eligible public speech. A message with
missing/unknown phase is withheld until an authoritative completed item explicitly
classifies it. Reasoning events, tool events, user messages and unrelated chats
are ignored. The relay does not infer eligibility from text or scan stored events.

## Choose exactly one final-answer route

- **`completion-notify` (default):** the relay forwards commentary and partial
  answers. It excludes `final_answer` items so an existing final-only completion
  notifier remains the sole final-answer speaker.
- **`host-relay`:** the relay also forwards final-answer paragraphs while they
  arrive. The owning client must exclude those selected chats from its completion
  notifier. Do not turn off completion narration for other, unforwarded chats.
  This route has no automatic fallback to the notifier; any admission failure
  is visible in receipts and the written reply continues.

The relay cannot coordinate an independent global notifier by itself. Do not
enable `host-relay` while a second final route still narrates the same selected
chat. Distinct message IDs are distinct author output; no semantic deduplication
of separately authored/repeated paragraphs is claimed.

## Capability and bounds

`status()` explicitly reports `automaticDesktopSubscription:false` and
`hostForwardingRequired:true`. It also reports the chosen final route and whether
final streaming requires the completion notifier to exclude selected chats.
This callback is not an installed Desktop extension or universal speech hook.

The default queue holds at most 4,096 pending notifications/64 KiB, 64 live item
and turn records, 16 KiB per item and 256 retired item identities. Backpressure
fails and cancels that selected turn; the client must report it, not automatically
resubmit its text. Closed metadata rolls over during long sessions. Replay
protection is bounded and in-memory; the owning host must forward a single ordered
live feed without replaying historical notifications after reconnect. The browser
provider imposes its own receipt, text-expiry and queue bounds.

## Current host limitation

Official documentation describes app-server agent-message deltas and the public
`commentary`, `partial_answer`, `final_answer` phases. The client owning that live
transport can attach this callback at its dispatch point. See
[Codex App Server](https://learn.chatgpt.com/docs/app-server).

The configured external `notify` command receives turn-completion events, so it
cannot provide earlier paragraph events. See
[Notifications](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications).
The documented [lifecycle hooks](https://learn.chatgpt.com/docs/hooks) also do not
provide an assistant-message paragraph/delta hook. These sources do not establish
a supported way for a skill to attach to all existing Codex Desktop chat streams.

Accordingly this machine's existing final notifier can remain active, and supplied
progress paragraphs can continue. Automatic paragraph forwarding across every
Desktop chat requires the host to expose or install the live callback above. Do
not claim it is enabled from a successful supplied-event test.

## Verification

`node tests/codex-paragraph-relay-check.cjs` uses real local HTTP admission with
injected browser events. It verifies speech is admitted before item/turn completion,
selected cross-chat identities, public phases, duplicate completion and final
suffix handling, ignored unknown/hidden events, revised-prefix and turn-failure
cancellation, shared Stop, bounded backpressure and long-session metadata.
It also covers cancellation-cache eviction during gated relay creation, queued
starts, immediate cancellation during gated append, late creation after close,
visible cancellation failure, and 80 consecutive whitespace-only inputs.
It does not start Codex, call a model, activate a microphone, attach to Desktop or
establish a human hearing verdict.
