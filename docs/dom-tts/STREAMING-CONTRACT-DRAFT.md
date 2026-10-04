# Dom TTS 0.5 asynchronous narration contract — draft

Legion, 4 October 2026. Design for the owner-authorized programme, not implemented
capability or a release claim. Existing final-message readers remain supported.

## Experimental implementation status

scripts/experimental/narration-queue.js implements an in-memory stable-segment kernel
with an injected player, explicit selected sessions, synchronous admission, bounded
history/text, per-session ordering, round-robin scheduling, retry and cancellation.
Its dom-tts-segment/1 input is a deliberately smaller interface than the full event
contract below. It is not invoked by speak.js or the watcher, and receives no real
harness events or token deltas. No native playback/stop integration is claimed.

The injected player must reject on playback failure and honour AbortSignal while
containing its own child process. Cancellation remains 'cancelling' until that player
settles; an ignored signal does not imply stopped audio. idle() means no active or
runnable work, not all speech completed: failed messages may remain pending. History
is bounded and admission refuses when full; no persistence, exactly-once acoustic
guarantee, reconnect transport, revision reconciliation or automatic eviction exists.
Status contains counts only, not speech, raw provider errors or identifiers.

45 deterministic assertions exercise unresolved-player admission, sequence/replay
refusal, explicit session/role boundaries, retries, generation cancellation, limits,
three-session fairness, failed-message ordering and selected-session revocation. These use injected promises;
they are not native audio, acoustic latency or real-harness streaming receipts.

Message lifecycle refinement: admission of a new message in a session/turn/generation
seals append admission to the previous message. Later new segments for that predecessor
are visibly refused and require adapter reconciliation; existing segments and explicit
failed-segment retries remain eligible, and exact replay stays idempotent. Rejected
new-message admission does not advance the cursor. delivery exposes messageSealed.
This is an arrival-order rule, not proof of provider message ordinals or an end-to-end
reconnect/rewrite solution. Cross-generation lifecycle must be enforced by the adapter.
The reproduced A0,B0,A1 fixture now refuses A1; adapters must not silently discard it.

The kernel's segment and total retained-text limits are UTF-8 bytes (Buffer.byteLength),
not JavaScript character counts. It has no text-range fields yet; the delta/revision
adapter must define and validate ranges, astral/surrogate and grapheme boundaries
before range reconciliation is enabled. Emoji byte-bound checks exist; this is not
evidence of a complete Unicode streaming segmenter.

Only a trusted, owner-consented caller supplies selectedSessions. The kernel does not
discover sources or authorize them from event IDs. revokeSession removes admission,
aborts active work and drops retained queue text for that session; another session
continues. It cannot erase strings already handed to an engine or prove acoustic stop.
The future source registry/adapter must gate actual reads and enforce revocation too.

The kernel also exposes delivery(identity): count-free per-segment state with a typed
playback-failed result and an attempt-terminal flag. Admission remains separate from
completion. Failed work can be explicitly retried, so terminal describes that attempt,
not an irreversible lifetime verdict. Receipts are in-memory, are not native/human
audibility evidence, and disappear with the queue; durable controller accounting and
mandatory per-final-reply harness hooks remain future integration work.

event-framer.js supplies a bounded per-stream JsonlFramer. It carries incomplete UTF-8
bytes/JSONL, decodes complete records strictly, and returns valid records preceding a
later malformed record together with a typed error. committedBytes counts syntactically
parsed bytes, not admitted events or completed speech. An error clears carry and stops
that parser until an explicit reset; adapters must preserve/reconcile offsets rather
than silently skipping failed input. Reset begins a new byte-accounting stream and is
not a replay/deduplication policy. Record/chunk limits are bytes; record count per push
is also bounded. 152 framing assertions cover every two-part byte split of the Unicode
fixture, incomplete input, malformed JSON/UTF-8, shape checks and bounds.

No pipeline currently joins framer, delta/final reconciliation, consent registry,
queue, native player and host hook. The installed-0.4 field report in discussion
comment18739938 (omitted invocation, permissions, chunk timeout and uncollected
completion) remains a separate unresolved integration investigation.

## Boundaries

