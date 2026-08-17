# Promptus F5-TTS recreation analysis

## Contents

- Local architecture
- Supported service API
- Observed F5 schema
- Installation sequence
- Persistent output
- Failure modes
- Consent and data handling

## Local architecture

The diagnosed Windows installation stores its discovery record at `%APPDATA%\promptusai\install.json`. The `installRoot` value points to `%LOCALAPPDATA%\PromptusAI` on the tested machine.

Important derived paths:

| Purpose | Path under `installRoot` |
|---|---|
| Promptus Python | `cosy\venv\Scripts\python.exe` |
| Worker | `cosy\promptus\worker.py` |
| ComfyUI root | `cosy\comfyui\ComfyUI` |
| Input | `cosy\comfyui\ComfyUI\input` |
| Engine output | `cosy\comfyui\ComfyUI\output` |
| Local cosyflows | declared by `COSY.COSYFLOW_LOCAL_DIR`; `models\comfy_models\cosyflow` on the tested machine |
| Backend config | `models\<backend>_models\cosy.json` |
| Bundled F5 flow | `cosy\promptus\cosyflow\promptus_audio_f5tts.cosy` |

`models\cosyflow` is only the fallback default in `cosy\promptus\config.py` and does not exist on the tested
machine. Resolve the directory from the backend config, reading its `COSY` section only — the other sections
hold account numbers and provider API keys. Confirm against Cosy's startup line
`Got N from local cosyflow directory <path>`. See `promptus-conventions.md`.

Use the Python interpreter above. The tested system has a `py` launcher but no registered Python, and `python` is not on `PATH`.

Promptus owns the process lifecycle. Start and restart ComfyUI and Cosy through the app's **Server** screen.

## Supported service API

Default addresses:

| Service | Address |
|---|---|
| ComfyUI | `http://127.0.0.1:8288` |
| Cosy worker | `http://127.0.0.1:8190` |
| PManager control/status | `http://127.0.0.1:7412` |

Useful read routes:

- ComfyUI: `/queue`, `/system_stats`, `/object_info/<node>`, `/history/<prompt_id>`
- Cosy: `/api/generate/get-info`, `/api/generate/is-busy`, `/api/generate/get-cosyflows`, `/api/generate/get-cosyflow-variables/<title>`, `/api/generate/progress/<prompt_id>`, `/api/generate/get-models`, `/api/generate/get-loras`

Supported write routes used by the scripts:

- `POST /api/cosy/install-dependencies/<title>`
- `POST /api/cosy/install-local` with `{ "cosyflow": ... }`
- `POST /api/generate` with the route key `cosyflow`, the selected cosyflow title, and its public variables

Four more worker routes are relevant and currently unused by this skill:
`/api/cosy/uninstall-local` removes an installed local cosyflow — use it to retire a superseded voice preset
instead of deleting the file behind Cosy's back; `/api/generate/cancel/<prompt_id>` cancels a submitted job;
`/api/cosy/create` and `/api/cosy/share` cover authoring and publishing and are out of scope here.

`get-cosyflows` is the whole catalogue, not just what runs today. Each entry carries `title`, `uid`,
`category`, `tags`, `description`, `custom_node_dependencies`, `external_model_dependencies`, and
`install_status` — `INSTALLED` when every dependency is present, `INSTALLABLE` otherwise. On the tested
machine that was 208 entries, 53 installed when last measured (2026-08-15) — the count moves as cosyflows and
their dependencies are installed, so read it live rather than quoting this number. The catalogue is assembled
purely from the two on-disk directories;
no worker route queries a remote Promptus catalogue, so nothing appears there that is not already bundled or
locally installed. Filter on `install_status` before telling a user a cosyflow is available to run.

PManager exposes its own local lifecycle routes on the diagnosed build. `GET /status` reports `comfyui`, `cosy`, and `cworker`. `GET /stop-pmanager-comfyui-server` followed by `GET /run-pmanager-comfyui-server` performs the same app-owned ComfyUI lifecycle used by the Server panel. Confirm the ComfyUI queue is empty before restarting, and poll `/status` plus the service endpoint afterward. Never reproduce PManager's process command line because it contains account credentials.

Use `manage_promptus_services.py` rather than rebuilding this sequence. Use `test_promptus_voice.py --text-file` for multiline narration; it keeps content out of shell history and verifies the saved output directly from authoritative ComfyUI history.

Worker `0.110` returns HTTP `201` for many successful GET and POST responses. Accept both `200` and `201` from Cosy. An unknown progress ID returns its standard error response rather than proving the route is unavailable.

## Observed F5 schema

The Promptus catalogue contains `(cosy) Promptus: Audio F5TTS`, with dependency `comfyui-f5-tts`. Before installation it reports `INSTALLABLE`.

The bundled basic-node schema contains:

