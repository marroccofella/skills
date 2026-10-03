# MOMM ideas register

Where ideas live when they are not in the release being built. One place, one format, so that a
later maintainer can see what was proposed, why, what became of it, and what would make it worth
doing. The release being built is governed by its own plan: today 1.17, in
[plan-1.17.md](plan-1.17.md) (the last released plan is [plan-1.16.1.md](plan-1.16.1.md)); `ROADMAP.md` says what is now, next and later; this register is
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
| `--early-exit` after quorum | 1.16.0 plan, deferred | Stops paying for reviews the gate no longer needs. Status 29 September: the decision helper `earlyExitDecision` exists in `scheduler.mjs` with unit tests; dispatch does not call it | In-flight cancellation exists inside `runProcess` and is proven not to orphan a provider process on any OS |
| `--split auto` | 1.16.0 plan | Removes a manual choice. Status 29 September: already parsed and applied with a fixed 40 KB ceiling; the evaluation below is what remains | Five live runs above 100 KB show at most 10% coverage loss against a manual split |
| Ledger-learned route caps, higher `--jobs` ceiling | 1.16.0 measurement: throughput is bound by concurrency | Faster gates | The attempt ledger (1.16.1 C) has a month of clean timing per route and size |
| Adaptive timeouts from seconds per KB | 1.16.0 notes | Fewer false timeouts. Status 29 September: `adaptiveTimeoutMs` exists in `scheduler.mjs` with unit tests; dispatch does not call it | Outcome classification (1.16.1 C1) has separated timeout from quota, auth and invalid output for long enough to trust the timing |
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

## 1.17 design candidate: role-preserving review

**Origin.** Owner proposal, 28 September 2026, with an assessment of it from a second session. The
proposal: keep one writer and make the bench around it harsher. When a reviewer fails, cover its
*role* with another route instead of dropping it or retrying blindly; type every claim; accept nothing
without reproduction. Its summary: "authority is singular, scrutiny is plural, and a missing critic
is replaced by role, not by committee."

**Fit.** It strengthens the standing constraints rather than crossing them: a cover reviewer is still
a read-only reviewer, and the governor remains the only writer. It gathers several rows above into
one design (`--cross-check`, the persona field on dispositions, deterministic evidence beside model
reviews, bounded context, receipt invalidation on change) and the controlled benchmark below. It
moves into 1.17 only through a 1.17 design plan (`plan-1.17.md`, not yet written), which must
reconcile it with those rows. It is not a change to the released 1.16.1.

**Staging.** Each stage is opt-in and fail-closed, and ships only when the stage before it is proven.

| Stage | What | Worth doing when |
| --- | --- | --- |
| 1. Roles and typed claims | Separate a reviewer's *role* (surgeon, architect, adversary, verifier, innovator: today's personas) from the *route* that performs it, and version each role's brief as a reviewed artifact rather than prompt text that drifts. Add a claim type beside severity: `DEFECT` (reproducible, must be proven or refuted), `RISK` (plausible, needs a probe), `QUESTION` (missing assumption), `IDEA` (optional, never blocks), `NOISE` (style, taste, out of scope). Additive report fields; every original claim and its evidence kept intact. | The type is recorded next to severity, never replaces it, and a test shows that no type can authorize an edit or count as proof of a defect. Only `DEFECT` and `RISK` can hold up acceptance |
| 2. Opt-in role cover | When a route fails, the role is marked vacant, not the vendor. MOMM may offer, or with an explicit flag perform, a cover: the same role packet (stance, what the role must not do, the claims already on the table, and the failure reason) sent to another route from the user's own allowed reviewers. The report records the failed route, its status, the cover route, attempts, the role and the packet version, and labels the result a cover review, never a native one. Change role or route in one step, never both. The packet is data, not instructions: earlier claims and the failure reason reach the cover route as quoted evidence, never in its instruction channel (the same line as "Automatic debate" under Refused) | Every terminal status has a defined cover rule. Authentication and quota failures are never retried or routed around (a quota is the provider's allowance, not an obstacle). No provider is added and no permission relaxed. Two routes backed by the same model family are not counted as independent quorum votes. The cover appears in the attempt ledger |
| 3. Harder accept gate | "No reproduction, no edit" stays the rule (it already is the protocol). A change to source or guidance marks earlier reviews stale; only the claims it touches and any failed test are re-verified. A second look runs only on a specific disagreement: two roles contradict, a `CRITICAL` fails reproduction, tests pass but an architect says the contract is wrong, or the only review of a role was a cover. It asks one fresh route about that one claim, adds no new scope and keeps the original reviews. When the governor rejects a `CRITICAL`, a different route may be asked to refute the rejection, which is the nearest thing to a second writer without splitting the pen | The receipt binds source, guidance and prompt-template hashes (see "Receipt invalidation on change"); `--cross-check` exists as the narrow single-claim mechanism; the second look provably never feeds one reviewer's output to another as instructions (see "Automatic debate" under Refused) |
| 4. Measure before choosing pairings | A roster card per route and role: valid-review rate, reproduced-claim rate, false-`CRITICAL` rate, median time, and cover success when standing in for another role. Choose covers by a route's record *in that role*. Test writer-to-reviewer pairings in both directions on a blinded, seeded set: findings found, seeded defects missed, false criticals, reproduction rate, regressions introduced, time and cost | The controlled benchmark below exists. Promotion thresholds are written down before a pilot's results are seen. The roster stays advisory: it orders attention and cover choice, and never replaces reproduction |

