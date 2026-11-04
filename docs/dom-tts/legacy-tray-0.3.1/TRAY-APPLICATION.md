# Legacy Windows tray application: technical and operator manual

## 1. Identity and origin

The visible name is **Dom TTS Read-Aloud**. Settings title:
Dom TTS Read-Aloud Settings. Control title: Dom TTS Read-Aloud Control.
Attribution: Prof Dom Marrocco / 42.uk. The tray tooltip has no version label;
package.json reports 0.3.1. It is not a standalone compiled executable and not
a native Codex chat-toolbar plugin. It is a PowerShell WinForms companion in
the `read-aloud` skill tree, invoking bundled Node scripts.

Installed skill/plugin/cache copies can coexist. A skill's metadata icon does
not add a toolbar button. Codex's triangular project-run control launches a
configured project command; it is not this application's speech button.
Do not configure the project-run button as an automatic narration hook.

The original installed Git commit/distribution receipt is unresolved. An older
portable ZIP, marketplace package and Inno source exist locally, but a filename,
package version or old success report does not establish which bytes were
installed or that an executable was built, signed and distributed.

## 2. Startup and dependencies

The entry point is `source/scripts/tray-app.ps1`. Requirements:

- Interactive Windows desktop, Windows PowerShell 5.1/.NET WinForms and Drawing.
- Embedded C# compiled by Add-Type; user32.dll RegisterHotKey/UnregisterHotKey.
- Node on PATH. Legacy package uses CommonJS and node-edge-tts ^1.2.8.
- SAPI speech installed on Windows for the offline provider.
- Edge online synthesis: node-edge-tts plus ffplay.exe or WMPlayer.OCX playback.
- Optional Piper, Whisper.cpp/model, ffmpeg capture and Ollama for optional lanes.

Observed on Bob on 2026-10-04: one global Node watcher, two processes whose
command lines reference tray-app.ps1, and per-user Startup shortcuts named
Dom TTS Read-Aloud Global and Dom TTS Read-Aloud Tray. Matching processes prove
launch, not that both have usable notification icons or registered hotkeys.
No matching Dom TTS scheduled task was observed in the bounded query.
The installer has shortcut/startup code; actual shortcut targets and all other
launch mechanisms remain to be audited separately.

For isolated source reproduction only, copy the source tree to a disposable
folder on Windows and provide its dependencies deliberately. Then launch:

```powershell
powershell.exe -NoProfile -File .\scripts\tray-app.ps1
```

This archive is not a public product installer. Do not invoke archived
install.ps1 or install-dom-tts.ps1 over production. Do not launch watchers
against another person's chats. Do not launch Duplex to inspect the tray.

## 3. Architecture and source map

```text
WinForms NotifyIcon / ContextMenu / global WM_HOTKEY
  -> hidden or visible child PowerShell/Node commands
  -> watcher / speak.js / settings / doctor / optional avatar or voice shell
  -> providers/edge.js, sapi.js, piper.js
  -> local Windows audio
```

The tray runs an Application.Run message loop. It derives the skill directory
from its own script path. It reads/writes assets/settings.json and reads
state/watcher-status.json. It does not connect to Codex's live token stream,
select a chat through Codex UI, or use an authenticated service API. A global
watcher discovers transcript/result files; Node speech is launched in separate
processes. Status/queue/lock/PID/stop files coordinate the legacy runtime.

| Source | Responsibility |
| --- | --- |
| tray-app.ps1 | Notification icon, menus, hotkeys, launch helpers |
| settings.ps1 | Provider/voice/speed/mode/profile/filter/poll/chunk settings |
| control-panel.ps1 | Button-based watcher, speech, doctor, avatar controls |
| start-watcher.ps1, watch-codex.js | Selected transcript watcher |
| start-global-watcher.ps1, watch-all-codex.js | Global Codex/OpenClaw/AgentLab discovery |
| stop-watcher.ps1 | Broad watcher process termination, then speech stop |
| speak.js, summarize.js | Cleaning, narration modes, chunks, provider fallback |
| stop.js, status.js | Legacy playback interruption and status |
| providers/edge.js | Online Edge synthesis and ffplay/WMP audio |
| providers/sapi.js, piper.js | Offline Windows speech / optional neural adapter |
| doctor.js, acceptance-test.js, ui-smoke-test.ps1 | Diagnostics and declared fixtures |
| telemetry.js, support-bundle.js | Legacy local events and diagnostic export |
| avatar-state.js, avatar-server.js | Avatar state and localhost UI/service |
| avatar-screen-switcher.js and stop helpers | Optional device/window presentation |
| duplex-shell.js, voice-runtime.js, record/transcribe-audio.js | Experimental microphone/STT/agent lane |
| voice-doctor.js, duplex-acceptance-test.js | Separate optional-lane diagnostics |
| install/export scripts | Legacy skill/plugin/startup/package scaffolding |
| assets/avatar-ui.html, icons, voices.json | Static UI resources and catalog |

