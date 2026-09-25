# MOMM 1.16.1 — independent reviewer pack

Prepared 21 September 2026. **Draft audit, not a release approval.**

Repository: https://github.com/marroccofella/skills

Feedback hub: the MOMM 1.16.1 candidate-testing topic linked from
https://github.com/marroccofella/skills/discussions (use the exact topic URL in the invitation).
Code candidate: https://github.com/marroccofella/skills/pull/18

Exact candidate commit: use the full 40-character SHA in the maintainer's
invitation and Discussion. Replace every `<PINNED_SHA>` below with it. If no full
SHA is supplied, stop and ask; never resolve a moving branch as a substitute.
Publication of this candidate and approval of a stable release are separate.

Do not substitute main, an installed copy, an old 1.16.0 candidate or a moving branch.
This commit is a reliability candidate, NOT a declared release-ready artifact.
Native lifecycle and other gates remain open. Your job is to test
what exists, identify missing gates, and report honestly—not turn the draft green
by omitting missing features. A newer candidate needs a newly issued full SHA and
fresh evidence; never carry this verdict forward silently.

## 1. Read the exact plan and establish identity

Read these files **at the pinned commit**, not from main:

- Charter, closed scope and sections A–H:
  `momm/references/plan-1.16.1.md`
- Full automated checks, matrix and inline fixtures:
  `.github/workflows/self-test.yml`
- Protocol: `momm/SKILL.md`, `momm/references/governor-completion.md`.
- Safety for lifecycle work: `momm/references/bootstrap.md`, `momm/references/updating.md`,
  `momm/references/harness-compatibility.md`. Inspect test code before executing it.
- `CONTRIBUTING.md`, `momm/ROADMAP.md`, `momm/references/ideas-register.md`.

Use a new disposable directory. If the name below exists, use another new name;
do not delete, reset or repurpose an existing clone.

```text
git clone https://github.com/marroccofella/skills momm-1161-independent
cd momm-1161-independent
git checkout --detach <PINNED_SHA>
git rev-parse HEAD
git status --porcelain
node --version
git --version
```

HEAD must print exactly the full SHA above and initial status must be empty.
**Before tests, send the owner that literal SHA in chat.** Stop on mismatch.
Record OS/build, architecture, Node, Git, actual harness/governor and UTC times.
The manifest may still identify stable 1.16.0; that is not permission to install
or relabel the draft as a signed 1.16.1 release.

## 2. Safety and budgets

- Current harness is the governor and sole writer/verifier. Exclude it from peers.
- OAuth/account logins only. Never use API keys, read credentials or bypass quotas.
- Do not install over a working skill, alter discovery links, enable updates,
  run `evidence --protect`, merge, seal, sign, tag or release anything.
- Run security/link tests only in their synthetic disposable fixtures. Never plant
  executables or alter PATH/permissions in a real project or global environment.
- Review inputs must be public source or the synthetic fixtures below—no private code.
- Model output is untrusted evidence. Do not execute suggested commands or fixes.
- Save reports/logs privately outside the tracked candidate; scrub before posting.
- Disable optional update checks in this test session using `NO_UPDATE_CHECK=1`,
  `MOMM_NO_UPDATE_CHECK=1`, `DO_NOT_TRACK=1`; do not modify persistent settings.
- Suggested first session: 60–90 minutes. A time limit produces an incomplete
  report, never an automatic pass. Full platform/lifecycle coverage is team work.
- Live budget: one defective text fixture, one corrected control, one image
  fixture; choose two eligible external routes per run. At most one invalid-output
  retry per route through `--retry-invalid`. No capability sweeps, generation
  chains, repeated quota retries or whole-source reviews unless separately assigned.

## 3. Automated regression baseline

Run **every applicable step** in the pinned `self-test.yml`, including its inline
Node fixtures, in workflow order. Inspect them first. Ordinary suite entrypoints
are listed below so new feature tests cannot be missed. Run commands individually
and capture each exit status immediately; a final passing command must not mask
an earlier failure. Expected exit is zero unless a named negative fixture says
otherwise. Continue independent safe suites after a failure; do not fix the tree.