**The pairing evidence is a hypothesis, not a rule.** The proposal cites a 2026 study
([arXiv 2607.21656](https://arxiv.org/abs/2607.21656)) in which one model reviewing another's drafts
raised the pass rate and the reverse direction lowered it. The assessment notes its limits: two
model versions, 116 single-file Python benchmark tasks, a stated lack of generalisation to
repository-scale work, and a direct comparison between the two directions that was not significant
after correction. The maintainer has not checked the paper independently. Measure on MOMM's own
work before routing on it.

**Also proposed, already partly in place.** Deterministic gates before any model reviewer (tests,
types, linters, secret scan: see "Deterministic test and scanner evidence" above). Reviewers never
see the governor's reasoning: they receive only the artifact, and that stays an invariant. Scope by
what the diff reaches (callers, migrations, contracts) instead of the bare hunk: see "Bounded
surrounding-code context" above. A budget ladder (one cheap reviewer for a small change, native roles
for a medium one, the full bench plus covers for a hard one, a second look only on disagreement) extends
today's `--tier quick|deep`.

**Deferred beyond the first 1.17 release.** Each needs its own threat model and evidence:

| Idea | Why not yet | Worth doing when |
| --- | --- | --- |
| Split cover (two cheap routes each take half of a wide role's checklist) | Divides a role's context and doubles the ways a cover can be wrong | Single-route cover has a measured success rate per role |
| Sketch patches attached to a review as evidence | A patch from a reviewer is one step from a reviewer writing | It is stored as a quoted artifact only, never applied or offered as a diff to apply, and the ledger records "inspired by route X" when the governor reproduces and rewrites a line from it |
| Shuffled multi-pass on one role (several passes with the diff in a random order, keeping what survives two passes) | Cheap diversity, but multiplies quota use | The benchmark shows it finds seeded defects that a single pass misses, at a stated cost |
| Automatic pairing optimisation | Depends on stage 4 data that does not exist yet | A month of roster data per route and role |
| Local project memory of what reproduced, what kept failing reproduction, and which pairings helped | See "Refused" for the automatic form | Opt-in, local, structured fields rather than free text, scrubbed of source, and read as data rather than loaded as instructions |

**Acceptance tests to write before any implementation.** A cover rule for every failure status;
same-role cover; refusal when quorum cannot be met; no duplicate or correlated votes; immutable input
hashes across a cover; permission boundaries unchanged for a cover route; "no reproduction, no edit";
authentication and quota never retried by a cover. Then a small opt-in pilot, against thresholds set
before it runs.

**Review status.** A MOMM review of the proposal (`rev_20260928085108_fa71e697d72f`) did not reach
quorum (0 of 2): the input was outside the project's review scope and the routes that ran failed on
connection, authentication or a policy lock. It produced no valid findings and is not a peer
sign-off. The 1.17 design plan gets its own review, with the plan inside the project.

## 1.17 design candidate: loophole-aware critical review

**Origin.** Owner proposal, 28 September 2026: "we need much more critical thinking." Roadmap entry:
[ROADMAP.md, "1.17"](../ROADMAP.md#117-design-no-code-before-its-plan). The idea is a
*structural discrepancy*: a rule obeyed to the letter while its purpose is defeated. Rules are finite
text laid over dynamic behaviour, so a capable actor finds the gaps. That applies to statutes and tax
codes, and equally to software, where the actor may be a user, an attacker or an agent optimising
for a passing check.

**Two uses in MOMM.** (a) A *lens* for what reviewers look for in the work under review. (b) The
same lens turned on MOMM's own gates, which are rules an agent, the governor included, can satisfy
on paper while missing the point. The second use matters as much as the first: MOMM's integrity
claims rest on its gates meaning what they say.

### The lens (four ways a rule leaks)

| Theme | In reviewed work, look for |
| --- | --- |
| Letter versus spirit | Code that satisfies a test, type, lint rule or spec wording while defeating what it was for: a check that inspects the wrong value, a guard on one form of a behaviour but not another, a test that passes without exercising the claim |
| Categorical arbitrage | A value, request or file that escapes a control by changing its label rather than its nature: a renamed type, a reclassified error, a path that is "not a file", a status that skips a branch |
| Temporal latency | Rules and data that were right when written and are silently stale: cached decisions, pinned versions, allowlists, expiry that never fires, docs that lag the code |
| Compositional blind spots | Steps that are each permitted but chain into a forbidden state: a safe read plus a safe write that together escape a sandbox, two retries through two different paths, two partial checks that each assume the other ran |

Four thinking styles drive it: **adversarial** (what inputs give the most reward with no failing
state?), **formalist** (undefined terms, silent exemptions, "shall" against "may", where a rule's power
ends), **systems** (second-order effects: Goodhart's law, the cobra effect, how participants adapt
to a metric), and **counterfactual** (stress the rule far from its designer's median case).

Five techniques turn it into checks: **boundary values** (just below and above every threshold, and
splitting one thing into several to stay under it); **intent anchoring** (state the purpose a rule
serves, so a manoeuvre that meets the text and defeats the purpose is named as such); **invariants**
(states that must never occur whatever sequence of valid steps is taken, tested as properties rather
than examples); **payoff auditing** (where finding a bypass is cheap and the gain is large, expect it
to be found); **sunset and review triggers** (rules that expire or are re-examined when a measure
drifts).

### The lens turned on MOMM's own gates

Each row is a real, current discrepancy, checked against the location it cites. None of them is a
hidden defect; most are documented limits. Each counter-measure is labelled for what it would do:
**Closes** (the letter-compliant path no longer exists), **Narrows** (the path still exists but is
harder or visible), or **Documents** (it cannot be closed locally, so it is stated wherever the gate
is shown). A counter that only narrows is not reported as a fix.

| Gate | How the letter can be met without the purpose | Counter-measure to consider |
| --- | --- | --- |
| Completion receipt: `change_kind` | The governor declares a decision `behavior` or `style`, and only `behavior` needs failing-before/passing-after evidence (`governor.mjs`: `if (material \|\| row.change_kind === "behavior")`). Declaring a change "style" is a categorical arbitrage. It happened in this project on 28 September: a test-only strengthening was recorded as "style" (owner's private ledger, run `rev_20260928015057_fbe9e5568938`) | **Closes**. A decision can be "style" only when a mechanical check shows the diff of every file it touches is whitespace or comments only. A diff the check cannot classify (binary, rename, generated file) fails closed to `behavior` |
| Reproduction test adequacy | The validator checks that the same test failed and then passed. It "cannot prove that an arbitrary chosen test is adequate" (`governor-completion.md`). A test that fails for an unrelated reason, then passes, meets the letter | **Narrows**. A recorded mutation check: with the fix reverted, the test must fail again, on the same assertion. Reverting cannot prove adequacy either (a revert that does not build fails too), so a recorded mutation is stronger evidence, not proof. The governor did this by hand for PR #29 |
| Quorum | Quorum counts routes that answered. Two routes backed by the same model family are correlated, so two answers may be one opinion counted twice | **Closes**, owned elsewhere. The rule belongs to role-preserving review stage 2 ("correlated routes never count as independent votes") and is only cited here, so the two themes cannot publish two voting rules |
| Retry limits under composition | Outage retry and `--retry-invalid` share one limit: a route "is retried at most once per piece, whether after an outage or under `--retry-invalid`" (`SKILL.md`). A cover review would be a third path to another answer for the same piece and role | **Closes**. One budget per piece and role: at most two route invocations in total (the first and one more), counted across outage retry, `--retry-invalid` and cover together. Every invocation counts, including ones that fail or time out |
| Typed claims (proposed) | A `DEFECT` labelled `IDEA` never blocks acceptance. Whoever assigns the type can route a real defect around the gate | **Narrows**. Severity keeps its own gate: a `CRITICAL` or `WARNING` blocks whatever its type. Re-typing a claim is recorded with who did it and why; lowering a severity stays possible, so it is recorded the same way |
| Split review | Dividing a long one-line hunk at line boundaries showed reviewers only its removal half, so they reported pages as deleted (this register, "Make the full-range review able to finish") | **Closes**. Every piece a reviewer sees is a well-formed diff that carries both halves of each change it contains |
| Scorecard and ratings | The acceptance rate and ratings are the governor's own rulings. Once they steer routing (role-preserving review stage 4), a route that learns to be agreeable scores well (Goodhart's law) | **Narrows**. Routing uses reproduced-claim and seeded-defect rates from the benchmark, not the governor's acceptance rate alone, and the scorecard keeps saying which measure it shows |
| Local evidence chain | The validator checks bytes and hashes. It cannot rule out that "a same-user actor did not rewrite the whole local chain" (`governor-completion.md`) | **Documents**. Not closable with local files; see "Signed receipts" under Measurement. Said wherever a receipt is shown |
| Expiry | Capability probes expire after seven days, so they sunset. Role briefs, guidance and project rules have no review date | **Narrows**. Versioned role briefs (role-preserving review stage 1) carry a review date and are re-measured when a route's record drifts. A date forces a look, not a correct one |

**Property tests over an explicit alphabet.** The invariants marked Closes are tested as properties:
every sequence up to a fixed depth over the steps `retry`, `retry-invalid`, `cover`, `split`,
`re-type` and `re-severity` is generated, and the test fails if a forbidden state is reachable
(a third invocation for one piece and role, an unclassifiable diff recorded as style, a half-change
piece). A fixed alphabet and depth keep the search finite and say exactly what was covered.

### How it would ship

| Idea | Worth doing when |
| --- | --- |
| A short loophole checklist (the four themes, one line each, and the five techniques by name) kept as its own versioned file and included by reference in the adversary brief, so the review prompt does not carry this essay. Findings must still quote the artifact and name a concrete sequence of steps, not a general worry | The brief is a versioned artifact (role-preserving review, stage 1), and the seeded benchmark includes letter-versus-spirit and compositional defects to show the checklist finds more than the current brief does |
| A separate "loophole auditor" role | Only if the benchmark shows the checklist inside the adversary brief misses what a dedicated role finds; otherwise it is one more voice to pay for |
| MOMM invariants as property tests | Each invariant marked Closes above has a depth-bounded property test over the explicit step alphabet. These join the acceptance tests of role-preserving review |
| A gate self-audit in every release plan | Each plan (starting with `plan-1.17.md`) has a section asking of every new gate: what meets its letter and misses its purpose, and which invariant catches that |

**A limit on intent anchoring.** In law, a general anti-avoidance clause lets an adjudicator set aside
a manoeuvre that meets the text. In MOMM the adjudicator is the governor, which is also the party
whose shortcuts the gates exist to catch. So purpose clauses may only ever *tighten* a gate (refuse
something that meets the text), never loosen one (accept something that fails it because it "meets
the spirit"). A reviewer's appeal to intent is a claim like any other and needs evidence.

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
| Runs that write lessons into a skill or instructions the governor loads next time | It would carry reviewed source into persistent instructions and turn untrusted reviewer text into next session's guidance. The opt-in, local, structured form is deferred under "Role-preserving review" |
| A panel whose judge or synthesizer produces the change | The synthesizer becomes a second writer. Merging several notes into one claim list inside a single reviewer role is fine; authoring the fix is not |
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
  `randomBytes` call to `stageCopy` invalidated one in `review-refutations.test.mjs`. A third followed
  in the next round: routing `source-hygiene.test.mjs` through `resolveGit` broke the slice of it in
  `review-followup.test.mjs`. A fourth: keeping the end of a failed route's output added a helper the
  classifier slice in `stabilisation.test.mjs` did not carry. All four had to be repaired to land correct fixes, which is precisely
  the wrong incentive. Export the small
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

## Planned for 1.17

- **Drill interrupted-install recovery.** The 1.16.1 lifecycle drill covered signed install, upgrade,
  rollback, re-upgrade and tamper refusal, but not recovery from an update interrupted mid-transaction
  (not waived; see the 1.16.1 gate record). Add a step that stops an apply after `prepared` and recovers
  with the retained updater, on every drill cell.
- **Resolve reviewer launches on macOS and Linux.** Accepted as a documented risk for 1.16.1 (owner
  decision, 24 September 2026; see the gate record). `processScope.spawn` should resolve a bare name
  with `pathEntryOutside` / `executableOutside` and scrub the child PATH on every platform, as it
  already does on Windows. Expect users whose CLI is installed only inside the project they review
  to be told it is not installed; say so in that release's notes.
- **Preview film captions (before accepting `overview-1.16.0`).** The sidecar `captions.vtt` split
  "1.16", "git.exe" and the site address at their dots (range review rev_20260925004814_1ed9f58c2c3a);
  it is fixed and guarded in `momm-site-videos.test.mjs`, but the same captions are burned into
  `walkthrough.mp4`, which must be re-rendered by the owner's media pipeline before the film is
  accepted. The film is already held for the human listening verdict.
- **Make the full-range review able to finish (1.17).** Two 1.16.1 range reviews could not reach
  quorum on every piece: Codex quotations still failed the quotation rule after look-alikes were
  allowed (19 times; failed answers are not stored, so a deliberate diagnostic run is needed to see
  what it quotes), Grok ran past 360 s on dense 24 KB pieces (17 times), and dividing a long
  one-line hunk at line boundaries showed reviewers only its removal half, so they reported pages as
  deleted. Owner waiver for 1.16.1 in the gate record.
- **Film poster wording (media pipeline).** `docs/momm/momm-poster.jpg`, already public, shows the
  phonetic spelling "mom skill" and a "local preview" label from the film. Re-render it with the
  film.
- **Image quotation (1.17).** In an image review the only text MOMM sends is the brief, so a reviewer that
  quotes text it sees in the image (for example "Total orders: 75") fails the quotation rule. Codex did
  this on the final 1.16.1 image gate. Accept quotations from the image, or ask for scope as a
  description when the artifact is media.
- **Preflight version checks time out during every review.** Found 25 September 2026: in each recent
  report every route's in-review preflight reads `version_status: "timeout"` (so `ready: false`,
  `auth: unknown`) although the same routes then review normally, and a standalone `--preflight`
  answers for all of them in about a second. The results arrived 35 s after dispatch and route
  launches were seconds apart, which suggests something blocks the event loop while reviewers launch; each
  `--version` spawn alone takes 10 to 18 ms. Next step: profile one ordinary review with
  `node --cpu-prof` (no extra provider calls) and move the blocking work off the loop, or run
  preflight before dispatch. The report's preflight rows are informational and gate nothing.
- **Evidence outside the project (1.17, owner decision).** Found 28 September 2026 on the Mannin
  project: an evidence folder on a drive whose defaults grant other local accounts access is refused
  until the owner runs `evidence --protect` once per project. A per-user location (one folder per
  project under the user's profile) never inherits drive-level access. In [plan-1.17.md](plan-1.17.md)
  as A7, opt-in, with the same permission checks wherever the folder lives.
- **Finish isolating the Codex route (1.17).** 1.16.1 stops project `AGENTS.md` and switches off hooks,
  plugins, apps, multi-agent and image generation for MOMM's Codex runs (owner decision, 25 September
  2026). Still inherited: the user's MCP servers (six on the owner's machine), global instructions and
  skills, and the model and effort shared with the Codex desktop app. `-c mcp_servers={}` merges rather
  than clears; `codex exec --ignore-user-config --ignore-rules` is the documented route, but MOMM must
  then name the model and effort itself, and a synthetic probe must confirm login and valid output.
