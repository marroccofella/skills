# MOMM Roadmap — alignment record

## Homepage cinema and diagram library — September 14

The first page presents the approved introduction with real scene thumbnails and
exact chapter links for installation, dashboard, benefits and ledger. Seven
expandable technical diagrams reuse the paper's source rather than diverging
copies. The voice owner explicitly accepted the setup and trailer cuts on
September 14. Both join the introduction as inline homepage players, with real
posters, explicit play controls, chapter/transcript pages and a three-film sitemap.
Chapter thumbnails seek within the homepage; playing another film pauses the first.
Unaccepted media never becomes a public player. The separate ledger film remains
held for audio repair. This is a website update, not a new MOMM product release.

## Technical paper and route branding — local page follow-up, September 13

Adds seven diagrams covering responsibility layers, the governor loop, privacy,
evidence linkage, historical successful-route counts, a hypothetical shared-error
model and a toy latency comparison. The architecture is explicitly pinned to
released 1.15.1, not the concurrent 1.16 candidate. Four original provider/product
marks have public source links and hashes; unresolved logos use text, never guessed
artwork. The teaching calculator makes zero model calls and states its assumptions;
no customer uplift or orders-of-magnitude benefit is inferred from developer logs.
Publication remains subject to the authorised MOMM review gate and privacy scans.

## Approved practical film and discovery — September 13, 2026

The owner-approved 1.15.1 introduction replaces the held preview. Its public
watch page includes captions, the complete transcript, chapter links, explicit
sharing controls and installation guidance. Media hashes bind the approved file;
VideoObject/Clip metadata and the video sitemap describe that same film. Sharing
is user-initiated, without tracking or automatic posts. Setup and trailer audio
were separately accepted on September 14; the ledger film is still held.
Discovery improvements do not promise ranking, virality or customer
productivity gains. Runtime and narration pace come from the approved manifest;
the earlier 15x screen-action note below describes a superseded cut.

## Public search and answer clarity — page-only follow-up

The public renderer now emits page-specific titles and descriptions, unique
canonical URLs, source-linked WebPage/SoftwareSourceCode information and visible
breadcrumbs. Direct answers cover reviewer support, costs, privacy, setup and
evidence limits. A generated-page regression gate keeps canonical URLs aligned
with the sitemap and tests structured-data escaping and visible answer content.
These changes aid discovery and comprehension; they do not establish indexing,
search rankings, AI citations or independent product accuracy. Root crawler
policy and webmaster-account submissions are unchanged; approved video handling
is described above.

The same page update adds scoped Promptus voice-workflow credits, a source-linked
Professor Dominic Marrocco background section with historic appointments labeled
as historic, and a benefits table computed from the public decision snapshot.
The public skill's release history and earlier Promptus MoMM work stay distinct;
a two-year origin awaits dated provenance. Recorded decisions are not unique
bugs, customer counts or a controlled AI-alone versus AI-plus-MOMM experiment.

## Public tour refresh — September 13, 2026

Documentation-only follow-up to published 1.15.1: manifest-derived prominent
release identity and patch changes; a version-bound narrated-tour slot; verified
public CI links separate from the unchanged September 4 telemetry; five offline
charts, explicit route-result denominators and failure categories; restored prose
and attachment guidance, and a release-verifying new-user installation prompt.
The new Dom narration must pass signal/word checks and the owner's listening
verdict before public video acceptance. Screen actions are accelerated 15x;
narration and readable holds are not. No automatic update or new dispatcher
feature is introduced. Existing historical notes below are not current blockers.

1.15.0 was published on September 13. The subsequent fresh-install check exposed
gitsign's inability to open the updater's bare staging repository. The 1.15.1
patch uses normal empty staging and adds real signed preview/apply to the release
gate before stable tags are pushed. The earlier candidate notes below remain
historical; the 1.15.0 tag is immutable. No new feature scope is introduced.

Candidate 1.15.0 stabilization also covers shared installer/updater receipt exclusion,
scope-preserving rollback, explicit downgrade selection, compatible public CSV
columns, overlapping-source decision deduplication and ledger navigation regressions.
These are verified local repairs; publication still requires the release gates below.

Purpose: keep parallel sessions and future releases pointed the same way.
Before proposing or building a MOMM feature, read this file; after shipping or
rejecting one, update it. Shipped items stay listed so nobody re-proposes them.

## Candidate — not released

### 1.16.0 candidate — measured, rated, guided, split, clock-driven, modality-aware