Host rendering and speech are independent consumers. The host displays its text
without awaiting playback; the speech observer accepts bounded events and returns
an admission receipt promptly. Admission is not completed playback or human hearing.
Speech failure cannot freeze, replace or erase the written answer.

Each adapter advertises final-message, progress-message or token-delta capability.
Do not describe completed JSONL narration as token streaming. A host without delta
events uses the final-message path and retains visible text delivery.

## Event identity and lifecycle

Versioned events contain schema, selected session ID, turn ID, generation ID, message
ID, sequence number, role, phase and kind. Text is carried only in permitted text
events. Tool output, user messages and internal reasoning are excluded by default.
IDs are bounded opaque strings, not paths, shell commands or executable instructions.

Kinds: start, delta, stable-segment, complete, replace, cancel and error. Sequence
numbers are monotonic within a message generation. Duplicate sequence with identical
content is idempotent; conflicting replay is refused visibly. A gap is retained for
bounded reordering or reported as an adapter error, never silently skipped. Fresh
generations cannot inherit the predecessor's speech-completion acknowledgements.

Stable segments have explicit IDs and text ranges. Reconnect replay checks accepted
and completed segments separately. A completed final message reconciles only the
unsaid suffix where append-only text matches exactly. A revision crossing already
spoken ranges produces an explicit revision state; it must not replay the whole
message or silently claim the spoken output matches the revised final.

## Queue and worker

One bounded admission queue feeds the existing owned speech-worker boundary.
Per-session order is preserved; eligible sessions are served fairly between bounded
chunks. Adapters select sessions explicitly; there is no automatic other-chat scan.
Queue size, message bytes, segment bytes and per-session pending work are bounded.
Full queues return a typed refusal/backpressure receipt. No admission means no
acknowledgement of completed speech. Metadata/status exports exclude raw text.

Event ingestion never awaits synthesis/playback. Worker states are queued, playing,
completed, failed and cancelled. Retry uses the same identity but only unsatisfied
segments; a failed launch remains pending unless explicitly discarded. A crash after
audio but before acknowledgement is an ambiguous outcome, not proof of exactly-once
audible output. Define the operator recovery choice explicitly before persistence.

Stop cancels active owned playback and pending segments for the selected generation.
Late events for that cancelled generation are refused. A new explicit generation can
restart. Pause/resume is advertised only by providers/queue paths that implement it;
process killing is not resumable pause. No recorded PID is blindly terminated.

## Text framing and segmentation

Carry partial UTF-8 bytes and incomplete JSONL across reads. Reject malformed or
oversized events with typed diagnostics. Rotation/reconnect requires explicit session
and generation reconciliation; skipping to file end is not evidence of no omissions.

Stable sentence/clause segmentation has a bounded timeout and size. Preserve Unicode
and paragraph order. Markdown code fences, tables and diffs maintain parser state
across deltas; mode selection must not speak raw delimiters or incomplete commands.
Token transport alone is not evidence of meaningful speech segmentation.

## Tests before production integration

1. Slow injected player: event admission and host display proceed while playback is
   pending, with deterministic clock/queue evidence rather than timing-only guesses.
2. Ordered segments, duplicate replay, conflicting sequence, gaps and reconnect:
   no unexplained duplicate/omission; documented refusal and reconciliation states.
3. Queue saturation and fair multi-session ordering: bounded memory/work, explicit
   backpressure, one stalled session does not prevent ingestion for another.
4. Cancel before launch, during playback, between chunks and after completion:
   pending generation flushed, unrelated sessions survive, late events refused.
5. Worker rejection/crash/retry: completion recorded only after actual success;
   failed segments remain pending and ambiguous audible outcomes remain labelled.
6. UTF-8/JSONL split at every byte boundary, rotation, final unsaid suffix, revision
   after speech, malformed events and hostile identifiers/content.
7. Real pinned Claude Code interactive/headless and generic harness runs; Hermes and
   the owner's Agent/Open Claude after exact identity/surface confirmation.
8. Native process containment/privacy/environment checks on each supported OS,
   followed by measured first-visible/first-audible and acoustic-stop/listening tests.

Proposed display/dispatch/acoustic targets are in the owner's programme plan; they
are not achieved benchmarks. Fixture success alone cannot certify a real harness.

