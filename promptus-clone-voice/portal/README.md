# Promptus F5 Voice Studio

A localhost-only recording portal for consented F5-TTS voice cloning through the Promptus-managed Cosy worker and ComfyUI services.

## Start

1. Open Promptus and make sure **ComfyUI**, **Cosy**, and **CWorker** are ready.
2. Run `start-portal.ps1`.
3. The portal opens at `http://127.0.0.1:8765`.

## Diagnostics and history

The portal prefers live service evidence: PManager `/status`, ComfyUI `/queue`, and the relevant
`/object_info` capability checks. Its token-protected `POST /api/log-diagnostics` accepts an optional JSON
`job_id`, auto-discovers only approved sources under the active Promptus installation, and returns constant
finding codes and copy, source metadata, portable `<installRoot>` display paths, and safe summary fields —
never raw log lines. It does not expose narration, reference transcripts, request tokens, queue payloads,
prompt objects, or absolute user paths, and it never restarts a service or modifies Promptus.

Only the launcher, current ComfyUI, and Cosy sources are signature-scanned. CWorker, queue, debug, desktop,
rotated ComfyUI, media-index, and Voice Studio history sources are metadata-only, so their contents never
enter the browser. Live endpoints remain authoritative over every file observation.

| Priority | Source or portable path | Purpose |
|---:|---|---|
| 1 | Live `/status`, `/queue`, `/object_info` responses | Reachability, authoritative queue counts, and F5 node capability |
| 2 | `POST /api/log-diagnostics` | Token-protected, signature-only classification of current backend evidence, optionally scoped by `job_id` |
| 3 | **Recent jobs** | Durable sanitized history: state, issue stage, hashes, safe metrics, verdict, and recovery |
| 4 | `<installRoot>\logs\ComfyUI_log.txt` | Current ComfyUI startup, node import, and execution evidence |
| 5 | `<installRoot>\logs\Cosyflow_log.txt` | Current cosyflow discovery, publishing, and backend communication |
| 6 | `<installRoot>\logs\CWorker_log.txt` | Current worker heartbeat and structured worker errors |
| 7 | `...\ComfyUI\user\comfyui.log` or `comfyui_8288.log` | Optional, version-dependent secondary ComfyUI log |
| 8 | `data\portal.stdout.log` / `portal.stderr.log` | Optional portal process output, only when launch redirection creates it |
| 9 | Rotated, wrapper, `.old`, dated, or legacy logs | Historical comparison; never current health on their own |

`start-portal.ps1` does not promise `portal.stdout.log` or `portal.stderr.log`; their absence is normal.
When redirection is enabled, Flask may place ordinary successful request lines on stderr.

Recent jobs is the user-facing history source. It retains at most 100 privacy-safe manifests for 30 days,
reconciles an interrupted process after restart, and never copies narration or recognized speech into the
durable record. A rejected or quarantined render retains decision evidence but no playable media URL. Raw
ComfyUI history, queue entries, object metadata, and Promptus logs remain backend-only because they can
contain the full prompt, reference data, filenames, identifiers, and local paths.

## What the portal automates

