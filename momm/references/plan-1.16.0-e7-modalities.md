# E7 — Modality registry and capability-aware routing (1.16 addendum)

Status: revision 3, 2026-09-13, after two momm reviews: `rev_20260913200258_g63x` (12 findings, 13 suggestions, folded into revision 2) and `rev_20260913200824_pd6p` (Codex, Grok, Antigravity all answered; 3 CRITICAL, 10 WARNING, 3 NITPICK, all applied below and logged in `.ensemble_reviews/dispositions.jsonl`). Companion to [plan-1.16.0.md](plan-1.16.0.md). The owner's brief: MOMM must understand what each CLI can take in and produce (text, image, PDF, audio, video, live speech; image, video and speech generation; code execution; web), so the governor routes each job to a route that can do it, and so a job that needs several modalities can be composed across routes. Wiring this must advance MOMM's review core without weakening it.

## Principle

Capabilities are evidence, not marketing. Every cell carries a **level** (mechanism evidence) and a **blocker** (whether this machine can use it now). The code routes only on the **effective cell** (overlay entry if one is valid, otherwise the baseline cell) whose level is `verified` or `documented` **and** whose blocker is null.

| Level | Meaning |
|---|---|
| `verified` | this machine did it in a recorded probe (overlay), or the CLI's own `--help` names the flag and the adapter uses it (baseline, `evidence.help_capture`) |
| `documented` | vendor documentation names a non-interactive path; not exercised here |
| `model-only` | the model can, the CLI exposes no headless path under an account login |
| `no` | neither |

| Blocker | Meaning | Example today | Expiry |
|---|---|---|---|
| `auth_tier` | the account tier is refused | Gemini CLI, `IneligibleTierError` | 7 days, then `reprobe` |
| `zdr` | a privacy or retention setting refuses the tool | Grok `image_to_video` under zero data retention | 7 days, then `reprobe` |
| `allowlist` | headless use needs a permission rule the machine lacks | Antigravity `run_command` in print mode | 7 days, then `reprobe` |
| `missing_flag` | the adapter cannot satisfy the cell's `requires` (flag or directory grant) | Antigravity `view_file` without `--new-project` or `--add-dir` | cleared when the adapter binds the grant |
| `quota` | the provider's allowance is exhausted | Copilot this month | 24 hours, then `reprobe` |
| `probe_failed` | the last probe here did not confirm a non-`no` cell, including a baseline `verified` one (a CLI at the same version string can drop a flag); the baseline level is preserved | — | until the next probe |
| `reprobe` | the overlay entry expired or was invalidated by a CLI upgrade or login change; probe before routing | — | until the next probe |

A blocker is never cleared by the passage of time alone: an expired entry becomes `reprobe`, and only a successful probe on this machine sets the blocker back to null. Read-only review stays read-only. Generation is a separate command with its own consent and its own evidence; a reviewer route is never asked to generate during a review.

## Two layers, never one file

