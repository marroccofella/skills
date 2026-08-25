# MOMM 1.12.1 — unreleased first-run and completion candidate

Release candidate as of 2026-08-24. It is **not published**: the public update manifest and latest annotated release remain at 1.10.2 until the final commit, cross-platform gates, tag, GitHub release, and public documentation agree.

This candidate is cumulative on the hardened 1.10.2 baseline. It combines guarded media review and local-only ledger narration with a machine-enforced governor phase, durable first-run evidence, and truthful completion states.

## First-run and completion contract

- Peer collection always reports `review_complete: false` and an unmissable `required_user_message`; even unanimous ACCEPT is not a completed review.
- Every raw reviewer finding claim and every successful reviewer's suggestion becomes a stable obligation bound to the sealed report digest. The sealed action set carries an explicit obligation-derivation version; canonical equality is enforced only for that supported version, while missing or unsupported versions remain historical `legacy_unverifiable` evidence and require fresh peer collection. Correlation remains useful for prioritization but can never force distinct raw claims into one governor ruling.
- MOMM creates a self-describing private draft. Findings use `fixed`, `accepted_open`, or `rejected`; suggestions use `applied` or `rejected` plus a claim type. Material findings require reproduction evidence or a documented attempt, and applied behavioral suggestions require reproduced-before evidence; fixed/applied items require passing-after evidence; every run needs a passing final project check.
- Finalization verifies exact decision coverage, peer quorum, report/log digest binding, and outcome-specific evidence. It creates an immutable completion sidecar and log anchor without changing the sealed peer report. A fresh status gate is authoritative.
- Peer output remains available on stdout when a required evidence surface fails, but the dispatcher exits with dedicated code `4` instead of reporting false success. `governor_handoff_ready` distinguishes an unsealed report/log/draft failure that must be repaired and re-run from a ledger-only failure whose already sealed finalize/status argv can be resumed after repair.
- Headless onboarding self-excludes the governor before it constructs review argv. If no external route remains, machine output carries `first_review: null` plus a blocked reason instead of an impossible quorum command; an explicitly selected optional route such as Gemini remains in the structured argv.
- The ledger distinguishes pending, blocked peer gate, complete clean, complete with open findings, invalid, and legacy-unverifiable states. Pending runs show explicit `0/N` obligations and next actions. Legacy free-form disposition rows remain historical only and cannot satisfy completion.
- Per-run and global log locks have separate namespaces, stale-lock recovery, and crash-tail preservation. Missing or tampered anchors fail closed.

## Durable and private evidence

- Git-root discovery works from nested project directories. MOMM protects the private evidence directory through local `.git/info/exclude` and verifies the rule before reviewer calls without modifying tracked `.gitignore`.
- A marker and bounded legacy-signature checks prevent adoption of an unrelated directory. Managed symlinks/junctions, path traversal, repo-root evidence targets, and already tracked evidence fail closed.
- System-temporary evidence is refused before dispatch by default. The explicit test-only override produces a warning before dispatch and repeats the deletion risk in the mandatory final status.
- If Git privacy protection later fails, status still returns the validated completion state as structured data, withholds the ledger link, reports `privacy_error`, and exits nonzero.
- MOMM requests `0700` directories and `0600` files on POSIX. Windows inherits the selected directory's ACL; this candidate does not claim to replace or harden it.

## Honest correlation and UI

- Every bounded raw claim survives in the report. Deterministic multi-signal correlation uses normalized locations and semantics, never merges two claims from the same reviewer, and preserves the original v1 agreement-score meaning while adding source coverage.
- Zero successful external routes render **no verdict**, never “0 findings.” Failed routes retain their closed status vocabulary.
- Every run has keyboard-accessible **Read aloud / Stop** controls. Narration is composed from bounded allowlisted structure only; reviewer prose, finding text, suggestions, media evidence, paths, and unknown values are never spoken. Only browser voices reporting `localService === true` are eligible, with no cloud fallback.

## Explicit attachments

- `--attach <file>` is repeatable. Attach-only reviews never infer `git diff HEAD` or load `.reviewrules`; explicit text-plus-media reviews continue to apply `.reviewrules`.
- Original names and paths never enter provider prompts or persisted evidence. Generated IDs, bounded descriptors, sent-byte hashes, and one ordered aggregate artifact hash bind the report to the staged payload.
- Sources are opened as stable regular files; links and path swaps fail closed. Size/count/aggregate limits precede bounded reads, formats receive signature/header screening, PNG/JPEG privacy metadata is removed, staging is private/read-only, hashes are rechecked before every spawn, and tracked process/temp cleanup covers normal and cooperative-interrupt paths.
- PDF, the reviewed audio set, and MP4/MOV/WebM require explicit `--allow-unstripped-metadata`; audio additionally requires voice-owner consent. Media-capable routes and content-witness acceptance remain documented and fail closed.

## Deterministic release evidence

- Dispatcher, Setup Center, offline UI, private-ledger, completion-contract, and deterministic fresh-user round-trip suites run without provider calls.
- The fresh-user test exercises nested Git roots, local privacy exclusion, pre-spend temporary-directory refusal, stream purity, a blocked peer gate, pending `0/N`, legacy-row non-authority, exact decision coverage, immutable report bytes, final status/ledger handoff, temporary-risk relay, and privacy failure after completion.
- The Actions matrix runs the same contracts across Windows, macOS, and Linux on supported Node versions. Exact counts are read from live suite output rather than frozen into release prose.

No attachment, original filename, temporary path, private ledger, credential, API key, or voice/model asset belongs in a public release or public evidence export.