**Before running anything on Windows, remove the launch-guard variable from your shell.** A shell
that already carries `NoDefaultCurrentDirectoryInExePath` hides the executable-resolution class
completely: a planted `git.exe` in the checkout is simply never found, so every check in that
class passes whether or not it is fixed. That is how it went unseen on the maintainer machine.

```text
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue   # PowerShell
set NoDefaultCurrentDirectoryInExePath=                                           # cmd.exe
unset NoDefaultCurrentDirectoryInExePath                                           # Git Bash
```

Then confirm the named security regression actually exercised the hazard: on Windows,
`node momm/scripts/executable-resolution.test.mjs` must report `"skipped": []`. A skipped
planted-`git.exe` control means this runtime did not reproduce the hazard, so the check beside it
proved nothing there.

**macOS reaches its temporary folder through a link** (`/var` to `/private/var`), and tests that
compare a resolved path with an unresolved one pass on Linux and Windows and fail only there. On
Windows the same condition can be produced by pointing `TEMP` and `TMP` at a directory junction
before running a suite; the maintainer used this to reproduce the four macOS failures on
`b0a2dfe` and to sweep the steps those jobs skipped.

Expected, not defects, until the owner seals the release: the dispatcher declares `1.16.0`, and
`scripts/momm-release.mjs --check` fails on the package hash. A dry-run install that meets an
existing MOMM link exits 1 and now says why on stderr.

```text
node momm/scripts/multi-review.mjs --self-test --pretty
node momm/scripts/scope-closure.test.mjs
node momm/scripts/media-bytes.test.mjs
node momm/scripts/install-completion.test.mjs
node momm/scripts/expiry-regression.test.mjs
node momm/scripts/attempts.test.mjs
node momm/scripts/path-resolution.test.mjs
node momm/scripts/review-claims.test.mjs
node momm/scripts/review-workflow.test.mjs
node momm/scripts/review-final-regressions.test.mjs
node momm/scripts/review-refutations.test.mjs
node momm/scripts/review-followup.test.mjs
node momm/scripts/transport.test.mjs
node momm/scripts/process-scope.test.mjs
node momm/scripts/executable-resolution.test.mjs
node momm/scripts/entrypoint.test.mjs
node momm/scripts/stabilisation.test.mjs
node momm/scripts/update.test.mjs
node momm/scripts/bootstrap.test.mjs
node momm/scripts/migrate-legacy.test.mjs
node momm/scripts/governor-range.test.mjs
node scripts/source-hygiene.test.mjs
node momm/scripts/scorecard.test.mjs
node momm/scripts/installations.test.mjs
node momm/scripts/governor.test.mjs
node momm/scripts/usage.test.mjs
node momm/scripts/guidance.test.mjs
node momm/scripts/split.test.mjs
node momm/scripts/scheduler.test.mjs
node momm/scripts/update-clock.test.mjs
node momm/scripts/probes.test.mjs
node momm/scripts/governor-split.test.mjs
node momm/scripts/capabilities.test.mjs
node momm/scripts/lock-ownership.test.mjs
node momm/scripts/modality.test.mjs
node momm/scripts/modality-evaluation.test.mjs
node scripts/launch-guard.test.mjs
node scripts/render-momm-site.mjs --check
node scripts/check-momm-site.mjs
node scripts/momm-release-pages.test.mjs
node scripts/public-export.test.mjs
node scripts/doc-consistency.test.mjs
node scripts/momm-release-privacy.test.mjs
node scripts/momm-media-contract.test.mjs
node scripts/ledger-integrity.test.mjs
node scripts/reviewer-ux-regressions.test.mjs
node scripts/ledger-serving.test.mjs
node scripts/version-discovery.test.mjs
node scripts/private-tree-boundary.test.mjs
node scripts/information-shutdown.test.mjs
node scripts/evidence-permissions.test.mjs
node scripts/release-seal-precheck.test.mjs
node scripts/media-cancellation.test.mjs
node scripts/media-preservation.test.mjs
node scripts/momm-release-regressions.test.mjs
node scripts/momm-auth-recovery.test.mjs
node scripts/momm-independent-review.test.mjs
node momm/scripts/copilot-transport.test.mjs
node momm/scripts/antigravity-transport.test.mjs
node momm/scripts/shutdown.test.mjs
node momm/scripts/attachment-cleanup.test.mjs
node momm/scripts/adapter-cleanup.test.mjs
node momm/scripts/multi-review.mjs --doctor --pretty
node scripts/evidence-permissions-native.test.mjs
node momm/scripts/setup-ui.mjs --self-test
node momm/scripts/setup-maintenance.test.mjs
node --check momm/scripts/setup-ui.mjs
node --check momm/scripts/ledger.mjs
node --check momm/scripts/multi-review.mjs
node --check momm/assets/setup-ui/app.js
node --check myskills/scripts/health-contract-test.mjs
node myrepo/scripts/publish.mjs --self-test
node myskills/scripts/run-all.mjs --pretty
node myskills/scripts/health-contract-test.mjs
node yorkshire-pudding/scripts/yorkshirify.mjs --self-test
node multi-llm-review/scripts/multi-review.mjs --self-test --pretty
node multi-llm-review/scripts/install.mjs --target auto --dry-run --pretty
node scripts/ledger-ui.test.mjs
node scripts/momm-improvement-regressions.test.mjs
node scripts/momm-release-observer.test.mjs
node scripts/momm-site-community.test.mjs
node scripts/momm-site-discovery.test.mjs
node scripts/momm-site-flow.test.mjs
node scripts/momm-site-home.test.mjs
node scripts/momm-site-regression.test.mjs
node scripts/momm-site-search.test.mjs
node scripts/momm-site-technical.test.mjs
node scripts/momm-site-videos.test.mjs
node scripts/momm-site-visuals.test.mjs
node scripts/preview-module.test.mjs
```