| Input | Meaning | Observed values/default |
|---|---|---|
| `sample` | Uploaded reference audio | audio upload |
| `speech` | Narration | multiline string |
| `seed` | Reproducibility | `1`; `-1` random |
| `model` | F5 model family | F5, language variants, E2 |
| `vocoder` | Decoder | `vocos`, `bigvgan` |
| `speed` | Pace | `1.0`; higher is slower |
| `model_type` | Checkpoint generation | live enum; `F5TTS_v1_Base` is the observed default |

After app-managed package installation, the active build exposes `F5TTSAudioAdvanced`. Its quality controls such as `nfe_step`, `cfg_strength`, target RMS, and cross-fade are optional inputs. Always query both the required and optional live `/object_info` sections; do not assume they exist on another package version.

## Installation sequence

1. Start ComfyUI and Cosy through Promptus.
2. Run the read-only diagnostic.
3. Invoke the catalogued dependency installer when the basic F5 node is absent.
4. Restart ComfyUI through Promptus so it imports the custom node.
5. Rerun the diagnostic.
6. Generate and install a local cosyflow through the Cosy worker.
7. Restart Cosy so Playground reloads local cosyflows.
8. Run a dry smoke test, then one consented generation.

Do not copy a Git repository into `custom_nodes` when Promptus can install the catalogue dependency itself.

## Persistent output

Promptus's bundled F5 flow uses `PreviewAudio`, which writes to ComfyUI's `temp` directory: the result is
audible once in the Playground and is never persisted or indexed. The reusable installers replace it with
`SaveAudio` and a stable `filename_prefix` of `promptus_voice/<voice>/<Variant>`, so output lands under
`ComfyUI\output\promptus_voice\` where Promptus can find it. Verify the history/output view reports
`type: output`, and confirm the item is visible in **Comfy Output**.

### How Promptus indexes Comfy Output

Two SQLite databases sit at the install root and are **not** interchangeable:

| Database | Table | Holds | Written by |
|---|---|---|---|
| `comfy_output.db` | `media` | The **Comfy Output** gallery: one row per file discovered on disk | The Electron desktop app only |
| `promptus-sqlite.db` | `momm*` | Chat-assistant history and collections, with audio inlined as base64 | The app's chat/collection features |

Local **Comfy Output** and cloud **My Collection** are therefore genuinely different systems, not two views
of one store. `media.in_collection` is the only bridge.

The index is maintained exclusively by the desktop app, logging under `[ComfyDB]`. Neither Cosy, ComfyUI,
nor PManager ever writes it — verified by searching the worker sources, which contain no reference to it.
The app maintains it two ways:

- `synchronizeDatabase()` at app start walks the output tree **recursively**, inserts every file not already
  present, and deletes rows whose file has disappeared.
- A `chokidar` watcher created with `ignoreInitial: true` catches files added **while the app is running**.

A file is indexed when its extension is allow-listed — audio accepts `.mp3 .wav .ogg .flac .aac .m4a` — and
its basename does **not** start with `cosy_`, which deliberately excludes the worker's own extensionless
uploads. Both `name` and `hash` are `UNIQUE`, and `hash` is an MD5 of the file contents, so two byte-identical
renders index only once: a fixed-seed rerun that reproduces an earlier take exactly will not add a second row.

The consequence that matters in practice: **generating while the desktop app is closed leaves output
unindexed until the app is next opened**, because the watcher is not running and no startup sync has occurred.
Nothing is lost — the recursive sync picks the whole backlog up on the next launch. Measured 2026-08-15:
162 audio files under `promptus_voice\`, 1 indexed, because the app had last run on 2026-08-11 while
ComfyUI and Cosy stayed up under PManager. Restarting ComfyUI or Cosy from the **Server** screen does not
trigger a sync; only launching the app does.

### What correlates a generation to its file

Playground and this portal take the **same path**. Both call Cosy `/api/generate` with a cosyflow title;
Cosy injects the public variables into that graph and submits it to ComfyUI, which returns a `prompt_id`.
The difference is never the route — it is only which save node the chosen cosyflow contains.

| Boundary | What carries the correlation |
|---|---|
| Client → Cosy | the cosyflow `title` selects the graph; public variables are injected into it |
| Cosy → ComfyUI | ComfyUI's `prompt_id`, authoritative in `/history/<prompt_id>` |
| ComfyUI → disk | the save node's `filename_prefix`, surfacing as `subfolder` + `filename` + `type: output` |
| disk → index | the path relative to the output root (`media.name`) and an MD5 of the bytes (`media.hash`) |
| index → collection | `media.in_collection`, the only bridge between the two databases |
| anything → `momm*` | **nothing.** The collection database is disjoint from ComfyUI output |

Verified 2026-08-15 on a live job: history reported `subfolder='promptus_voice\voice-a'`, `type=output`, and the
file appeared in `media` under `promptus_voice/voice-a/…`. The `momm*` database was untouched by generation,
by indexing, and by signing in — its file had not been written since 2026-07-30, and no row in it references
a ComfyUI path.

### The web Studio drives the same local services

Promptus's web Studio (`login.promptus.ai/pwa_demo`) is a browser client with two independent modes, and
the local one is the same route this skill uses.

Observed live on 2026-08-15 while signed in: the page repeatedly issues
`GET http://localhost:7412/status` — PManager — to discover whether a local install is running. That
endpoint answers `Access-Control-Allow-Origin: *` and returns the local service URLs
(`comfyui → :8288`, `cosy → :8190`, `cworker`). Cosy in turn answers a request carrying
`Origin: https://login.promptus.ai` with exactly that origin echoed back in `Access-Control-Allow-Origin`,
and ComfyUI answers `*`. The web page is therefore *designed* to call the local worker directly from the
browser; Cosy's allow-list naming the web origin is deliberate, not incidental.

