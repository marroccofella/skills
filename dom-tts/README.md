# Dom TTS

Windows read-aloud by **Prof Dom Marrocco / 42.uk**.

## Development Baseline

`0.3.2-dev.1` is a deliberately scoped source baseline recovered from the
0.3.1 Standard Mode implementation, with privacy and playback safety fixes.
It is not a production release, signed installer, or proof that two existing
installations match. A prior independent review covered the diagnostic changes;
full-product review and a second successful independent review remain open.

Requires Windows, Node 18+, and built-in Windows PowerShell/System.Speech.
No npm dependencies, API keys, microphone access, or network service are required.

```text
node scripts/speak.js --provider sapi --mode informative --text "Dom TTS is ready."
node scripts/speak.js --dry-run --text "Preview without audio or state changes."
node scripts/stop.js
node scripts/status.js
node scripts/self-test.js --self-test
```

`watch-codex.js --file <transcript.jsonl>` reads newly appended assistant records
after its initial end-of-file cursor. It runs in the foreground; Ctrl+C stops the
watcher. `stop.js` stops active speech and discards pending/new transcript batches
until an explicit watcher restart or speech request; it does not kill the watcher.
No background startup
tasks, browser automation, or application injection are installed.

## Privacy And Safety

The default SAPI provider speaks locally. This baseline intentionally excludes
Edge/Piper, automatic multi-app watching, private agent integrations, avatars,
Duplex Mode, distribution exporters and the unrecovered installer EXE.
Existing installations are not replaced. Runtime `state/` includes speech text
and local paths and must remain private. Diagnostics export only a typed
allowlist, never logs, settings, transcripts, raw errors, speech or recordings.
Support archive creation fails closed if directory protection fails.

Playback is single-owner: a second request fails while the first owns its lock.
Stop requests are checked between chunks and kill only a verified Dom TTS SAPI
child. After an abnormal process termination, a stale lock may require manual
inspection; do not delete a lock without checking the recorded process first.

## Verification And Remaining Work

Offline tests cover mode selection, partial transcript records, user/tool record
rejection, duplicate suppression, invalid settings, bounded chunking, no-write
dry runs, lock ownership, and diagnostic privacy/archive failure fixtures.
Configured cross-platform CI is not proof of audible playback on every machine.
Windows audio, interruption and archive lifecycle checks are tracked separately.

Next: complete independent review, reconcile legacy installations against one
canonical manifest, restore optional providers with explicit consent, validate
the installer lifecycle, and integrate product pages through the repository's
existing renderer/theme. No signed EXE or live product Pages are promised here.
