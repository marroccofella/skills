# MOMM 1.15.0 — explicit updates and clearer evidence

These notes were prepared for the release candidate. Publication is complete only
after the safety matrix, privacy review and signed-tag verification. Check the
[canonical release record](https://github.com/marroccofella/skills/releases/tag/momm-1.15.0)
and signature before installing; this file is not proof that the tag exists.

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
- A source-linked version archive separates published releases, historical tags
  and public code milestones. An existing-user upgrade prompt covers both saved
  installation receipts and explicitly approved legacy bootstrap; it never
  instructs an agent to bypass signature or protocol-consent checks.
- Interrupted daily-check recovery, ignored-file transition protection, matching
  signed-tag reuse on publication retry, and a main-checkpoint-only signing mode.
- Local-only public read-aloud refuses browser-default or remote voices. Review
  parsing prefers final envelopes; an unmet quorum cannot be labeled complete.
- Completed-review contract with quoted scope and strict pre-normalization
  validation; incomplete, malformed and oversized replies never silently qualify.
- Offline governor completion command: unique item decisions, original seals,
  reproduction/refutation records and final source/test/output hashes. A receipt
  is separate from the original report; later edits invalidate current completion.
- Growing append-only logs are streamed and fully hashed instead of failing at
  the individual-evidence-file size limit. Records and selected-run data remain
  bounded; malformed records and concurrent log changes fail closed.
- Stabilisation: visible partial-installer results, skill-list whitespace handling,
  actionable torn-claim and malformed-policy errors, source-snapshot race checks,
  explicit root guidance and accurate a/b path binding. Dirty checkouts cannot pass
  the release seal. Signing dependencies and successful-run lookup are hardened.
- Preview redirects/error handling, copy-feedback races and restored harness
  selections are covered by offline tests. Grok uses explicit tool denies instead
  of an ineffective empty tools argument, with a bounded four-turn final-response
  budget; this is CLI policy, not an OS sandbox or a universal reliability claim.

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

The controlled lifecycle test runs real authored failing/passing tests with
synthetic peer replies, without provider calls. It is not proof that every harness
obeys the protocol. Record validation cannot establish that an observation is
truthful or a chosen test adequate; no peer snippet is executed automatically.
This release does not solve every reviewer reliability issue. See the maintained
roadmap for large-input route failures, independently detached processes and unsupported
source/media lifecycle binding. No API-key support,
repository split, telemetry collection or marketing outreach was added.
