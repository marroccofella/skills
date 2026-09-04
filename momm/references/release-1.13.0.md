# MOMM 1.13.0 — reconciled lineage, momm-reviewed fixes, walkthrough and evidence refresh

Released 2026-09-04.

## Why a minor bump

Two lines of MOMM had been developed in parallel after the 1.9.1 acceptance-test-plan commit:

- the **published** 1.10.0 → 1.10.2 line (Setup Center hardening split into `oauth-env.mjs`, `provider-manifest.mjs`, `setup-probe-contract.mjs`, plus an offline UI contract test), and
- the **installed** 1.11.0 → 1.12.0 line (per-agent tuned personas, ledger-derived reviewer track record, `verify_first`, multimedia `--attach` review with metadata stripping, ledger read-aloud, ROADMAP).

1.13.0 is the merge. It keeps the installed 1.12.0 implementation for `momm/` (single-file dispatcher, monolithic Setup Center), takes `myrepo` 1.3.1 and `myskills` 1.1.0 from the published line, and removes the modules nothing imports any more. The 1.10.x release notes stay in `references/` as history. The separate, unpublished 1.12.1 "first-run completion" candidate is preserved unchanged on branch `candidate/momm-1.12.1` for future evaluation; none of its obligations/finalize protocol is in this release.

## Fixes found by MOMM reviewing MOMM

Run `rev_20260904131435_mf6w` (governor claude; codex, copilot, grok completed; antigravity returned `invalid_output`). Every finding was reproduced with a minimal failing script before a fix was authored, and each fix carries a regression self-test:

- **CRITICAL — Setup Center `supervise()` misreported timeouts** (codex + copilot, corroborated). The timer added a second `close` listener, but the ordinary listener registered earlier always ran first and settled with `timedOut:false`, so a connectivity check killed for overrunning looked like a normal failure. Fixed with a `timedOut` flag read by the single listener. Self-test `timeout_reports_timed_out`.
- **WARNING — ledger read-aloud stale event** (codex). A cancelled utterance's late `onend`/`onerror` reset the control of the run that had superseded it. The reset is now guarded by utterance identity. Self-tests `stale_speech_event_cannot_reset_newer_run`, `own_speech_end_resets_control`, driven against a fake DOM.
- **NITPICK — myskills redacted the myautoness reference path only on drive D:** (codex). Redaction now keys on any path separator.
- Codex's suggestion to share provider capabilities between the Setup Center and the dispatcher was accepted in goal and changed in mechanism: the dispatcher stays one dependency-free file, and the Setup Center self-test now parses `MODALITY_SUPPORT` out of it and fails on drift (`modalities_match_dispatcher`).
- Ledger pre-indexes dispositions by `run_id` (codex suggestion).

Rejected with reasons on the record: de-duplicating the layered termination chain (a protocol hard constraint), refactoring `narrationFor` (already pinned by sentinel self-tests), and a placeholder Grok entry.

## Public page, walkthrough, and evidence

- `docs/momm/` rebuilt: 42.uk theme, a narrated walkthrough (consented synthetic clone of the creator's voice, generated locally by F5-TTS through Promptus, labeled as synthetic), diagrams of the review flow and of the mapping onto editorial peer review, and charts computed from the sealed ledgers.
- A scientific peer-review specimen: a synthetic manuscript excerpt with planted flaws was refereed by the coalition under a `.reviewrules` file of journal guidelines (run `rev_20260904131823_wvxh`: three REJECT verdicts, 26 raw findings, every planted flaw caught). The sanitized report is published beside the page.
- Public evidence export regenerated from this repository's own ledgers by `export-public-evidence.mjs` (paths normalized, ledger links removed, digest sidecar re-sealed; CI verifies both).

## Known observation from the specimen run

On prose artifacts the findings' `target_file` values are free-text section labels and `line_range` is empty, so the corroboration merge never fires: the specimen run reports `agreement_score` 0 although three referees flagged the same eight defects. Recorded in ROADMAP as the next correlation improvement. Verdict agreement (3/3 REJECT) is unaffected.

## Companion: myrepo 1.3.2

The privacy scan now asks git for its ignored entries and skips them — private momm telemetry, a 2 GB Whisper cache and local `.env` files were blocking a publish although none of them can ever be pushed. Tracked and untracked-but-unignored files are scanned exactly as before; secret checks stay unwaivable. Found while publishing this release.

## Verification

Dispatcher self-test 49/49, Setup Center 20/20 (two new), ledger 8/8 (two new), myskills health contract, myrepo offline safety self-test, onboarding smoke, doctor, yorkshire-pudding 13/13, and the Windows/macOS/Linux × Node 18/20/22 Actions matrix.
