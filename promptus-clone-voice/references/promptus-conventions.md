# Conforming to Promptus

Everything this skill installs sits beside 197 cosyflows Promptus ships itself. A generated preset should be
indistinguishable from a Promptus-authored one in the Playground list. This document records the conventions
observed in Promptus's own files, where this skill currently diverges, and how to resolve paths the way the
app does instead of guessing them.

Verify every claim here against the live installation before relying on it. Read the bundled flows directly:

Discover the root the way the app records it rather than typing a profile path, which would not survive a
move to another machine or account:

```powershell
$Root = $env:PROMPTUS_INSTALL_ROOT
if (-not $Root) {
    $record = Join-Path $env:APPDATA 'promptusai\install.json'
    if (Test-Path -LiteralPath $record) { $Root = (Get-Content -Raw -LiteralPath $record | ConvertFrom-Json).installRoot }
}
if (-not $Root) { $Root = Join-Path $env:LOCALAPPDATA 'PromptusAI' }
$PromptusPython = Join-Path $Root 'cosy\venv\Scripts\python.exe'
& $PromptusPython -c "import json;d=json.load(open(r'$Root\cosy\promptus\cosyflow\promptus_audio_f5tts.cosy',encoding='utf-8'));print(d['title'],d['category'],d['tags'])"
```

## Contents

- Resolve directories from the backend config
- Cosyflow metadata conventions
- Variable conventions
- Reference file placement
- Generated flows and installed legacy flows
- Sibling Promptus speech cosyflows

## Resolve directories from the backend config

Promptus supports several generation backends. Each one owns a models directory, a local cosyflow directory,
and a disk budget, declared in its own config file:

```
<installRoot>\models\<backend>_models\cosy.json
```

The observed backends are `comfy_models` (local ComfyUI, the one this skill targets) and `horde_models`.
The worker reads the file through `cosy\promptus\config.py`, which exposes:

| Config key | Meaning | Default when absent |
|---|---|---|
| `COSY.COSYFLOW_DIR` | Promptus's own bundled cosyflows | `promptus/cosyflow` |
| `COSY.COSYFLOW_LOCAL_DIR` | Installed local cosyflows | `models/cosyflow` |
| `COSY.MODELS_DIR` | Checkpoints and other weights | `models` |
| `COSY.MAXIMUM_MODELS_SIZE` | Total weight budget | `10GB` |
| `COSY.MINIMUM_DISK_FREE` | Reserved free space | `10GB` |
| `COSY.COSYFLOW_AUTO_INSTALL_TITLES` | Titles Cosy installs on startup | `[]` |

On the diagnosed machine the comfy backend overrides the defaults with absolute paths, so the local cosyflow
directory is `models\comfy_models\cosyflow` and **`models\cosyflow` does not exist**. Never hard-code either
one. Read `COSYFLOW_LOCAL_DIR` from the backend config; fall back to the documented default only when the
config is unreadable, and print the resolved path so the user can confirm it.

Cosy's startup log states the directory it actually watched, which is the authoritative check:

```
cosyflows: observer schedule <installRoot>\models\comfy_models\cosyflow
Got 8 from local cosyflow directory <installRoot>\models\comfy_models\cosyflow.
```

Read only the `COSY` section. The same file's other sections hold account numbers and provider API keys.
Never print them, and never copy the file.

`/api/cosy/install-local` writes the cosyflow itself, so installation succeeds regardless of what the
installer believes the path to be. Only the local collision check, the pre-replacement backup, and the
reported target path depend on resolving it correctly, and all three silently do nothing when it is wrong.
Treat `find_cosyflow(get_cosyflows(...), title)` as the authoritative collision test in every case.

## Cosyflow metadata conventions

Sampled from `promptus_audio_f5tts.cosy`, `promptus_kokoro_tts.cosy`, `promptus_zonos_tts.cosy`,
`promptus_rembg.cosy`, `promptus_zimage_t2i_bf16.cosy`, and `promptus_ace_music_generator.cosy`:

| Field | Convention | Examples |
|---|---|---|
| `title` | `(cosy) Promptus: <Name>`, with a variant in square brackets | `(cosy) Promptus: Audio F5TTS`, `(cosy) Promptus: Z-Image Text to Image [bf16]` |
| `category` | `Promptus/Cosy/<Media>` — exactly one level below `Cosy` | `Promptus/Cosy/Audio`, `Promptus/Cosy/Image` |
| `tags` | Exactly two: media, then task | `["Audio", "Text to Audio"]`, `["Image", "Image Edit"]` |
| `description` | One short plain sentence naming the model | `Convert text to speech using model kokoro-v1_0 from hexgrad/Kokoro-82M.` |

Top-level keys are exactly `title`, `category`, `tags`, `description`, `workflow`, `prompt`, `assignments`,
and `variables`. Do not invent additional keys.

The filename Promptus writes is derived from the title, so an ASCII title keeps the file portable. Promptus's
own files are lowercase ASCII with underscores (`promptus_audio_f5tts.cosy`). A title containing an em dash
produces a filename containing an em dash.

## Variable conventions