Branch `release/momm-1.16.0` (draft PR #4; plan in `references/plan-1.16.0.md`,
verification record in `references/release-1.16.0.md`). What it adds, all
off-by-default where it touches the network or the user's machine: per-CLI
token and cost accounting in reports, ledger and Setup Center; reviewer
ratings (`ledger.mjs --rate`) with a five-run floor and 30-day route
reliability that recommends only on ten or more runs; guidance layers behind a
per-file trust gate (untrusted text is never sent); `--split` with per-piece
quorum, over-ceiling hunks divided at line boundaries into consecutive valid
sub-hunks so routes read every line of a whole new file (on by default in
the dispatcher, lossless on reassembly; `--no-line-split` keeps the older
rule; a hunk stays whole as governor-direct scope only when one of its lines
is itself larger than the ceiling) and `--jobs` parallel
dispatch; an event-driven update clock with conditional GETs whose
automatic-update toggle is off by default and never enabled by an agent;
`update --check-all`; containment probes per CLI; one design system with a
theme toggle shared by the Setup Center and the private ledger.

E7, the modality registry (`references/plan-1.16.0-e7-modalities.md`, two
momm reviews): a shipped baseline `references/capabilities.json` (levels
verified only from help captures, otherwise documented) plus a per-machine
overlay written only by probes, with blockers that expire into `reprobe`
rather than silently clearing; `multi-review.mjs --capabilities`; attachment
routing and `--reviewers auto` on the effective cell (overlay over baseline)
with `requires` bound to argv or `missing_flag`; `probes.mjs <cli>
--modalities [--consent]` with synthetic material, content assertions and a
disclosure before any generation; `modality.mjs plan|run` for cross-route
chains with a separate immutable creative prompt, step-scoped harvest (a step
that produces nothing fails) and consent per run; a Setup Center Modalities
panel. Grok media is not bound in the review adapter because its containment
is `--deny Read`; its image and PDF cells route as `missing_flag` until a
staged-files-only read grant exists. Generation never runs inside a review.
Publication still needs the privacy scan, the signed tag and the evidence
refresh.

### Legacy bootstrap hardening — local follow-up to 1.15.1

Separately trusted bootstrap and migration helpers now distinguish missing tools,
failed signatures, missing receipts and legacy conflicts. Preparation verifies
the release workflow identity, issuer, repository, ref, workflow commit, package
hash and checked-out bytes before any candidate code runs. Migration previews the
exact protocol and scope, requires the approved plan hash and separate protocol
acceptance, and moves the old entry outside skill discovery with a rollback
journal. Project ledgers are never copied or merged. Active or ambiguous process
locks and changed entries fail closed; recovery is not a power-loss guarantee.
The explicit sensitive-diagnostic hard constraint is restored. Setup Center and
the public guide explain these routes rather than asking agents to invent them.

Local Windows tests include a genuine signed 1.15.1 preparation, synthetic legacy
installation and restoration; deterministic fixtures exercise failure paths.
Security review also reproduced Git replacement/object substitution and competing
rollback attempts. The candidate ignores replacement resolution, rejects modified
Git administration, checks object integrity and holds an exclusive recovery claim.
Windows executable shadowing has a real regression; tool paths are absolute and
outside the inspected clone. Untracked files fail verification. Prerequisites,
check timeouts and orphan claims have distinct diagnostics, without force repair.
These changes are not published. Native macOS/Linux matrix results, final peer
decisions and release verification remain required before a release claim.

Final September 13 repairs: updates fetch full ancestry and verify promotion and
Git connectivity across intervening commits; repeated explicit harness installs
preserve matching clean verified provenance. Existing update claims fail closed
instead of racy dead-PID reclamation, and receipt/journal decisions are rechecked
inside exclusivity. A stale claim may need manual inspection before recovery.
The hub version is stamped from the manifest; sitemap generation omits unverified
lastmod dates. The shared prompt covers new and legacy users without broadening
skill/harness scope. Governor locations normalize only within reviewed paths;
protocol commands use quoted absolute paths and failed ledger builds are visible.

### 1.15 release candidate — explicit updates and clearer public information

Implemented in the candidate: installation receipts with per-harness scopes;
manifest-only check, signed staged preview, explicit apply, protocol acceptance,
stable/pinned/main channels, retained offline rollback, daily opt-outs, executable
hashes, five focused information pages, and deterministic public-data rendering.
Publication remains gated by the OS/Node matrix, MOMM dispositions, privacy scans
and a verified Sigstore-signed tag. Do not call this candidate released until those
gates pass. Main-channel updates require a signed development checkpoint; an
ordinary unsigned branch head is not eligible. Legacy unsigned tags stay intact.

