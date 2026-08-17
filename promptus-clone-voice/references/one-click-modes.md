# One-click F5-TTS modes on Windows

## Requirement

Only install these modes when active ComfyUI exposes `F5TTSAudioAdvanced`. The app-managed `comfyui-f5-tts` installation on the tested machine exposes it; always query the live schema because package versions vary.

The installer discovers both required and optional parameters from `/object_info/F5TTSAudioAdvanced` and refuses unknown schemas. Current NFE and guidance controls are optional inputs, so inspecting only `required` would incorrectly reject the live node.

## Presets

| Playground model | NFE | Guidance | Intended use |
|---|---:|---:|---|
| `(cosy) Promptus: Local Voice <Name> [Fast Preview]` | 16 | 2.0 | Script and pronunciation review |
| `(cosy) Promptus: Local Voice <Name> [Production]` | 24 | 2.0 | Normal finished narration |
| `(cosy) Promptus: Local Voice <Name> [Hero Quality]` | 32 | 2.0 | Hooks and important passages |

Three separate cosyflows are intentional. Promptus assignments map a public variable to one node input; one public mode enum cannot safely alter both NFE and guidance without supported switch nodes.

## Reference rules

- Use one clean, consented 7–11.8 second reference, preferably WAV; F5 automatically truncates longer audio near 12 seconds.
- Supply the exact UTF-8 transcript in a `.txt` file.
- Keep audio and transcript basenames aligned after copying into the active ComfyUI input directory.
- Fix the reference and quality values inside each preset.
- Leave narration, seed, and speaking pace editable.
- Submit the selected preset using the worker route key `cosyflow`. If the node's model choice is public, call that variable `f5_model` to avoid client-side ambiguity.

The installer supports upload-style advanced reference inputs and graph-style `AUDIO` inputs. For graph input, it inserts `LoadAudio`. When a sample-text input exists, it fixes the supplied transcript into that node input; otherwise the node's installed fallback governs transcription.

## Safe install sequence

1. Run `diagnose_promptus_voice.py --require-advanced`.
2. Run `install_f5tts_mode_pack.py ... --dry-run`.
3. Review all three titles, the input destination, and any collision.
4. Rerun with `--consent-confirmed`.
5. Restart Cosy through Promptus Server.
6. Generate a short consented line with Fast Preview.
7. Confirm the saved output appears in Comfy Output.
8. Reject the render if the signal gate reports severe clipping, DC offset, or silence.
9. Run a short exact-script ASR check and listen to an A/B cadence comparison before delivery.

Use native `F5TTS` timing. On ComfyUI-F5-TTS 1.0.26, do not use TDHS: its installed stretch path can produce int16-scale output and catastrophic clipping. In the F5 node's `speed` control, values above 1.0 are slower.

Use `--force` only to intentionally replace an existing voice pack. Changed reference files and local cosyflows receive timestamped backups.

## Performance guidance

Fast Preview reduces iteration latency. Production is the default delivery mode. Hero Quality trades additional latency for important passages. Actual speed depends on device VRAM, model caching, reference duration, and node implementation. Report measured performance rather than promising a fixed render time.

If VRAM is constrained, shorten the narration and use Fast Preview. Do not submit overlapping jobs while ComfyUI's `/queue` reports work in progress. Cosy worker 0.110's `/api/generate/is-busy` state is inverted after completion and should be treated as diagnostic only; the portal's process lock supplies the second concurrency guard.

## Distribution

Do not package or share the fixed reference audio unless the speaker explicitly authorized redistribution. Prefer distributing the skill and an unconfigured cosyflow procedure. If the preset must travel with the reference, include the consent scope and require the recipient to keep shared renders labelled as synthetic where confusion is plausible.
