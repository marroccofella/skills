---
name: dom-tts
description: Dom TTS by Prof Dom Marrocco / 42.uk speaks selected text and assistant replies through Windows audio. Use for read aloud, speak this, narration, conversation mode, stop speaking, speech status, and privacy-safe diagnostic bundles.
---

# Dom TTS

Development baseline 0.3.2-dev.1. Windows Standard Mode only; not a signed
installer release. Use Node 18+ and built-in Windows PowerShell/System.Speech.
Run commands from this skill directory. No npm installation is required.

```text
node scripts/speak.js --provider sapi --mode informative --profile conversational --text "Text to speak"
node scripts/stop.js
node scripts/status.js
node scripts/self-test.js --self-test
node scripts/support-bundle.js
```

When asked to stop, pause, or interrupt, run stop.js immediately. Conversation
mode is turn-based: compose the answer, then speak it. Do not claim automatic
barge-in, wake-word listening, microphone access, or full-duplex voice.

Profiles: conversational for prose, engineering for technical content, concise
for short reports. Modes: full, informative, summary, action-items, errors-only,
warnings-only, terminal-summary, diff-summary. Summary is deterministic sentence
selection, not a model-generated summary. Prefer informative for ordinary replies.
Long code should be summarized before speaking unless full narration is requested.

For explicitly consented automatic narration of one transcript:

```text
node scripts/watch-codex.js --file <transcript.jsonl> --provider sapi --phase final_answer --speakStartup false
```

Watching begins at the current file end. Stop the foreground watcher with Ctrl+C;
stop.js interrupts speech and suppresses pending/new watcher batches until an
explicit watcher restart or speech request resumes narration, but does not
terminate the watcher. Ask before watching
private transcripts or enabling progress-message narration. This baseline does
not scan other applications, peer mailboxes, or global agent directories.

Speech is local and offline. Edge/Piper adapters are intentionally not shipped
in this baseline; do not silently install packages or send text to a cloud TTS
service. Runtime state contains speech text and local paths: never publish state,
settings, logs, review evidence, or support archives. Support bundles export only
typed allowlisted counters/enums, in a Windows ACL-protected directory; review
the archive before sharing. Do not patch Codex Desktop or signed app files.

See README.md for verified scope and remaining work. This public baseline does
not establish equality of existing installations or approval by a second reviewer.
