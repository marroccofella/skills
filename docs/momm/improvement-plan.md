# MOMM website and bounded improvement loop

Audit date: 20 September 2026. This is a work record, not a release approval.

## Source identities and collaboration boundary

- Website baseline: `a8f7be8d123748388099a3c7503a0edc44648e9a` on main.
- Draft 1.16.1 reviewed at `1fc113fe7e8d62c2770fa0dd06afa238bc504f6d`, PR #18.
- No public 1.17 branch or pull request was found at audit time. Its candidates are in
  `momm/references/ideas-register.md` on the 1.16.1 branch, not implemented release claims.
- This change does not modify the installed skill, the draft release branch, the release
  seal, default reviewer behavior or the stable version manifest.

## Findings and action

| Finding | Action in this change | Verification |
| --- | --- | --- |
| Browser script replaced an approved film with an unfinished film, leaving old timing and chapter metadata | Remove source swapping; feature the catalogue-approved introduction | Player regression and catalogue tests |
| Three films and seven full diagrams crowded the homepage | One featured introduction, one architecture overview; other films grouped by purpose in Media | Generated HTML and media tests |
| Media was added only by JavaScript | Generate consistent navigation, including Media and Improve MOMM | Nested-page link tests |
| Update copy said never automatic | State off by default, owner opt-in only | Copy regression |
| Install copy promised one question and no further upgrade questions | Explain prerequisite, preview, protocol and future-behavior choices | Copy regression |
| Proposed automatic self-improvement had no disclosure boundary | Public metadata observer; release-specific GitHub issue, bounded updates, no private evidence export | Mock API tests; workflow review |

The unapproved preview's existing public assets and direct watch URL are not deleted by
this change. Their removal is covered by draft PR #19 and requires coordination to avoid
silently undoing another engineer's work. They are excluded from featured/catalogued media.

## Explicit version split

### 1.16.1: patch safety and verifiable claims

PR #18 already contains inventory, source-range receipts, actionable dirty-clone refusals
and a governor-decision scorecard. Keep these in its closed plan; do not duplicate them here.
The four-tier modality proposal is useful architecture, but several particulars are not
current behavior: `--preflight` is zero-call; a capability ledger is not automatically a
cryptographic signature; Grok's denied Read path must not be relaxed to claim media support.
A one-pixel image, silent WAV or PDF header alone cannot prove semantic ingestion.
Keep byte validation, capability expiry, receipt binding and rejection classification in
the existing patch work order with failing-before/passing-after tests. This website patch
does not claim to have implemented or completed those core gates.

### 1.17: measured improvement, not self-authorized changes

Propose a licensed seeded-defect corpus with separate held-out fixtures, public measurements
of confirmed defects, misses, false positives, triage time and latency. Preserve original
findings, including duplicates, before measuring agreement. Governor acceptance is not
ground truth. Any adaptive timeouts or route weights need measured evidence and an explicit
plan, never automatic learning from untrusted reviewer prose. Signed receipts need a real
identity/key design, not a hash renamed a signature. No automatic paid model probes.

## Observer operation

The workflow is a repository maintenance feature, not a change to installed MOMM. It runs
on published stable `momm-X.Y.Z` releases, completion of the trusted main-branch signed
publisher, and manual dispatch after merge to main. The publisher-completion trigger covers
releases made with GITHUB_TOKEN, whose events do not trigger further release workflows.
That trigger and manual dispatch check the first stable MOMM release returned in the first
100 GitHub release records; this is not a highest-semver upgrade decision and does not
backfill all history. There is no polling schedule. It checks
only GitHub release/asset/tag/version metadata. It does not execute code from release tags.
It records the exact tag commit, checker commit and a link to public workflow history. An issue is created
per release. One bot-authored summary is updated only when observations change; a closed
issue is never reopened. Maintainers can disable the workflow in Actions to stop it.

No secrets, local paths, email addresses, model responses, private code, machine inventory
or private ledger data enter the issue body. The generated suggestions are fixed text chosen
from deterministic checks, not executable model instructions. Missing evidence means
unverified, not failed security or release approval. Human replies and rulings remain intact.
Editing the managed summary body (including changing its line endings) deliberately stops
updates with an actionable workflow failure. Put rulings in comments, or close the issue to
stop observations for that release. The content hash is an edit detector, not a signature.

