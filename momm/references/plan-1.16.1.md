# MOMM 1.16.1 plan: close, prove, audit

Status: **in progress, not released.** The current release is 1.16.0. This plan is the owner's
charter of 20 September 2026; it replaces an earlier five-bucket draft that had no theme, no
acceptance tests and no "done when".

**Theme.** Close the holes 1.16.0 documented, prove the lifecycle 1.16.0 claimed, make reruns
auditable.

**What 1.16.0 claimed and did not prove.** Its notes say the OS by Node matrix was green on the
reviewed head. The same record shows that CI injected a fake permission inspector, that a fresh
clone on Windows 11 could not run a review until the evidence folder was created private, and that
on Windows with Node 18 and 20 a planted `git.exe` was started until MOMM stopped handing bare names
to spawn; the failing test had been hidden because a multi-command CI step reported only its last
command. Install, upgrade, rollback and re-upgrade were exercised by the release workflow's
isolated drill, not on real machines. Its self-review reached quorum cumulatively across reruns,
and the report cannot show which piece passed on which attempt. 1.16.1 exists to fix that, not to
add features.

**Sources of truth.** `versions.json` holds the published version. The newest
`references/release-*.md` is the dated record. `ROADMAP.md` opens with now, next, later. Site pages
render from those three. Nothing else says "current".

## The closed set (owner, 20 September)

Required for 1.16.1 are only items that close a hole 1.16.0 documented, prove a claim 1.16.0 already
made, or stop the tree contradicting itself. Twelve items; the sections below carry the detail and
the "done when" for each.

| # | Required addition | Section | State |
| --- | --- | --- | --- |
| 1 | Media type from file bytes; the extension may label, never authorize | A1 | implemented; final candidate gate pending |
| 2 | Capability expiry a human can act on: expired, when, why, exact re-probe command; no auto re-probe | A2 | implemented; final candidate gate pending |
| 3 | Completion receipts for committed-range reviews | A3 | runner and attempt references implemented; final committed-range receipt pending |
| 4 | Closed-set failure classification; a wrong bucket fails a test | C1 | normalized attempts and quota/cancellation classification implemented; final gate pending |
| 5 | Partial quorum and retry as first-class evidence, per piece and per attempt | C2 | cumulative coverage audit implemented; does not replace completion or approve unresolved findings |
| 6 | Attempt evidence persisted beside the run; a rerun appends, never rewrites | C3 | started/terminal records implemented; interrupted starts remain incomplete, never invented outcomes |
| 7 | Real lifecycle drills on Windows, macOS and Linux, Node 18 and 24 at least | B | not started (last in the work order) |
| 8 | Named security regressions as tests | E | PATH fixtures added; native final OS/Node matrix pending |
| 9 | One live image review on the final tree, with the checklist in `references/` | A4, gates | checklist written; live final-tree gate pending |
| 10 | ROADMAP tells the truth | D | **done** |
| 11 | Node 18 to 24 compatibility table of what was actually run; no "supported" for a blank cell | B | explicit untested cells in gates-1.16.1.md; CI now requests 13 cells |
| 12 | User-facing 1.16.1 notes stay one page; gate record separate | D | draft-1.16.1.md and gates-1.16.1.md; no version bump or release claim |

**Constraints that are required non-additions:** the governor remains the only writer; account
logins only, no API-key routes; automatic updates stay off and an agent never enables them;
`evidence --protect` is owner-invoked only; no new reviewer families; no dashboard redesign; no new
generation modalities; no Grok media binding (containment stays `--deny Read`, so Grok image and
PDF cells stay `missing_flag`).

**To 1.17 by name, not into this release:** `--early-exit`, `--split auto`, a higher `--jobs`
ceiling, ledger-learned caps, CRLF handling in guidance, `Object.create(null)` lookup maps, the
guidance sidecar `0o700` mode, synthetic hunk counts, recognising one observation across finding
ids.