Also execute the workflow's inline checks for zero-call onboarding/unknown routes,
sanitized sealed public evidence, private ledger generation and permissions,
NDJSON-pure legacy alias stderr, and evidence persistence full/blocked/partial
round trips. Omitted inline fixtures mean the full CI contract was not exercised.

Do not regenerate public output to hide a `--check` failure. Missing tests or
requirements are gaps, not PASS. A skipped platform test is N/A on that platform,
but its matrix cell remains untested until the assigned platform reviewer runs it.
Doctor output may expose local paths; report only sanitized statuses.

Run `node scripts/momm-release.mjs --check` separately and record the exact exit
and short output. For this unsealed draft, refusal is expected; it must not be
counted as a product defect solely because it refuses. A final sealed candidate
has a different expectation, to be supplied with its exact SHA. Never run
`--prepare` to make the draft pass.

## 4. Full feature/improvement acceptance matrix

For **every row**, record PASS / FAIL / BLOCKED / NOT IMPLEMENTED / NOT RUN / N/A,
the actual command or manual steps, expected/actual outcome and evidence. Existing
generic tests do not prove a newly required behavior unless they assert it.

| ID | Scope | Required positive and negative checks |
| --- | --- | --- |
| A1 | Media bytes | Valid supported fixture accepted; JPEG named txt, PNG named jpg, HTML named png, truncated, empty and linked media rejected before dispatch/probe/harvest. Assert zero provider invocations on rejection. |
| A2 | Capability expiry | Fresh eligible cell versus expired cell; show when/why/exact re-probe instruction; auto-selection excludes expired cells; baseline cannot revive them; no automatic probing. Verify one successful modality cannot silently clear another modality's blocker. |
| A3 | Committed-range receipts | Exact base/head full SHAs and head file hashes; wrong diff/range and changed source refused; additions/deletions/renames/path filters disclosed; stdin range binding; tool-produced momm-check/1 manifest, piece/attempt IDs and disposition linkage; validator refuses missing/stale evidence. A hand-authored manifest is not proof the required producer exists. |
| A4 | Live image | Published checklist present; final-tree synthetic image actually inspected by eligible routes, region-bound finding validated; text-only replies excluded from visual coverage. |
| B + H3 | Lifecycle/platforms | Isolated fresh signed install; signed upgrades from both 1.15.1 and 1.16.0; rollback/re-upgrade; tampered/unsigned refusal and interrupted recovery; receipts + loaded-version inventory. Windows/macOS/Linux: Node18 and Node24 lifecycle drills required, Node22 also primary; Node20 offline compatibility separately labelled. Record exact versions and architecture; never substitute synthetic tests for signed lifecycle receipts. |
| C1 | Outcome classification | Synthetic success, timeout, quota/rate-limit, authentication, ineligible tier, malformed JSON, empty response and cancellation all land in the intended distinct bucket; do not manufacture real provider outages. |
| C2/C3 + H1 | Attempts/quorum/accounting | Multiple pieces, invalid retry, outage retry, cancellation and failed piece; list every route/piece/attempt; minimum enforced per piece; old evidence survives rerun; cumulative coverage only for identical bound source with linked attempts; tokens/time/cost include failures where known; reported/estimated/unavailable remain distinct, unknown is not zero. |
| D | Documentation | Exact current versus draft release; one-page user notes plus separate gate record; every suite documented; no missing/contradictory install, modality or privacy claims. |
| E | Security | Synthetic Windows git.exe/taskkill.exe shadowing, early PATH, dot/relative/empty/unresolvable PATH entries, junction/symlink/8.3 aliases; evidence symlink/junction/hardlink refusal. Use packaged isolated fixtures; no manual evidence --protect against a real folder. |
| F1 | Inventory | Zero, single, duplicate same-version, conflicting versions, legacy alias, broken link and ambiguous precedence; read source without executing found copies; --expect must not claim an absent upgrade. |
| F2 | Upgrade completion | Installer/updater completion paths themselves detect an older active copy and exit nonzero; a standalone inventory unit test alone does not prove those integration paths. |
| G1 | Scorecard | Hand-count synthetic per-piece success/failure, ruled versus deferred/unruled, unique catches, rejected criticals, timing and cost; below-eight ruled finding threshold withheld and formula disclosed; governor acceptance is not ground-truth accuracy. |
| G2 | Training export | Explicit destination, owner-only permissions, no silent overwrite, JSONL/chat formats, only ruled items with reason; dataset card labels untrusted model text and non-ground-truth decisions; private source never posted. Use synthetic evidence only unless owner explicitly authorizes otherwise. |
| H2/H4 | CI/site integrity | Pages deployment bound to successful checks for the same revision, or explicitly disclosed as ungated; source hygiene, media file hashes, human approval boundaries, XML sitemap and generated links. Do not publish an unapproved film as a test. |
| Invariants | No regressions | One writer; governor excluded; OAuth only; update opt-in unchanged; no private ledger upload; no default paid probes, new families, Grok media binding or relaxed containment. |