- records a fixed reference prompt with an 11.8-second hard stop, live waveform, safe-window meter, countdown, and immediate quality feedback;
- decodes with Promptus's bundled FFmpeg;
- trims leading and trailing silence;
- converts to mono 24 kHz PCM WAV;
- requires 7–11.8 seconds of usable speech so upstream F5 never truncates the reference;
- verifies microphone speech against the displayed transcript and transcribes uploaded references locally with the cached Whisper verifier;
- installs a fixed-reference `F5TTSAudioAdvanced` cosyflow through Promptus;
- discovers every installed local F5 clone from Promptus metadata, preflights its fixed reference, and presents a searchable voice/variant picker; structurally invalid presets are disabled immediately, and a selected preset is locally transcribed and compared with its sidecar text before any F5 job is admitted (cached by audio and transcript hashes);
- exposes Natural, Poetic, Intense, and Intimate performance presets plus advanced controls;
- submits jobs to the Promptus worker, follows real queue, section, retry, automatic-recovery, and verification progress, and serves only verified ComfyUI output;
- rejects clipped, excessively silent, click-prone, DC-offset, non-finite, or undecodable renders and gives a marginal clipping-only random render one fresh-take retry;
- removes non-spoken Markdown, preserves the spoken words, groups short pasted lines and paragraphs into coherent sections, normalizes every delivered FLAC master (including a one-section job) to about -1 dBFS, and quality-checks it again;
- checks the final master against the intended narration with Whisper's native long-form decoder and refuses delivery above 5% normalized word error or outside a 0.95–1.05 recognized-word ratio, using exact edit/word counts rather than rounded display values; the retired generic 30-second overlap mode is forbidden because it can duplicate recognized passages;
- revalidates and reuses an exact prior fixed-seed master only when model, reference hashes, narration hash, section count, style, controls, file hash, fresh signal checks, and the current word gate all match; random-seed requests always create a new take;
- when a clean master genuinely misses the word gate, checks the saved sections independently, repairs only the failed section once with the same words and performance controls plus a recorded deterministic alternate seed, rebuilds a revisioned master, and reruns every unchanged gate; rejected candidates never receive a media URL;
- serializes installation and generation, and checks ComfyUI's authoritative queue plus the portal lock;
- removes rejected captures immediately, resets and re-locks the capture workflow for a user-triggered retake, expires private job text after six hours, and retains at most 100 privacy-safe result manifests for 30 days so rejected, failed, interrupted, verified, repaired, and listened-to jobs survive a portal restart;
- requires and persists an explicit consent basis at installation and generation submission, records the terminal job result, and keeps the reproducible seed, narration hash, complete controls, output metrics, and optional human listening verdict as acceptance evidence.
- auto-discovers 11 allow-listed Promptus evidence sources, correlates internal Comfy prompt identifiers with sanitized durable job history, and gives system failures a Promptus-native recovery without silently changing voice-performance settings; automatic repair status, hashes, seeds, exact word counts, and gate decisions are durable, while narration, recognized speech, paths, and rejected audio remain private.

## Download the skill

The sidebar carries a **Download skill** button (it moves into the footer below 820 px) that packages
`promptus-clone-voice/` as a zip. The archive is built from the working tree when you click, so it is
always current — there is no build step to forget and no stored artefact to go stale.

The label beside it is a version: a short hash of every packaged file's path and bytes. Edit a script and
it changes; change nothing and it stays the same on any machine. The same value appears in the filename,
so a downloaded archive can be traced back to exactly the source that produced it.

- `GET /api/skill/info` — name, version, file count, size, and the date of the newest packaged file.
- `GET /api/skill/download` — the zip, named `promptus-clone-voice-<date>-<version>.zip`.

Packaging is allow-listed by file type (`.md`, `.py`, `.yaml`, `.yml`, `.json`, `.toml`, `.txt`), so a
recording, cache, or backup that ever lands in the skill directory cannot be distributed by accident. A
test asserts this, and asserts that editing a packaged file changes the version.

## Validation status

The portal is operational. A final in-app-browser generation with `voice-a` deliberately used Markdown and three short pasted fragments. Preflight removed only non-spoken formatting, grouped the fragments into one F5 section, and produced job `4c6806561fd0d04ab11b24a1`: 31.867 seconds, -1.01 dBFS peak, 0% master clipping, 3.05% relative silence, 0% possible clicks, zero DC offset, and 0% normalized word error across 53 intended words. The human listening verdict remains deliberately unset.

