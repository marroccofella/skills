# Experimental local browser speech

Source candidate 0.5.0-rc.4 repairs word boundaries, healthy long-reply expiry, speech deadlines and long-session adapters on top of public 0.5.0-rc.2. Personal notification settings, runtime state, credentials, recordings and native binaries are excluded. Optional companions are dormant until explicitly invoked. It is not a stable release.

Start with Node18+: run `node scripts/experimental/browser-session.js`, open its printed private local link, choose a local voice and click Enable spoken replies. Keep the page open. Never publish the access fragment or connection descriptor. The voice uses local browser speech synthesis, no microphone or cloud service. Speed accepts0.5–2; the initial default is0.9. Saved preferences do not enable a fresh page.

Run `node scripts/doctor.js --browser true` or `node scripts/browser-speak.js --command status`. Regular supplied speech uses `node scripts/browser-speak.js --text "A concise supplied reply." --enqueue true --wait false`. The browser CLI now defaults to wait=false. Retain the queued ID; retrieve its outcome with --command queue-receipt --id ID. Queued is not played or heard. Use --wait true for an explicit playback test only.

Stop with `node scripts/browser-speak.js --command stop`; it clears queued text and requires explicit --command restart. Disable revokes the browser connection. Boundary pause/resume/skip are available on the page. Do not interrupt another queued message merely to narrate your own reply.

An enabled document keeps retrying transient health requests with backoff capped at10seconds. Visibility/online events wake one polling loop. Interrupted speech is cancelled, terminal acknowledgement is reconciled and never automatically replayed. Stop requested offline settles before another speech poll. Reload, server restart, Disable, authentication or session change requires explicit Enable. This is same-document recovery, not a permanent speech grant.

Network interruption while reading a response body remains a transport failure;
malformed UTF-8/JSON, oversized data and failed authentication remain unverified.
An ambiguous unverified response pauses delivery while the already-enabled page
performs bounded fresh authenticated read-only status revalidation. It resumes
ordinary owned acknowledgement/polling only after verification, without retrying
an admission, Enable or Restart. Persistent failed verification requires explicit
operator action. A valid proof does not override Stop, Disable or client ownership.

A late speaking acknowledgement for a retained settled job is an idempotent
no-op after the current-client ownership check. It does not renew the lease,
change another active job or undo Stop. Wrong-client and unknown-job requests
remain refused; retired receipts outside the bounded history are not restored.

Doctor distinguishes state-not-found, state-inaccessible, descriptor-invalid, owner-unobservable, loopback-denied, transport-unreachable/timeout, browser-page-not-enabled/disabled, lease-expired and build mismatch. A restricted caller's owner-unobservable or inaccessible result does not prove the service died. Check the actual authorized context before restarting; never bypass owner/ACL checks or kill a saved PID. DOM_TTS_STATE_DIR explicitly selects one shared private state location for launcher, CLI and notification integration.

## Connection identity and upgrade

Descriptor-driven Node clients require a fresh, port-bound server proof on the exact
TCP connection before sending the access token or supplied text. A closed proof
connection cannot reconnect for the authenticated request. An old or unverified
listener reports `browser-server-identity-unverified`; do not resend, weaken the
check or start a duplicate server. The tray's older browser transport and stored-link
opener are refused until they have an equivalent guarded implementation.

