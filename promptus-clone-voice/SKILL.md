---
name: promptus-clone-voice
description: Create, record, configure, accelerate, diagnose, and verify consented local F5-TTS voice clones in the Promptus desktop app on Windows using a localhost recording portal, Playground, the app-managed Cosy worker, ComfyUI, reusable local cosyflows, and adjustable Studio/Fast/Production/Hero modes. Use when a user asks to clone a voice in Promptus, capture and automatically prepare a reference, install a reusable local voice preset, improve cadence or expression, install or troubleshoot Promptus Audio F5TTS, speed up local narration, diagnose audio jobs or output discovery, or package this workflow for another Windows Promptus user.
---

# Promptus Voice Cloning

Use Promptus-owned services and leave successful output visible under **Comfy Output**. Do not launch replacement ComfyUI or Cosy processes while Promptus owns their lifecycle.

## Safety gate

1. Confirm that the user owns the voice or has the speaker's explicit permission.
2. Ask for confirmation when ownership or consent is unclear.
3. Refuse deceptive impersonation, fraud, harassment, and bypassing voice-authentication systems.
4. Require `--consent-confirmed` before a script installs a voice-specific preset or submits generation.
5. Label shared output as synthetic when a listener could reasonably mistake it for a real recording.
6. Never print base64 audio, API keys, profile tokens, or unrelated account data.

Installing the F5 custom-node dependency alone does not clone a voice. Do not claim that a voice clone exists until a consented reference has been configured and a job succeeds.

## Set the Windows paths

Use Promptus's managed Cosy interpreter. Do not substitute `python` or `py` — on a Promptus machine neither
reliably resolves to a usable interpreter. Discover the install root rather than typing it, so these commands
work for any user on any machine:

```powershell
$PromptusRoot = $env:PROMPTUS_INSTALL_ROOT
if (-not $PromptusRoot) {
    $record = Join-Path $env:APPDATA 'promptusai\install.json'
    if (Test-Path -LiteralPath $record) {
        $PromptusRoot = (Get-Content -Raw -LiteralPath $record | ConvertFrom-Json).installRoot
    }
}
if (-not $PromptusRoot) { $PromptusRoot = Join-Path $env:LOCALAPPDATA 'PromptusAI' }

$PromptusPython = Join-Path $PromptusRoot 'cosy\venv\Scripts\python.exe'
$SkillRoot      = Join-Path $env:USERPROFILE '.codex\skills\promptus-clone-voice'
```

This is the same order the Python helpers use: `PROMPTUS_INSTALL_ROOT`, then `PROMPTUS_USER_DATA\install.json`,
then `%APPDATA%\promptusai\install.json`, then `%LOCALAPPDATA%\PromptusAI`, accepting the first candidate that
contains both `promptusai.exe` and a `cosy` directory. Pass `--root` to any script only for a confirmed custom
installation. Never hard-code a user profile path into this skill or into anything it installs.

## Choose the workflow

- If Promptus, ComfyUI, or Cosy is not running, open Promptus **Server** and start or restart both services there.
- If the F5 nodes may be missing, run the diagnostic, then install dependencies through **Install F5 support**.
- For a reusable voice with editable narration, install a basic cosyflow with a fixed reference pair.
- For microphone capture, automatic silence trimming and reference quality checks, use the local F5 Voice Studio portal.
- For one adjustable advanced preset, install an F5 Studio cosyflow; prefer it over duplicating presets when the Advanced node is available.
- For a reference fixed into three presets, use the one-click mode pack only when `F5TTSAudioAdvanced` is exposed.
- For a non-destructive API test, run `test_promptus_voice.py --dry-run` first.
- For poems, scripts, and other long narration, pass UTF-8 text with `--text-file`; do not embed multiline text in PowerShell.
- Read `references/recreation-analysis.md` for the local architecture, endpoints, and version-specific failure modes.
- Read `references/one-click-modes.md` before installing or distributing fixed-reference modes.
- Read `references/promptus-conventions.md` before generating or renaming a cosyflow, and before resolving any Promptus directory.
- Read `references/reading-promptus-logs.md` before diagnosing from the **Server** screen output; it records
  the current managed log paths, endpoint-first priority, signature-only privacy boundary, and durable
  **Recent jobs** history.
