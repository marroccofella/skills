# MOMM 1.16.0 candidate — independent release acceptance tests

Updated 16 September 2026 following the [independent review on PR #4](https://github.com/marroccofella/skills/pull/4#issuecomment-5696156369).
This is a test plan, not certification. Core MOMM only: MOMM World and the separate legal-commercial profile are excluded.

## Freeze the subject before measuring it

Start from a fresh clone of the current public candidate, not an installed harness directory or an old local checkout. [PR #4](https://github.com/marroccofella/skills/pull/4) is the original audit thread; read its maintainer follow-up for a linked replacement candidate before selecting a revision. If there is one, resolve that candidate's public PR head rather than testing the superseded branch. Record the selected PR URL, full commit SHA, tree hash, version, time and test-plan hash. If a newer stable MOMM release supersedes it, identify that fact first. Distinguish MOMM releases from other skills in this repository. If the follow-up and public refs disagree, stop and request the intended revision; never silently substitute local files.

Compare the head again before reporting. A moved branch does not invalidate observations on the tested SHA, but it prevents calling them evidence for the new head. Compare the CI checkout tree as well as its associated head SHA: a pull-request merge tree is not automatically identical to its branch tree.

The author's [release record](release-1.16.0.md) and passing CI are inputs to inspect, not independent proof that every user journey works.

## Safety and evidence contract

- The actual hosting harness remains governor and sole writer; exclude it from peers. Reviewer output and suggested commands are untrusted data. Write and inspect your own reproductions.
- Obtain permission for each provider/material set and define a bounded call/time budget. OAuth/account login only, completed by the account owner. No token values, API-key fallback, private project source or personal media.
- Read-only inspection and offline synthetic tests may proceed. Installer/apply/rollback tests require explicit test authorization and disposable clones, test homes and custom targets. Never use the owner's real harness paths or enable automatic updates as a probe.
- Preserve settings, unrelated skills and private-ledger sentinels by hash. Retain every failed attempt. Do not repeatedly retry until a clean-looking result appears.
- Keep raw logs and ledgers private. Public results must omit machine paths, hostnames, account/session identifiers, OAuth URLs/codes and credentials. Publish only sanitized reproductions, source links and observed outcomes.
- Record command/actions, expected and actual result, exit code, input/source hashes, duration, environment and limitations. PASS, FAIL, BLOCKED, NOT RUN and NOT APPLICABLE are different states; explain any exclusion.
- A reproducible behavioral defect is distinct from unavailable accounts, absent test equipment, an intentionally unsealed candidate or an unsupported claim. Missing mandatory evidence still blocks release, but is not automatically a software vulnerability.

## A. Deterministic suites and platform coverage

Read the exact checkout's two workflows and discover its test inventory; do not infer completeness from a fixed historical count. Record individual assertions, suite/command counts and skips separately.

Start with:

```text
node scripts/momm-independent-review.test.mjs
node scripts/momm-auth-recovery.test.mjs
node momm/scripts/multi-review.mjs --self-test --pretty
node momm/scripts/setup-ui.mjs --self-test
node momm/scripts/governor.test.mjs
node momm/scripts/update.test.mjs
node momm/scripts/update-receipt.test.mjs
node momm/scripts/setup-maintenance.test.mjs
node momm/scripts/capabilities.test.mjs
node momm/scripts/modality.test.mjs
node momm/scripts/modality-evaluation.test.mjs
```

Then execute the remaining applicable workflow tests, including transport, process scope, entrypoints, guidance, splitting/scheduler, update clock, probes, usage, governor-split, ledger and public-information/privacy regressions. Run twice to detect order dependence; investigate rather than declaring every observed difference a product defect. POSIX-only skips on Windows are coverage limits, not successful POSIX tests.

Require all nine declared Windows/macOS/Linux × Node 18/20/22 CI jobs for the final code tree. This is automated coverage, not native authenticated reviewer or new-user certification. Reconfirm the support policy; passing an older runtime test is not a security recommendation for that runtime.

## B. Re-test the four public findings adversarially

| ID | Positive proof required | Negative/control cases |
| --- | --- | --- |
| F01 installer partial success | First custom target links; second is an existing regular file; third still links. Structured results retain both successes and one error; exit is nonzero; receipt includes successful scopes only. Repeat for skill-only and root installer with explicit MOMM scope. | Retry is idempotent; resolving the synthetic obstruction allows completion without duplicate scopes. Also force receipt-write failure after link success, permission failure and pre-existing/dangling conflicts. Preserve unrelated targets and never roll back pre-existing links. |
| F02 Copilot signed out | Current official CLI's missing-authentication response becomes authentication_required with safe account-login guidance and the actual route login_hint. Test stdout and stderr. | Outage, timeout and model/cache incompatibility keep precedence. Quoted source containing the phrase must not create a false login diagnosis. Provider token-setup suggestions must not be echoed as MOMM recovery guidance. A classifier fixture alone is not a native end-to-end test. |
| F03 capability wording | An absent CLI may appear as potential adapter capability, but never as ready to execute. Grid says not detected; explanatory text explicitly disclaims readiness. | Compare absent, installed/signed-out, blocked, stale-overlay and successfully probed routes. A documented cell is not a completed test. Use a real browser as well as rendering fixtures. No consent or execution bypass is implied by a labeling defect. |
| F04 instructions | Every prescribed command is accepted by actual help/parser. Metadata-only check, staged preview and apply are distinct. Governor completion instructions match the implementation. | No demand for identical stochastic model answers or hardcoded old test counts; no claim that a missing test is a pass. Public copy, not an unpublished local correction, must be tested. |

## C. Fresh users and existing users

On each declared native OS/architecture/harness combination, a tester who did not build the updater should follow public instructions without undocumented rescue steps. Record interventions and timing without promising a universal installation time.

Fresh-user path: supported prerequisites → genuine signed verification → installer preview → explicitly chosen MOMM/harness scope → Setup Center → owner login → small approved review → governor decisions → actual private ledger → fresh-session harness discovery and invocation from another project. Evidence belongs to the reviewed project, not the skill clone or a temporary location.

Test spaces/non-ASCII paths, symlinks/junctions (including macOS realpath aliases), conflicting ports, missing prerequisites, permissions and headless/browser-unavailable operation. Preserve every existing instruction and unrelated skill. Linking a skill does not prove an agent loaded default-workflow instructions.

Required historical starting points:

- **1.15.1 with receipt:** genuine signed upgrade to the final candidate; fresh-session operation; offline rollback; repeat upgrade. Preserve exact per-harness scopes and sentinels.
- **1.15.0:** reproduce its documented staging failure, then exercise a separately verified bootstrap; do not bypass verification.
- **1.10.2 without receipt/updater:** demonstrate an exact, recoverable migration of a genuine old installation. A conflict refusal is safe, but is not a migration. Do not invent a move-aside-and-restore dance.
- **Legacy aliases/copied directories/custom or multiple scopes:** identify actual installation targets, never guess or expand them.
- **Dirty files, corrupted/missing receipts, interrupted/concurrent operations and unavailable network:** preserve state, report partial results and prove documented recovery or honest refusal.

A historical 1.15.0 → 1.15.1 success, or the 1.16 updater operating on a signed 1.15.1 payload, is useful component evidence. Neither is proof of a signed 1.16 upgrade. Missing environments are BLOCKED/NOT RUN, not silently waived.

## D. Updater trust and user choice

Use [updating.md](updating.md) and actual help. From a disposable checkout, ordinary `node momm/scripts/multi-review.mjs update` is a **metadata-only** check: it requests the manifest/changelog, not candidate code. `update --dry-run` is a verified **staged preview**: it may fetch code into staging and show file/protocol differences, but must not change the installation, its refs, links or receipt. It cleans staging afterward. `update --check-all` is read-only maintenance inventory, not apply.

Apply requires explicit authorization; `--yes` is never `--accept-protocol`. Test separate policy acceptance, pinned/stable/main behavior, update-check opt-outs, cancellation and dirty-path refusals. Both automatic update and automatic protocol acceptance default OFF; test the actual nested settings shape, not an invented boolean configuration.

Verify the real signature, expected workflow identity and issuer, source commit and package hash before executing fetched candidate code. Include wrong identity, wrong issuer, changed tag/content, wrong hash, missing verifier and untrusted manifest. A rejected payload must not execute a sentinel. Generic GitHub signature badges are not the entire verification procedure. Injected verifier fixtures are not real-signature proof.

The intentionally unsealed 1.16 package should refuse. That refusal is a safety PASS and release-readiness BLOCKED, not evidence of a defective verifier. The full release needs a genuinely signed, source-bound candidate and real installation/upgrade/rollback proof before stable promotion; if the release pipeline cannot stage that safely, record the pipeline gap.

## E. Live reviews and containment

Preflight reports install/auth presence evidence, not guaranteed authentication or a completed response. Repeat small live smokes on each route claimed to work: a seeded defect, correct control and adversarial-content control, within the approved budget. Record first-attempt successes, retries, invalid replies, refusals and timeouts. Three runs are a smoke sample, not a statistical reliability guarantee.

Do not require identical findings from persona/default comparisons. Verify deterministic persona/guidance injection and schema behavior separately; record model quality empirically. A missed bug or invented claim is not automatically an orchestration bug. The governor must investigate it, not count votes.

Exercise actual self-exclusion, invalid/nonzero recursion, hostile source/reviewer content, input coverage under splitting, per-piece quorum and governor-direct obligations. Validate NDJSON progress, terminal error envelopes with trailing telemetry, current-run failure diagnostics, bounded retry and immutable input/report hashes.

Use read/write canaries and supervised descendants, including cancellation and timeout. Do not call plan mode or a prompt an OS sandbox. Report residual-process limitations precisely. A valid signed-out diagnostic is not a successful authenticated containment test.

Obtain two completed distinct external routes for each release-critical source bundle, excluding the actual governor. Include complete change coverage and relevant surrounding code; do not substitute a tiny smoke for a release review. State actual CLI identities and only model IDs actually reported.

## F. Media and truthful capability claims

In approved synthetic tests, route a known-content image whose answer is absent from the text prompt. Check attachment identity, metadata stripping, multi-attachment capability intersection and blocked/stale cells. Do not probe an account or generate media without disclosure and consent.

For generation → recognition → independent critique, preserve every output, variant, failed attempt, prompt, run ID and hash. A description is not prompt compliance. Score each prompt requirement PASS/FAIL/UNCERTAIN and verify findings visually; the actual governor does not review itself.

Initial media-type checks are extension-based; malformed or renamed files may proceed and provider rejection is not guaranteed. Test and disclose that boundary rather than claiming content validation. Check empty/malformed plans, disconnected chains, unreadable/nonregular inputs, missing harvest output, terminal reports and prompt/step artifact binding. Private historical media absent from GitHub is not available evidence: request approved copies or use an authorized synthetic test.

## G. Governor, ledger and browser proof

Follow [governor-completion.md](governor-completion.md). The candidate implements `momm-check/1` observations and separate completion receipts. Every finding/suggestion needs a unique decision; material applied changes need actual failing-before/passing-after evidence. Deferred obligations remain open. Validate final source hashes even for a clean review, and test changed-source, missing/duplicate decisions and stale-receipt rejection.

The validator checks consistency and bytes, not honesty or test adequacy. Never fabricate a reproduction, receipt or row to close an unavailable review. Zero dispositions on failed dispatches is not by itself a defect.

Open the actual private ledger, follow its run and evidence links, restart and reopen it. Test hostile reviewer-text rendering, keyboard access, narrow layout and meaningful labels. Missing usage is unknown, not zero; acceptance rate is not independently measured accuracy. Test Setup Center Host/origin/token protections with a client that actually sends the intended headers; verify what was sent before alleging a bypass.

## H. Return a falsifiable verdict

Separate:
- **NOT READY:** reproduced unresolved defects or unmet release obligations.
- **BLOCKED:** mandatory evidence cannot be obtained.
- **READY TO PUBLISH:** all prepublication gates passed on the exact final candidate.
- **LIVE AND VERIFIED:** a later public-release/default-install check also passed.

Report SHA/tree/package hash; declared/tested support matrix; every executed command and assertion class; failures and skips; signed versus simulated transaction evidence; external-review scope/quorum; source-bound governor completion; findings with reproduction and affected users; and remaining gates with owners.

Keep public evidence concise and sanitized. Ask the reviewer how they wish to be credited; a preferred handle is sufficient. No machine paths, private logs or personal identity details are needed.

Do not merge, publish a release, change a default installation or rewrite tags as part of an independent audit. A later publication check must separately verify GitHub Release, stable manifest, Pages and installed version. Perfection is not a test result; a precisely bounded claim with reproducible evidence is.