| Mode | Where compute happens | Where results go | Costs credits |
|---|---|---|---|
| Cloud | Promptus servers, hosted models (e.g. Seedream 4.5) | Promptus cloud account | Yes |
| Local | This machine's GPU via Cosy and ComfyUI | `ComfyUI\output\`, then the media index | No |

So the web Studio in local mode, the desktop Playground, and this project's portal are all **the same class
of client** hitting the same Cosy `/api/generate` route with the same cosyflows, landing in the same output
tree and the same `comfy_output.db`. Nothing here is a parallel or competing pipeline.

One diagnostic worth knowing: when the `localhost:7412` probe is blocked — a sandboxed frame, a blocking
extension, mixed-content policy, or PManager simply not running — the web app fails that request silently
and falls back to cloud-only models. A user reporting "the web app cannot see my workflows" is usually
describing a blocked local probe, not a broken install. Confirm with PManager `/status` directly before
looking anywhere else. (This was observed from a sandboxed pane, where the probe failed with
`ERR_BLOCKED_BY_CLIENT` and only cloud models were offered; a local generation driven from the web UI was
therefore not exercised end to end.)

**Signing in is orthogonal to this pipeline.** Local F5 voice cloning needs no Promptus account session.
Every render in this project was produced while the desktop app was closed entirely, and signing in
afterwards changed nothing that generation depends on: measured 2026-08-15, the cosyflow catalogue stayed at
208 entries / 53 installed, the `momm*` database was not written, and the only file touched under the
install root in the following hour was `comfy_output.db`. No worker route fetches a remote catalogue, so an
account gains no local cosyflows. The desktop app keeps its authenticated session and cloud-side state in
Electron's IndexedDB under `%APPDATA%\promptusai`, which is separate from both SQLite databases — never read
it, as it holds session material.

Practical consequence: never tell a user to sign in to fix a local F5 problem, and never treat a signed-out
state as a diagnosis. The one thing the app must be doing is *running*, and that is for indexing, not
authentication.

**The index stores no provenance for audio.** `addFileToDatabase` populates `model`, `prompt`, `seed` and
`params` only when `dataType === 'image'`, reading them from PNG metadata. Measured across all 178 audio
rows: every one of those four columns is `NULL`. Comfy Output therefore cannot say which voice, seed, or
settings produced a render — **the file path is the only provenance the app retains**, which is exactly why
the `promptus_voice/<voice>/<Variant>` prefix is load-bearing rather than cosmetic. Full provenance
(seed, controls, reference hashes, narration hash, consent basis, verdict) exists only in this project's own
job records, so never point a user at Comfy Output to recover the settings behind a take.

Never write to `comfy_output.db` from this skill. The app owns it, enforces uniqueness on two columns, and
deletes rows it considers orphaned, so an injected row is at best redundant and at worst removed or
conflicting. Read it if useful — `test_promptus_voice.py` opens it `mode=ro` to report `promptus_indexed` —
and treat a `false` there as "the app has not ingested this yet", not as a generation failure.

## Failure modes

