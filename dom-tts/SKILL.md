---
name: dom-tts
description: Speak selected text or assistant replies locally, stop speech, check speech status, or narrate one consented transcript with Dom TTS. Use for read aloud and spoken replies; excludes transcription and voice cloning.
---

# Dom TTS 0.4

Use Node 18+ and the scripts in this skill's directory. Prefer a maintained Node
LTS. Run doctor before first playback: `node scripts/doctor.js --voices true`.
Windows uses built-in SAPI; macOS Intel and Apple Silicon use /usr/bin/say;
Linux needs an already installed espeak-ng. Missing engines produce an error.
Do not install a package or download a voice without the user's request.

Read selected text with `node scripts/speak.js --text "Text to speak"`.
For long text or text containing shell symbols, pass stdin or a UTF-8 file:
`node scripts/speak.js --stdin true` or `--text-file <file>`.
Use `--dry-run` to preview without audio or state changes. All models and harnesses
can use this interface; native skill discovery depends on the host.

When asked to stop, pause or interrupt, run `node scripts/stop.js` immediately.
Status: `node scripts/status.js`. Never kill a PID copied from a state file.
A stale lock can be inspected and recovered with `status.js --recover`; a live
owner is never removed by recovery.

Modes: informative (default), full, summary, action-items, errors-only,
warnings-only, terminal-summary, diff-summary. Prefer diff-summary for a diff
and errors-only for build errors. Summary selects sentences; for a meaningful
spoken summary of complex code, compose it yourself and send that text.
Profiles: conversational, engineering, concise. Speed: 0.5–2. Voice names must
come from doctor. A missing voice fails visibly. Full mode includes code.

For explicitly requested continuous narration, confirm which single transcript
the user wants, then use `watch-codex.js --file <file> --format codex`.
Formats: codex; claude (only assistant messages explicitly marked end_turn);
generic (JSONL with role assistant, phase final_answer, text and optional id).
Watch begins at file end and skips existing history after truncation/rotation.
Commentary additionally requires `--phase all --include-commentary true`.
No global session scan. Ctrl+C ends watching. Stop suppresses new watcher batches
until an explicit watcher restart. Do not claim microphone, barge-in or Duplex.

Speech uses local engines; no cloud TTS or model calls. macOS/Linux playback has
not yet been audibly certified on native machines. Inspect COMPATIBILITY.md.
Runtime state is private and separate from the skill; do not share it.
`node scripts/support-bundle.js` exports a sanitized diagnostics.json, never
speech, raw errors, settings or transcript paths. Review it before sharing.

