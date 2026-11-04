# Portable Codex default speech

The public package includes the default helper; it does not need a machine-specific
`browser-companion.cjs` file. Keep the enabled local companion page open. Run
`node /ABSOLUTE/DOM-TTS/scripts/doctor.js --browser true` and check provider status
before admitting speech:

```text
node /ABSOLUTE/DOM-TTS/scripts/codex-default.js --command status
node /ABSOLUTE/DOM-TTS/scripts/codex-default.js --text "A supplied progress paragraph." --wait false
```

Display each useful public progress paragraph, admit its concise supplied speech,
retain its returned job ID, and continue work. Speech defaults to queued admission
without waiting for sound. Queued is not completed playback. For an explicit voice
test, pass `--wait true`; its completed browser receipt still needs the listener's
hearing verdict. Written replies remain available on failure.

The helper uses this package's `scripts/browser-speak.js` and the same private
state directory as other installed commands. An explicit `DOM_TTS_STATE_DIR`
environment override must match the already enabled companion; no alternate
server is started on failure. It preserves the browser's saved voice and speed.

If the host supplies `CODEX_THREAD_ID`, the helper hashes that supplied identity
into a scheduler source for queued speech. It never discovers chats or reads
transcripts. Missing identity uses the manual source. `--session-id` explicitly
selects another supplied source; `--enqueue false` selects direct browser speech.
Status and Stop do not register a chat. Invalid supplied identities fail visibly.

Stop and silence are immediate and global:

```text
node /ABSOLUTE/DOM-TTS/scripts/codex-default.js --command stop
```

Stop suppresses subsequent queued speech until an explicit requested Restart:

```text
node /ABSOLUTE/DOM-TTS/scripts/codex-default.js --command restart
```

Do not treat an inaccessible state directory, unobservable owner or denied
loopback connection as proof of a dead server. Check from the authorized desktop
context before recovery. Do not bypass privacy checks or launch a duplicate server.

The helper bounds child output and emits a structured, text-free diagnostic for a
launch failure, timeout, signal termination or empty result. It reports only safe
error/signal codes, exit status and output byte counts. Admission remains unknown:
a failed launcher can have delivered a request before losing its receipt. It
never automatically retries speech. Check the provider and retained receipt before
deciding whether a new, explicitly requested test is appropriate.

## Final replies through Codex notifications

`scripts/codex-notify.js` accepts only a supplied `agent-turn-complete` JSON
argument. It ignores prompts, transcript paths, title metadata and silent heartbeat
events. It hashes the supplied chat identity for queue isolation, bounds the spoken
summary and admits without waiting for playback. It does not scan chat history.

For a host with **no existing notification command**, the following is the shape
of the user-level `config.toml` setting. Replace the two absolute executable/file
paths with the actual installation paths. Use single-quoted TOML strings for
Windows paths to preserve backslashes:

```toml
notify = ['C:\PATH\TO\node.exe', 'C:\PATH\TO\dom-tts\scripts\codex-notify.js']
```

If `notify` already exists, preserve its complete command and argument chain.
Integrate the supplied final-event adapter at that command's documented chaining
point; do not replace an existing outer app notification handler. This package
does not mutate Codex configuration. Review the exact proposed configuration and
keep a backup before applying it. A running chat may need a host reload before a
new user default is used. Test the supplied event route separately from claims
that every existing chat has adopted it.

When this completion route is active, do not manually enqueue the same final
reply a second time. Supplied progress paragraphs remain separate manual calls.

## Live paragraphs require a forwarding host

Codex's documented external notification emits only turn completion. It cannot
supply earlier paragraphs. [Live paragraph forwarding](codex-paragraph-speech.md)
provides the callback for an owning client that already receives public live
events. The host must wire it to its event dispatcher and coordinate the final
route to prevent duplicate speech. The helper and notification adapter cannot
attach themselves to all existing Desktop chats.

This default is local supplied-text speech: no chat scan, transcript watcher,
microphone, cloud provider or execution-policy change. See the official
[notification documentation](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)
and [app-server protocol](https://learn.chatgpt.com/docs/app-server).
