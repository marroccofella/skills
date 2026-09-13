# E7 — Modality registry and capability-aware routing (1.16 addendum)

Status: draft, 2026-09-13, for momm review before implementation. Companion to [plan-1.16.0.md](plan-1.16.0.md). The owner's brief: MOMM must understand what each CLI can take in and produce (text, image, PDF, audio, video, live speech; image, video and speech generation; code execution; web), so the governor routes each job to a route that can do it, and so a job that needs several modalities can be composed across routes. The example: a Claude Code harness cannot generate an image, Codex or Copilot might, and Grok might turn that image into a video. Wiring this must advance MOMM's review core without weakening it.

## Principle

Capabilities are evidence, not marketing. Every cell in the registry carries one of four levels, and the code only routes on the top two:

| Level | Meaning | Routable |
|---|---|---|
| `verified` | a probe on this machine did it, or the CLI's own `--help` names the flag and the adapter uses it | yes |
| `documented` | vendor documentation names a non-interactive path the machine has not exercised | yes, with a notice |
| `model-only` | the model behind the CLI can, but the CLI exposes no headless path under an account login | no |
| `no` | neither | no |

Read-only review stays read-only. Generation is a separate command with its own consent and its own evidence; a reviewer route is never asked to generate during a review.

## Registry

`momm/references/capabilities.json`, versioned with the skill and refreshed by probes:

```json
{ "schema": "momm-capabilities/1", "captured_at": "...", "routes": { "codex": {
    "cli_version": "0.154.0",
    "input":  { "text": {"level":"verified","how":"stdin"}, "image": {"level":"verified","how":"-i <file>"}, "pdf": {"level":"no"}, "audio": {"level":"no"}, "video": {"level":"no"}, "live_speech": {"level":"no"} },
    "output": { "text": {"level":"verified"}, "image_gen": {"level":"...","how":"..."}, "video_gen": {"level":"..."}, "speech_gen": {"level":"..."}, "code_exec": {"level":"verified","how":"--sandbox workspace-write (never in review)"}, "web": {"level":"...","how":"..."} },
    "models": { "selectable": ["..."], "families": ["openai"] },
    "evidence": { "help_capture": "references/cli/help/codex-exec.txt:37", "docs": ["..."], "probe": "probes.jsonl#..." }
} } }
```

The dispatcher's existing `MODALITY_SUPPORT` (text/image/pdf/audio/video input per route) becomes a projection of this file: the code reads `capabilities.json`, and a self-test fails if the two disagree.

## Commands

- `multi-review.mjs --capabilities [--json]`: the matrix for this machine, merged from the registry and the latest probes, with the evidence level and the invocation per cell; `--json` for agents.
- `probes.mjs <cli> --modalities`: extends the containment probe with cheap modality probes, each sending only synthetic material and each disclosed: a 1×1 PNG with a question (image input), a one-page synthetic PDF (pdf input), a one-second synthetic tone (audio input), and, for generative cells at `documented`, one tiny generation request whose output file is hashed and recorded. Results move a cell from `documented` to `verified` or to `no` and are written to `probes.jsonl`.
- `modality.mjs plan --need <spec>`: a pure planner. Given a job spec such as `{ "input": ["image"], "output": ["video"] }` or a chain `text → image → video`, it returns the ordered routes that can serve each step at `verified` or `documented`, the evidence, and what is impossible on this machine, without executing anything. The governor uses it to decide; the Setup Center shows it as a matrix.
- `modality.mjs run --plan <file> --consent`: executes a planned chain step by step through each route's own non-interactive mode, staging every intermediate file under `.ensemble_reviews/media/<run>/` with sha256, and recording a `momm-media/1` report. Refuses without `--consent`, refuses steps below `documented`, never passes reviewer output as instructions to the next step (only files), and never runs during a review.

## Dispatcher changes (review path)

- Attachment routing already skips routes without the modality; it now also reports *why* (level and evidence) and suggests the routes that could, from the registry.
- `--reviewers auto` for media inputs: pick every route at `verified` for each attached modality.
- Report gains `capabilities_used: { route: { modality: level } }` so a media review records what evidence its routing rested on.

## Setup Center

A "Modalities" panel: rows are routes, columns are the modalities, cells are chips at the four levels, each with its invocation on hover; a "Probe modalities" button per route with the disclosure of exactly what synthetic material is sent; the planner as a small form (need in, need out) that shows the chain it would run and the cells that block it.

## Proof

- Registry self-test: every route in the dispatcher has an entry; every `verified` cell names a probe or a help-capture line; `MODALITY_SUPPORT` equals the registry projection.
- Probe fixtures with fake exec for each modality outcome; live probe on this machine recorded for every installed route.
- Planner tests: chains that are possible, chains blocked by a `model-only` cell, chains needing two routes, and the "same route for both steps" preference.
- Runner tests with fake exec: files staged and hashed, refusal without consent, refusal below `documented`, no text from step N reaching step N+1 as a prompt.

## Verified matrix (2026-09-13, this machine, account logins only)

Full cells with citations and the probe log: [cli/modalities.md](cli/modalities.md). Condensed, evidence level first:

| Route | Image in | PDF in | Audio/video in | Image gen | Video gen | Speech | Code exec | Web |
|---|---|---|---|---|---|---|---|---|
| codex 0.154 | verified `-i` | no | no | **verified** (`image_gen` tool; PNG under `~/.codex/generated_images/`) | no | no | verified sandbox | verified `--search` |
| claude 2.1.270 | verified (Read) | verified (Read) | no | **no** | no | interactive `/voice` only | verified | verified |
| antigravity 1.2.2 | verified (`view_file`, needs `--new-project` or `--add-dir`) | verified | model-only | **verified** (`generate_image`, Nano Banana; JPG under the brain dir) | no | interactive only | verified (auto-denied headless without an allow rule) | verified |
| gemini 0.59 | documented | documented | documented (mp3/wav, mp4/mov) | no under account login (extension needs a key) | no | no | flag verified | documented, but the consumer login is rejected (`IneligibleTierError`, probed today) |
| copilot 1.0.83 | verified `--attachment` | verified | no | **no** (every route needs a key) | no | interactive only | verified | verified |
| grok 1.0.30 | verified (`read_file`) | verified | no | **verified** (`image_gen`, `image_edit`; JPG under the session dir) | tool present (`image_to_video`, `reference_to_video`) but **gated** by the zero-data-retention setting; refused today | preset voices inside video only | verified | verified incl. X search |

Owner claims checked: Codex generates images, confirmed live. Copilot generates images, refuted. Grok turns an image into a video: tool confirmed, blocked by the ZDR gate until `/privacy` is turned off or a user-hosted bucket is configured. Gemini CLI image generation needs a key, so the Nano Banana route under an account login is Antigravity. Claude Code cannot generate images, confirmed.

Pipelines possible today under account logins: prompt to image (codex, grok, antigravity); image or PDF to critique (all five reviewers); image to video (grok only, after the gate). Not possible without keys: audio or video input (Gemini only, and its login is blocked), any speech generation, headless microphone input.

Disclosure: establishing this matrix sent one synthetic prompt per generative probe to Codex, Antigravity and Grok, each of which produced one image under the account login; the artefacts stay in the scratchpad and nothing was published.

## Not in scope

Real-time speech in or out (no CLI here offers a headless path; recorded as `model-only` or `no`), model pinning changes, and any generation inside a review run.