Node proof v2 also binds a monotonic tick captured at request entry. Reviving
controls must be newer than the last Stop barrier, including when the initial
proof or body upload was delayed. The proof rejects future or over-ten-second-old
ticks. Use the same Node executable for server and helpers: the CI child-process
check verifies that runtime's local clock, not every mixed-runtime or VM clock
origin. Incompatible clocks fail closed without a wall-clock fallback. See
[Node's clock API](https://nodejs.org/api/process.html#processhrtimebigint) and
[libuv's platform implementations](https://github.com/libuv/libuv/tree/v1.x/src).
This ordering begins at request entry, not at an earlier conversation or plan.

An already-loaded trusted companion page uses authenticated encrypted RPC for its
requests and responses, with bounded replay refusal. Its token remains in memory;
legacy session storage is cleared. Reload needs the freshly printed private link
from the trusted running server and explicit Enable. This protects the loaded
page's transport, not the authenticity of HTML opened from an old saved URL after
its port has been reused. Do not bookmark or reopen stale private links.

Stop also invalidates older pending speech admissions and queue controls,
including Enable/Restart. A fresh explicit
action uses the current Stop generation; an Enable click retains the generation
from before its asynchronous voice preview. A stale control is refused rather
than automatically retried. Read-only status can refresh the generation without
enabling speech.

The page checks each authenticated poll response's generation again before using
it. Once it learns a newer Stop generation, it discards older commands and stops
an older active job or Enable preview while retaining cancellation acknowledgement. A late Enable
success cannot commit older UI state. These checks use the barrier the page has
observed; submitting a network Stop is not a completed playback acknowledgement.

Upgrade the client, server and page together. Before replacing the installed
package, stop speech through its existing trusted controls and close its server
normally. Start one server from the new reviewed package, open its fresh link and
Enable, then check doctor. Installation alone does not upgrade a running page or
certify the new voice. No automatic replay, restart or weakening of owner/ACL
checks is part of this upgrade.

## Speech during the reply

The final-only notification route cannot receive earlier progress. With only chat tools, display a useful commentary paragraph, submit that supplied paragraph with --wait false, and continue composing. That is agent-driven paragraph delivery, not automatic token capture. Avoid duplicate final narration.

An application that actually owns a selected live prose stream can pipe flushed UTF-8 to `node scripts/reply-stream.js --format plain --wait false`. Plain prose admits completed sentence/paragraph boundaries before stdin ends; Markdown waits for completed blank-line blocks and holds open fences/reference tails. EOF seals only the unsaid suffix. No model is called, transcript watched or other chat discovered. The owning client may use createReplyRelay from scripts/reply-stream.js; append waits only for HTTP admission, finish seals input, receipt is optional audio diagnostics and cancel revokes the owned reply. Do not await terminal audio on the text-display path.

Codex notify currently exposes agent-turn-complete: https://learn.chatgpt.com/docs/config-file/config-advanced . An application-owned selected app-server integration can receive item/agentMessage/delta: https://learn.chatgpt.com/docs/app-server . This candidate does not attach to the running Desktop application's event stream.

## Bounds and acceptance

Supplied speech is bounded: the browser CLI accepts 1000 characters, the manual HTTP queue accepts 6000 characters within a 32768-byte request limit, and reply-stream accepts 16000 UTF-8 bytes. The stream splits within its 420-byte segment limit at sentence or word boundaries. A token longer than the limit splits at grapheme boundaries; an individual grapheme larger than the limit is refused transactionally.

The two-minute text lifetime measures inactivity. Healthy active playback renews the active message and its bounded waiting queue; paused, disconnected, failed and abandoned open-tail text still expires. Each segment has a finite startup deadline and a duration budget based on length and saved speech rate, capped at five minutes. This supports healthy long replies without making stalled text permanent. It is not an unlimited-duration guarantee.

The browser-speak CLI's explicit wait=true uses a bounded duration-aware wait, but the ordinary display path must use wait=false. A wait timeout preserves the admitted job ID and reports an uncertain terminal outcome; it does not stop playback or authorize resending the text. Stop remains global and authoritative.

The separate reply-stream CLI observes a sealed reply for at most 125 seconds when explicitly given --wait true. Observation timeout or a failed receipt request reports a nonterminal, uncertain result with the original reply identity and exits unsuccessfully without cancelling admitted playback. Explicit interruption still cancels the owned reply. A successfully observed terminal receipt reports its known outcome. This finite observation window is not a speech-duration limit; default --wait false seals and returns without observing completion.

In-memory history remains bounded at 64 messages/128 tracked segments, with a further 256 text-free retired identities. Only fully settled records retire. Harness/OpenClaw histories use bounded rolling windows too; pending, failed and uncertain work is not evicted to admit another reply. Admission can refuse at these bounds and receipts are lost on restart. Do not claim unlimited or durable delivery. No automatic replay or reset is introduced to conceal those limits.

The status health ring contains at most24state/time records and last-poll age; no speech text, token, path or transcript. It is live metadata, not a retrospective diagnosis of every disconnect.

Historical Windows listening of local hal.8 was human-confirmed at rate1.8. An isolated actual browser recovered after two batches of7 and10 dropped HTTP poll requests and completed a new sentence. Local hal.8 passed9914core assertions plus focused recovery/protocol checks. Those results are separate from validation of this newly packaged public candidate and its hosted CI. OS sleep/resume, real background discard, non-Windows listening, other-context delivery, sustained bounded-history behavior and release review remain open.
