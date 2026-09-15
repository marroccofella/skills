# MOMM 1.16.0 candidate — review brief for the Codex session

Written 2026-09-15 by the Claude session that built the candidate, for an independent review before any release step. Branch `release/momm-1.16.0`, draft [PR #4](https://github.com/marroccofella/skills/pull/4). Every commit named below has its own green nine-job matrix (ubuntu, macOS, Windows × Node 18, 20, 22). Nothing is merged, sealed, signed or published; stable remains 1.15.1. This brief summarises; the verification record is [release-1.16.0.md](release-1.16.0.md) and the plans are [plan-1.16.0.md](plan-1.16.0.md) and [plan-1.16.0-e7-modalities.md](plan-1.16.0-e7-modalities.md).

## What the candidate adds

- **Measurement.** Per-CLI token and cost figures from each CLI's own envelope (`usage.mjs`), never estimated; `usage_totals` per route; the ledger and Setup Center show "k of n reported".
- **Ratings and reliability.** `ledger.mjs --rate <run> <reviewer> <1-5> --tags …`; mean from five ratings; 30-day completion by route and input size; recommendation only from ten dispatches.
- **Guidance.** Project, user, run and governor layers behind a per-file trust gate (`guidance --trust <sha>`); untrusted text is never sent; hashes in the report, text in a sidecar.
- **Throughput.** `--split auto|<KB>` with per-piece quorum, header-only quotes never corroborate, oversize hunks become `governor_direct` scope with their own obligation; `--jobs` bounded scheduler.
- **Upkeep.** `update --check-all`; an event-driven update clock with conditional GETs and adaptive intervals; the automatic-update toggle is off by default and no agent may enable it; containment probes after CLI changes.
- **Design system.** One `momm-theme.css` shared by the Setup Center and the private ledger, theme toggle, cross-links.
- **E7, modalities.** A shipped baseline `capabilities.json` (levels `verified` only from help captures, otherwise `documented`), a per-machine overlay written only by probes (blockers expire into `reprobe`, never silently clear), `multi-review.mjs --capabilities`, attachment routing on the effective cell with `requires` bound to argv or `missing_flag`, `--reviewers auto` as the intersection of routes that take every attachment, `probes.mjs <cli> --modalities [--consent]` with synthetic material and content assertions, `modality.mjs plan|run` for cross-route chains with an immutable creative prompt and step-scoped harvest, and a Setup Center Modalities panel.

## How it was built and gated

1. Plan reviewed twice by momm before code. E7 designed and reviewed twice more (`rev_20260913200258_g63x`, `rev_20260913200824_pd6p`; 28 findings applied).
2. Release gate on the 337 KB branch diff with `--split` (run `rev_20260913143455_cx2r`, 24 pieces, quorum on all): 66 findings, 157 suggestions, every material finding reproduced with a failing test before a fix.
3. Seven oversize files reviewed whole as `governor_direct` (four real CRITICALs fixed).
4. The author's pre-release audit: nine gaps reproduced and fixed; one incident recorded (an adversarial fixture ran a real `npm install`; guarded the same hour).
5. E7 gate on the staged E7 diff (`rev_20260913213315_o8c2`, 13 pieces, quorum on all): 49 findings and 87 suggestions, 136 decisions logged against the governor's item ids.
6. Independent readiness audit (2026-09-14) and its verification of `2647054`: four issues fixed (strict recursion-depth parsing; typed refusal for malformed plans; input hashing under terminal-state handling; live-cell step level), six media-runner regressions folded in, real-path entrypoints for the new CLIs.
7. Live evidence on this machine (account logins only): input probes on six CLIs wrote 12 overlay entries; a registry-routed review with an attached red image that both auto-selected reviewers described; three generate → critique rounds (below); negative controls that never dispatched (Gemini `auth_tier`, Grok `missing_flag`); the Modalities panel served live.

## The generate → critique rounds (2026-09-15)

| Round | Generation | Critique (governor excluded) | Result |
|---|---|---|---|
| 1 | `media_20260915090046_bd21d99e`, Codex, 75 s | `rev_20260915091159_itvh` — dispatched with `--governor other`, which let the Claude route review under a Claude harness; recorded as a protocol breach, Claude's row treated as the governor's own | No ears under the hat, oversized brim, hard light; Codex accepted at 0.93 and missed all of it |
| 2 | `media_20260915093052_36cd5466`, Codex, 61 s | `rev_20260915093602_whbi`, codex + antigravity, 230 s | Ears, light, size and eyes fixed; no fur compression, ear-base clipping, stray whiskers |
| 3 | `media_20260915094319_2a019812`, Codex, 134 s | `rev_20260915094814_9vi1`, codex + antigravity, 164 s | Brim overlaps both ears again; still no fur compression; Antigravity REJECT (severity judged inflated), Codex MODIFY |

Conclusion: the photorealistic goal is met in all three; strict prompt compliance on contact physics (fur compression, ear clearance) was never achieved by prompt wording alone, and round 2 is the best image. Timing: each critique's wall clock equals Antigravity's reply (160 to 229 s); Codex answers in 52 to 73 s. Every finding and suggestion has a logged disposition; reviewers were rated per run.

## Known limitations, stated exactly

- MOMM checks initial media types by filename extension, not file contents. Malformed or mislabelled files may still proceed; downstream rejection is not guaranteed.
- Corroboration is by finding id, so the same observation from two routes under different ids scores agreement 0. Read agreement 0 as "no id-level corroboration", not disagreement.
- A route whose overlay entry has expired to `reprobe` is left out of `--reviewers auto` until someone probes by hand. That is the intended fail-closed default; any automatic re-probe would spend quota and needs a disclosure and explicit permission.
- Grok media is not bound in the review adapter (its containment is `--deny Read`), so its image and PDF cells route as `missing_flag`.
- `--governor other` is valid only when the controlling harness is none of the named routes.
- The completion validator's `momm-check/1` manifests were not produced for the gate runs; `governor.mjs --run` joins every decision but reports that gap.

## 1.16.1 candidates (not in this release)

Semantic corroboration that links, never merges; a per-route deadline for media critiques so one slow route does not hold the report; one command for generate → critique → draft dispositions; a stored image-review brief; a content sniff for media types; an opt-in, disclosed re-probe under `--reviewers auto`; `--jobs` up to 9 with three or more routes; `--early-exit` once in-flight cancellation exists.

## What the reviewer is asked to do

Review the branch as a whole against `main` for correctness and for anything that weakens the review core (sole writer, reproduce before fix, OAuth only, no generation inside a review, off-by-default automation). Reproduce any material finding before proposing a fix; do not enable any toggle; do not run installers; treat `.ensemble_reviews/` as private telemetry. The release steps that remain, in order, once the review is clean: `momm-check/1` completion evidence for the gate runs, privacy scan on the final head, `momm-release.mjs --prepare` to seal the manifest entry, the signed tag through the release workflow, public evidence refresh, and a clean install and upgrade proof. None of these has been started.
