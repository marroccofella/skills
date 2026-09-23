# MOMM ideas register

Where ideas live when they are not in the release being built. One place, one format, so that a
later maintainer can see what was proposed, why, what became of it, and what would make it worth
doing. The release being built is governed by its own plan (today:
[plan-1.16.1.md](plan-1.16.1.md)); `ROADMAP.md` says what is now, next and later; this register is
the memory behind "later".

**Rules.** An idea enters with an origin and a reason, not only a name. It carries a "worth doing
when", so nobody has to re-argue it from nothing. It moves to a release only through that
release's plan. Ideas that cross a standing constraint are recorded under "Refused, and why", so
they are not re-proposed as new. Nothing here is a promise.

**Standing constraints (they outrank every idea).** The governor is the only writer. Reviewer
output is untrusted evidence. Account logins only, no API-key routes. Automatic updates are off
unless the owner turns them on, and an agent never does. `evidence --protect` is owner-invoked.
Anything that speaks, uploads or publishes defaults to off and local. Agreement between reviewers
is corroboration, not proof.

## 1.17 candidates: review quality and throughput

| Idea | Origin | Why | Worth doing when |
| --- | --- | --- | --- |
| `--early-exit` after quorum | 1.16.0 plan, deferred | Stops paying for reviews the gate no longer needs | In-flight cancellation exists inside `runProcess` and is proven not to orphan a provider process on any OS |
| `--split auto` | 1.16.0 plan | Removes a manual choice | Five live runs above 100 KB show at most 10% coverage loss against a manual split |
| Ledger-learned route caps, higher `--jobs` ceiling | 1.16.0 measurement: throughput is bound by concurrency | Faster gates | The attempt ledger (1.16.1 C) has a month of clean timing per route and size |
| Adaptive timeouts from seconds per KB | 1.16.0 notes | Fewer false timeouts | Outcome classification (1.16.1 C1) has separated timeout from quota, auth and invalid output for long enough to trust the timing |
| `--cross-check` for `verify_first` findings | ROADMAP "Planned" | A second opinion only where history says one is needed | The scorecard shows which routes' single-source findings are most often rejected |
| Recognise one observation across finding ids | 1.16.0 image critiques | Agreement score 0 was shown for reviewers who agreed in different words | It can match without merging, rewriting or dropping any original finding; until then agreement 0 is never presented as disagreement |
| Bounded surrounding-code context | Owner proposal, 20 September | Reviewers reject or miss findings because they saw only a hunk | Context is bounded by bytes and by file, is part of the receipt identity, and never widens what is sent without saying so |
| Deterministic test and scanner evidence beside model reviews | Owner proposal | A failing test is stronger than three opinions | It enters as evidence the governor weighs, never as an automatic verdict |
| Persona field on dispositions | ROADMAP "Parked" | Lets the scorecard say which persona earns its keep | Dispositions carry the persona of the route at review time |

## 1.17 candidates: installation management

Moved here from 1.16.1 section F by the owner's scope boundary ("broad installation-management
interfaces"). 1.16.1 keeps the read-only inventory and the refusal to call an upgrade complete
while an older copy is active.

| Idea | Why | Worth doing when |
| --- | --- | --- |
| Choose one active installation; older copies only as rollback backups outside discovery folders | The owner's machine had five discovery folders on an old clone and nothing said so | The inventory has been in use for a release and its harness table is confirmed against each harness's own documentation |
| Migration preview (old path, new path, backup path, resulting precedence) and a rollback command that restores link and receipt without deleting the newer clone | Changing links is the riskiest thing MOMM does to a machine | Every step is journalled and replayable, as the legacy migration already is |
| Version banner in the Setup Center and in reports | "Which MOMM ran?" should never need a command | The report field is additive and the path is scrubbed from any public export |
| Fresh-session verification | MOMM cannot see inside a harness | Each harness has a documented, scriptable way to list the skills it loaded |
| Consented verifier install in `bootstrap.mjs` | Every new user is stopped to install `gitsign`, which has no Windows installer | Owner decision pending; the download is pinned, checksum-checked, user-only, and never silent |

## Measurement, datasets and services

| Idea | Origin | Why | Worth doing when |
| --- | --- | --- | --- |
| Controlled benchmark: confirmed defects found, defects missed, false positives, triage time, reviewer latency, total token and money use, benefit of each extra reviewer | Owner proposal | The scorecard measures governor decisions on real work; a benchmark measures against known answers | A seeded-defect corpus exists whose answers no reviewer model has seen, with a licence that allows publishing results |
| Public, anonymised scoreboard across consenting projects | Follows from the 1.16.1 scorecard | Shows which routes earn their place, beyond one codebase | An opt-in global ledger index exists (links and counts only, no telemetry merge), and a privacy review of what a finding's text can leak |
| Training sets for a triage model (finding in, decision and reason out) | 1.16.1 training export | The governor's triage is the expensive human-shaped step | Enough projects export to make labels more than one governor's habits; each provider's terms on training with their output have been read |
| Signed receipts | Owner proposal shows a "governor signature" | A receipt that proves who recorded it | A real key story exists (Sigstore identity or a local key the owner controls). A timestamp and a name are not a signature and must not be called one |
| Receipt invalidation on change | Owner proposal, acceptance gate 4 | A cached review must die when its diff, guidance or prompt template changes | The receipt binds all three hashes (1.16.1 binds source and guidance; the prompt template hash is the missing third) |
| MOMM World (watch your agents work) | Owner feature, built on a branch off an old 1.16 commit | Observation of runs as they happen | Rebased onto the released line, its adapter canaries run with the owner's hooks enabled, and reviewed as its own release |
| Reviewer CLI health feed | 1.16.0 found CLIs changing under it (Gemini retirement, Copilot quota events) | Users learn from a failed review that a provider changed | The update clock's conditional checks can carry it without new network destinations |