The candidate adds a source-linked version-history archive and an existing-user
upgrade prompt. Published releases, tags without Release records and untagged code
milestones are distinguished; gaps are not invented. Legacy installs must approve
a bootstrap, preserve their prior installation and establish an actual receipt.
Growing governor logs are streamed with full-byte hash rechecks, bounded individual
records and selected-run memory; corruption or concurrent mutation fails closed.
The completion command uses the absolute installed skill path from the project.
Public export regression tests now cover validation-before-write, sparse legacy
reports, canonical duplicate comparison and aliased preview roots. Filesystem I/O
failure is not a multi-file atomic transaction. Current documentation distinguishes
supervised POSIX groups from independently detached processes. CLI maintenance
refuses known Volta/Scoop/Chocolatey/asdf/mise-managed executable paths; executable
magic alone is not ownership proof, and unrecognized package managers remain a
discovery limitation. Declined-update assertions include an actual API call counter
and a positive control; exact-command endpoint checks cover successful launches.

Candidate release testing also found interrupted notice claims, changed ignore
rules stranding rollback, and browser default speech bypassing local-only voice
selection. Each now has a regression fixture. The signing workflow can reuse
matching verified tags on retry, and has an explicit main-checkpoint-only mode.
Claude's text review disables customizations and tools while retaining OAuth and
plan permissions (verified flag surface: 2.1.233); Grok preserves the supplied
prompt with --verbatim and disables subagents (1.0.5). Live re-verification is
still required; unsupported flags fail closed on older installations.
Output parsing now prefers the final review and refuses explicitly non-final
Grok envelopes; regression fixtures cover intermediate/final ordering. Copilot
requests non-streamed final text while preserving its viewer-only tool allowlist.
An unmet external-review quorum can no longer coexist with outstanding.complete.
Executable hashes are captured at dispatcher startup, not retroactively from
files changed during review; a changed installation clears verified-release status.

Candidate lifecycle hardening: peer-review/2 requires explicit completion and
artifact quotations; malformed/over-limit/error-wrapped replies fail closed before
normalization. A governor validator checks original report/log linkage, unique
item decisions, required before/after or refutation records, and current source,
test and output hashes. It records completion separately and keeps stale/deferred
work visibly open. The controlled zero-model-call regression runs real authored
tests before/after a seeded fix and tests conflicting/missing/forged decisions.
This validates consistency, not an agent's honesty, test adequacy or all harnesses.
Current source capture supports local text input and exact current Git text A/M
diffs; binary/deleted/renamed source and media lifecycle binding remain open.

Candidate reviewer reliability: real source probes completed after the former
120/180-second windows. The default base is now 180 seconds (deep: 240), with
existing Grok 1.5x headroom and explicit timeout overrides retained. Scope prose
is concise and useful novelty is optional; all material findings remain required.
--stream sends content-free elapsed/deadline/byte-count progress, never reasoning.
An explicit --effort medium is supported for locally verified Claude/Grok flags;
default leaves account settings alone. Output is decoded across UTF-8 chunks and
bounded in bytes, malformed JSON scans linearly, and Windows uses native/verified
npm bin launchers instead of shell argument interpretation. Transport fixtures
run in the OS/Node matrix; local success is not a cross-machine certification.
Grok's text adapter uses ordinary final JSON, explicit deny rules for read/search,
shell/edit, MCP and web tool classes, and a four-turn ceiling within the unchanged
wall-clock deadline. An empty --tools value did not disable reads in a local
1.0.5 canary; explicit deny rules withheld its marker. This is CLI policy, not an
OS filesystem sandbox or certification of every future binary. A 38 KB synthetic
control completed after an earlier quotation-invalid reply; real-source quorum
is still required. The local peer contract remains mandatory. Failed/non-final
probes are not successful reviews.

Stabilisation regressions now cover CLI/model errors versus real login failures,
partial installation receipts, comma-separated skill names, torn update claims,
strict-policy shape diagnostics, source text containing sample diffs, repository
root guidance, concurrent Git-source changes, and genuine a/b source directories.
The release seal refuses a dirty checkout; prepare requires the intended files
staged first. The signing job pins setup-node and queries successful exact-commit
push runs explicitly. Preview stream failures, slash redirects, copy feedback and
restored harness snippets have offline regressions. None of this marks the
candidate released or turns legacy decision counts into validated completion.

