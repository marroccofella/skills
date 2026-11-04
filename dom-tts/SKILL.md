---
name: dom-tts
description: Speak selected text or assistant replies locally, stop speech, check speech status, or narrate one consented transcript with Dom TTS. Use for read aloud and spoken replies; excludes transcription and voice cloning.
---

## Experimental browser speech and progress

Use the explicitly enabled local browser companion for browser speech. Check
`node scripts/browser-speak.js --command status` first. See
[Browser speech](references/browser-speech.md) for setup, precise readiness states,
Stop/Disable, and the supplied progressive reply interface. Default browser CLI
admission does not wait for audio; use `--wait true` only for a voice test. For
requested progress narration, display each completed paragraph and enqueue its
concise spoken text immediately, then continue work. Do not reread that progress
at the final answer. A completion notification alone is not a live output stream.
Read only supplied text; no watcher or chat scan is started by this provider.

For portable supplied-paragraph defaults and final-only notification wiring, see
[Codex default speech](references/codex-default-speech.md). Preserve existing
notification chains. Live Desktop forwarding remains host-required.


# Dom TTS 0.5

Use Node 18+ and the scripts in this skill's directory. Prefer a maintained Node
LTS. Run doctor before first playback: `node scripts/doctor.js --voices true`.
Windows uses built-in SAPI; macOS Intel and Apple Silicon use /usr/bin/say;
Linux needs an already installed espeak-ng. Missing engines produce an error.
Do not install a package or download a voice without the user's request.
Windows script execution policy is respected; report a policy refusal without
changing policy or silently using inline execution. Settings apply unless the
caller explicitly overrides them. See EVOLUTION.md for migration and release gates.

Read selected text with `node scripts/speak.js --text "Text to speak"`.
For long text or text containing shell symbols, pass stdin or a UTF-8 file:
`node scripts/speak.js --stdin true` or `--text-file <file>`.
Use `--dry-run` to preview without audio or state changes. All models and harnesses
can use this interface; native skill discovery depends on the host.

Stop the active provider immediately when asked to stop or interrupt. For the
preferred browser provider use `node scripts/browser-speak.js --command stop`
(or this machine's configured browser helper); native `scripts/stop.js` does not
stop the browser. Browser pause is `--command pause` and finishes the current
segment before pausing. For native playback or a selected native watcher use
`node scripts/stop.js` to stop; native playback has no pause/resume capability.
Status: `node scripts/status.js`. Never kill a PID copied from a state file.
A dead owner's lock is recovered automatically by the next playback;
`status.js --recover` does the same on request. A live owner is never removed.

Modes: informative (default), full, summary, action-items, errors-only,
warnings-only, terminal-summary, diff-summary. Prefer diff-summary for a diff
and errors-only for build errors. Informative reads tables row by row as
"header: value" and skips code, diffs and stack frames; the log modes
(errors-only, warnings-only, terminal-summary) also read fenced output.
Summary selects sentences; for a meaningful spoken summary of complex code,
compose it yourself and send that text.
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

Browser receipts roll over as completed/cancelled messages settle. They are a bounded
window, not a lifetime message quota. Pending, failed and open messages are never
evicted to admit new work. Detailed history retains up to 64 messages/128 segments;
256 additional text-free retired identities refuse delayed retries. Receipts beyond
those windows are unavailable; do not resubmit old text to infer delivery.

## Live paragraph forwarding and per-chat delivery

For an owning Codex app-server client, use [live paragraph forwarding](references/codex-paragraph-speech.md). Its supplied-event callback forwards public commentary and stable partial answers before turn completion; the host-relay final route requires excluding those selected chats from a second completion notifier. This skill cannot attach to every Desktop chat by itself. Status explicitly reports hostForwardingRequired and automaticDesktopSubscription:false. Keep the existing final-only notification route for unforwarded chats.

`scripts/codex-notify.js` accepts only its supplied Codex completion payload, never prompt fields or transcripts. It registers a bounded source derived from the supplied chat identity so a failed reply in one chat does not block another. Supplied live relays support the same source isolation. Manual queued speech can use `--session-id <explicit-source>`; do not discover chats to populate it. At most 32 sources are selected, and only settled dynamic sources retire. Retained unsaid segments drain as queue capacity becomes available, without replay; receipts stay nonterminal while input remains. `doctor --browser true` distinguishes queue Stop, pause, failure and congestion from browser connection readiness.
