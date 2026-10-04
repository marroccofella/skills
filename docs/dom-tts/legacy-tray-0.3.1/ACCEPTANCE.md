# Acceptance protocol and honest evidence levels

## Packet checks, independent of production

1. Run node verify-packet.cjs: committed packet hashes and JS syntax only.
2. Parse every supplied .ps1 with System.Management.Automation.Language.Parser;
   collect and fail on parser errors. Do not execute parsed scripts.
3. Run source/scripts/ui-smoke-test.ps1 without LaunchSafeActions. This checks
   declared argument/path shapes only; it does not click real UI or register
   hotkeys. A pass cannot certify safe quoting, microphone or audible playback.
4. Scan allowlisted source for personal paths, LAN endpoints and credential-shaped
   values. Never package state, settings from a live host, audio or transcripts.
5. Verify that original hashes match all copied files except the two explicitly
   sanitized files. Record committed published hash separately.

## Independent legacy comparison

Reviewer A and B independently supply public-safe relative-path hashes, actual
launch entry, package/version/commit if available, enabled controls and sanitized
screenshots. Do not export full command lines, settings or logs. A read-only SSH
inventory by A is host evidence, not a second reviewer's agreement. Save the
original installation and do not replace it. Check alternate skill/plugin/cache
copies and Startup/task/shortcut targets; reconcile bytes, not version labels.

## UI and playback matrix

Use disposable state and fixture transcripts; explicit permission before real
chat monitoring or audio. Check provider auto/offline/online consent, installed
voices, Unicode, apostrophes/quotes/paths/spaces, speed bounds, every mode and
code toggle, live settings apply, unknown-setting preservation and invalid JSON.
Test one tray owner, second launch refusal, hotkey conflicts, output-device loss,
Bluetooth changes, sleep/resume, DPI 100/150/200 percent, keyboard reachability
and bottom controls. Test exit tray separately from stop speech and stop watcher.

For stop/pause/resume/skip/retry/priority: long multi-chunk text, all sources busy,
new source during playback, synthesis failure, playback failure, caller crash,
unauthenticated stop, stale lock and owner replacement. Verify unrelated processes
survive. User hearing and process completion are separate result fields.

## Display and streaming A/B experiment

Same pinned harness/model/prompt, with narration disabled, legacy enabled and
candidate enabled. Use consented synthetic prose plus a long-code response.
Record machine/OS/architecture, package and commit, harness version, provider and
actual voice, native vs stand-in engine. Capture timestamps:

```text
first_generated_event
first_visible_text
first_stable_chunk_enqueued
first_synthesis_started
first_playback_process_started
first_audible_speech (human/acoustic, or UNKNOWN)
final_visible_text
final_audio_completed (human/acoustic, or UNKNOWN)
stop_requested / process_exited / acoustic_silence
```

Do not subtract wall clocks on different machines without synchronized clocks;
use monotonic durations within one process and document capture method. Queue
latency, synthesis latency and acoustic first sound are different measurements.
Never wait for playback before publishing the written answer. No tool/session
log can prove exactly when text became visible without host/render evidence.

Fixture cases: split UTF-8/JSONL, incomplete last line, appended delta/snapshot/
final, rewritten tail, duplicate final/progress, cancel during synthesis, fail
then retry, reconnect, file rotation/truncation, newly created file, two sessions
with identical text, fairness/backpressure, long code omitted, no old-chat replay.
All final text must reconcile to spoken/omitted/cancelled accounting with no
unexplained loss or repeat. Declare final-only fallback if true deltas unavailable.

## Security and release matrix

Local-only refuses every remote speech/STT/model path; Standard never activates
microphone. Unauthorized web reads/writes, foreign origins/hosts, oversize bodies,
HTML injection, arbitrary commands, path traversal and source symlink escape
must fail. Ledger is metadata-only unless explicit content consent. Redacted
support exports must survive private canaries, not just known key-name regexes.

For each installer/store: fresh non-admin user, repeat install, upgrade, repair,
rollback, missing host/runtime/provider, malformed metadata, interrupted install,
preserved custom settings, uninstall keep-data/clean-data and private-state ACLs.
Verify signature and exact artifact hash separately from source manifest checks.

All failures retain exact source pin, test command, result and sanitized receipt.
Green CI, another author's reported test or a process exit is not independent
human listening. Stable approval needs explicit reviewers and disposition of
every blocking issue; no agreement is assumed from silence.