Automatic-recovery acceptance used the existing quarantined `voice-a` job `bac3718cef755047705cfd8a`. Its retired overlap verifier had falsely reported 146.13% word error; the guarded in-place recovery regenerated no audio, matched source/master/reference hashes and consent, reran the signal gate, and approved the same 152.482-second master at 3.32% WER and a 0.993 ratio under `whisper_native_long_form_v1`. The in-app browser showed one verified player/download, a single recovery announcement, no horizontal overflow in desktop or 390 px mobile layouts, working dark/light themes, and zero console warnings or errors. Its human listening verdict remains unset.

Installed-reference preflight currently leaves four selectable presets and marks four as needing re-recording. `My Studio Voice` is 12.96 seconds, `Promptus F5 Example Local Voice` is 5.33 seconds, and `Promptus F5 Portal Proof` is 6.08 seconds. `voice-c` passes structural checks but its installed speech disagrees with the sidecar transcript at 47.62% normalized word error (1.048 word ratio), so it is also disabled before generation. This is not a full multi-voice listening acceptance; see [ACCEPTANCE_TEMPLATE.md](ACCEPTANCE_TEMPLATE.md). Discovery alone never counts as voice acceptance.

## Release interface

The Studio uses the audited Promptus application system: the original contour background and logo, deep blue-purple surfaces, cyan status signals, solid amber actions, 8/12/16-pixel radii, and the platform's system UI typography. It includes a derived light theme, keeps the exact Promptus sidebar as its brand anchor in both modes, respects the system preference on first use, persists an explicit choice, supports reduced motion, and retains stage navigation at narrow widths.

Locked stages are genuinely inert, not merely covered by a blur. Style and verdict selections expose pressed state, invalid narration is blocked before submission, generation inputs freeze while a job runs, and a reloaded tab reconnects to an active job. The selected voice, style, customization state, and text length remain visibly pinned during generation.

Every long-running step has visible feedback: a persistent operation HUD, workflow and capture progress, loading buttons, service health, section-aware generation progress, rejected-take metrics in the timeline, final peak/RMS/clipping/word metrics, and dismissible success/error notifications. The UI distinguishes “not started,” “interrupted,” “failed,” “not approved,” and “verified”; generation percentages are derived from backend job state and section events rather than simulated timers. Recent jobs can reopen a quarantined decision or verified master after a process restart without copying narration or recognized speech into durable history.

All processing and stored references remain on this computer. The server binds only to `127.0.0.1`.
Write routes require a token embedded in the locally served page, and downloads are restricted to the
`ComfyUI\output\promptus_voice` tree.

The launcher discovers custom Promptus installations through `%APPDATA%\promptusai\install.json` and checks
Flask, NumPy, and SoundFile in the Promptus Cosy environment. If `F5TTSAudioAdvanced` is unavailable, Studio
installation stops explicitly; use the basic F5 installer described by the skill instead.

## Studio baseline

- `F5TTS_v1_Base`
- Vocos vocoder
- NFE 32
- CFG 2.0
- speed 1.0 (values above 1.0 are slower)
- native F5 timing
- 0.15-second crossfade
- sway sampling -1.0

These match the current upstream-quality baseline. Higher NFE is an optional experiment, not an automatic quality guarantee. Do not use TDHS with ComfyUI-F5-TTS 1.0.26 because its installed implementation can return unscaled samples and severely clip the result.

Cosy worker 0.110 reports its native busy state backwards after a completed job. The portal keeps the endpoint as a reachability and diagnostic signal, exposes the stale flag in `/api/health`, and relies on the ComfyUI queue plus its own one-job lock for safe admission. It does not patch Promptus's installed source.

For delivery QA, use `analyze_f5_audio.py` to reject signal faults and `transcribe_f5_quality.py` to compare the result with the intended words. The word verifier uses `whisper_native_long_form_v1`: Whisper owns long-form segmentation, and the generic pipeline's overlapping `chunk_length_s`/`batch_size` path must not be restored. The portal runs both gates before exposing a download when its local Whisper cache is ready, and refuses signal-only approval when it is missing. These automated checks cannot judge emotional performance, so cadence presets should still be A/B listened to with the same text and seed.