Candidate CLI maintenance now inventories all six installations independently of
governor self-exclusion. The dashboard shows installed/latest versions, source,
installation type and explicit update actions. Failed checks stay unknown; AGY
has no verified read-only latest query and needs an explicit native update.
Native updater commands bind to the detected path; npm commands bind to the
detected global prefix. Homebrew, project-local and unknown wrappers receive
guidance rather than a guessed global install. A launched terminal is not an
update success; changed versions invalidate prior live checks. Offline fixtures
cover inventory, failed native checks, prereleases, origins and declined consent.
Local Windows binaries were updated and re-probed on 2026-09-12; account quotas,
tier eligibility and real-source review quorum remain separate gates.

Quotation validation treats CRLF/LF as equivalent while retaining all other
literal characters and the original input byte hashes. This repairs a reproduced
cross-platform false rejection; it does not certify the cause of every earlier
invalid reply. Setup update endpoints require the displayed command, readiness
probes require the local token, and request bodies are byte-bounded and decoded
once. Supervised POSIX children now own groups; deadlines and normal leader exit
kill residual members. Handled shutdown signals allow nested dispatchers to
cancel their reviewer groups before bounded escalation. Windows retains taskkill
tree termination and a direct-child backstop. After a Windows leader exits
normally, ordinary helpers may no longer be addressable through that leader;
guaranteed residual cleanup needs OS job ownership, which is not implemented.
Cross-platform policy fixtures pass
locally; real POSIX descendant drills must pass in CI before release. This is not
OS sandboxing: an uncatchable crash, blocked event loop or independently detached
helper can defeat signal forwarding. Hard settlement still prevents hung pipes
from stranding the dispatcher or Setup Center.

The attached broader proposals are not silently bundled: API-key support conflicts
with OAuth-only policy; a repository split, automatic execution of peer-authored
tests, independent benchmarking and marketing outreach remain separate decisions.

## Planned — later work

### Stronger process containment

The candidate owns ordinary POSIX descendant groups and tests nested cancellation.
Independent OS job/cgroup containment remains separate future work; do not claim
group signalling contains arbitrary detached processes or survives every crash.

### Route failures are product bugs, not vocabulary

The initial September 4 prompt-size hypothesis is unproven. The September 13
maintainer knowledge base reports headless tool-permission denials and a small,
single-artifact A/B trial: 3/4 replies with the old prompt and 4/4 with explicit
instructions that the prompt file is the entire input. Those counts are attributed
to the maintainer's table; it does not link the raw eight-run evidence.
A candidate probe also reproduced an empty response on just 714 bytes of synthetic
input, so size alone is not an adequate explanation. The candidate now tells the
route not to search other files or run commands, while retaining plan/sandbox
controls. Prompt instructions are not filesystem isolation. Repeated probes and
representative real-source reviews remain required before claiming reliability;
empty, invalid or timed-out replies still fail closed.

The candidate's follow-up on that same 714-byte source produced two valid clean
reviews with the amended prompt; a 736-byte negative control produced a valid
defect report identifying the seeded exclusive-bound error. These local synthetic
controls exercise the real dispatcher and account route, not every provider/model
or representative large source. No permission flag was relaxed.

Release-fix regressions also cover color-forced Git diffs, realpath entrypoints
through directory aliases, failed alias cleanup, repeated child errors, Windows
tree-kill failure/budget policy, literal CRLF excerpt boundaries, saved diagnostic
redaction, native update flags and malformed dashboard maintenance responses.
An account card retains failed evidence while offering an explicit retry after
login. Public source and Pages remain unchanged until the release gates pass.

31 of 120 sealed runs lost at least one route to a timeout, and antigravity
returned invalid_output on every 2026-09-04 run. The status vocabulary keeps
the ledger honest, but the page and the terminal now say plainly how many
routes did not review. Next: per-route adaptive budgets from the ledger's
own p90 (grok and codex already get headroom), and an antigravity adapter
fix once the 1.14.0 invalid_output diagnostics show the failure class.

### Second-reviewer cross-check for verify-first findings

`verify_first` (shipped 1.10.0) flags single-source findings from
low-precision routes. Next step: an optional pass that asks one *high*
-precision route to confirm or refute just that finding before it reaches the
governor. Keeps the reproduction gate; reduces governor time spent on
hallucinated findings. Opt-in flag (`--cross-check`), never silent.

