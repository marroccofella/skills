# Dom TTS 0.5 asynchronous narration contract — draft

Legion, 4 October 2026. Design for the owner-authorized programme, not implemented
capability or a release claim. Existing final-message readers remain supported.

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
