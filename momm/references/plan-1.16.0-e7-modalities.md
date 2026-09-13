# E7 — Modality registry and capability-aware routing (1.16 addendum)

Status: revision 2, 2026-09-13, after momm review run `rev_20260913200258_g63x` (Codex, Grok, Antigravity all answered; 12 findings and 13 suggestions, all applied below). Companion to [plan-1.16.0.md](plan-1.16.0.md). The owner's brief: MOMM must understand what each CLI can take in and produce (text, image, PDF, audio, video, live speech; image, video and speech generation; code execution; web), so the governor routes each job to a route that can do it, and so a job that needs several modalities can be composed across routes. Wiring this must advance MOMM's review core without weakening it.

## Principle

Capabilities are evidence, not marketing. Every cell carries a **level** (mechanism evidence) and a **blocker** (whether this machine can use it now). The code routes only on a cell whose level is `verified` or `documented` **and** whose blocker is null.

| Level | Meaning |
|---|---|
| `verified` | this machine did it in a recorded probe, or the CLI's own `--help` names the flag and the adapter uses it |
| `documented` | vendor documentation names a non-interactive path; not exercised here |
| `model-only` | the model can, the CLI exposes no headless path under an account login |
| `no` | neither |

| Blocker | Meaning | Example today |
|---|---|---|
| `auth_tier` | the account tier is refused | Gemini CLI, `IneligibleTierError` |
| `zdr` | a privacy or retention setting refuses the tool | Grok `image_to_video` under zero data retention |
| `allowlist` | headless use needs a permission rule the machine lacks | Antigravity `run_command` in print mode |
| `missing_flag` | the adapter must pass a flag or directory grant first | Antigravity `view_file` without `--new-project` or `--add-dir` |
| `quota` | the provider's allowance is exhausted | Copilot this month |
| `probe_failed` | the last probe here did not confirm a documented cell; retried on the next probe, the baseline is not downgraded | — |

Read-only review stays read-only. Generation is a separate command with its own consent and its own evidence; a reviewer route is never asked to generate during a review.

## Two layers, never one file

