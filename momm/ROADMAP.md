# MOMM Roadmap — alignment record

Purpose: keep parallel sessions and future releases pointed the same way.
Before proposing or building a MOMM feature, read this file; after shipping or
rejecting one, update it. Shipped items stay listed so nobody re-proposes them.

## Planned — next release

### Prose-artifact correlation (non-code peer review)

Observed 2026-09-04 on the manuscript specimen run (rev_20260904131823_wvxh):
three referees flagged the same eight defects, yet `agreement_score` was 0
and `corroborated_count` 0, because prose findings carry free-text section
labels in `target_file` ("§2.3 Analysis" vs "Methods, 2.3 Analysis") and no
`line_range`, so neither merge key fires. Next: normalize section labels
(strip §/numbering/"Methods," prefixes, lowercase, token overlap) and fall
back to quoted-sentence overlap when line ranges are absent, so manuscript
and document reviews get the same corroboration signal code gets. Verdict
agreement is unaffected and must stay the headline for prose.

### Antigravity structured-output regressions

antigravity returned `invalid_output` on both 2026-09-04 runs (and 3 of its
last 22 momm-folder runs). Status, not finding — but the adapter's parser
should record the first 200 sanitized characters of the unparseable reply in
`detail` so the failure class (schema drift vs truncation vs refusal) is
diagnosable from the ledger without re-running.

### Read-aloud, premium voice engine (baseline SHIPPED in 1.11.0)

The ledger's baseline read-aloud is live (see Shipped). Remaining premium
tier: consented local voice via the promptus-clone-voice / myvoice pipeline
(F5-TTS in Promptus). Constraints are non-negotiable and inherited from that
skill: explicit owner consent per voice, generation stays entirely local,
output audibly/visibly labeled as synthetic, and the voice reference never
ships with MOMM — the integration points at the user's own installed preset
(e.g. a `MOMM_READALOUD_COSYFLOW` setting), it never bundles one. Precedent:
the FREEL*ADER 42 longplay video (2026-08) proved the event→script→synthesize
pattern end-to-end. Also still open: an optional `--read-aloud` dispatcher
flag that speaks the run summary when a review completes.
Non-goals stand: no cloud TTS; never auto-read reviewer prose verbatim.

### Multimedia review — remaining tiers (core SHIPPED in 1.12.0)

Shipped: modality matrix, `--attach` for image/pdf/audio/video with per-route
mechanisms, metadata stripping, fail-closed `unsupported` gate, `region`
finding field, hash-only evidence, Setup Center modality rows (see Shipped).

Still open, evidence-first:

- **Verify antigravity's image path live**, then promote it in
  MODALITY_SUPPORT — capability claims stay evidence-only.
- **Synthetic test-card probe** in Setup Center: a locally generated image
  (the visual analog of the harmless sentence) verifying each vision route
  end-to-end before real media rides.
- **Video, frame-sampled tier**: extract N keyframes locally (ffmpeg) and
  review as images on every vision route, so video review is not
  gemini-exclusive. Proven artifact: the autopilot longplay.
- **Audio-as-word-gate workflow**: a documented recipe using
  `--attach narration.flac --reviewers gemini` as the second word gate when
  local Whisper is unavailable (the exact gap hit 2026-08). Voice content
  inherits myvoice consent rules; synthetic audio declared as such.

Explicit non-goals stand: reviewer-side code execution and reviewer web
access during review.

### Second-reviewer cross-check for verify-first findings

`verify_first` (shipped 1.10.0) flags single-source findings from
low-precision routes. Next step: an optional pass that asks one *high*
-precision route to confirm or refute just that finding before it reaches the
governor. Keeps the reproduction gate; reduces governor time spent on
hallucinated findings. Opt-in flag (`--cross-check`), never silent.

### Global cross-project ledger

Ledgers are per-project silos by design (telemetry stays beside its repo),
but the owner experience fragments: the demo review lives in demo/, the game
reviews in Willy/, and nothing lists them together. Add an opt-in aggregator
(`ledger.mjs --global`) that reads a small local registry of known
`.ensemble_reviews` roots (appended on each run, home-directory dotfile),
renders one combined page with per-project sections, and never copies
telemetry between projects — links and counts only. Registry is hash-free
paths on the owner's own machine; the aggregate page carries the same
private-by-default posture.

### Persona effectiveness measurement

Dispositions now record reviewer; they should also record the **persona** the
reviewer wore for that run, so `--stats` can answer "did copilot=verifier
actually raise copilot's precision?" — the tuned defaults (1.10.0) were set
from pre-persona data and need their own A/B evidence. One added field per
disposition line; ledger table gains a persona column when present.

## Shipped (do not re-propose)

- **1.13.0** — lineage reconciliation: merged the published 1.10.0–1.10.2
  Setup Center line into the installed 1.11–1.12.0 line (kept the single-file
  dispatcher and monolithic Setup Center; took myrepo 1.3.1 and myskills
  1.1.0; unpublished 1.12.1 candidate preserved on branch
  candidate/momm-1.12.1). Fixes from MOMM reviewing MOMM
  (rev_20260904131435_mf6w, reproduced before fixing, regression self-tests
  added): Setup Center `supervise()` misreported timeouts (CRITICAL,
  codex+copilot); ledger read-aloud stale-event reset (WARNING, codex);
  myskills drive-specific path redaction (codex); Setup Center self-test now
  fails on provider/dispatcher modality drift; ledger pre-indexes
  dispositions by run_id. Public page rebuilt with a consented narrated
  walkthrough, ledger-derived charts, and a manuscript peer-review specimen
  under `.reviewrules` journal guidelines (rev_20260904131823_wvxh); public
  evidence export regenerated by `export-public-evidence.mjs`. Also ships the
  ledger accounting reconciliation below.