- Connection refused on `8190` or `8288`: the services are stopped; use Promptus Server.
- F5 catalogue entry exists but node is absent: install dependencies, then restart ComfyUI.
- Package installed but object info absent: inspect the app-managed startup log for import errors.
- Advanced mode installer stops: the active package version does not expose a compatible advanced schema.
- A client submits `model` instead of `cosyflow`: worker `0.110` cannot select the cosyflow. Use `cosyflow` for routing; a generated preset may expose the F5 node's own model input as `f5_model` for clarity.
- A cosyflow exposes a dynamic `sample` upload: worker `0.110` decodes it to an extensionless file and does not create the matching transcript sidecar required by F5's disk loader. Copy the `.wav` and exact same-basename `.txt` into `ComfyUI\input\F5-TTS` and fix that relative filename into the preset.
- Output succeeds but is not discoverable: use `SaveAudio` and preserve the returned filename, subfolder, and type.
- Existing preset differs: stop unless replacement is explicit; retain the timestamped backup.
- `Could not load libtorchcodec`: Torchaudio 2.9+ routes decoding through TorchCodec, while the diagnosed Promptus build has a static FFmpeg executable but not the shared FFmpeg DLLs TorchCodec loads. Use `patch_f5_torchcodec_compat.py`; it retains TorchAudio first and falls back to installed SoundFile only for this exact runtime error.
- Cosy progress says complete but ComfyUI history says error: the worker's completion flag is not authoritative on failure. Require ComfyUI history `status_str=success`, `completed=true`, and non-empty output metadata.
- Render clips at exactly 0 dBFS with a clean, unclipped reference: the model's raw output exceeded full
  scale and was clamped at the int16 write. F5's only output headroom is its own attenuation
  (`generated_wave * rms / target_rms` in `utils_infer.py`), applied ONLY when the stored reference is
  quieter than the node's `target_rms` (0.1). A reference normalized to exactly 0.1 removes all headroom,
  and projected, high-energy voices then clip while soft voices pass by luck. Store references at RMS 0.05
  (the portal now does); scaling an installed sub-0.1 reference down is near-invariant for the voice because
  the node boosts it back to target for inference — only "near", since F5's pydub edge trim uses absolute dB
  thresholds, so re-level with a timestamped backup and verify with one render. Measured 2026-08-15: the
  hottest installed voice clipped 0.07% at reference RMS 0.08 and passed at 0.06. A repaired 0.05 RMS,
  7.52-second `voice-a` reference then produced a 2026-08-15 live master with 0% clipping and 0% normalized
  word error; its marginal second section was rejected once and approved on the bounded fresh-take retry.
  That run demonstrates the repaired path end to end, but it used ad-hoc narration rather than the
  acceptance fixture, so it is engineering evidence and not voice acceptance — see `ACCEPTANCE_TEMPLATE.md`,
  which is the authority on which voices are accepted and records `voice-a` as still pending.
- A voice installed before the current capture rules still carries the old defect. The portal only applies
  the level and length rules to references it captures, so presets installed earlier keep whatever they were
  given, and neither Promptus's catalogue nor the cosyflow shows it. Audit the directory itself with
  `audit_voice_references.py`; `--repair` re-levels behind a timestamped backup. Measured 2026-08-15 across
  eight installed presets: two legacy references sat above the node target (0.1289 and 0.1131 RMS, so F5
  amplified their output by 2.20 and 1.07 dB and left no headroom at all), and one preset installed the same
  day held a 12.96-second recording — the same over-length fault that broke `voice-a`. Level is recoverable
  arithmetic and was repaired; length is not, because F5 has already truncated the audio away from its
  transcript, so an over-length reference must be re-recorded or the preset retired with
  `POST /api/cosy/uninstall-local`.
- Reference signal checks pass but generated words repeat or drift: compare the reference itself with its
  stored transcript. The diagnosed `voice-a` preset had 95.24% normalized reference word error because a
  different 12.96-second recording was paired with the displayed prompt text. Repair or rerecord below
  11.8 seconds, create an exact local transcript, reinstall with a backup, and require the master word gate.
- Cosy logs `model_loader_inputs: warning: old and new tests disagree` for an installed voice preset: benign. `F5TTSAudioAdvanced` is absent from the worker's `text_class_types` allowlist while `F5TTSAudio` is present, so a retired heuristic flags every string input on the advanced node. The effective test classifies them correctly. See `reading-promptus-logs.md`.
- Cosy logs `install would exceed maximum models size`: the backend is at its `MAXIMUM_MODELS_SIZE` budget. It blocks new model downloads for other cosyflows and does not affect F5 voice cloning, which needs no new weights. Keep any ASR cache outside `MODELS_DIR` so it never counts against the budget.
- Promptus restores the venv during managed hardware init: re-verify the TorchCodec patch, which the launcher can overwrite.
- Signal verifier dependency or decode failure: fail the job closed. Both the CLI and portal master use `promptus_audio_quality.py`; neither may emit an approved result without NumPy, SoundFile, and a successful decode.
- Portal returns HTTP 429: another portal job or an authoritative ComfyUI queue item is active. Wait for it to clear; do not bypass the admission gate. Cosy worker 0.110's raw busy flag is inverted after completion, so it is exposed diagnostically but is not trusted for admission.

## Consent and data handling

Store and distribute only reference recordings the user owns or has explicit permission to clone. Decline impersonation, fraud, harassment, and authentication bypass. Avoid uploading the reference to external services; this workflow is designed for local inference. Never log base64 media or unrelated Promptus account configuration. Mark externally shared renders as synthetic when confusion is plausible.