- **Baseline** `momm/references/capabilities.json`, shipped with the skill and machine-independent: levels derived from help captures and vendor documentation, with `evidence.help_capture` (file:line, plus `evidence.help_version`) or `evidence.docs` (URLs) on every non-`no` cell, plus per output cell the `harvest` (glob under the user's home or session dir) and `mime`, and per input cell `how` (an argv template such as `-i {file}`, `--attachment {file}`, or a directory grant plus the path in the prompt) and `requires` (flags or grants the adapter must bind). The baseline holds `verified` **only** with `help_capture` evidence; docs-only evidence is `documented`. Baseline route objects carry no `cli_version`.
- **Overlay** `~/.momm/capabilities-<machine>.json`, written only by probes on this machine: `verified` upgrades and blockers, each entry `{ level?, blocker, expires_at, machine_id, cli_version, login_identity_sha256, at, evidence }`. A CLI upgrade or a login change invalidates the matching entries: an invalidated entry that carried a blocker becomes `reprobe`; an invalidated `verified` upgrade reverts to the baseline level. The registry exposes `effectiveMatrix()` (overlay ?? baseline, with expiry and invalidation applied) and that is the routing source of truth.
- The dispatcher's `MODALITY_SUPPORT` is a derived projection of the **baseline** kept for compatibility and checked by self-test; the review path never routes on it directly.

```json
{ "schema": "momm-capabilities/1", "captured_at": "...", "routes": { "codex": {
    "input":  { "image": { "level": "verified", "how": "-i {file}", "requires": [], "evidence": { "help_capture": "cli/help/codex-exec.txt:37", "help_version": "0.154.0" } } },
    "output": { "image_gen": { "level": "documented", "how": "image_gen tool in exec mode", "harvest": "~/.codex/generated_images/**/*.png", "mime": "image/png", "evidence": { "docs": ["..."] } } },
    "models": { "selectable": ["..."], "families": ["openai"], "local": "--oss --local-provider ollama|lmstudio" }
} } }
```

The live image-generation probe on this machine upgrades `codex.output.image_gen` to `verified` in the overlay, not in the baseline.

## Commands

- `multi-review.mjs --capabilities [--json]`: the effective matrix for this machine, each cell with level, blocker, expiry, invocation and evidence, and the clearing action for every blocker (`reprobe` → `probes.mjs <cli> --modalities`); `--json` for agents. Any pipeline summary it prints is derived from the effective matrix, never hand-written.
- `probes.mjs <cli> --modalities`: input probes only by default, each with synthetic material and a 120 s timeout: a 64×64 PNG with a question, a one-page synthetic PDF, a one-second synthetic tone; each asserts the reply describes the content (colour, the sentence, the tone) so a generic answer never counts. `--modalities --consent` adds one generation request per generative cell at `documented` or `verified` **whose effective blocker is null, `probe_failed` or `reprobe`** — the last two are exactly the blockers whose clearing action is this probe, so a recovery probe is the only way back; cells blocked by `zdr`, `quota`, `auth_tier`, `allowlist` or `missing_flag` are skipped with their clearing action printed and exec is never called for them. Before sending, the command discloses exactly what is sent and that the provider's quota is spent. Results write the overlay: success clears `probe_failed` and `reprobe`; a failed probe on any non-`no` cell records `probe_failed` with the baseline level preserved, never `no`.
- `modality.mjs plan --need <chain> --prompt <text> | --prompt-file <path>`: pure. The chain (`{ "input": ["image"], "output": ["video"] }` or `text → image → video`) is routing metadata; the prompt is the user's creative instruction and is stored in the plan as the immutable user prompt. Returns the routes that can serve each step (level verified or documented, blocker null), the evidence, which blockers stand in the way and what would clear them, preferring one route for adjacent steps. Refuses a chain without a prompt. Executes nothing.
- `modality.mjs run --plan <file> --consent`: executes a planned chain step by step through each route's own non-interactive mode. Every step receives the immutable user prompt plus the previous step's staged files, bound to argv through the input cell's `how` template (and its `requires`); no text produced by a step ever enters a later step's prompt. **Harvest is step-scoped**: before a step the runner snapshots every file the cell's `harvest` glob matches (path, size, mtime, with `~` expanded to the home directory); after the step it stages only files that are new or changed since the snapshot and not older than the step start, copies them under `.ensemble_reviews/media/<run>/` with sha256, and records a `momm-media/1` report. Zero new files fails the step; the chain never continues on stale or foreign artefacts. Refuses without `--consent`, refuses a plan without a prompt, refuses any step whose effective cell has a blocker or a level below `documented`, and never runs during a review.

## Dispatcher changes (review path)

- Attachment routing reads the effective cell, binds the cell's `requires` to argv (an unsatisfiable requirement makes the cell unroutable with blocker `missing_flag`), skips a route when any attached modality's cell is unroutable, and the report says why (level, blocker, evidence) and which routes could.
- `--reviewers auto` with attachments = the **intersection** of routes that are routable for every attached modality; if the intersection is empty, the run refuses and lists per-modality options rather than silently fanning out. A test with image plus PDF proves the intersection rule; a test with a baseline `documented` cell and an overlay `auth_tier` blocker proves the overlay is honoured.
- Report gains `capabilities_used: { route: { modality: { level, blocker, source: "baseline" | "overlay" } } }`.

## Setup Center

A "Modalities" panel: rows are routes, columns are modalities, cells are chips at the four levels with a blocker badge (including `reprobe`/stale) and the invocation on hover; every badge names the clearing action. "Probe inputs" per route (synthetic files, disclosed) and a separate "Probe generation" behind the same disclosure and consent as `run`, skipping blocked cells exactly like the CLI. The planner as a small form that takes the chain and the prompt, shows the chain it would run and the cells that block it, with the exact action that would clear each blocker. Pipeline summaries are derived from the effective matrix.

## Proof

- Registry self-test: every dispatcher route has an entry; every non-`no` baseline cell names help-capture or docs evidence; `verified` in the baseline only from help captures (a docs-only `verified` cell is rejected); no `cli_version` on baseline routes; `MODALITY_SUPPORT` equals the baseline projection.
- Overlay tests: binding to machine, CLI version and login identity; invalidation on upgrade or login change turns a blocked entry into `reprobe` and reverts a `verified` upgrade to the baseline level; expiry by blocker class becomes `reprobe`, never null; `probe_failed` keeps the baseline level, including for baseline `verified` cells.
- Probe fixtures with fake exec for each modality outcome including a generic reply that must not count; timeout; consent refusal for generative probes; a blocked generative cell under `--consent` is skipped and exec is not called.
- Planner tests: possible chains, chains blocked by a level, chains blocked only by a blocker (with the clearing action named), two-route chains, same-route preference, empty intersection refusal, refusal without a prompt.
- Runner tests with fake exec: step-scoped harvest (a pre-existing file under the glob is never staged; a step that writes nothing fails; two concurrent runs stay separate), `~` expansion, staging and hashing, artefact binding through the `how` template (argv holds the flag and the staged path), `requires` bound to argv, refusal without consent, refusal on a blocker, the immutable prompt present on every step, and no step-output text in any later prompt.
- Dispatcher tests: intersection routing; overlay blocker honoured over a routable baseline; `requires` bound or `missing_flag`; `capabilities_used` names level, blocker and source.

## Verified matrix (2026-09-13, this machine, account logins only)

Full cells with citations and the probe log: [cli/modalities.md](cli/modalities.md). Condensed: the **baseline level** as shipped in `capabilities.json` (verified only where a help capture names the flag), then any blocker, then "probed here" where this machine's live probe succeeded, which the overlay records as `verified` for this machine only:

| Route | Image in | PDF in | Audio/video in | Image gen | Video gen | Speech | Code exec | Web |
|---|---|---|---|---|---|---|---|---|
| codex 0.154 | verified `-i`; probed here | no | no | documented (`image_gen`; harvest `~/.codex/generated_images/**/*.png`); probed here | no | no | verified (sandbox) | verified `--search` |
| claude 2.1.270 | documented (Read); probed here | documented (Read); probed here | no | **no** | no | model-only (interactive `/voice`) | verified | verified |
| antigravity 1.2.2 | documented (`view_file`), requires `--new-project` or `--add-dir`; probed here | documented, same; probed here | model-only | documented (`generate_image`, Nano Banana; harvest under the brain dir); probed here | no | model-only | documented, blocker `allowlist` headless | documented |
| gemini 0.59 | documented, blocker `auth_tier` | documented, blocker `auth_tier` | documented (mp3/wav, mp4/mov), blocker `auth_tier` | no under account login | no | no | verified flag, blocker `auth_tier` | documented, blocker `auth_tier` |
| copilot 1.0.83 | verified `--attachment`, blocker `quota` this month | verified, same | no | **no** | no | model-only | verified | verified |
| grok 1.0.30 | documented (`read_file`); probed here | documented; probed here | no | documented (`image_gen`, `image_edit`; harvest under the session dir); probed here | documented tool, blocker `zdr` (clear: `/privacy` off or a user-hosted bucket) | no (preset voices inside video only) | verified | verified incl. X search |

Owner claims checked: Codex generates images, confirmed live. Copilot generates images, refuted. Grok turns an image into a video: tool confirmed, blocked by the ZDR gate. Gemini CLI image generation needs a key, so the Nano Banana route under an account login is Antigravity. Claude Code cannot generate images, confirmed.

Pipelines routable today under account logins, derived from the effective matrix above: prompt to image (codex, grok, antigravity); image to critique (codex, claude, antigravity, grok; copilot is blocked by `quota`, gemini by `auth_tier`); PDF to critique (claude, antigravity, grok; codex has no PDF input); image to video (grok only, after the ZDR gate is cleared and re-probed). Not possible without keys: audio or video input (Gemini only, and its login is blocked), any speech generation, headless microphone input.

Disclosure: establishing this matrix sent one synthetic prompt per generative probe to Codex, Antigravity and Grok, each of which produced one image under the account login; the artefacts stay in the scratchpad and nothing was published.

## Not in scope

Real-time speech in or out (no CLI here offers a headless path), model pinning changes, and any generation inside a review run. Media-content validation is deferred: MOMM checks initial media types by filename extension, not file contents. Malformed or mislabelled files may still proceed; downstream rejection is not guaranteed. A content sniff (magic bytes, and mime against the registry cell) is the 1.16.1 candidate for this gap. Two more 1.16.1 items from the live image critiques of 2026-09-15 (`rev_20260915091159_itvh`, `rev_20260915093602_whbi`), each with a safeguard. Corroboration across routes should recognise the same observation under different ids (two routes reported the missing ears, and later the missing fur compression, as separate single-source findings and the report scored agreement 0). Safeguard: semantic matching only adds a corroboration link; it never merges, rewrites or drops the original findings, and it must not join different defects that share words. Until it exists, an agreement score of 0 is presented as "no id-level corroboration", never as evidence that the reviewers disagreed. Second, a route whose overlay entry has expired to `reprobe` is left out of `--reviewers auto` until someone probes by hand. Safeguard: an automatic re-probe still sends synthetic material to the provider and spends quota, so it may only run with a disclosure and explicit permission (a flag or an interactive yes), never silently; blocking the expired capability until it is rechecked is the correct fail-closed default and stays. A reusable image-review checklist (subject, hat or prop fit, shadow consistency, reflections, anatomy, text or watermark) belongs in the modalities guidance so image critiques check the same things every time.
