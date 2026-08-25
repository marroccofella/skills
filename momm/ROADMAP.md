# MOMM roadmap

This file separates released behavior from ideas. A feature moves to **Shipped** only when implementation, deterministic tests, release notes, public documentation, the final annotated tag, and the public release all identify the same commit.

## Unreleased candidate

### 1.12.1 — reliable first run, closed-loop review, narration, and media

- Peer collection is explicitly unfinished. Every raw finding claim and suggestion becomes a stable, report-bound governor obligation; finalization plus a fresh status gate creates digest-anchored completion evidence. Legacy free-form disposition rows remain historical only.
- Correlation cannot erase adjudication choices: each original reviewer claim is separately decidable even when several claims share one correlation group. Material findings and applied behavioral suggestions require reproduction; fixed/applied outcomes require verification and final project checks.
- Evidence resolves from the project Git root, is protected through verified local `.git/info/exclude`, rejects tracked/unsafe/unrecognized zones, refuses temporary storage before reviewer calls by default, and repeats any explicitly accepted temporary-storage risk at final status. POSIX modes are private where honored; Windows inherits the selected directory's ACL.
- Pending, blocked, invalid, legacy, complete-clean, and complete-with-open-findings states are machine-validated and visible with next actions. Concurrent finalization/log writes use separate lock namespaces and crash-tail recovery.
- Every run in the private local ledger has a keyboard-accessible **Read aloud / Stop** control. Narration is composed at the speech sink from bounded and allowlisted structural fields only. Reviewer prose, finding text, suggestions, media evidence, paths, and unknown values are never spoken.
- MOMM selects only a voice for which the browser reports `SpeechSynthesisVoice.localService === true`; there is no cloud fallback. Speech is chunked, cancellation is generation-guarded, stale callbacks cannot reset a newer run, engine failures reset truthfully, stalled utterances have a watchdog, and page exit cancels playback.
- A run with no successful external route says **no verdict**, never “0 findings.” Failed routes remain visible from the sealed report. Attachment descriptors and valid image regions are shown without media bytes, original names, or paths.
- Suggestion history is presented only as governor-recorded decision counts (adopted, qualified adoption, rejected, and unclassified). It is not called precision, accuracy, a reviewer ranking, or an automatic investigation prior.
- Repeatable `--attach` supports explicit PNG/JPEG image review through capable adapters. PDF, the reviewed MP3/WAV/AIFF/AAC/OGG/FLAC audio set, and MP4/MOV/WebM video remain fail-closed until `--allow-unstripped-metadata` records the user's explicit metadata-risk choice. Audio additionally requires voice-owner consent.
- Attach-only never infers `git diff HEAD` or loads `.reviewrules`. Source names and paths are replaced by generated IDs. MOMM enforces format-specific signature/header screening (with deeper PNG/JPEG/PDF parsing), per-file/count/aggregate caps before bounded reads, link rejection/opened-source binding, private read-only staging, source/sent-byte hashes, reviewer-claimed per-route observations, compatible-route/quorum gates, and tracked process/temp cleanup before report persistence or cooperative interruption. Claimed observations remain untrusted model evidence; content-witness probes establish end-to-end adapter evidence.
- Codex uses its native image option, Claude Code uses a constrained Read route for image/PDF, and optional Gemini uses relative private-stage references for its reviewed image/PDF/audio/video set. Other routes remain text-only. MOMM filters implicit defaults but never auto-adds optional Gemini.
- Automatic timeout budgets add bounded modality headroom. Explicit `--timeout` values are exact per reviewer, constrained to 1 millisecond–3600 seconds, and recorded per route.
- The Setup Center renders the shared modality matrix alongside CLI, account, and model state, including the existing 320-pixel containment contract.
- Deterministic release gates cover dispatcher security/media/timeout behavior, Setup Center behavior, offline UI contracts, and private-ledger narration/honesty across Windows, macOS, and Linux on Node.js 18, 20, and 22.

This section remains a candidate until implementation, deterministic tests, release notes, public documentation, the final annotated tag, GitHub release, and `versions.json` all identify the same commit.

## Shipped

### 1.10.x — Setup Center and release hardening

- Local loopback Setup Center with six-provider authority, isolated synthetic connectivity probes, diagnostic scrubbing, truthful route states, safe visible maintenance handoffs, and hydrated narrow-screen layout contracts.
- Provider-scoped OAuth environments, one-use setup-probe IPC authorization, cross-platform process-tree termination, evidence sealing, and public Pages/release verification.

## Planned

### Consented premium voice

- Optional `myvoice` / F5-TTS narration through an explicitly configured `MOMM_READALOUD_COSYFLOW`.
- Opt-in only, with the same closed-field narration boundary, local model preflight, consent disclosure, and a recorded listening verdict before acceptance.
- Baseline browser-local speech remains dependency-free and available independently.

### Dispatcher summary narration

- An explicit `--read-aloud` flag may narrate the final structural review summary after the report and ledger have been safely persisted.
- It must default off, never delay or corrupt report output, never speak reviewer prose or source, and share the ledger's local-only boundary.

### Additional media formats and sanitizers

- GIF, WebP, BMP, SVG, M4A, MKV, and other containers remain unsupported until each has a bounded parser/sanitizer, a verified CLI ingestion witness, honest evidence semantics, and cross-platform fixtures.
- A format is never advertised merely because an installed CLI's MIME table recognizes its extension.

## Invariants for future work

1. The governor remains the sole writer and verifier.
2. Private ledgers, attachments, and `.ensemble_reviews/` telemetry are never published by default.
3. Speech and media features fail closed on privacy and capability uncertainty.
4. No roadmap claim becomes a release claim without executable evidence.
5. Optional voice/media dependencies cannot weaken or block the core text-review path.