- Read `references/dependencies-and-storage.md` before moving, sharing, or cleaning portal data or optional runtimes.

## Conform to Promptus

Anything installed here sits beside Promptus's own bundled cosyflows and should be indistinguishable from
them. `references/promptus-conventions.md` records the observed conventions, the now-conforming installer
output, and the legacy titles that may still be installed; the essentials:

- Titles are `(cosy) Promptus: <Name>`, with variants in square brackets. Keep them ASCII — Promptus derives
  the on-disk filename from the title.
- `category` is `Promptus/Cosy/Audio`. `tags` is exactly two: media, then task. `description` is one short
  sentence.
- Never hard-code `models\cosyflow`. Promptus declares the installed-cosyflow directory per backend in
  `models\<backend>_models\cosy.json` as `COSY.COSYFLOW_LOCAL_DIR`; on the diagnosed machine it resolves to
  `models\comfy_models\cosyflow` and `models\cosyflow` does not exist. Read only that file's `COSY` section —
  the other sections hold account numbers and provider API keys.
- Treat `find_cosyflow(get_cosyflows(...), title)` as the authoritative collision test. Cosy writes the file
  itself through `/api/cosy/install-local`, so a wrong local path fails silently rather than loudly.
- Fixed references belong in `ComfyUI\input\F5-TTS\`, never the input root, which fills with the worker's
  extensionless `cosy_<hash>_<n>_image` uploads.
- Promptus already ships `(cosy) Promptus: Kokoro TTS` and `(cosy) Promptus: Zonos TTS`. Choose F5 because
  the user wants a specific consented voice cloned from a reference, and say so rather than implying F5 is
  the only local speech option.

## Diagnose first

Start with live PManager `/status` and ComfyUI `/queue` and `/object_info`, then correlate the relevant
Promptus **Server** output. The stream states the worker version, ComfyUI version, VRAM ceiling, whether
`comfyui-f5-tts` imported, which local cosyflow directory Cosy watched, and which presets it considers
available. `references/reading-promptus-logs.md` decodes it, including the
`model_loader_inputs` warnings that this skill's own presets provoke and that are benign. The token-protected
`POST /api/log-diagnostics` route is read-only and signature-only: use it to classify auto-discovered evidence,
optionally for one `job_id`, never to expose raw logs or to restart or alter Promptus.

Then run the read-only diagnostic:

```powershell
& $PromptusPython "$SkillRoot\scripts\diagnose_promptus_voice.py"
```

For the mode pack, require the advanced node explicitly:

```powershell
& $PromptusPython "$SkillRoot\scripts\diagnose_promptus_voice.py" --require-advanced
```

Treat exit code `0` as ready and exit code `2` as a prerequisite or service failure. A missing advanced node is not a blocker for the basic reusable cosyflow.

Use PManager's native local status endpoint when the UI is unavailable:

```powershell
& $PromptusPython "$SkillRoot\scripts\manage_promptus_services.py" --status
```

To restart idle ComfyUI through PManager itself, inspect first, then run without `--dry-run`:

```powershell
& $PromptusPython "$SkillRoot\scripts\manage_promptus_services.py" --restart-comfyui --dry-run
& $PromptusPython "$SkillRoot\scripts\manage_promptus_services.py" --restart-comfyui
```

The restart script refuses a non-empty ComfyUI queue and waits for PManager plus `F5TTSAudio` to become ready.

## Install F5 support

The supported Promptus catalogue title is `(cosy) Promptus: Audio F5TTS`; its dependency is `comfyui-f5-tts`.

Inspect without writing:

```powershell
& $PromptusPython "$SkillRoot\scripts\install_f5tts_cosyflow.py" `
  --voice-name 'My Voice' `
  --reference-audio 'C:\absolute\voice-reference.wav' `
  --reference-text-file 'C:\absolute\voice-reference.txt' `
  --dry-run
```

If the dry run reports `F5TTSAudio` missing, install the dependency through the active Promptus Cosy worker:

```powershell
& $PromptusPython "$SkillRoot\scripts\install_f5tts_cosyflow.py" `
  --voice-name 'My Voice' `
  --install-dependencies `
  --consent-confirmed
```