Sections F3–F8 and named 1.17 ideas are out of this patch unless the owner issues
an explicit revised scope. Accounts, billing, managed reviewers and new film
production are not 1.16.1 acceptance features.

## 5. Bounded live review (separate from offline checks)

Use a separate disposable synthetic project. Invoke the **pinned clone's**
dispatcher by absolute path, never the installed skill. In all commands replace
`<governor>` with your actual supported harness and `<two-routes>` with two
eligible, signed-in external routes that are not that governor.

```text
node "<pinned-clone>/momm/scripts/multi-review.mjs" --preflight --governor <governor>
node "<pinned-clone>/momm/scripts/multi-review.mjs" --capabilities --json
```

Preflight makes zero model calls; it is not an active modality probe or proof of
live authentication. If accounts/quota block live work, stop only live work and
finish the safe offline checks. Never claim an environmental block is a defect.

Create a small public-style synthetic `sum.mjs` containing an array-summing
function with `for (let i = 0; i <= values.length; i++) total += values[i]`.
Record a local assertion demonstrating its wrong result; save a separate corrected
control using `< values.length`. This is test-fixture creation, not a MOMM fix.
Review the defective and control files once each:

```text
node "<pinned-clone>/momm/scripts/multi-review.mjs" --governor <governor> --reviewers <two-routes> --input sum.mjs --min-success 2 --retry-invalid --stream
```

Use the corrected fixture's filename on the control run. Record run_id, command,
process exit, literal quorum block, each route's status/attempts, finding locations
and which routes detected the bug. Expected: defect found and independently
verified; control should not receive a spurious defect. Retry is not a new route.
An account/quota-limited one-review result must not claim the two-review minimum.