### Global cross-project ledger

Ledgers are per-project silos by design (telemetry stays beside its repo),
but the owner experience fragments: the demo review lives in demo/, the game
reviews in Willy/, and nothing lists them together. Add an opt-in aggregator
(`ledger.mjs --global`) that reads a small local registry of known
`.ensemble_reviews` roots (appended on each run, home-directory dotfile),
renders one combined page with per-project sections, and never copies
telemetry between projects — links and counts only. Registry is hash-free
paths on the owner's own machine; the aggregate page carries the same
private-by-default posture.

### Persona effectiveness measurement

Dispositions now record reviewer; they should also record the **persona** the
reviewer wore for that run, so `--stats` can answer "did copilot=verifier
actually raise copilot's precision?" — the tuned defaults (1.10.0) were set
from pre-persona data and need their own A/B evidence. One added field per
disposition line; ledger table gains a persona column when present.

## Shipped (do not re-propose)

- **1.14.1** — second page critique: FAQ answers rendered visibly (CI answer corrected: no token path, so headless runners need a CLI session or run pre-push with --tier quick); ANSI/OSC sequences stripped before the reviewer JSON parse (self-test); routes.md Markdown table beside the HTML table; footer ends on the licence. Declined again: auto-executing reviewer repro snippets; the word automated for the gate.

- **1.14.0** — response to external critique (2026-09-04): prose
  corroboration by shared quotation (a finding with no line_range merges
  with another reviewer's finding that shares six normalized words; the
  manuscript specimen goes from 26 raw / 0 corroborated to 10 defects / 9
  corroborated, agreement 0.90; four self-tests); `--tier quick|deep`
  presets (quick = copilot+antigravity, 60 s; deep = pool + quorum 2;
  explicit flags always win); `invalid_output` now records the failure
  class, byte counts and a sanitized 200-char sample; token-prefix redaction
  extended (gho_/ghu_/ghs_/github_pat_/AKIA/bare sk-) with a template-string
  survival test; `--stats` and the report's insights call the metric what
  it is — the governor's acceptance rate, not ground-truth precision; the
  live UI ends with material findings, anchors, the reviewer's reproduction
  idea and the routes that did not review; `install.mjs` requires an
  explicit `--target`. Closes the prose-artifact correlation and the
  antigravity diagnostics items.

- **1.13.0** — lineage reconciliation: merged the published 1.10.0–1.10.2
  Setup Center line into the installed 1.11–1.12.0 line (kept the single-file
  dispatcher and monolithic Setup Center; took myrepo 1.3.1 and myskills
  1.1.0; unpublished 1.12.1 candidate preserved on branch
  candidate/momm-1.12.1). Fixes from MOMM reviewing MOMM
  (rev_20260904131435_mf6w, reproduced before fixing, regression self-tests
  added): Setup Center `supervise()` misreported timeouts (CRITICAL,
  codex+copilot); ledger read-aloud stale-event reset (WARNING, codex);
  myskills drive-specific path redaction (codex); Setup Center self-test now
  fails on provider/dispatcher modality drift; ledger pre-indexes
  dispositions by run_id. Public page rebuilt with a consented narrated
  walkthrough, ledger-derived charts, and a manuscript peer-review specimen
  under `.reviewrules` journal guidelines (rev_20260904131823_wvxh); public
  evidence export regenerated by `export-public-evidence.mjs`. Also ships the
  ledger accounting reconciliation below.
- **1.13.0 ledger accounting** — Observed 2026-09-04 on a real ledger: the headline said 123 triaged
suggestions while the reviewer table summed to 116, because seven `deferred`
rows were counted in the headline and silently dropped from the table. Fix:
every parseable disposition row now lands in exactly one bucket — applied,
rejected, deferred, other — with an `unattributed` line for rows lacking a
reviewer and a total row that must equal the file's row count (the panel
flags itself if it does not). Same treatment in the dispatcher's `--stats`.
Precision is unchanged (applied / adjudicated) and deferred rows never move
it. A second table separates reviewer findings from execution reliability:
completed / dispatched, completion rate, timeouts, other failures, median
findings per review and severity-weighted findings per review (sealed
reports only; CRITICAL 3, WARNING 2, NITPICK 1), and utility = severity-
weighted applied suggestions / completed reviews. Utility weights a
suggestion at 1 unless its disposition carries the new optional
`finding_id` field, so precision alone can no longer flatter a route that
rarely completes (codex: 100% precision, timeouts on every 2026-09-04 run).
Self-tests: ledger +6, dispatcher +1. Protocol note added to SKILL.md that
dispositions belong beside the review log the dispatcher wrote.