After dependency installation, restart **ComfyUI** from Promptus **Server** and rerun the diagnostic. Do not start ComfyUI directly from its Python entry point.

If diagnostics report that TorchCodec cannot load, inspect the safe compatibility plan and apply it:

```powershell
& $PromptusPython "$SkillRoot\scripts\patch_f5_torchcodec_compat.py" --dry-run
& $PromptusPython "$SkillRoot\scripts\patch_f5_torchcodec_compat.py"
```

This keeps TorchAudio as the first choice and uses the package's installed `soundfile` dependency only when TorchCodec cannot load Promptus's missing shared FFmpeg DLLs. It creates a timestamped backup. Restart ComfyUI through Promptus after applying it.

## Install a reusable basic cosyflow

After `F5TTSAudio` is active, inspect and install:

```powershell
& $PromptusPython "$SkillRoot\scripts\install_f5tts_cosyflow.py" `
  --voice-name 'My Voice' `
  --reference-audio 'C:\absolute\voice-reference.wav' `
  --reference-text-file 'C:\absolute\voice-reference.txt' `
  --dry-run

& $PromptusPython "$SkillRoot\scripts\install_f5tts_cosyflow.py" `
  --voice-name 'My Voice' `
  --reference-audio 'C:\absolute\voice-reference.wav' `
  --reference-text-file 'C:\absolute\voice-reference.txt' `
  --consent-confirmed
```

The installer:

- reads Promptus's bundled, version-matched F5 cosyflow;
- copies the consented reference and exact transcript to `ComfyUI\input\F5-TTS` with matching basenames;
- fixes that reference into the preset because worker `0.110` cannot preserve F5's required extension-plus-sidecar pair during dynamic upload conversion;
- exposes the node's model choice as `f5_model` to distinguish it from application-level model selectors;
- replaces `PreviewAudio` with `SaveAudio` for persistent output;
- installs through `POST /api/cosy/install-local`;
- refuses replacement unless `--force` is supplied, and backs up the existing local file — resolved from
  `COSY.COSYFLOW_LOCAL_DIR`, not assumed — before replacement.

Restart **Cosy** from Promptus **Server** after installation.

## Prepare a reference

Use one clean, consented speaker with little room echo, no music, and no overlapping speech. Prefer 7–11.8 seconds of usable WAV speech and an exact UTF-8 transcript with the same basename and a `.txt` extension. Installed F5 1.1.22 truncates longer references near 12 seconds; never pair that truncated audio with the original full transcript. Reject a gross duration/transcript mismatch instead of guessing the words.

Do not silently substitute speakers. If several samples exist, choose the cleanest single-speaker clip and state the choice.

Store the reference below the node's `target_rms`. F5 boosts it back to target for inference and then scales the output by `rms / target_rms`, so that ratio is the pipeline's only clipping headroom: a reference at exactly 0.1 gets none, and anything louder is amplified. The portal stores 0.05, which buys 6 dB.

Audit the installed references before trusting an existing voice — the portal only applies these rules to references it captures, so anything installed earlier keeps whatever it was given, and neither the cosyflow nor Promptus's catalogue reveals it:

```powershell
& $PromptusPython "$SkillRoot\scripts\audit_voice_references.py"
& $PromptusPython "$SkillRoot\scripts\audit_voice_references.py" --repair
```

It is read-only without `--repair`, and exits non-zero when any reference needs attention. `--repair` re-levels behind a timestamped backup and never touches duration: an over-length reference has already been truncated away from its transcript, so it must be re-recorded or the preset retired with `POST /api/cosy/uninstall-local`. Verify each re-levelled voice with one render, because F5's edge trim uses absolute dB thresholds.

## Use the F5 Voice Studio portal

Start it from wherever the portal project was checked out, adjusting only the first line:

```powershell
Set-Location '<path-to>\portal'
.\start-portal.ps1
```

It opens `http://127.0.0.1:8765` and binds only to localhost. Keep Promptus, ComfyUI, Cosy, and CWorker running. The portal:

- records the fixed displayed prompt and stops at 11.8 seconds, below F5's automatic truncation boundary;
- uses Promptus's bundled FFmpeg to create mono 24 kHz PCM WAV;
- trims boundary silence and enforces 7–11.8 seconds of usable speech;
- scores duration, speech activity, estimated noise, level, and clipping;
- preserves the displayed prompt for microphone capture and locally transcribes uploaded references with the cached Whisper verifier;
- requires explicit consent before installation and generation, recorded as a structured basis — either that the user is the speaker or that they hold the speaker's explicit permission — and persisted with the reference hash rather than kept as a bare checkbox;
- installs through Cosy's native `/api/cosy/install-local` route;
- discovers every installed fixed-reference F5 cosyflow from Promptus metadata and presents a searchable voice/variant list, including conforming and retained legacy presets, without requiring another recording; it structurally preflights every reference and locally compares a selected reference with its sidecar transcript before admitting generation, caching that result by both content hashes;
- generates through the app-managed worker and verifies persistent ComfyUI audio;
- admits only one voice job at a time and refuses submission while ComfyUI's authoritative queue is busy;
- uses one fail-closed verifier for every generated section and the final downloaded master;
- rejects clipping, DC offset, excess silence, possible click artifacts, non-finite samples, invalid metadata, or a verifier dependency failure;
- gives only a marginal clipping-only render at random seed `-1` one fresh-take retry; fixed seeds, other flags, and clipping above 0.05% fail immediately;
- verifies the final master against the intended narration with local Whisper and refuses delivery above 5% normalized word error or outside a 0.95–1.05 recognized-word ratio, using exact edit and word counts so rounded display values cannot cross a boundary incorrectly;
- removes non-spoken Markdown without changing spoken words, groups short pasted lines and paragraphs into coherent bounded sections, renders them sequentially, and assembles a verified FLAC master;
- removes rejected capture folders immediately, expires private job text after six hours, and keeps at most 100 privacy-safe result manifests for 30 days; these retain hashes, controls, metrics, rejection evidence, and listening verdicts across a portal restart but never copy narration or recognized speech;
- requires a per-process local request token for writes and serves media only when a completed job carries an explicit `verified_master`/`delivery_approved` decision; directory membership alone cannot expose a quarantined file.

The installed Studio flow defaults to `F5TTS_v1_Base`, Vocos, NFE 32, CFG 2.0, speed 1.0, native `F5TTS` timing, crossfade 0.15, and sway -1.0. The portal offers four modes, all at NFE 32, crossfade 0.15, sway -1.0 and native timing: Natural (speed 1.0, CFG 2.0), Poetic (1.07, 2.0), Intense (1.04, 2.2) and Intimate (1.10, 1.9). It initially selects Poetic; Natural returns the controls to speed 1.0. In this node, values above speed 1.0 are slower. Expression still comes primarily from the speaker's reference performance and punctuation; do not claim that a preset can manufacture theatrical emotion from a flat reference.

Cosy worker 0.110 has an inverted `Job.is_running()` implementation: completed jobs can keep `/api/generate/is-busy` true while active jobs can report false. The portal therefore exposes that raw value only as a diagnostic and uses the ComfyUI queue plus its local one-job lock for admission. Do not patch the user's installed Promptus source to work around this.

Do not use the `TDHS` tempo method with ComfyUI-F5-TTS 1.0.26. Its installed stretch path returns int16-scale samples without restoring float scale, producing severe clipping. Use native `F5TTS` timing; `torch-time-stretch` is an explicit fallback only.

For a prepared reference without the portal, install the same adjustable Studio flow directly:

```powershell
& $PromptusPython "$SkillRoot\scripts\install_f5tts_studio.py" `
  --voice-name 'My Voice' `
  --reference-audio 'C:\absolute\voice-reference.wav' `
  --reference-text-file 'C:\absolute\voice-reference.txt' `
  --consent-confirmed
```

## Generate in Playground

1. Confirm ComfyUI and Cosy are running on the Promptus **Server** screen.
2. Open **Playground**, switch to **Local**, and select the intended `(cosy) Promptus: Local Voice <Name>` model or its `[Studio]`/mode variant.
3. Expand **Model & Options**.
4. Confirm the fixed consented reference named by the preset.
5. Enter or approve the editable narration.
6. Start with F5, `vocos`, speed `1.0`, and a randomized seed.
7. Generate with the button associated with the dynamic local-model form.
8. Wait for the app-managed job; the first uncached render may be slow.
9. Verify that the saved result appears and plays under **Comfy Output**.