All helpers and their tests are supplied, including avatar, dedupe and OpenClaw
fixtures. Source/static imports are present; node_modules, ffplay, Whisper and
models are not bundled in this review packet.

## 4. Operating controls and verified limits

These are **source-confirmed actions**, not a claim that each works acoustically.

| Control | Source behavior | Caution / evidence gap |
| --- | --- | --- |
| Start all chats | Launch global watcher | Only discovered/configured roots, not every harness |
| Stream all chats | Global watcher with phase=all | Complete messages/progress events, not token streaming |
| Read last / Ctrl+Alt+R | Read status.lastText; invoke informative speech | Global watcher stores only first 180 chars; fixed profile/mode |
| Stop speaking / Ctrl+Alt+S | Invoke stop-watcher.ps1 then stop.js | Stops narration monitoring too; not a speech-only stop |
| Mode menu / Ctrl+Alt+M | Save informative/summary/full to settings | Global args loaded at startup; no restart/reload in this handler |
| Settings | Open WinForms settings dialog | Fixed height; bottom controls may clip without scrolling |
| Save | Write a new limited settings object | Drops unknown fields, watch flags, pitch and voiceRoutes |
| Save + Restart | Save; stop watcher; wait 500 ms; restart | Fixed delay is not readiness/exit proof |
| Test voice | Invoke speak.js | Launch success is not provider/audio success |
| Provider | auto / edge / sapi selector | SAPI cannot normally use Edge neural voice names |
| Voice | Static catalog dropdown | Catalog entry is not installed-provider availability |
| Speed | Slider 0.70-1.50 | Out-of-range existing value can throw during initialization |
| Chunk size | 180-1600 characters | Does not create host token events or prove low latency |
| Poll interval | 250-5000 ms | Global watcher clamps effective minimum to 500 ms |
| Code/commands | Inclusion toggles for informative mode | Must test every narration mode; full has different semantics |
| Startup confirmation | Speak-on-start toggle | This is not the Windows startup enable/disable setting |
| Dedupe | In-memory watcher duplicate filtering | Failure is marked before playback success; can suppress retry |
| Doctor / logs | Launch diagnostics / open state folder | Legacy output can contain paths or speech text |
| Avatar / device / auto switch | Start optional server/switcher | Does not prove camera consent, gestures or accurate context |
| Duplex / Ctrl+Alt+Space | Launch optional voice shell | A launch hotkey, not verified push-to-talk capture |
| Wake Phrase Status | Display config/default phrase | Not evidence of active wake detection |
| Exit tray | Dispose icon and unregister hotkeys | Does not stop watcher or speech children |
| Double-click tray | Start global watcher | Restart behavior, not settings open |

No tray pause/resume, skip-sentence, queue editor, chat/context picker, current
provider health indicator or persistent conversation ledger exists in this source.
Voice routes exist in watcher configuration code, not as a context picker UI.

## 5. Concrete source defects and live observations

1. `watch-all-codex.js` stores lastText=text.slice(0,180); Read-Last reads that
   field. This directly explains truncated manual replay. Ordinary speech gets
   the full detected text; do not generalize the replay defect to every call.
2. Detection awaits speech completion per line, file and scan. Large answers can
   delay scanning all other chats. Child exit/error resolves without inspecting
   success and the text is remembered before playback, weakening retries.
3. New files are initialized at current size when discovered, skipping already
   written first events. Partial JSON records have no carry buffer; failed JSON
   parses are discarded while the cursor advances. Truncation moves the cursor
   to the new size, potentially skipping replacement content.
