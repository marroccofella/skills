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

*Done when* each numbered line has a test on real folders (junctions on Windows, symlinks
elsewhere), the lifecycle drills in B end with `--doctor --versions --expect <version>` exiting 0,
and the owner's five-folder case above is reproduced as a fixture.

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
5. Installations and precedence (F): the read-only inventory first (it is also the last step of
   every drill in B), then the conflict refusal, selection, preview, rollback and banner.
6. Lifecycle drills (B), last, because they certify the rest.

No 1.17 item starts before the signed `momm-1.16.1` tag exists.