**Section F, settled 20 September.** The owner's scope boundary keeps "installation identity and
conflict detection" in 1.16.1 and sends "broad installation-management interfaces" to 1.17. So F1
(the inventory) and F2 (never call an upgrade complete while an older copy is active) are in; F3 to
F8 are recorded in the [ideas register](ideas-register.md). The paragraph below is the history.

**One item needed the owner to reconcile.** On the same day the owner also asked that 1.16.1 make
duplicate installations and precedence explicit (section F). F is not in the closed set above.
F1, the read-only `--doctor --versions` inventory, is built and is how drill 7 proves which
version a harness loads after an upgrade, so it stays as drill tooling. F2 (never call an upgrade
complete while an older copy is active) stops a false claim and fits the set's own rule. F3 to F8
(choosing one active copy, migration preview, rollback command, version banner, fresh-session
verification, duplicate protection) change links or add surfaces; by the closed set's rule they
belong in 1.17 unless the owner says otherwise. They are not started.

**Sections G and H are owner additions too, and the set is still twelve.** G (what the evidence is
worth) and H (the remainder of the owner's 20 September proposal) were added after the set was
closed, on the owner's instruction. They appear under *must ship* because the owner asked for them,
not because the twelve grew: the closed set is unchanged at twelve items, and F, G and H are named
additions recorded alongside it. Anything in G or H that would add a surface rather than close a
hole 1.16.0 documented goes to the ideas register on the same rule that sends F3 to F8 to 1.17.

## In scope: must ship, or 1.16.1 does not tag

### A. Documented 1.16.0 follow-ups

1. **Media type from bytes.** The runner identifies a file by its leading bytes, not its
   extension. A mismatch or unknown bytes fail closed before probe, attach or harvest. The
   extension may label; it may not authorize.
   *Done when* these each have a test that fails today: a JPEG named `.txt`, a PNG named `.jpg`, a
   truncated file, HTML named `.png`, an empty file, a symlink to a media file.
2. **Capability expiry is visible and manual.** An expired overlay cell is blocked; `--capabilities`
   and the report show the reason and the expiry time; the exact re-probe command is printed;
   `--reviewers auto` skips the cell. No automatic re-probe, no synthetic traffic without consent,
   no reuse of a stale cell because the baseline still says yes. A consent allow-list for the probe
   worker is in scope only as an explicit list passed on that run, never remembered.
   *Done when* each of those sentences has a test, and the rule that the first successful cell
   clears a route-level blocker is re-examined against "no stale reuse" and either kept with a
   stated reason or tightened.
3. **Completion receipts for committed-range reviews.** `governor.mjs --record` accepts the inputs
   the gates use (a committed range, a range on stdin), not only `git diff HEAD` or a file. It
   emits `momm-check/1` receipts with source identity, piece list, attempt ids and disposition
   linkage.
   *Done when* the 1.16.1 self-review ends with a receipt for its committed range, and a gate that
   has only `git diff HEAD` evidence is reported as incomplete.
4. **Image-review protocol as a reference.** The checklist lives in `references/`. One live image
   review on the final 1.16.1 tree is a release gate, recorded in the release file. It is not a
   feature.

### B. Lifecycle proof (the 1.16.0 debt)

On real Windows, macOS and Linux, with Node 18 and Node 24 at least (20 and 22 in CI): a fresh
signed install; upgrade 1.15.1 to 1.16.1 and 1.16.0 to 1.16.1; rollback to the previous signed tag;
re-upgrade; the updater refuses a broken or unsigned payload and recovers to the last good receipt.

*Done when* a table of OS by Node by install kind by result is published in the release record,
each row backed by a receipt. An untested cell says "untested". "18 to 24 supported" is not written
for an untested cell. On Windows the upgrade still needs the owner to run `evidence --status` and,
where told, `evidence --protect`; an agent never runs `--protect`. Automatic updates stay off, and
"updater recovery" adds no default-on clock.

### C. Reviewer reliability: audit, not synonyms

1. Every provider outcome falls in a closed set: timeout, quota or rate limit, auth, ineligible
   tier, invalid output, empty, cancelled, succeeded. A wrong bucket is a test failure.
2. Partial quorum is first-class: per piece, per attempt, who answered, who did not, and why.
   Cumulative quorum across reruns counts only if the report lists every attempt and the receipt
   hashes them.
3. The evidence is stored beside the run so a later rerun appends and never rewrites.

*Done when* the 1.16.0 situation (quorum met over five runs) can be read from one report: which
piece, which attempt, which route, which outcome.

### D. Docs integrity

Done on 20 September 2026 in the commit that added this plan: `ROADMAP.md` opens with the current
release line and now, next, later; everything written before the signed tags sits under a
HISTORICAL banner; website notes moved to `references/site-changelog.md`; a short 1.17 section;
deferred 1.16.0 findings listed by name in `references/deferred-from-1.16.0.md`.
Still to do: `release-1.16.1.md` is one page for a user (shipped, proven, still refused, how to
upgrade) with the gate record below it or in a separate file; `CONTRIBUTING.md` names every suite;
the changelog covers the modality registry and the private evidence folder.

### E. Security regressions, named

Non-goals that stay fixed: one writer (the governor), account logins only, no API keys, no
automatic update that an agent can enable, no change to the containment model.

*Done when* these each have a locked test on Windows Node 18, 20, 22 and 24 where they apply: a
project-local `git.exe` or `taskkill.exe` is never started; a planted tool earlier on PATH; a PATH
entry of `.`, a relative entry, an empty entry; a PATH entry that reaches into the project through
a junction, a symlink or an 8.3 short name; a PATH entry that cannot be resolved; symlinks,
junctions and hard links under the evidence folder, with `evidence --protect` refusing a
hard-linked file that has another path.

### F. Installed somewhere is not what the harness loads (owner addition, 20 September)

On the owner's machine after the 1.16.0 release, five harness discovery folders still loaded 1.15.1
from one clone while the 1.16.0 copy that had been run all week was linked from none. Nothing said
so. 1.16.1 separates "installed somewhere" from "the version this harness loads" and reports and
verifies both.

1. **`--doctor --versions`** lists every MOMM copy a harness can find: path, link target, the
   version that copy's own source declares, and which copy each harness would load. Read-only; other
   copies are read, never executed. *Built first; the rest depends on it.*
2. **Conflict warning.** No command claims an upgrade is complete while an older copy remains on
   another active discovery path. The installer and updater end with the inventory and exit non-zero
   on a conflict.
3. **Canonical-path selection.** The owner chooses one active installation. Older copies are kept
   only as rollback backups, outside every discovery folder.
4. **Version banner.** The Setup Center and every review report show the loaded MOMM version and
   the folder it was loaded from.
5. **Safe migration preview.** Before any link changes: old path, new path, backup path and the
   resulting precedence, then an explicit yes.
6. **Fresh-session verification.** From a new harness session, confirm the selected version is the
   one discovered. MOMM can read the folders a harness searches; it cannot see inside the harness,
   so where one harness has two folders on different copies precedence is reported as undetermined,
   never invented.
7. **Rollback command.** Restore the previous link and receipt without deleting the newer clone.
8. **Duplicate protection.** Two active links never silently point at different MOMM versions:
   the installer refuses to add a second active copy without the selection step in 3.

*Done when* **F1 and F2** each have a test on real folders (junctions on Windows, symlinks
elsewhere), the lifecycle drills in B end with `--doctor --versions --expect <version>` exiting 0,
and the owner's five-folder case above is reproduced as a fixture. F3 to F8 are **not** conditions of
this tag: the owner's scope boundary of 20 September keeps installation identity and conflict
detection here and sends broad installation-management interfaces to 1.17, where they are recorded
by name in the [ideas register](ideas-register.md).

### G. What the evidence is worth (owner addition, 20 September)

Read-only derivations of evidence the ledger already holds; no new reviewer, no new traffic.

1. **Effectiveness scorecard** (`momm/scripts/scorecard.mjs`): for MOMM as a whole and for each
   reviewer. Reliability is counted **per piece** (a split run's merged row reads "success" if any
   piece succeeded, which hid a 30% failure rate). Acceptance is the governor's acceptance rate over
   ruled findings; deferred and unruled count as neither. Unique catches, the accepted findings
   each reviewer would have missed alone, severity calibration (rejected criticals), time per
   review, and cost per accepted finding where the provider reports cost, otherwise "unmetered",
   never zero. A score appears only from eight ruled findings and its formula is printed beside it.
   Output as JSON, Markdown, or an HTML table in the ledger's theme.
2. **Training export** (`--export-training <file>`, JSONL or chat format): one example per ruled
   finding or suggestion, labelled with the governor's decision and reason. Written only where the
   owner says, owner-only, never overwriting silently, with a dataset card that states the label is
   not ground truth, that reviewer text is untrusted and may quote source, and that provider terms
   apply to training on model output.

*Done when* both have tests on synthetic evidence (17 today), both run on the real 1.16 gate ledger,
and the scorecard's numbers match the hand counts in the 1.16.0 release record.

### H. From the owner's 20 September proposal, not already covered

1. **Usage and time from failed work** (belongs with C): tokens, cost and elapsed time of failed,
   invalid and retried attempts are counted. Reported, estimated and unavailable are three different
   values. Unmetered is never shown as zero.
2. **Pages deploy only after the same revision passes its checks.** Today Pages builds from `main`
   on push; `main` only receives squash merges whose PR checks passed, but the Pages build itself is
   not gated on the push-event run. Gate it, or state plainly that it is not.
3. **Node 22 and 24 are the primary lifecycle targets.** Node 18 and 20 are past end of life; they
   stay in CI as compatibility checks, labelled as such, because the 1.16.0 Windows launch defect
   was specific to them.
4. **Immediate repairs to verify, not assume:** no raw control character in any tracked source
   (done, guarded by `scripts/source-hygiene.test.mjs`); every media asset exists and matches its
   recorded hash; nothing awaiting the owner's listening approval is publicly linked, and the
   revised video stays labelled a local preview until the narration is approved; the sitemap is
   valid XML listing only published pages; generated section links resolve to real pages;
   compatibility claims match exact CI matrix cells.

## Scope widened (owner decision, 25 September 2026)

The owner asked for every reviewer-route improvement found during candidate testing to ship in this
release rather than a separate one, and chose to fold them into 1.16.1, which had not been published.
Each is a fix to something 1.16.x already claimed, not a new surface:

- **Reviewer CLI update notice.** The update clock claimed to watch reviewer CLIs but could never
  say one was behind: it held no installed version for any CLI, and nothing told the user. It now
  reads and caches each CLI's own `--version` (at most daily), and prints one notice after preflight
  and at the end of a review with the official update command, automatic installs as the user's own
  switch, and the Setup Center for guidance. Found when Codex, Claude, Gemini and Grok were all behind.
- **Grok isolation.** Grok imports the user's Claude Code and Cursor setup by default: global
  instructions, skills, MCP servers (the GitHub server started with the user's credentials) and hooks,
  plus cross-session memory. MOMM now switches every import off for its own Grok runs through Grok's
  documented per-process variables, and denies every tool class (`--deny "*"`). The user's own Grok
  setup is unchanged. Grok's skill list cannot be hidden per run (only the user's global config can),
  so skills remain advertised to the reviewer but cannot be invoked.
- **Grok speed.** At its default high reasoning effort Grok took 736 s on a 5 KB review against a
  budget of about 270 s, so every MOMM Grok review timed out. MOMM uses `grok-4.7-build-fast` (the same
  model on faster serving) when the account lists it, at medium effort, with 2x headroom (360 s);
  the measurements are in the gate record.
- **Codex instructions and features.** Codex's private directory sits inside the reviewed project, and
  Codex reads `AGENTS.md` from the git root down, so the project's own instructions reached the reviewer,
  with the user's hooks, plugins, apps and multi-agent tools on. MOMM's Codex runs now load no project
  instructions (`-c project_doc_max_bytes=0`) and switch those features off. The owner chose to keep the
  shared model, effort and MCP servers until 1.17 rather than ignore the user's config entirely.
- **Codex advice.** "Model is not supported when using Codex with a ChatGPT account" was the Codex CLI
  being older than the model the Codex desktop app had selected in their shared config. The failure
  now says to update the CLI, and not to change the shared model or switch to an API key.
- **Failure details keep nothing MOMM sent**, in any echo form, including the two short-line prefix
  cases deferred from the delta review of 7a970f7.

Copilot needed no change: its 402 was confirmed as the monthly quota on every model the account offers.

## Explicitly out of 1.16.1

New reviewer families. Automatic updates on by default, or any path by which an agent enables
them. A dashboard or Setup Center redesign. New generation modalities, new chains, Grok media
binding. `--early-exit` and in-flight `runProcess` cancellation. `--split auto`. Ledger-learned
route caps and a higher `--jobs` ceiling. Adaptive timeouts from seconds per KB (classification
first, adaptation later). Corroboration across divergent finding ids, unless it can match without
merging, rewriting or dropping an original finding. Changing Grok's `--deny Read` containment:
because containment does not change, Grok image and PDF cells stay `missing_flag`.

## Owner decisions pending (not in scope until decided)

1. **First-install friction.** Every new user is stopped within a minute to install the `gitsign`
   verifier, and on Windows it has no installer. The guide now has per-system steps. A proposed
   product fix is a consented "install the verifier" action in `bootstrap.mjs` (pinned official
   release, checksum checked, user-only folder), so the agent's question is one yes or no. It
   belongs with B (a fresh signed install must be completable by a new user) if accepted.
2. **Gemini route.** Google retired Gemini CLI for individual accounts on 18 June 2026;
   organisation licences remain. The owner asked for its removal. It is already opt-in and reports
   `ineligible_tier`. Proposed for 1.16.1: a deprecation notice in preflight, the Setup Center and
   the docs only; removal itself touches 51 files and is a later release.
   Decided: notice only; shipped in preflight and SKILL.md.
3. **Decided 24 September 2026: deferred to 1.17 as an accepted, documented risk.** It was not a hole
   1.16.0 documented, so it is outside the closed set, and closing it changes launch behaviour for
   every macOS and Linux user. Stated in the release notes and the gate record.
   **Reviewer launches on macOS and Linux still trust any PATH directory.** The independent
   review of 3d7a8be showed a repository could choose which executable ran. Every resolver now
   refuses a PATH directory inside the project, and on Windows `processScope.spawn` routes every
   launch through that rule and scrubs the child PATH. On macOS and Linux it still passes a bare
   name to `spawn`, so a PATH entry inside the reviewed project (for example one added by direnv,
   or an activated virtual environment inside the project) could supply `codex`, `claude` or
   `grok`. There is no working-directory search on those systems, so it needs that PATH entry to
   exist. Closing it changes launch behaviour for every macOS and Linux user, including anyone
   whose CLI is installed only inside the project they are reviewing, so it is the owner's call
   whether it lands in 1.16.1 or 1.17. It is recorded here rather than left in a transcript.
4. **Decided 24 September 2026: added to CI** as one Linux job (`site-and-ledger`) and to the signed
   release job.
   **Thirteen suites run by no workflow.** The site, ledger, preview, release-observer and
   improvement-regression suites (for example `scripts/momm-site-home.test.mjs`,
   `scripts/ledger-ui.test.mjs`, `scripts/preview-module.test.mjs`) pass locally but no
   workflow runs them, so a regression in them would only be found by hand. Adding them to one
   Linux job is small; it is listed here because it widens what the release gate asserts.

## Release gates

1. Local suites and the OS by Node matrix on the commit that will be tagged, read from the job
   logs, not the badge.
2. The lifecycle drills in B, with receipts.
3. Self-review of the 1.16.1 delta with per-piece quorum and a completion receipt for the
   committed range.
4. Privacy and history scan.
5. One live image review on the final tree.
6. Signed tag `momm-1.16.1`. A version string is not a release.

## Work order

1. Docs integrity (done with this plan).
2. Receipts, media type from bytes, capability expiry (A3, A1, A2).
3. Outcome classification and the attempt ledger (C).
4. Named security regressions (E).
5. Installation identity and conflict refusal (F1–F2). Selection, preview, link rollback and
   broader management (F3–F8) remain in 1.17 under the settled scope boundary above.
6. Lifecycle drills (B), last, because they certify the rest.

No 1.17 item starts before the signed `momm-1.16.1` tag exists.

## Progress

- 21 September: reliability implementation in an isolated candidate checkout. F2 now checks
  all discovered active paths after installation/update and preserves transaction receipts when
  an unrelated copy conflicts. Failed attempts contribute reported usage to the scorecard.
  `checks.mjs` executes an explicitly governor-selected local Node test; it never executes
  reviewer-supplied commands. `attempt-audit.mjs` hashes original sealed reports and attempt
  files and combines only identical source/policy/piece identities; its output explicitly is
  coverage, not completion. See [verification workflow](verification-checks.md). This is local
  implementation progress, not evidence that release gates have passed.

- 20 September: D (docs integrity) done. F1 (`--doctor --versions`) built: 16 tests on real links,
  green on all ten CI jobs. A3 first half built: `--range <base>..<head>` binds a review to both
  commit ids and to the head commit's file bytes; the completion state names the source and the
  pieces; 12 tests on a real temporary repository. Still owed for A3: `momm-check/1` verification
  manifests produced by a tool rather than by hand, and attempt ids (they arrive with C).
- 22 September: pre-handoff scope audit against this plan, the closed set, the gates record, the
  deferred list and the ideas register. Two documentation obligations were still open and are now
  closed, each with a failing check first: `CONTRIBUTING.md` reached only ten of seventy-five suites,
  so it now names the two authoritative sources (the workflow and the catalogue) and a check fails if
  it names a suite that does not exist or that CI does not run; and the public 1.16.0 change list
  implied every oversize hunk becomes governor scope, when line splitting is the default. The narrow
  six-name assertion that allowed the drift is replaced by the complete rule. Sections A1 to A4, C,
  E, F1, F2, G and H are implemented, except that A4 is implemented only as its checklist: the live
  image review it describes is a gate on the final tree, not code. Items 7 and 9 (real lifecycle
  drills, that final-tree live image review) remain the release gates they were always meant to be.
- 20 September: G built. `scorecard.mjs` and its training export, 17 tests. Run on the real 1.16 gate
  ledger: 10 runs, 482 findings, 440 ruled, 165 accepted; corroborated findings accepted 62% against
  36% single-source; 90% of accepted findings came from exactly one reviewer; per-piece reliability 71
  to 76% (the first version said 100% because it read merged rows, and the real data exposed it);
  1,376 labelled examples exported. The [ideas register](ideas-register.md) now holds everything
  that is not in this release, with origin, reason and "worth doing when".
- Field report, 20 September (it was the owner's own installed clone): the verified updater stopped
  on local changes, which is right, and left the person with nothing to do next. The refusal now
  names the files, says when MOMM's own signed files were edited, and gives three safe choices as
  commands the owner runs; it still changes nothing. A parser slip that ate the first letter of the
  first path was caught by the new test before it shipped. Belongs to item 7: an upgrade has to be
  something a person can finish.
- Found on the way, fixed, and now guarded: a tool had expanded a regex escape into raw control
  bytes in `installations.mjs`, so Git classed the file as binary and the first real `--range` run
  refused it. `scripts/source-hygiene.test.mjs` fails if any tracked text source has a raw control
  byte or is binary to Git.