- **1.13.0 ledger accounting** — Observed 2026-09-04 on a real ledger: the headline said 123 triaged
suggestions while the reviewer table summed to 116, because seven `deferred`
rows were counted in the headline and silently dropped from the table. Fix:
every parseable disposition row now lands in exactly one bucket — applied,
rejected, deferred, other — with an `unattributed` line for rows lacking a
reviewer and a total row that must equal the file's row count (the panel
flags itself if it does not). Same treatment in the dispatcher's `--stats`.
Precision is unchanged (applied / adjudicated) and deferred rows never move
it. A second table separates reviewer findings from execution reliability:
completed / dispatched, completion rate, timeouts, other failures, median
findings per review and severity-weighted findings per review (sealed
reports only; CRITICAL 3, WARNING 2, NITPICK 1), and utility = severity-
weighted applied suggestions / completed reviews. Utility weights a
suggestion at 1 unless its disposition carries the new optional
`finding_id` field, so precision alone can no longer flatter a route that
rarely completes (codex: 100% precision, timeouts on every 2026-09-04 run).
Self-tests: ledger +6, dispatcher +1. Protocol note added to SKILL.md that
dispositions belong beside the review log the dispatcher wrote.

- **1.12.0** — multimedia review, core: `MODALITY_SUPPORT` matrix (evidence-
  verified per route: codex text+image via native `codex exec -i`; claude
  text+image+pdf via tool-read with `--add-dir`; gemini
  text+image+pdf+audio+video via `@file` prompt references;
  antigravity/copilot/grok text-only until verified); repeatable
  `--attach <file>` staging copies with JPEG APP1/APP2 and PNG
  tEXt/zTXt/iTXt/eXIf/tIME metadata stripped locally (zero-dep, self-tested
  on synthetic buffers); per-modality reject-don't-truncate size caps; routes
  missing an attached modality fail closed as `unsupported` before spawning;
  attachments recorded in dispatch events and reports as name/modality/
  bytes/sha256 only; optional additive `region` [x,y,w,h] field on findings;
  preflight reports per-route modalities; Setup Center modality row per
  provider card. Also: explicit `--timeout` now honored above the 360s agent
  cap (the clamp only bounds auto-scaled budgets), closing the 2026-08-23
  open item. Self-tests: dispatcher 44, setup-ui 18.
- **1.11.1** — ledger honesty fixes: a run with zero completed external
  reviews now wears an explicit "no verdict — 0/N completed" badge instead of
  a "0 findings" label that masqueraded as a clean pass (immediately exposed
  two failed 2026-08-19 release gates that had passed unnoticed); sealed
  reports list their non-success routes ("Routes without a review: …");
  reviewer track-record table rendered at the top of the ledger (same math as
  --stats); verify-first flags shown on findings; workspace-scope note in the
  header.
- **1.11.0** — ledger read-aloud, baseline tier: per-run "Read aloud" control
  in ledger.html driven by browser `speechSynthesis` (local, zero
  dependencies, disabled gracefully when unsupported). Narration is composed
  by `narrationFor()` from structured closed-vocabulary fields only — run
  label/id, governor, reviewer statuses, verdict split, severity counts,
  verify-first count, disposition tallies — never reviewer prose or artifact
  content (enforced by a sentinel self-test). Toggle semantics (click to
  speak, click to stop), `aria-pressed` state, 6 ledger self-tests
  (`ledger.mjs --self-test`). Verified live in-browser: 25 runs, speak/stop
  state transitions confirmed.
- **1.10.0** — per-agent tuned default personas (codex=surgeon,
  claude=architect, gemini=fresheyes, antigravity=adversary, copilot=verifier,
  grok=innovator; `none` to disable); ledger-derived
  `insights.reviewer_track_record` + `investigation_order`; `verify_first`
  flag; `--stats` table; Setup Center codex/gemini provider cards + gemini
  governor option; six-route readiness probe; connectivity timeout unified at
  240s (named constant, budget documented); dispatcher-grade process-tree
  containment in the Setup Center's child runners; self-tests 38 + 17.
- **1.9.x** — Setup Center (guided OAuth onboarding, quick setup, maintenance
  panel); versioned skills repo checks; update awareness.

## Open items

- **Source-bearing peer review of the momm release diff** — pending the
  owner's explicit approval sentence; do not dispatch without it.
- The running Setup Center instance must be relaunched after upgrades; old
  processes serve stale UI (observed live on 1.9.x → 1.10.0).
- **Agent timeout hard cap defeats --timeout on dense inputs** (observed
  2026-08-23): agentTimeoutMs clamps to 360s even when the user passes
  `--timeout 420`, so codex cannot finish a 63KB dense patch. Either honor an
  explicit --timeout above the cap, or surface the clamp in the report so a
  timeout is distinguishable from an impossible budget.

## Parked ideas (small, fun, or unproven)

- Demo flourish from grok's innovator persona (run `rev_20260823211631_18kv`):
  a `SOUND 110*I` variant of `demo/count_to_ten.bas` so the program audibly
  counts — a natural read-aloud sibling if a showpiece demo is ever wanted.
- `momm stats` persona/precision trends over time (needs the persona field in
  dispositions first).

## Alignment rules of thumb

1. Additive report fields only; `momm-report/1` consumers must never break.
2. Anything that speaks, uploads, or publishes defaults to OFF and local.
3. Every reviewer-facing prompt change ships with a negative control run
   (trivially-correct input must still yield zero findings).
4. Update this file in the same commit as the feature it describes.