The browser/app UI is the delivery surface. Endpoint checks are diagnostic evidence, not a substitute for the app-native result.

## Install one-click modes

Only use this path when the advanced diagnostic passes. This Promptus build's bundled snapshot may expose only the basic node; the installer must stop rather than mislabel simple presets as NFE/guidance modes.

```powershell
& $PromptusPython "$SkillRoot\scripts\install_f5tts_mode_pack.py" `
  --voice-name 'My Voice' `
  --reference-audio 'C:\absolute\voice-reference.wav' `
  --reference-text-file 'C:\absolute\voice-reference.txt' `
  --dry-run
```

Install only after reviewing the plan and confirming consent:

```powershell
& $PromptusPython "$SkillRoot\scripts\install_f5tts_mode_pack.py" `
  --voice-name 'My Voice' `
  --reference-audio 'C:\absolute\voice-reference.wav' `
  --reference-text-file 'C:\absolute\voice-reference.txt' `
  --consent-confirmed
```

Restart Cosy from Promptus Server after installation. Use `--force` only when replacement is intentional; the installer creates timestamped backups.

## Smoke-test an installed basic voice

Run a dry run first. It validates the model title and dynamic fields without submitting audio:

```powershell
& $PromptusPython "$SkillRoot\scripts\test_promptus_voice.py" `
  --model-title '(cosy) Promptus: Local Voice My Voice' `
  --text 'This is a short synthetic test.' `
  --dry-run
```

Submit only with consent:

```powershell
& $PromptusPython "$SkillRoot\scripts\test_promptus_voice.py" `
  --model-title '(cosy) Promptus: Local Voice My Voice' `
  --text 'This is a short synthetic test.' `
  --consent-confirmed
```

For multiline narration:

```powershell
& $PromptusPython "$SkillRoot\scripts\test_promptus_voice.py" `
  --model-title '(cosy) Promptus: Local Voice My Voice' `
  --text-file 'C:\absolute\narration.txt' `
  --consent-confirmed
