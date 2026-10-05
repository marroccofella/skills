# Narration integration acceptance — draft

Legion, 4 October 2026. These are required cases, not passing runtime receipts.

An assistant preference or a spoken setup confirmation does not demonstrate a
running delivery hook. Track final replies separately from explicitly requested
periodic progress announcements. The installed 0.4 report in discussion comment
18740201 describes omitted periodic invocation, not a native-engine failure.

## Final replies

- A consented final reply produces an observable admission and eventual terminal
  result; a reply emitted without an invocation is reported as missing delivery.
- Written text appears independently of speech. A launch acknowledgement is not
  playback completion, and process completion is not human-confirmed hearing.
- Replayed event identity does not speak twice. Confirmed failures may be retried
  explicitly; ambiguous started speech and cancelled events are never auto-retried.
- State permissions are checked in the actual harness execution context. Refusal
  is actionable and does not silently escalate privileges.

## Explicitly requested periodic announcements

- A setup acknowledgement alone fails this case. A registered job must consume
  each selected structured sample and record its own delivery result.
- Missing and stale samples yield observable outcomes instead of fabricated
  progress. Duplicate samples and duplicate announcers must not repeat speech.
- Cancellation prevents future admission and requests owned-player stop; distinguish
  a scheduling stop marker from the engine's stop acknowledgement.
- Failure, completion and final notification have separate receipts. A failed
  announcement must not freeze the displayed progress or lose later samples.
- Reads are limited to the explicitly selected source. No global chat discovery,
  transcript watcher or microphone activation follows from periodic-update consent.

## Required evidence

Declare eligibility and skip policy before evaluation. Count expected delivery
against independent harness events, not only the product's admitted-event journal.
Report missing invocation, skipped-by-policy and superseded counts explicitly;
these outcomes must not inflate a success ratio. Periodic backlog must be bounded
and coalesced under a declared policy, with each superseded sample accounted for.

Unknown started speech remains ambiguous even after an owned child is reaped:
reaping proves process termination, not absence of earlier audible output. Keep
that outcome visible or abandoned; automatic duplicate-free retry is not justified.
Any at-least-once replay policy needs explicit user authorization. Cancellation
continues to prohibit automatic retry. Test lease clock/heartbeat behavior across
suspend/resume and process identity reuse; no lease controller is implemented here.

Journal failure must not erase in-process deduplication. Document restart duplicate
risk while durable receipts are unavailable. Use session plus an actual provider
identity/ordinal when supported, never content-only suppression of repeated replies.
Report independent hosts and sessions separately from correlated event counts.

Record exact source commit, harness/version, model where relevant, OS/architecture,
Node version, native versus stand-in player, input identity, admission/terminal
counts, failures and retries. Measure visible-text and acoustic timings separately.
Run cancellation, duplicate-announcer, stale/missing-sample and failure fixtures,
then a real harness/native playback check. Preserve original failures separately
from successor passes. These cases remain open until that evidence is supplied.