- **1.12.0** — multimedia review, core: `MODALITY_SUPPORT` matrix (evidence-
  verified per route: codex text+image via native `codex exec -i`; claude
  text+image+pdf via tool-read with `--add-dir`; gemini
  text+image+pdf+audio+video via `@file` prompt references;
  antigravity/copilot/grok text-only until verified); repeatable
  `--attach <file>` staging copies with JPEG APP1/APP2 and PNG
  tEXt/zTXt/iTXt/eXIf/tIME metadata stripped locally (zero-dep, self-tested
  on synthetic buffers); per-modality reject-don't-truncate size caps; routes
  missing an attached modality fail closed as `unsupported` before spawning;
  attachments recorded in dispatch events and reports as name/modality/
  bytes/sha256 only; optional additive `region` [x,y,w,h] field on findings;
  preflight reports per-route modalities; Setup Center modality row per
  provider card. Also: explicit `--timeout` now honored above the 360s agent
  cap (the clamp only bounds auto-scaled budgets), closing the 2026-08-23
  open item. Self-tests: dispatcher 44, setup-ui 18.
- **1.11.1** — ledger honesty fixes: a run with zero completed external
  reviews now wears an explicit "no verdict — 0/N completed" badge instead of
  a "0 findings" label that masqueraded as a clean pass (immediately exposed
  two failed 2026-08-19 release gates that had passed unnoticed); sealed
  reports list their non-success routes ("Routes without a review: …");
  reviewer track-record table rendered at the top of the ledger (same math as
  --stats); verify-first flags shown on findings; workspace-scope note in the
  header.
- **1.11.0** — ledger read-aloud, baseline tier: per-run "Read aloud" control
  in ledger.html driven by browser `speechSynthesis` (local, zero
  dependencies, disabled gracefully when unsupported). Narration is composed
  by `narrationFor()` from structured closed-vocabulary fields only — run
  label/id, governor, reviewer statuses, verdict split, severity counts,
  verify-first count, disposition tallies — never reviewer prose or artifact
  content (enforced by a sentinel self-test). Toggle semantics (click to
  speak, click to stop), `aria-pressed` state, 6 ledger self-tests
  (`ledger.mjs --self-test`). Verified live in-browser: 25 runs, speak/stop
  state transitions confirmed.
- **1.10.0** — per-agent tuned default personas (codex=surgeon,
  claude=architect, gemini=fresheyes, antigravity=adversary, copilot=verifier,
  grok=innovator; `none` to disable); ledger-derived
  `insights.reviewer_track_record` + `investigation_order`; `verify_first`
  flag; `--stats` table; Setup Center codex/gemini provider cards + gemini
  governor option; six-route readiness probe; connectivity timeout unified at
  240s (named constant, budget documented); dispatcher-grade process-tree
  containment in the Setup Center's child runners; self-tests 38 + 17.
- **1.9.x** — Setup Center (guided OAuth onboarding, quick setup, maintenance
  panel); versioned skills repo checks; update awareness.

## Open items

- **Fresh source-bearing release review** — the user approved the final dispatcher,
  dashboard, public website and documentation scopes for Claude and Antigravity,
  in addition to the previously approved updater/installer/protocol scopes.
  Approval is not a review result; each final scope still needs source-bound
  quorum, governor decisions and verification before publication.
- The running Setup Center instance must be relaunched after upgrades; old
  processes serve stale UI (observed live on 1.9.x → 1.10.0).
- Explicit timeout overrides are already honored (see 1.12.0 above); provider
  completion reliability remains a separate open item, not an unimplemented cap fix.

## Parked ideas (small, fun, or unproven)

- Demo flourish from grok's innovator persona (run `rev_20260823211631_18kv`):
  a `SOUND 110*I` variant of `demo/count_to_ten.bas` so the program audibly
  counts — a natural read-aloud sibling if a showpiece demo is ever wanted.
- `momm stats` persona/precision trends over time (needs the persona field in
  dispositions first).

## Alignment rules of thumb

1. Additive report fields only; `momm-report/1` consumers must never break.
2. Anything that speaks, uploads, or publishes defaults to OFF and local.
3. Every reviewer-facing prompt change ships with a negative control run
   (trivially-correct input must still yield zero findings).
4. Update this file in the same commit as the feature it describes.