```

The smoke test never prints the narration or encoded audio. It polls Cosy for advisory progress, treats ComfyUI history as authoritative, emits 15-second elapsed/queue heartbeats for long jobs, resolves the persistent output path, and runs `promptus_audio_quality.py`. Missing NumPy/SoundFile, decode errors, or signal flags fail the job closed. It separately reports whether Promptus's media database has indexed the output. A delayed media index is a UI-discovery warning, not a generation failure.

### Where generations go, and when they appear in the app

Write persistent audio to `ComfyUI\output\promptus_voice\<voice>\` with a `SaveAudio` node. That is the tree
Promptus indexes for **Comfy Output**, and it is why every installer here replaces the bundled flow's
`PreviewAudio` — which only writes ComfyUI's `temp` directory and is never persisted or indexed.

The index lives in `comfy_output.db` at the install root and is written **only by the Promptus desktop
app**, never by Cosy, ComfyUI, or PManager. The app performs a recursive sync of the whole output tree when
it launches, and watches for new files while it runs. So:

- Generating while the desktop app is **closed** leaves output correctly saved but unindexed. It appears as
  soon as the app is opened, because the startup sync is recursive and picks up the whole backlog.
- Restarting ComfyUI or Cosy from the **Server** screen does not index anything; only launching the app does.
- Tell the user this rather than reporting a failure. `promptus_indexed: false` means "not ingested yet".

Never write to `comfy_output.db`. The app owns it, enforces `UNIQUE` on both the relative path and an MD5 of
the contents, and deletes rows whose file is missing. A file whose basename starts with `cosy_` is excluded
by design, so never name output that way. Because the hash is unique, a fixed-seed rerun that reproduces an
earlier take byte-for-byte indexes only once — that is deduplication, not a lost render.

**Comfy Output** and cloud **My Collection** are separate stores, not two views of one: the collection side
lives in `promptus-sqlite.db` with its own tables and inlines audio as base64. Do not claim a local render
has been added to a collection.

Do not approve a voice merely because a file was saved. Run `analyze_f5_audio.py` on every delivery candidate and reject clipping, DC offset, silence, long-gap, or click flags. Use `transcribe_f5_quality.py` with a local Whisper cache for word evidence; it reports and never enforces, always exiting 0, so apply the threshold yourself — the portal refuses a master above 5% normalized word error or outside a 0.95–1.05 recognized-word ratio, and a CLI check should hold the same line rather than reading a report and calling it a pass. The verifier strategy is `whisper_native_long_form_v1`: call the pipeline with `return_timestamps=True` and let Whisper own long-form segmentation. Do not restore generic `chunk_length_s` or `batch_size` overlap chunking; on long rhythmic speech it can duplicate recognized passages and manufacture triple-digit WER. The report includes substitution, deletion, insertion, and total normalized edit counts without printing recognized speech. For long narration, use those counts and section evidence to diagnose a rejection; interpret WER as a fail-closed delivery gate and diagnostic, not a perfect human-listening score.

Always give the user a short A/B set using the same text and seed when tuning cadence. Compare Natural (`speed=1.0`, CFG 2.0), Poetic (`speed=1.07`, CFG 2.0), and, when useful, tighter guidance (`speed=1.04`, CFG 2.2). Report the measured duration, clipping, word accuracy, and voice-match proxy, but ask the user to choose by listening because objective signal metrics cannot certify emotional performance.

## Repair from evidence

- Services unreachable: start or restart them through Promptus **Server**.
- `F5TTSAudio` missing: install the catalogued dependency, restart ComfyUI, and rerun diagnostics.
- `F5TTSAudioAdvanced` missing: use the basic flow; do not invent NFE/guidance controls.
- `Could not load libtorchcodec`: run `patch_f5_torchcodec_compat.py --dry-run`, apply it, and restart ComfyUI through PManager. Promptus's bundled static FFmpeg executable does not satisfy TorchCodec's shared-DLL requirement.
- Reference rejected: confirm the file type, transcript encoding, and exact input-directory filename.
- Microphone words rejected: invalidate the take and keep Install locked. Preserve the displayed transcript, focus a user-triggered retake action, and never silently replace the declared words or start the microphone automatically.
- Installed voice needs re-recording: do not render around it. The selected-reference preflight has proved that its audio and sidecar text disagree or that its duration is unsafe; re-record 7–11.8 seconds with the exact words, then reinstall the preset.
- Cosyflow exposes `sample`: reinstall it as a fixed-reference preset; worker `0.110` writes dynamic uploads without the extension and transcript sidecar F5 requires.
- Queue busy: wait or cancel through Promptus; do not submit competing jobs.
- Master word rejection: first recheck the existing clean master with `whisper_native_long_form_v1`. If it still fails, verify the saved sections, render only a failed section once with the same words/style/settings and a recorded alternate seed, then rebuild and rerun the unchanged signal and word gates. Never lower the thresholds, expose a rejected candidate, or silently switch the user's performance preset.
- Exact fixed-seed repeat: a prior master may be reused only after exact model/reference/narration/section/style/control fingerprint matching, current file-hash verification, fresh signal checks, and the current word gate. A random seed always requests a new take.
- Output completes but is absent: confirm the cosyflow uses `SaveAudio` and preserves ComfyUI `type`, `subfolder`, and filename.
- Local model absent: restart Cosy and query `/api/generate/get-cosyflows` before touching vendor files.
- Cosy reports `complete` but no output exists: treat ComfyUI `/history/<prompt_id>` as authoritative. The smoke-test script now rejects a failed history record even if worker `0.110` says complete.
- Portal says **Audio created — not approved**: synthesis completed but a delivery gate rejected the master. Open **Recent jobs** for the retained hash, signal metrics, exact word-error counts, issue stage, and recovery. Do not expose the quarantined master, loosen the threshold, or call this a ComfyUI crash.

## Hand-off

Report the selected cosyflow, reference duration and format, narration or its editable status, output duration/format/location, local versus external inference, selected mode and parameters, and any workaround tied to the installed worker version. Do not share the reference audio unless requested.