Every public variable in a Promptus-authored flow titles itself after the node and input it drives:

```
"title": "<Node title>: <input name with underscores replaced by spaces>"
```

`F5-TTS Audio: sample`, `Kokoro Generator: speed`, `Zonos Generate: model type`, `Load CLIP: clip name`.
The pattern holds across every sampled flow, including nodes whose titles contain emoji
(`🔧 RemBG Session: model`). It tells the user which node a control belongs to when a flow exposes several.

Other observed conventions:

| Field | Convention |
|---|---|
| `importance` | `5` primary content (prompt, reference, lyrics) · `4` key selector · `3` normal control · `1`–`2` plumbing |
| `type` | `STRING`, `prompt`, `enum`, `FLOAT`, `INT`, `seed`, `b64data`, `model` |
| `seed` | `"type": "seed"`, `"min": -1`, `"step": 1`, `"display": "number"`, tooltip `Seed. -1 = random` |
| `enum` | always carries `options`; `b64data` audio carries `"audio_upload": true` |
| `tooltip` | short, plain, optional — used to explain a non-obvious default |

Assignments map one variable to one node input. A seed variable carries `"convert": "seed_to_int"`.

## Reference file placement

Fixed references belong in a named subdirectory of the ComfyUI input directory:

```
<installRoot>\cosy\comfyui\ComfyUI\input\F5-TTS\<slug>-reference.wav
<installRoot>\cosy\comfyui\ComfyUI\input\F5-TTS\<slug>-reference.txt
```

The input root itself accumulates worker upload artefacts named `cosy_<hash>_<n>_image` with no extension.
Writing a reference there makes it indistinguishable from that churn and risks collision. Keep the audio and
its transcript sidecar together, same basename, in `input\F5-TTS`.

The node resolves the value through `folder_paths.get_annotated_filepath(sample)`, then re-derives the
transcript with `F5TTSCreate.get_txt_file_path(sample)`, so the relative path stored in the cosyflow must
point at both files. Forward slashes are the ComfyUI convention and are what the node's own combo lists use;
`os.path.join` accepts either separator on Windows.

## Generated flows and installed legacy flows

The current installers generate native metadata. Presets installed by earlier versions remain deliberately
unchanged until they are reinstalled and verified. Measured against the legacy
`(cosy) voice-c — F5 Studio` still present on the diagnosed machine:

| Field | Promptus convention | What this skill writes | Conforms |
|---|---|---|---|
| `title` | `(cosy) Promptus: <Name>` | legacy: `(cosy) voice-c — F5 Studio`; current installers conform | legacy only |
| `title` | ASCII, colon separator | legacy title contains an em dash; current installers conform | legacy only |
| `category` | `Promptus/Cosy/Audio` | current installers conform | yes |
| `tags` | two tags | current installers write `Audio`, `Voice Cloning` | yes |
| `description` | one short sentence | current installers name F5TTS_v1_Base in one sentence | yes |
| variable titles | `F5-TTS Advanced: nfe step` | current installers follow node/input naming | yes |
| `importance` | 5 for primary content | 5 for narration | yes |
| seed variable | `type: seed`, `min: -1`, `convert: seed_to_int` | same | yes |
| reference location | `input\F5-TTS\` | all three installers conform | yes |

A conforming title scheme used by the current installers:

| Installer | Proposed title |
|---|---|
| `install_f5tts_cosyflow.py` | `(cosy) Promptus: Local Voice <Name>` |
| `install_f5tts_studio.py` | `(cosy) Promptus: Local Voice <Name> [Studio]` |
| `install_f5tts_mode_pack.py` | `(cosy) Promptus: Local Voice <Name> [Fast Preview]`, `[Production]`, `[Hero Quality]` |

Renaming changes the string a user selects in Playground and the string `test_promptus_voice.py --model-title`
expects. Do not rename a legacy installed preset in place. Install under the new title, verify a generation,
then remove the old preset deliberately and only with the owner's approval.

## Sibling Promptus speech cosyflows

Promptus ships two other speech paths. State why F5 was chosen rather than implying it is the only option.

| Cosyflow | Custom node | Use it when |
|---|---|---|
| `(cosy) Promptus: Audio F5TTS` | `comfyui-f5-tts` | Cloning a specific consented voice from a short reference |
| `(cosy) Promptus: Kokoro TTS` | `comfyui-kokoro` | A clean preset narrator voice is enough and no reference exists |
| `(cosy) Promptus: Zonos TTS` | `ComfyUI-Zonos` | Explicit emotion controls matter more than matching a specific speaker |

Zonos declares a dependency on espeak-ng, which is why an espeak runtime may already be present on the
machine. `(cosy) Promptus: Gemma4 Audio to Text` is Promptus's own speech-to-text path; this skill uses a
local Whisper cache for `transcribe_f5_quality.py` instead, because the Gemma4 weights are not installed and
the comfy backend's current audited model budget has 4.37 GB free (407.63 / 412.00 GB used) after its queued
auto-installs consumed earlier cleanup headroom. Keep the Whisper cache outside `MODELS_DIR` so it never
counts against that budget.