- **Baseline** `momm/references/capabilities.json`, shipped with the skill and machine-independent: levels derived from help captures and vendor documentation, with `evidence.help_capture` (file:line) or `evidence.docs` (URLs) on every non-`no` cell, plus per output cell the `harvest` (glob under the user's home or session dir) and `mime`, and per input cell `requires` (flags or grants).
- **Overlay** `~/.momm/capabilities-<machine>.json`, written only by probes on this machine: `verified` upgrades, `probe_failed` and other blockers, each bound to `{ machine_id, cli_version, login_identity_sha256, at }`. A CLI upgrade or a login change invalidates the matching overlay entries; the dispatcher reads baseline plus a still-valid overlay. `verified` therefore never ships in the baseline unless it comes from a help-capture flag.
- The dispatcher's `MODALITY_SUPPORT` is checked by self-test against the **baseline** projection; the overlay only adds blockers or upgrades at run time.

```json
{ "schema": "momm-capabilities/1", "captured_at": "...", "routes": { "codex": {
    "cli_version": "0.154.0",
    "input":  { "image": { "level": "verified", "how": "-i <file>", "evidence": { "help_capture": "cli/help/codex-exec.txt:37" } } },
    "output": { "image_gen": { "level": "verified", "how": "image_gen tool in exec mode", "harvest": "~/.codex/generated_images/**/*.png", "mime": "image/png", "evidence": { "docs": ["..."] } } },
    "models": { "selectable": ["..."], "families": ["openai"], "local": "--oss --local-provider ollama|lmstudio" }
} } }
```

## Commands

- `multi-review.mjs --capabilities [--json]`: the effective matrix for this machine (baseline plus valid overlay), each cell with level, blocker, invocation and evidence; `--json` for agents.
- `probes.mjs <cli> --modalities`: input probes only by default, each with synthetic material and a 120 s timeout: a 64×64 PNG with a question, a one-page synthetic PDF, a one-second synthetic tone; each asserts the reply describes the content (colour, the sentence, the tone) so a generic answer never counts. `--modalities --consent` adds one generation request per generative cell at `documented` or `verified`, harvests by the registry glob, hashes the file, and discloses beforehand exactly what is sent and that the provider's quota is spent. Results write the overlay; a failed documented probe records `probe_failed`, never `no`.
- `modality.mjs plan --need <spec>`: pure. Given `{ "input": ["image"], "output": ["video"] }` or a chain `text → image → video`, returns the routes that can serve each step (level verified or documented, blocker null), the evidence, which blockers stand in the way and what would clear them, preferring one route for adjacent steps. Executes nothing.
- `modality.mjs run --plan <file> --consent`: executes a planned chain step by step through each route's own non-interactive mode. Every step receives the same immutable user spec as its prompt plus the previous step's files as artefacts; no text produced by a step ever enters a later step's prompt. Outputs are harvested by the registry glob, copied under `.ensemble_reviews/media/<run>/` with sha256, and recorded in a `momm-media/1` report. Refuses without `--consent`, refuses any step whose cell has a blocker or a level below `documented`, and never runs during a review.

## Dispatcher changes (review path)

- Attachment routing skips a route when any attached modality's cell is unroutable, and the report says why (level, blocker, evidence) and which routes could.
- `--reviewers auto` with attachments = the **intersection** of routes that are routable for every attached modality; if the intersection is empty, the run refuses and lists per-modality options rather than silently fanning out. A test with image plus PDF proves the intersection rule.
- Report gains `capabilities_used: { route: { modality: { level, blocker, source: "baseline" | "overlay" } } }`.

## Setup Center

A "Modalities" panel: rows are routes, columns are modalities, cells are chips at the four levels with a blocker badge and the invocation on hover; "Probe inputs" per route (synthetic files, disclosed) and a separate "Probe generation" behind the same consent as `run`; the planner as a small form that shows the chain it would run and the cells that block it, with the exact action that would clear each blocker.

## Proof

- Registry self-test: every dispatcher route has an entry; every non-`no` baseline cell names help-capture or docs evidence; `verified` in the baseline only from help captures; `MODALITY_SUPPORT` equals the baseline projection.
- Overlay tests: binding to machine, CLI version and login identity; invalidation on upgrade or login change; `probe_failed` keeps the baseline level.
- Probe fixtures with fake exec for each modality outcome including a generic reply that must not count; timeout; consent refusal for generative probes.
- Planner tests: possible chains, chains blocked by a level, chains blocked only by a blocker (with the clearing action named), two-route chains, same-route preference, empty intersection refusal.
- Runner tests with fake exec: harvest by glob, staging and hashing, refusal without consent, refusal on a blocker, the immutable spec present on every step, and no step-output text in any later prompt.

## Verified matrix (2026-09-13, this machine, account logins only)

Full cells with citations and the probe log: [cli/modalities.md](cli/modalities.md). Condensed, as level plus blocker:

| Route | Image in | PDF in | Audio/video in | Image gen | Video gen | Speech | Code exec | Web |
|---|---|---|---|---|---|---|---|---|
| codex 0.154 | verified `-i` | no | no | **verified** (`image_gen`; harvest `~/.codex/generated_images/**/*.png`) | no | no | verified (sandbox) | verified `--search` |
| claude 2.1.270 | verified (Read) | verified (Read) | no | **no** | no | model-only (interactive `/voice`) | verified | verified |
| antigravity 1.2.2 | verified, requires `--new-project` or `--add-dir` | verified, same | model-only | **verified** (`generate_image`, Nano Banana; harvest under the brain dir) | no | model-only | verified, blocker `allowlist` headless | verified |
| gemini 0.59 | documented, blocker `auth_tier` | documented, blocker `auth_tier` | documented (mp3/wav, mp4/mov), blocker `auth_tier` | no under account login | no | no | verified flag, blocker `auth_tier` | documented, blocker `auth_tier` |
| copilot 1.0.83 | verified `--attachment`, blocker `quota` this month | verified, same | no | **no** | no | model-only | verified | verified |
| grok 1.0.30 | verified (`read_file`) | verified | no | **verified** (`image_gen`, `image_edit`; harvest under the session dir) | verified tool, blocker `zdr` (clear: `/privacy` off or a user-hosted bucket) | no (preset voices inside video only) | verified | verified incl. X search |

Owner claims checked: Codex generates images, confirmed live. Copilot generates images, refuted. Grok turns an image into a video: tool confirmed, blocked by the ZDR gate. Gemini CLI image generation needs a key, so the Nano Banana route under an account login is Antigravity. Claude Code cannot generate images, confirmed.

Pipelines possible today under account logins: prompt to image (codex, grok, antigravity); image or PDF to critique (all five reviewers); image to video (grok only, after the gate). Not possible without keys: audio or video input (Gemini only, and its login is blocked), any speech generation, headless microphone input.

Disclosure: establishing this matrix sent one synthetic prompt per generative probe to Codex, Antigravity and Grok, each of which produced one image under the account login; the artefacts stay in the scratchpad and nothing was published.

## Not in scope

Real-time speech in or out (no CLI here offers a headless path), model pinning changes, and any generation inside a review run.
