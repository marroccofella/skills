# MOMM 1.15.0 — explicit updates and clearer evidence

Release candidate. Publication is complete only after the safety matrix, privacy
review and signed-tag verification; this file is not proof that the tag exists.

## Changes

- First-class `update` command: manifest/changelog check; verified staged dry run;
  explicit apply; previous-installation rollback and an out-of-checkout recovery runner.
- Per-harness installation scopes in `momm.lock`; both installers require a
  target, and mixed MOMM-only/collection installs retain their original scope.
- Stable, pinned and signed-development-checkpoint channels. No automatic update.
- Full policy diff in the preview and a separate `--accept-protocol` gate that
  `--yes` cannot override. Setup Center no longer bypasses this with `git pull`.
- Exact release-workflow signature identity and package SHA-256 verification.
  Actual dispatcher, updater and protocol hashes are recorded in new reports.
- Daily opt-outs including `DO_NOT_TRACK`; a notice is not update authorization.
- Five focused information pages; corrected project working-directory guidance;
  one deterministic renderer for public evidence, tables, downloads and hashes.
- Interrupted daily-check recovery, ignored-file transition protection, matching
  signed-tag reuse on publication retry, and a main-checkpoint-only signing mode.
- Local-only public read-aloud refuses browser-default or remote voices. Review
  parsing prefers final envelopes; an unmet quorum cannot be labeled complete.

## Evidence corrections

The existing 2026-09-04 public snapshot remains the source—not a fresh run:
153 run records, 139 stored reports, 366 successful log responses versus 343
stored responses (23 summary-only), and 570 decision records. Those decisions
are 302 applied, 251 rejected, 8 deferred and 9 historical unclassified rows.
31 coalition/multiple-route decisions are kept separate from individual routes.
These are this project's development records, not an independent benchmark.

Public report hashes now cover canonical sanitized JSON. The older stored-file
hash is explicitly labeled private-source provenance, not public-byte verification.
Malformed imports and conflicting duplicate run IDs fail visibly.

## Verification and limitations

Updater fixtures use disposable real Git repositories and actual installers.
They cover manifest-only behavior, non-mutating preview, protocol refusal,
unsigned-tag rejection, bad hashes, dirty files, pinning, failed relinking,
per-harness scope, wrong post-relink commits, helper-code provenance, offline
recovery, opt-outs, stale claims, changed ignore rules, trust-environment overrides
and archive installation. Browser checks cover desktop/mobile layout and actual
ledger rendering; fake speech tests confirm missing/remote voices never play.
Positive transaction fixtures replace the signature service deliberately;
the release workflow and final live verification must exercise the real signer.

The updater does not claim recovery from deleted repositories, missing Git objects,
damaged storage or missing harness prerequisites. It refuses local edits and an
unrelated concurrent checkout. Legacy unsigned releases require an explicit
bootstrap; they are not update targets or retroactively signed.

This release does not solve every reviewer reliability issue or mechanize the
governor's reproduction protocol. See the maintained roadmap for large-input route
failures, POSIX descendant cleanup and decision-lifecycle work. No API-key support,
repository split, telemetry collection or marketing outreach was added.
