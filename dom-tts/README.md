# Dom TTS 0.4

Local speech for coding assistants by **Prof Dom Marrocco / 42.uk**.

Version **0.4.0-dev.2** is a working development build. The common interface is
model-independent: any harness that can run a command can pass text through
stdin, a UTF-8 file, or --text. Agent Skills hosts can discover SKILL.md.

## Run

Use Node 18 or newer (a maintained LTS is recommended). No npm install is needed.

```text
node scripts/doctor.js --voices true
node scripts/speak.js --text "Dom TTS version zero point four is ready."
node scripts/speak.js --text-file answer.txt --mode informative
node scripts/speak.js --dry-run --text=--verbose
node scripts/stop.js
node scripts/status.js
npm test
```

The speech provider is selected from the operating system:
Windows SAPI, macOS /usr/bin/say (Intel or Apple Silicon), Linux espeak-ng.
Linux requires the native engine to be installed separately. No hidden downloads,
cloud providers or API keys. Use --voice with an installed voice from doctor.
An invalid voice fails visibly. WSL is treated as Linux; it needs a working Linux
audio route. Other operating systems receive an unsupported-platform error.

Options accept kebab-case or camelCase, including --text-file/--textFile,
--max-chunk-chars/--maxChunkChars, --include-code-blocks and --wait-ms.
Boolean options accept true/false; --dry-run alone means true.
Values beginning with -- use equals syntax, such as --text=--verbose.
Speed 0.5–2; chunk limit 40–4000, further bounded by a conservative speech budget.
Modes: informative, full, summary, action-items, errors-only, warnings-only,
terminal-summary, diff-summary. Profiles: conversational, engineering, concise.
Summary is deterministic sentence selection, not semantic summarization.
Informative mode reads Markdown tables row by row as "header: value" pairs and
skips code fences, unified diffs and Python stack frames (the exception line is
kept). errors-only, warnings-only and terminal-summary also read fenced logs.

## Narrate one selected transcript

```text
node scripts/watch-codex.js --file <consented-transcript.jsonl> --format codex
node scripts/watch-codex.js --file <consented-transcript.jsonl> --format claude
node scripts/watch-codex.js --file <consented-transcript.jsonl> --format generic
```

The watcher starts at file end. Rotation or truncation skips existing history;
only later appended records are processed. Failed speech stays pending for retry
and is not marked spoken or deduplicated. Contention waits up to 30 seconds,
then reports failure and retries. Stop discards current/new batches until a
watcher restart. Ctrl+C exits the watcher. Commentary requires the explicit
--phase all --include-commentary true flags.

Codex accepts assistant final_answer/final response-item records. Claude accepts
only assistant records whose message.stop_reason is end_turn; transcripts omitting
that marker need a generic producer or direct invocation. Generic JSONL records:

```json
{"id":"reply-1","role":"assistant","phase":"final_answer","text":"Text to speak."}
```

This interface works with any model; it does not imply every harness exports
the same transcript format. No application injection, global transcript scan,
microphone, avatar or Duplex mode.

## Install, upgrade, rollback and uninstall

```text
node scripts/package.js
node scripts/install.js --target codex --dry-run
node scripts/install.js --target codex
node scripts/install.js --target claude
node scripts/install.js --dir <absolute-documented-skill-parent>
node scripts/install.js --target codex --action rollback
node scripts/install.js --target codex --action uninstall
```

The source manifest contains SHA-256 hashes and excludes runtime state, settings,
reviews and recordings. The installer validates it, stages source in a private
directory and replaces only its own managed dom-tts directory. An existing
unmanaged directory is refused. Upgrades retain a previous snapshot and preserve
valid per-machine settings. Uninstall moves the installed snapshot to the private
backup directory; it leaves runtime state and other skills alone.

Codex uses ~/.agents/skills, Claude Code uses ~/.claude/skills. For other Agent
Skills hosts use their documented skill parent explicitly. For hosts without
skills support invoke the command interface. Installation is local; it does not
modify model accounts or harness binaries. Some hosts need a restart to discover
a newly installed skill.

## Privacy and recovery

State defaults to LOCALAPPDATA/42uk/DomTTS/0.4 on Windows and
XDG_STATE_HOME/dom-tts (or ~/.local/state/dom-tts) on POSIX.
DOM_TTS_STATE_DIR selects an isolated test directory. Existing state directories
must already be private. New Windows state directories allow only the user,
SYSTEM and Administrators; POSIX directories use owner-only permissions.
On Windows the permission check runs once per state folder (up to 60 seconds,
for slow first PowerShell starts). It leaves a `.private-verified` marker bound
to that folder's identity, so later playbacks skip the PowerShell launch; a new
or replaced folder is checked again. A failed check names its cause (timeout,
could not start, folder open to other accounts, or exit code) without paths.

Persistent status holds enums and counters, not speech text, transcript paths
or raw errors. Speech exists briefly in a protected JSON file on Windows and is
deleted after playback; macOS/Linux receive it on stdin. A machine crash can leave
that temporary file; the next playback removes it once the owner is dead.
No raw speech is stored in queue or telemetry files. Native child environments
use an allowlist rather than forwarding credentials.

Stop uses a local named pipe/Unix socket and a random token from private state.
It interrupts only the child handle held by the authenticated playback owner;
it never kills a recorded PID. A live playback owns an exclusive lock.
--wait-ms can wait up to 60 seconds. If an owner terminates abnormally, the next
playback (including the watcher's) recovers its lock automatically: a well-formed
lock whose recorded process is no longer running is removed with its speech files,
and a stale "speaking" status is reset. A live owner is never removed, a lock still
being written is treated as busy, and an older malformed lock needs manual
inspection. status.js --recover applies the same rules on request. If the dead
owner's PID has been reused by another process, the lock looks live and waits
until that process ends.

support-bundle.js creates a protected diagnostics.json containing only typed,
allowlisted operational fields. This is a portable JSON bundle, not a ZIP.
Review before sharing. OS-native engines are invoked without a shell; speech and
voice text are data, never executable PowerShell fragments.

See [COMPATIBILITY.md](COMPATIBILITY.md) for tested scope and remaining gates.
Derived from skills PR #35, commit fd2811ef640b4e6cf29a0d2dc281a55022e1e164;
original source retains its MIT license.