## Refused, and why

| Idea | Why it stays out |
| --- | --- |
| API-key routes | Account logins are the product's trust boundary; keys in an agent's environment are what MOMM exists to avoid |
| Automatic updates on by default, or enabled by an agent | An updater that an agent can switch on is a remote code path the owner did not choose |
| Reviewers that write | One writer is the invariant every safety claim rests on |
| Automatic debate or negotiation between reviewers | It turns untrusted outputs into inputs for each other and hides who said what; revisit only with a design that keeps every original claim intact |
| Grok media binding by loosening `--deny Read` | It trades containment for a feature. A staged-files-only read grant is a 1.17 design review, not a patch |
| An install path that skips signature verification | It removes first-run friction by removing the proof that a release is genuine |
| Self-healing capabilities (automatic re-probe) | Synthetic probes spend quota and send traffic; expiry stays fail-closed and manual |

## Corrections recorded so they are not re-argued

- **Gemini CLI.** A reviewer asked that it not be called retired for individuals without direct
  evidence. The evidence is Google's own announcement ("Transitioning Gemini CLI to Antigravity
  CLI", Google Developers Blog) and the `google-gemini/gemini-cli` discussion "Gemini CLI has
  stopped serving requests for individual accounts", both stating 18 June 2026, with organisation
  licences unaffected. MOMM therefore reports `ineligible_tier` for those accounts and keeps the
  route opt-in. What remains open is separate: account, adapter and authentication failures on
  that route are investigated on their own evidence, not blamed on the retirement.
- **Node versions.** Node 18 and Node 20 are past end of life. Node 22 and Node 24 are the primary
  support targets. That label does not waive a drill: charter item B still requires Node 18 and
  Node 24 lifecycle drills on Windows, macOS and Linux, and Node 20 is an offline CI target with no
  lifecycle obligation. The single statement of this policy lives in
  [gates-1.16.1.md](gates-1.16.1.md); this entry records why, and must not be read as relaxing it.
  The Windows launch defect of 1.16.0 was specific to 18 and 20, which is exactly why they stay tested.
- **Code patterns offered with the 20 September proposal** were read as intent, not as a
  specification: MOMM skills have no `package.json` to compare, so runtime identity is checked
  against the dispatcher source and the discovery folders instead (`--doctor --versions`).

## Deferred from the 1.16.1 triage of review `rev_20260922162715_cc7e49c40234`

Twenty-seven reviewer suggestions were judged correct but out of scope for a patch release. They are
recorded here so the reason is a decision rather than an omission. Each one is in
`.ensemble_reviews/dispositions.jsonl` against that run id with its reason.

- **Stop slicing product source in tests.** Several suites extract a function from a `.mjs` file with
  `indexOf` between two names and evaluate it in a VM. This broke twice in one afternoon during this
  triage: adding `export` to `resolveGit` invalidated a slice in `governor.test.mjs`, and adding a
  `randomBytes` call to `stageCopy` invalidated one in `review-refutations.test.mjs`. Both tests had
  to be repaired to land correct fixes, which is precisely the wrong incentive. Export the small
  helpers and import them instead. The largest single cleanup on this list.
- **Media fixtures.** The 23-byte positive JPEG fixture declares a SOF0 component and omits its
  component descriptor, so it does not exercise acceptance of a decodable JPEG; some per-outcome
  fixtures are byte-identical where they should differ. Changing shared fixtures days before a tag
  risks more than it proves.
- **More focused tests**: inventory exceptions and malformed inventory; capability lifecycle
  boundaries (legacy entries without `expires_at`, the exact expiry instant, a reprobe that restores
  an expired cell); shared aliases and `--expect`; retry accounting and incomplete split coverage.
- **Evidence indexing.** Index review-log seals by run id once rather than filtering the whole JSONL
  per id, and pre-index split pieces by id. Performance only today; worth doing when the ledger grows.
- **Diagnostics and shape.** Report orthogonal installation flags (opaque path, version skew,
  duplicate copies) instead of one if-else chain; sanitize control characters per path inside `safe()`
  so a multi-path conflict still names every copy; strip a leading extended-length prefix before
  `path.win32.relative`; normalise CRLF before comparing stdin against a generated diff; reject a
  symmetric `a...b` range during argument parsing rather than at Git resolution.
- **Workflow extraction.** Count a suite only when the `node *.test.mjs` match sits on a `run:` step,
  and strip a leading `./` when comparing CONTRIBUTING paths. No miss has been observed.
- **Source hygiene at HEAD.** The binary-classification check asks Git about HEAD while the control
  byte check reads the working tree. Scanning HEAD blobs for control bytes too would close the gap.
- **Test isolation ordering.** `migrate-legacy.test.mjs` assigns the synthetic home after its static
  imports. Neither imported module reads `HOME` at load time and a sentinel home stayed empty, so
  nothing leaked; the equivalent ordering was fixed in `update.test.mjs`, and both suites now redirect
  `APPDATA`, `LOCALAPPDATA` and `XDG_CONFIG_HOME` as well.
- **Acceptance matrix.** Give each row a column naming the suite that asserts it, and give the image
  review the same copyable fenced command as the source review.
