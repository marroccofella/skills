# MOMM 1.16.0 — measurement, ratings, guidance, throughput, upkeep

Status: candidate on branch `release/momm-1.16.0`, built 2026-09-13 from the 1.15.1 release. Not published. Plan: [plan-1.16.0.md](plan-1.16.0.md) (momm-reviewed twice before a line was written).

## What a user notices

- **Every review reports what it cost.** `reviewers[].usage` carries each CLI's own token and cost figures (Claude and Grok: full usage and USD; Codex: total tokens, model and CLI version from its `tokens used` line; Antigravity and Copilot: nothing, and the report says so), plus a labelled `input_estimate`. `usage_totals` is per route only; the ledger shows "k of n reported", never a zero for missing data.
- **Reviewers get a report card.** After triage, `ledger.mjs --rate <run_id> <reviewer> <1-5> --tags …` records how the review read; the ledger shows mean rating (from five ratings up), tag frequencies, and a 30-day completion table by route and input size with a recommendation only once ten dispatches exist. Early exits and governor-direct pieces are excluded from completion rates.
- **Standing guidance.** `.momm/guidance.json` per project (trusted once by hash: `multi-review.mjs guidance --trust <sha>`), `~/.momm/guidance.json` per user, `--guidance route=text`, `--guidance-file`, `--guidance-governor`. Persona stays a selector; every other layer appends; per-block and per-route budgets; the report keeps hashes only and the text lives in `.ensemble_reviews/guidance/<run>.json`. `.reviewrules` is now a guidance layer with a one-release trust grace.
- **Big diffs stop timing out by hand.** `--split auto|<KB>` packs files by directory affinity into pieces, repeats only file headers, reviews every piece through a bounded scheduler (`--jobs`), judges quorum per piece, merges one parent report with per-piece outcomes, and hands any hunk larger than the ceiling to the governor as `governor_direct` scope rather than dropping it. Header-only quotes never corroborate.
- **Dashboards.** Setup Center and ledger follow the system theme with a toggle. Setup Center gains a guidance editor with an effective-prompt preview (artifact replaced by a placeholder), a usage panel, an automatic-updates card, batch CLI update with one confirmation, and auto-regeneration of the ledger while it is open.
- **Updating.** `update --check-all` lists the skill, every reviewer CLI (installed, latest, package-manager-owned), and each route's last successful review. The event-driven update clock checks sources only when due, with conditional GETs (a 304 costs nothing), doubling intervals when nothing changes and tightening after a release, triggered by reviews, Setup Center use, or an optional OS timer. Automatic updates are **off by default**; when enabled they apply only signature-verified skill releases and official CLI updaters, never bypass a failed verification, keep protocol changes behind explicit acceptance unless that toggle is also on, and run containment probes after every CLI change.

## Live measurement

| Artifact | Method | Wall clock | Quorum |
|---|---|---|---|
| 135 KB 1.15 gate diff, 3 routes | manual lanes, 15 hand-cut pieces (2026-09-13 00:41) | ~26 min | 5 of 15 pieces |
| Same diff, `--split 12 --jobs 6` (run rev_20260913134425_f4kn) | one command, 15 pieces, 42 route reviews | 36.6 min | 15 of 15 pieces |

Reading: quorum coverage tripled, wall clock was slower. The scheduler ran at most six reviewer processes (the hard cap) where the hand-cut lanes ran nine, and Codex needs about 100 s per 12 KB piece, so throughput is bounded by concurrency, not by splitting. Per route: Codex 14 of 15 pieces, Antigravity 14 of 15, Grok 9 of 15 (six exact-quote rejections). Usage was recorded for Codex (149 K tokens across 14 pieces) and Grok (578 K across 9); Antigravity reports none. Tuning for the next candidate: allow `--jobs` up to 9 when three or more routes are active, and let per-route caps come from the ledger.

## Deferred from the plan, on purpose

- `--early-exit` after quorum: needs in-flight cancellation inside `runProcess`; the scheduler already supports it, the dispatcher does not yet call it.
- Adaptive per-route timeouts from ledger seconds-per-KB: pieces scale with the existing size-based timeout; the E2 buckets exist so the next release can learn from them.
- `--split auto` stays opt-in until five live runs over 100 KB beat the manual baseline and the coverage fixture shows at most 10 % loss.

## Verification record (candidate, 2026-09-13)

- Local suites: 15 test files plus 5 self-tests, all green after fixes (`usage`, `guidance`, `split`, `scheduler`, `update-clock`, `probes` added to both CI workflows; OS matrix CI not yet run — the branch is unpushed).
- Release gate: run `rev_20260913143455_cx2r`, the 337 KB code diff of this branch reviewed through the new `--split 12 --jobs 6` by Codex, Grok and Antigravity; 24 pieces, quorum 2 met on all 24, 49.6 min; 66 findings (3 CRITICAL, 58 WARNING, 5 NITPICK) and 157 suggestions. Rulings: 45 applied with a failing test first, 5 applied with modification, 11 rejected (chunk artefacts or not reproduced), 5 nitpicks deferred, all suggestions carried forward. Reviewer ratings recorded with `ledger.mjs --rate`.
- Governor-direct scope: 7 hunks larger than the ceiling (whole new files) were reviewed whole as their own artifacts (runs `rev_20260913144450_tkrr`, `_144544_g83d`, `_144715_1e05`, `_145221_8nez`, `_145408_oxfr`, `_145943_7tl5`, `_150604_byvj`); 56 findings including 4 CRITICALs (probes held-by-prompt-echo and launcher verdict; guidance cross-file trust and untrusted-file crash; update-clock lock crash), 41 applied, 8 applied with modification, 1 rejected, nitpicks deferred. Two runs that missed quorum on timeouts were re-run against the fixed code with a 600 s budget.
- Still owed before release: OS matrix CI on the pushed branch, privacy scan, signed tag via the release workflow, public evidence refresh, and the 1.15-era holds that remain open (Grok exact-quote rejection rate; evidence-cap streaming is in 1.15.1).

## Suggestions carried forward

157 gate suggestions and 52 direct-review suggestions are recorded as `deferred` rows in the private ledger against their run ids. Themes worth scheduling for 1.16.1: per-route caps learned from the ledger and a higher `--jobs` ceiling when three or more routes run; `--early-exit` once in-flight cancellation exists in `runProcess`; synthetic-diff hunk counts in the probe fixture; CRLF normalisation for JSON guidance; `Object.create(null)` maps in the guidance resolver; sidecar directory mode 0o700.