4. Stop/start scripts match watcher basenames across processes, not the exact
   installation owner. They can affect a different installed Dom TTS watcher.
5. No tray singleton mutex; hotkey registration return values are ignored. Two
   matching tray processes were observed on Bob. Duplicate icons/hotkey conflicts
   are plausible but not established visually by this process query.
6. Saved settings replace the object and write non-atomically. Per-context routes
   and newer watcher options can disappear after using the old dialog.
7. Start-Process joins ArgumentList values; removing null/empty arguments fixes
   one exception class, not quoting/shell safety. Paths with spaces and hostile
   speech arguments need real tests. The command-shape test does not launch UI.
8. The 560px settings form positions action buttons at y=522 with height 36 and
   no AutoScroll; normal window chrome reduces client height. Layout requires
   actual DPI/keyboard validation, not a parsed-script success claim.
9. WMP playback uses a 30-second deadline and can exit successfully after timeout;
   successful child exit alone cannot certify that a long chunk fully played.

These findings are not changes applied to production. Preserve original source
and explicitly choose a migration; do not silently transplant old control logic
into the new privacy/IPC core.

## 6. Publication and feature gap analysis

| Feature | Installed 0.3.1 legacy | 0.4 / 0.5 development core |
| --- | --- | --- |
| Windows tray/settings/control panel | Present source | Not supplied in reviewed candidates |
| Online Edge / optional Piper | Present | OS-native offline provider design |
| Codex global discovery / OpenClaw / AgentLab | Present but bounded/brittle | Explicit consented transcript/generic paths |
| Claude adapter | Not shown in this global watcher | Explicit complete end_turn messages |
| True token streaming | Not established | Not established; final JSONL messages |
| Stop security | PID/process-name/file coordination | Authenticated IPC and managed owner lock |
| State/privacy | Skill-local; speech/logs/settings retained | External private state, no persisted speech text |
| Queue retry/recovery | Weak fail handling, in-memory dedupe | Improved retained failures/retry/recovery tests |
| Plugin/installer/operator skill | Historical source/artifacts | Not equivalent legacy distribution parity |
| Duplex/mic/STT/Ollama | Experimental helper source | Intentionally outside minimal Standard core |
| Avatar/screen switching | Present source | Not carried forward |
| Signed easy EXE | Inno scaffold; built artifact unverified | Public signed installer gate remains open |
| Context/conversation ledger | No centralized ledger | Planned opt-in service, not implemented claim |

Exact reviewed candidate pins: 0.4.0-dev.1 a1de798; dev.2 75ba1ce; PR40
0.5.0-dev.1 da5c228; permission follow-up PR41 1337e67. Results from one pin
must not certify another. PR41's creator reports native ACL tests and green CI;
those receipts do not constitute this reviewer's independent native retest.

The 2026-10-04 read-only two-host source inventory repeats 49 Bob / 43 Bab files:
19 identical, 21 differing shared paths, 9 Bob-only, 3 Bab-only. It covers scripts,
references, agents and package/skill metadata, not installed user settings or
node_modules. Both package labels can say 0.3.1 while code differs. A remote
PowerShell serialization wrapper was normalized before comparing; its initial
one-wrapper count is not evidence of missing files. No remote changes were made.

## 7. Privacy and troubleshooting

Standard microphone-free narration must stay independent of Duplex. Watching
all chats requires explicit source scope and opt-out; it is not harmless global
discovery. Edge synthesizes remotely: sensitive code/prose must not be sent under
a local-only setting. Local audio output is not local synthesis.

If no speech is heard: record actual entry point and package/source hash; check
watcher status and effective sources; test selected provider with short consented
text; check Windows output device and volume; distinguish detected, queued,
synthesized, playback started, process exited and human heard. Do not restart
everything blindly or weaken execution/security policies. Never publish full
legacy logs/status/settings in a support issue.

If repeated announcements occur: count watcher and tray owners, confirm startup
shortcuts, repeated harness records, per-source/message identity and retries.
Current dedupe heuristics and process-name shutdown are not a robust owner model.
Use a disposable source fixture to reproduce duplicates before changing production.