Workflow references: [release and workflow-run triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
and [workflow-token behavior](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).

## Peer review and dispositions

MOMM run `rev_20260920090029_nhbk` reviewed the source-change bundle, with Codex as governor.
Quorum 2/2: Claude MODIFY (9 findings), Antigravity ACCEPT (0 findings).
Copilot exhausted account quota; Grok timed out. Neither counts as approval. Agreement score
0 means no jointly reported findings here, not proof that reviewers disagree about correctness.
Antigravity's claims to have defeated all attack vectors are reviewer prose, not test evidence.

This initial review input was a source-change bundle, not a source-file diff. MOMM's completion
validator correctly refused path-bound finding certification because its captured source was
the bundle rather than the individual files. No completion receipt is claimed for that run.
The real tests and rulings are retained, and a final source-file review follows. Private reports
stay private. The table below publishes only the governor's bounded rulings.

| Reviewer / item | Disposition | Reason and verification |
| --- | --- | --- |
| Claude: workflow-run branch filter | Rejected | Publisher uses workflow_dispatch on main, not tag push; `publisher-main` investigation passes |
| Claude: missing navigation silently accepted | Applied | `nav-shape` fails before, passes after; one shared navigation list, exactly one primary landmark required |
| Claude: unknown accepted film silently omitted by gallery helper | Applied with modification | `gallery-id` fails before, passes after; refuse unknown ID rather than invent a category. Full watch pipeline already refused unknown IDs |
| Claude: direct release-ID path untested | Applied | `direct-release-coverage` fails before, passes after wiring direct, draft and prerelease cases into site CI; direct path itself already worked |
| Claude: human edit makes observer fail | Rejected | `human-edit-refusal` confirms intentional no-overwrite behavior; changed bytes need attention, not a green run |
| Claude: update claim checked on one page | Applied | `current-copy` now checks seven current pages; historical version notes retain their dated behavior |
| Claude: closed status says unchanged | Applied | `closed-wording` fails before, passes after; now says skipped, no issue update |
| Claude: missing hashes collapse gallery entries | Applied with modification | `gallery-hash` fails before, passes after; refuse malformed evidence before dedupe, not display unsigned metadata. Full watch validator already checked hashes |
| Claude: stale seven-diagram test message | Applied | `test-log` now describes one architecture overview |
| Claude: replace bounded issue scan with search/pointer | Rejected | Search indexing can lag; committed pointer would add automatic repository writes. Current scan refuses beyond its explicit bound |
| Claude: simplify seven diagram labels | Rejected | Retaining the complete paper's count guard is deliberate; only the overview is rendered on home |
| Claude: shared nav export and invariant | Applied | Shared list and failing-before/passing-after `nav-shape` |
| Claude: new page-specific social images | Rejected | General pages share the approved introduction poster; watch pages already preserve film-specific images; no new approved artwork exists |
| Claude: pin ideas-register source | Applied | `pinned-ideas` verifies the audited full commit link survives branch deletion |
| Claude: missing workflow token guard | Applied | `missing-token` proves no network attempt when the credential is absent |
| Claude: validate commit before content request | Applied | `commit-boundary` proves malformed SHA is refused before a content URL is constructed |
| Antigravity: normalize CRLF in integrity check | Rejected | Hash binds exact generated bytes; line normalization must not silently authorize an overwrite |
| Antigravity: replace all matching navs | Rejected in proposed form | Exactly one primary nav is required; duplicate primaries now fail instead of being silently rewritten |
| Antigravity: optional chaining for parsed null | Rejected | Existing bounded parse/catch already treats null/malformed metadata as unverified; no behavior change needed |

Local verification: deterministic renderer, all site checks (44 pages, 924 local references),
19-entry release catalogue tests, documentation consistency, media contract and 126-file public
privacy test passed. Desktop 1440px and phone 390px previews were inspected; phone navigation,
reduced-motion visibility and actual video chapter seeking passed with no page errors. These
local results do not substitute for the PR's cross-platform CI or a post-merge live-site check.

## Follow-up source-file reviews

Run `rev_20260920091639_knoo` captured the actual 13-file source diff rather than a
bundle. Antigravity returned ACCEPT with no findings; Claude's response failed the
report-format check (missing or oversized summary). Quorum was 1/2, so this run is
not a completed review gate. No completion receipt is claimed.

| Reviewer / item | Disposition | Reason and verification |
| --- | --- | --- |
| Antigravity: duplicated direct-release test key | Applied (style) | Removed identical duplicate assignment; full regression suite passes, no behavioral change claimed |
| Antigravity: special release-ID 404 message | Rejected | Existing status-specific error stops the run without publishing an observation; additional wording is optional |
| Antigravity: job-level permissions | Rejected | There is exactly one job; moving the same permissions would not reduce its effective access |

Final run `rev_20260920092155_2iiq` captured 14 actual source files, including the roadmap
note. Quorum 2/2: Claude MODIFY (6 findings), Antigravity ACCEPT (0). Both succeeded on
their first attempt; the enabled invalid-response retry was not used. Agreement score 0
means no jointly reported findings. Claude's six findings were unique to that route;
the highest concentration was the regression runner (3), then observer (1), homepage
test (1) and gallery (1). Model claims of having executed attacks are not test evidence.

| Reviewer / item | Disposition | Reason and verification |
| --- | --- | --- |
| Claude: CRLF issue creates duplicate | Applied | Independently reproduced; recognize LF/CRLF identity but retain exact-byte edit refusal. Before exit 1, after 0, zero writes |
| Claude: imported suite consumes host arguments | Applied | Only direct CLI reads case argument; imports run all cases. Before exit 1, after 0 |
| Claude: imported failure can be masked | Applied | Suite throws on any failure; seeded failure cannot be hidden by a later exit-code assignment. Before exit 1, after 0 |
| Claude: homepage/companion count mismatch | Rejected | Current homeCinema does not call companionFilms. Actual home and gallery suites both pass before/after investigation |
| Claude: missing-token test depends on cwd | Applied | Resolve observer from module URL; execution from docs passes. Before exit 1, after 0 |
| Claude: same-ID same-hash entry bypasses guard | Applied | Identity guard precedes hash deduplication. Before exit 1, after 0; distinct identities with matching bytes still deduplicate |
| Claude: narrow issue scan using search/creator | Rejected | Keep bounded enumeration and explicit bot identity checks; search freshness/creator encoding are not established here |
| Claude: normalize CRLF identity and integrity | Applied with modification | Recognize CRLF identity only; normalization must not silently authorize overwriting an edited body |
| Claude: export runner and separate CLI arguments | Applied | Exported run, explicit main detection and thrown failure; same argv/failure reproductions pass |
| Claude: select diagram by ID | Rejected | Current ordered technical paper intentionally begins with the ownership overview; current tests verify it. Optional refactor, no reordered-paper defect reproduced |
| Claude: rename mutating navigation helper | Rejected | Mutation is explicit at its renderer call and idempotency-tested; optional naming change |
| Claude: require navigation on every generated page | Rejected | Already iterates every generated MOMM HTML entry and refuses absent/duplicate primary landmarks; tested |
| Claude: textual workflow-shape test | Rejected | Exact permissions, pinned actions, default-branch checkout and disabled credential persistence were manually checked; optional additional drift coverage |
| Claude: data-only acceptance of fourth film | Rejected | A new film needs deliberate purpose, category and approval wiring; unknown accepted identity intentionally refuses |
| Claude: latest endpoint or highest semver | Rejected | Repository latest may be another skill; semver maximum can ignore intentional release ordering. Bounded first-stable selection is explicitly documented |
| Antigravity: historical pagination | Rejected | Backfill is outside the future-release observer's scope and bound |
| Antigravity: use path.posix for prefixes | Rejected | Controlled forward-slash paths and nested navigation tests already establish correct depth prefixes |

The governor authored five failing-before/passing-after reproductions, investigated the
non-reproducing homepage report and reran all six verification suites. Completion validation
returned `complete: true`, no errors and no unresolved items, with a private receipt for this
run. It validates these 14 source-file hashes and local records, not all repository history,
independent execution truth, cross-platform CI, a release or live deployment. Generated
website outputs were checked separately against the deterministic renderer. Every ruling is
also retained in the private ledger; no raw report or machine telemetry is published.

## Still requires engineer/owner review

- Merge coordination with PR #19, then live Pages verification; this branch does not deploy.
- Legacy Pages currently deploys main/docs separately from the safety workflow. A CI-gated
  Pages migration needs a dedicated reviewed change and repository setting switch; this
  observer does not fix that deployment policy.
- Confirm the first observer issue and no-change rerun after the workflow is enabled.
- Human review of future films' pronunciation, cadence, visuals and factual claims before
  adding them to the accepted catalogue. Rendering or a peer's ACCEPT is not that approval.