## Dependencies and ownership

PR #41 supplies per-call private-directory validation; Legion's PR #43 records the
independent Windows retest. Legacy PR #42 supplies archived UI/watchers for review,
not a safe production queue implementation. Preserve the Standard core while adding
the new path behind an explicit experimental option. No old global watcher is copied
into the new path. Specific 0.5 MOMM source-sharing approval and independent quorum
remain pending; do not treat this design document as that approval.
# Source-reader prototype

The experimental SourceReader accepts only explicitly granted injected readers.
The controller must obtain human source consent before calling grant; this API
does not collect or prove human consent itself. Opaque object grants bind to one
session, refuse foreign/forged grants and concurrent reads, and limit returned
Buffer size. Revocation aborts the injected reader, discards its late result and
calls a supplied session-revocation hook. Reader errors are sanitized.

No filesystem discovery, source identity/rotation validation, durable consent UI,
delta/final reconciliation or native player connection is implemented by this
prototype. Readers must honor AbortSignal; arbitrary injected code cannot be
forcibly stopped or its external buffers erased. Bounds apply to accepted results,
not allocations performed by an injected reader. Tests use injected promises,
not private transcripts or live harnesses; CI runs them separately from9903 totals.

SourceReader.revoke invalidates read authority and aborts its signal immediately,
then returns a promise for the supplied downstream hook. Await the structured
result: revoked and downstream acknowledged/failed/not-requested are distinct.
Synchronous throws and asynchronous rejection become sanitized failed results;
neither restores source access. Acknowledged means that hook completed, not native
process exit or acoustic silence unless the hook itself supplies those guarantees.
Hooks must settle; no timeout, durable retry or native-stop guarantee is implemented.
Regranting a reader does not restore a revoked queue's session selection.

The experimental SegmentStream composes an explicit injected source grant, JSONL
framing and stable-segment queue admission. One pump reads a bounded chunk without
awaiting playback. Valid prefix records are admitted before a later framing error;
refused admission retains pending records and blocks further reads for explicit
reconciliation. Syntactic byte progress and admitted/duplicate counts are separate;
there is no durable source-offset acknowledgement. Revocation clears pending/carry
and revokes source plus queue. This is not a filesystem tailer, delta converter,
native player, consent UI or real harness. Failed streams are not auto-reset/replayed.

SegmentStream revocation awaits both queue and source acknowledgements and reports
them separately. Synchronous throws and asynchronous rejection are sanitized failures;
source invalidation starts even while queue acknowledgement is pending. Repeated
stream revocation returns the retained result without reissuing its direct hooks.
The stream owns its direct queue cancellation; an independently supplied source
hook may also cancel that queue and therefore must be idempotent. Actual
NarrationQueue.revokeSession is idempotent. Never-settling hooks remain pending;
there is no fabricated timeout success or native/acoustic guarantee.

The experimental createNativePlayer adapter calls existing prepare/playback with
explicit bounded options and AbortSignal. It retains private state, playback lock,
authenticated stop and existing native provider selection; it introduces no shell
text interpolation or new command option. Saved settings are not read implicitly.
Its composed regression exercises the actual playback lock/status/cancellation
path with an injected engine. Actual native queue-stream execution, human listening,
device timing and all real harness/source adapters remain unverified.
# Authenticated global stop outcome

Playback now returns an explicit completed or stopped outcome after owned cleanup.
The native queue adapter propagates that outcome. An external authenticated stop
closes the entire queue, cancels pending work across its selected sessions, clears
retained text and refuses admission/retry until an explicitly constructed new queue.
Queue-initiated session revocation still affects only that selected session.
The regression uses the real lock and authenticated stop IPC with an injected
engine: before the fix the stopped segment incorrectly reported completed; after
the fix active and pending segments report cancelled and no pending player starts.

Host responsiveness is still open. On Windows x64 Node 22.16, an actual permission
check with an injected engine delayed a 20 ms event-loop timer from 22 ms to 1138 ms
(1116 ms added delay). This is a host timer measurement, not visible GUI latency or
an acoustic timing. The in-process native adapter is experimental and needs worker
isolation before an immediate-display claim is supported.