For image review, use a small synthetic chart with a known visual inconsistency
(for example bars contradicting their printed values), and a written ground-truth
record. Read the final candidate's image checklist, `momm/references/image-review-checklist.md` in the pinned clone. After confirming two eligible
image routes, review with `--attach <synthetic-image>` plus the same governor,
explicit reviewer list and minimum. Record input hash, route capability evidence,
region-specific finding and your visual verification. If the checklist or eligible
routes are absent, report that exact gap; do not substitute a text description as
proof of image inspection or spend quota on a capability sweep.

Whole-source/delta release self-review is the release governor's separately
assigned gate, not a surprise extra task for every confirmation reviewer.

## 6. Lifecycle and team coverage

Assign reviewers to Windows, macOS and Linux. Ask at least one to use a different
governor where available. No reviewer may claim another person's matrix cells.
Record exact Node patch versions; primary Node22/24 versus legacy18/20 must be
separate rows, not “18–24 supported.” CI requests 18/20/22/24 on three OSes plus
Windows 24.15.0 and 24.19.0, fourteen cells. Configuration does not prove a completed run or
native signed lifecycle drills. Node18 and Node24 lifecycle evidence remains required.

Use clean disposable VMs or user profiles with no working installations. Signed
lifecycle tests require a maintainer-provided, independently verified signed
candidate artifact/checkpoint and exact identity. That artifact is **not supplied
by this draft SHA**. Do not sign it yourself, bypass trust checks, substitute a
version string or call offline mocked-signature fixtures a real signed upgrade.
Mark unavailable lifecycle cells BLOCKED with the missing artifact and request
the maintainer's staged-candidate procedure. Repeat exact final release artifact
checks later; staging proof alone is not proof of the eventual published tag.

Finish each real lifecycle step with receipt checks and read-only loaded-version
inventory, including `--doctor --versions --expect <tested-version>` where present.
No global prerequisites, discovery links or protocol changes without owner consent.

## 7. Findings go to the 1.16.1 testing Discussion

Carry out this instruction in your own session. **Do not post this prompt.**
Post the completed verdict, test results and suggestions in the **exact testing
Discussion supplied in the invitation**, not the old 1.16.0 threads or a generic
new issue. Read its existing replies to cross-reference duplicate defects.
PR #18 remains the code-review location; link any inline code comment from your
Discussion verdict. Do not duplicate the complete report across several places.

Write one completed verdict to `report.md` outside the tracked candidate:

```markdown
## MOMM 1.16.1 full-plan review — <reviewer> — READY | NOT READY | BLOCKED
- Posted by: <own account OR owner's account on behalf of named reviewer>
- Commit tested: <literal full git rev-parse HEAD>
- Review scope: draft audit / assigned platform / final candidate
- Environment: <OS/build/architecture>, Node <exact>, Git <exact>
- Harness/governor: <actual>; selected external routes: <names>
- Started / finished (UTC): <times>
- Overall limitations: <missing implementation, artifacts, platforms or quota>

| Test / requirement ID | Expected | Actual / exit | Status | Evidence |
| --- | --- | --- | --- | --- |
| Identity | Exact pinned SHA, clean start | ... | ... | ... |
| Every automated suite, individually | ... | ... | ... | ... |
| Every acceptance row A1 through H and invariants | ... | ... | ... | ... |
| Live defective/control/image runs | ... | ... | ... | ... |
| Each assigned lifecycle cell | ... | ... | ... | ... |
| Final SHA/status and seal state | ... | ... | ... | ... |

Live run details: run_id, exit code, quorum block, route status/attempt table,
seeded bug/visual inconsistency detection, capability/coverage limits.
Failed suites: exact command and last 20 relevant sanitized output lines.
Defects: <linked separate defect comments, or none observed within tested scope>.
Unimplemented / not run / blocked requirements: <explicit list>.
```

READY means **all required checks in the explicitly stated scope** met expectations;
it is never a global release approval if other platforms/gates are outstanding.
NOT READY means a reproduced product failure or a required implementation is
missing. BLOCKED means an external prerequisite prevented the required evidence;
continue unrelated tests. If both product failures and external blocks exist,
use NOT READY and list the blocks separately. Never use N/A for an unimplemented
required feature. A scoped READY is not a whole-release READY while required release gates remain open.

Each distinct defect gets one separate top-level comment in the same testing Discussion
so maintainers can reply with a ruling. Put suggestions in a separately labelled comment:

```markdown
### DEFECT <n> — <reviewer> — release-blocking | not blocking — <title>
Commit and environment:
Requirement ID:
What I did / exact command:
Expected:
Actual / exit code / relevant sanitized output:
Minimal synthetic reproduction:
Why this severity:
```

Specific code-line observations may additionally be inline PR #18 comments, linked
from the verdict. Do not edit earlier reports to pretend they tested a new SHA.
Do not publish tokens, email addresses, account identifiers, local paths, raw
private ledgers or complete provider logs; use `~` for home paths.

Save the finished report to a UTF-8 `report.md` file outside the candidate.
Open the exact testing Discussion in GitHub, paste the file contents into a new
comment and submit. `gh pr comment` posts to a pull request, **not** a Discussion;
do not use it for this destination. If using GraphQL, supply the body from a JSON
file and the verified Discussion node ID, never a multiline shell argument.

Use the returned comment URL to open and verify the entire body, especially the
last table row and conclusion. Compare the posted body with the file using the
comment's API ID if possible; check for truncation before claiming success.
Give the owner the verdict URL. Reply to maintainer rulings/retest requests in
the same Discussion, with exact old/new SHAs and the explicitly rerun scope.

Nothing in this assignment authorizes a merge, release or installed-skill update.


## 8. Scope-audit closure checks

Run `node <pinned-clone>/momm/scripts/scope-closure.test.mjs`. It tests success then failure then
recovery in the update clock; existing broad export refusal; a private new output;
explicit overwrite; and a broadly accessible companion-file refusal. All data is
synthetic and native permission modifications are confined to disposable fixtures.
For manual exports choose a **new dedicated folder**, not an existing shared
folder. A refusal must leave existing permissions and files unchanged.

### Ledger access: one-use and expiry are different tests

Use a synthetic project ledger and launch the candidate Setup Center there. Keep
the printed launch link/session private. From the authenticated same-origin page,
use its existing local session token in the **X-MOMM-Token** header of an HTTP
**POST /api/ledger-ticket** request (empty body). Obtain that header from your own
page's request in browser developer tools; never copy it into a public report.
The JSON response contains `url`, a relative `/ledger?ticket=...` address.

1. Request ticket A, visit its URL immediately: expect the synthetic ledger.
   Request that identical URL again within 60 seconds: expect HTTP 403.
2. Request a separate ticket B using the same authenticated POST. Do **not** visit
   B yet. Wait more than 60 seconds (65 seconds is sufficient), then visit it for
   the first time: expect HTTP 403. This is expiry, not replay.
3. Request ticket C and visit it promptly: expect success. Requests for tickets
   without the session header must fail with HTTP 403. Do not expose tickets in
   screenshots or reports; record status codes and elapsed time only.

The automated serving suite complements these browser observations. A missing
synthetic ledger is not a ticket failure; generate it first with the candidate's
ledger command from the synthetic project. Do not use private production evidence.

## 9. What changed since 1.16.0

- Byte-based media checks and explicit successful-capability expiry.
- Committed-range source identity, tool-produced verification observations and
  separate completion validation; hashes do not prove test adequacy.
- Persistent per-attempt records, cancellation/quota classification, per-piece
  quorum, cumulative coverage audit and failed-attempt usage accounting.
- Active-installation inventory/conflict refusal, clearer dirty-clone recovery and
  retained owner-controlled update/rollback boundaries.
- Effectiveness scorecard and optional private training export; governor rulings
  are not ground-truth quality labels.
- Executable/PATH and evidence-storage regressions, broader CI compatibility
  matrix, current test catalog and distinct draft/release gate records.
- Audit follow-up: stale success cleared on failure, native export privacy
  enforced, and current retry/ledger-ticket testing instructions committed.

1.17 workflows, managed paid reviewers, new films and installed-skill changes are
not part of this candidate. Signed/native lifecycle and final live-image gates
remain separate; do not turn blocked evidence into PASS.
