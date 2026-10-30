# 1.16.1 offline test catalog

30 October 1.18 development inventory: the local runner now includes
`myskills/scripts/health-contract-test.mjs`, matching the hosted stable/development
version gate. The selection is 180 commands; the earlier 179-command result is
historical and is not a pass for this expanded selection.

This is the living inventory of offline suites: it keeps its 1.16.1 name (pinned by CONTRIBUTING and
the workflow tests) and also lists every suite added in 1.17.

The existing workflow-contract suite now also checks the measured local167-command
pack against explicit100-minute safety/120-minute release job ceilings and three
bounded offline-step timing floors. Its failing-before/passing-after evidence is
separate from hosted CI. Command selection is unchanged at167; the19October
167/167 snapshot is historical after the22October workflow/test/document edits.

The local 1.18 development selection also runs the governor-authored boundary
probes directly, with no provider calls:

The 16 October selection additionally registers captured worker code custody
and the baseline-first protected shadow coordinator in both workflows (167
commands registered, not a passing pack). The former executes a pinned captured
ESM graph after replacing its synthetic on-disk originals; the latter uses sealed
synthetic baseline files, generated owner signatures and the actual captured child
to test protected-preflight refusal and held accounting. Neither makes a remote
model request, provisions a real signer, establishes operator provenance or
qualifies the normal native dispatcher. Existing failed pack records remain.

- `momm/scripts/bumble-protected-execution.test.mjs`: pinned in-memory worker
  graph, actual supervised malformed-job refusals and post-capture source replacement.
- `momm/scripts/bumble-shadow-coordinator.test.mjs`: generated signed execution
  approval, sealed baseline binding, current source checks and held accounting.
- `momm/scripts/bumble-shadow-broker.test.mjs`: exact signed synthetic plan,
  one-shot request claims, revocation and existing shared capacity binding.

- `momm/development-tests/bumble-contract-boundary-probes.test.mjs`: three explicit
  `--case` selections (`attestation`, `grounding`, `decoding`) cover missing host
  completion evidence, deterministic tail-copy work, Unicode refusal and preserved
  original BOM byte identity. These exact probe bytes are used for retained
  before/after records, so the filename remains unchanged.
- `momm/development-tests/bumble-stage-attestation-before.test.mjs`: private-store
  synthetic fixtures verify the public stage entry requires explicit transport and
  finality, refuses ill-formed source text before encoding, and retains the original
  transmission hold. It is a reusable before/after regression despite its filename.

Both existing workflows run byte-identical canonical mirrors under `momm/scripts`:
`momm/scripts/bumble-contract-boundary-probes.test.mjs` and
`momm/scripts/bumble-stage-attestation-before.test.mjs`. The workflow contract
checks parity against the original probes; the local runner therefore includes
all four commands without broadening its allowed paths. It uses fixed
no-argument entry points for attestation, grounding and decoding;
the shared probe bytes stay identical to their original before/after records.
The stage probe now imports the skill-local fixture helper. Its import-context
change creates a new test hash; the older test records remain historical.
The new tests do not grant
native activation, worker qualification, release quorum or hosted-platform evidence.

Additional 1.18 regression probes retain exact original test bytes in both
development and canonical locations: `bumble-raw-identity-probes.test.mjs`
has fixed raw-evidence, task-Unicode and restored-task entry points. The
`bumble-stage-revalidation.test.mjs` suite uses fresh synthetic legacy fixtures
to check immutable companions, altered fields/counts, corruption, restart and
interrupted adoption. Both workflows run all four commands. These are private
store and contract controls, not an independent baseline or live-node qualification.
The shared `bumble-stage-review-probes.test.mjs` then checks that sealed terminal
evidence excludes a later send permit, and that a closed admission denial cannot
reserve future response headroom. Exact before/after bytes are mirrored and run
in both workflows; no network call or release is part of those controls.

The canonical capacity fixture now has free/held owner-map reason contrasts,
observed synchronous path operations and a legitimate-evidence positive control.
Three isolated mutation/output controls verify that these checks actually notice
the known weak-test regressions. `bumble-stage-probe-evidence.test.mjs` additionally
checks that an unrelated terminal-refusal error cannot pass and that unmeasured
activity counters are not emitted. Both workflows register it (164 commands).
These are bounded test-evidence regressions, not transport instrumentation,
backend release or native qualification. Earlier 163-command results retain
their original frozen scope and are not relabelled as this selection.

`momm/scripts/scope-closure.test.mjs` reproduces stale update results, native
owner-only export/refusal (including forced companion overwrite), and checks
the current acceptance guide's retry and ledger-ticket instructions.

`momm/scripts/review-final-regressions.test.mjs` tests exact CI deadline matching and CLI diagnostics.

`momm/scripts/executable-resolution.test.mjs` is a named security regression: none of MOMM's five executable resolvers may take an executable from a PATH directory inside the project, and nothing in the repository may launch a bare `git`. It does not cover reviewer launches on macOS and Linux, which still pass a bare name to spawn (owner decision 3 in plan-1.16.1.md). It holds all five resolvers (`windowsTool`, `windowsChildEnv`, `resolveGit` on Windows and POSIX, `windowsLauncher`, and the updater's own `resolveTool`) to one attack matrix of project-planted links, junctions and aliases; on Windows it runs a planted-interpreter `git.exe` with the launch-guard variable removed and proves checkout code never executes; and it fails if anything in the repository launches a bare `git`.

`momm/scripts/review-triage-1161.test.mjs` holds the regressions from the governor triage of review rev_20260922162715_cc7e49c40234: a harvest that discarded every readable artefact when one was refused, and the containment scan that decides which Git verifies a committed range on POSIX.
`momm/scripts/review-refutations.test.mjs` tests disputed review boundaries and independent audit identities.
`momm/scripts/review-followup.test.mjs` tests split-quorum reporting, bounded stdin,
201-file checks, scorecard/export correctness and unreadable-source refusal.

`momm/scripts/generation-rounds.test.mjs` (1.17 E) drives the guided image generation rounds with a fake exec
only: the user's words reach every maker byte for byte in every round, a notes round carries only that
maker's own notes, a combine round needs its own `--share-all` yes and attaches pictures only to makers
that can take images in, critiques are validated and saved before labels are revealed, refusals keep the
provider's reason, and the private gallery shows every picture with its provenance. No provider is
contacted and no model critiques anything. `scripts/ledger-media.test.mjs` also checks the ledger's round
number and critique summary for a generation's pictures (critique only after the reveal).

Suites that arrived from `main` while 1.16.1 was in progress (website and release tooling, not the
review product): `scripts/momm-improvement-regressions.test.mjs` reproduces governor-authored
improvement findings with no provider traffic or GitHub writes; `scripts/momm-release-observer.test.mjs`
checks the release observer; `scripts/momm-site-community.test.mjs`, `scripts/momm-site-discovery.test.mjs`
and `scripts/momm-site-flow.test.mjs` check the media and improvement pages, the discovery guide and the
workflow page against their data.

This is a source inventory, not a claim that every gate passed. Run each suite with Node;
record its own exit code. `.github/workflows/self-test.yml` is the authoritative CI selection,
including `--self-test` entrypoints, syntax checks and inline integration fixtures.
Native, live-provider and signed-lifecycle evidence are tracked in [the gate record](gates-1.16.1.md).

1.17 suites: `momm/scripts/roles.test.mjs` (B1 and C1) loads every role brief from `momm/roles`, proves the
brief text and the review contracts are byte-identical to 1.16.1 apart from the adversary's loophole checklist,
refuses unknown roles and malformed front matter, records `role` and `role_brief` in report rows and the brief's
file hash in the guidance layer, and shows a stale brief as a notice in a provider-free dispatcher run.
`momm/scripts/cover.test.mjs` (B3) gives every terminal status its cover rule, holds the one attempt budget,
runs the production contract, adapter and retry code against a stubbed process to show a cover gets the vacated
brief and failure status and no other claims in exactly one invocation, and checks that the completion validator
recounts cover votes under the model-family rule. `momm/scripts/invariants.test.mjs` (C2, step alphabet) runs
every sequence of retry, retry-invalid, cover, split, re-type and re-severity up to depth 5 from seeded starts
and asserts no third invocation per piece and role, no second vote per family from a cover, no merged claim type
below a source, and no lowering without a recorded decision row. `momm/scripts/second-look.test.mjs` (B5) proves a
second look sends one fenced claim and the hash-bound original artifact to one route that was not a source and is
not the governor, writes a separate `momm-second-look/1` report linked to the run and finding, leaves the original
report and its log line byte-identical, refuses source routes, tampered reports, missing artifacts and reserved
delimiters before any route runs, and requires the verdict to quote the artifact.

`attempts.test.mjs` covers `checks.mjs` and `attempt-audit.mjs`, including real failing/passing
child tests. `review-claims.test.mjs` adds split/start bindings and refusal controls;
`review-workflow.test.mjs` checks this catalog against the suite files on disk.

1.17 additions: `codex-isolation.test.mjs` proves Codex runs with `--ignore-user-config --ignore-rules`,
and that the model and reasoning effort are read read-only from a synthetic Codex configuration and
passed only when valid (A2), and that Codex probes send the review's command and shape. `grok-stream.test.mjs`
reads the live capture `momm/scripts/fixtures/grok-streaming-json-1.0.41.jsonl` byte for byte (Grok CLI
1.0.41; kept `-text` in `.gitattributes` and scanned by the privacy test) and streams in its shape: the
same review as the json envelope, a timeout that keeps its progress record, and malformed streams (A4.3).
`momm/scripts/evidence-location.test.mjs` (1.17 A7) covers the opt-in evidence home: the default
folder is unchanged, `MOMM_EVIDENCE_HOME` gives a hashed per-project folder, a home inside the project
(literally or through a link) is refused, a broadened home is refused as a broadened project folder is,
and attempts, checks, governor, ledger, scorecard and `evidence --status` all follow the setting.
`momm/scripts/quotation-diagnostics.test.mjs` (1.17 A4.2) proves a synthetic answer refused by the
quotation rule leaves its failing quote's hash, length and redacted 80-character prefix in the private
attempt record only.

1.17.1 additions: `momm/scripts/review-answer.test.mjs` (S1, S2) runs one matrix of answers (bare, fenced,
fenced with prose, two blocks, tilde fence, other language tag, broken JSON) against every route's parser.
Copilot and Antigravity read one answer string by the rule in `momm/scripts/review-answer.mjs`; Claude,
Codex, Gemini and Grok extract the last review object from text, unchanged. It also proves that an answer
refused as not JSON leaves its length, fence flags, parser error position and redacted 80-character prefix
in the private attempt record only. `momm/scripts/adapter-matrix.test.mjs` (R2) walks
`momm/scripts/fixtures/adapters/<route>/<cli-version>/` and runs every case file through the real adapter,
expecting the status in the `expected.json` beside it: Copilot 1.0.85 and 1.0.91 shapes, Grok 1.0.41 (the
recorded capture and error cases) and the Antigravity stream. Adding a CLI version is adding a folder; a
stray file, an unlisted case, an unknown route or a fixture holding a credential-looking string fails.
`momm/scripts/compatibility.test.mjs` (R1) proves a CLI/model compatibility failure is
remembered per machine with route, CLI version, configured model and time, is shown by preflight (route
not ready, update command) while both stand, stops applying when either changes, is removed by a later
success, never writes the Codex configuration, and never steals its lock. `momm/scripts/run-notices.test.mjs`
covers the repeated-status notice (S3: three recorded runs with the same failure, read through the
evidence resolver; excluded and undispatched rows do not count) and the gate-review guard (S4: an
untracked diff file given as `--input` gets a notice naming `--range`; the review runs as before), with
real provider-free dispatcher runs.

1.17.2 addition: `scripts/evidence-home-isolation.test.mjs` starts six suites directly (`node <suite>`, not
through `scripts/run-ci-suites.mjs`), each first without `MOMM_EVIDENCE_HOME` and then with it naming a new
empty folder outside the checkout: scorecard-roster, ledger-serving, probes, cover, quotation-diagnostics
and ledger-media. Each must pass both ways and leave the folder as it was handed over: still there, the
same folder, never added to, and empty. A folder that was removed, replaced, or written to and tidied
counts as used; stand-in children that do each of those things hold the suite to it. Started that way on
the released 1.17.1, each of the six ended with exit status 1, because a suite inherited the caller's
evidence home. They are among the 23 commands that failed in the pack, and are not the six further suites
that passed while writing into the caller's home. Three of them do not import the test-support module, so
their own first statement is what is exercised.

- `momm/scripts/review-claims.test.mjs`
- `momm/scripts/review-workflow.test.mjs`

- `momm/scripts/adapter-cleanup.test.mjs`
- `momm/scripts/adapter-matrix.test.mjs`
- `momm/scripts/antigravity-transport.test.mjs`
- `momm/scripts/attachment-cleanup.test.mjs`
- `momm/scripts/attempts.test.mjs`
- `momm/scripts/bootstrap.test.mjs`
- `momm/scripts/bumble-baseline.test.mjs`
- `momm/scripts/bumble-capacity-sensitivity.test.mjs`
- `momm/scripts/bumble-capacity.test.mjs`
- `momm/scripts/bumble-contract-attestation.test.mjs`
- `momm/scripts/bumble-contract-boundary-probes.test.mjs`
- `momm/scripts/bumble-contract-decoding.test.mjs`
- `momm/scripts/bumble-contract-grounding.test.mjs`
- `momm/scripts/bumble-contract.test.mjs`
- `momm/scripts/bumble-custody-review-regressions.test.mjs`
- `momm/scripts/bumble-final-regressions.test.mjs`
- `momm/scripts/bumble-fixtures.test.mjs`
- `momm/scripts/bumble-handoff-boundaries.test.mjs`
- `momm/scripts/bumble-handoff-clock.test.mjs`
- `momm/scripts/bumble-hardening.test.mjs`
- `momm/scripts/bumble-immutable-boundary-probes.test.mjs`
- `momm/scripts/bumble-immutable-file.test.mjs`
- `momm/scripts/bumble-native.test.mjs`
- `momm/scripts/bumble-oauth-authority.test.mjs` — temporary issuer/client exchange,
  consent, replay, scope, expiry, revocation and one-review admission controls.
  In-process only; not an SB2 OAuth service or live BAB qualification.
- `momm/scripts/bumble-oauth-captured-regressions.test.mjs` — actual child controls for owned raw-input wiping, mandatory positive supervisor timeout and canonical OAuth frame encoding.
- `momm/scripts/bumble-oauth-contract.test.mjs`
- `momm/scripts/bumble-oauth-discovery.test.mjs`
- `momm/scripts/bumble-oauth-handoff.test.mjs`
- `momm/scripts/bumble-oauth-http-review-regressions.test.mjs` — exact byte mirror of the governor's HTTP review reproductions/investigations; synthetic dependency-fault and data-shape controls only.
- `momm/scripts/bumble-oauth-http.test.mjs` — owned single-use PKCE exchange, fixed socket/TLS binding, default host denial and bounded discovery/token responses; in-process issuer and mocked HTTPS only.
- `momm/scripts/bumble-oauth-journal.test.mjs`
- `momm/scripts/bumble-oauth-panel.test.mjs`
- `momm/scripts/bumble-oauth-peer-handoff.test.mjs` — canonical whole-artifact peer request byte/hash binding, OAuth-only private frame custody, default denial, grant revocation and single original release; synthetic, not a transport or live qualification.
- `momm/scripts/bumble-oauth-peer-worker.test.mjs` — exact canonical OAuth bytes, separate Tailscale socket/TLS identity, bounded private frame/response, error/reflection/5xx controls and default closed entry; mocked HTTPS only.
- `momm/scripts/bumble-oauth-pilot-regressions.test.mjs` — injected validator failure still records an admitted attempt; a sub-millisecond budget refuses before executor invocation, without renewing the deadline.
- `momm/scripts/bumble-oauth-pilot.test.mjs` — signed one-use plan, original sealed baseline/source, captured OAuth worker graph, unchanged parent supervision, synthetic PKCE/HTTPS composition, shared capacity and retained unknown holds; no real BAB inference or native activation.
- `momm/scripts/bumble-oauth-receiver.test.mjs`
- `momm/scripts/bumble-oauth-vault.test.mjs`
- `momm/scripts/bumble-oauth-worker-review-regressions.test.mjs` — exact byte mirror of corrected worker VM/owned-child controls; native policy stays closed, no real request.
- `momm/scripts/bumble-peer-budget.test.mjs`
- `momm/scripts/bumble-peer-review.test.mjs`
- `momm/scripts/bumble-peer-shadow.test.mjs`
- `momm/scripts/bumble-peer-worker.test.mjs`
- `momm/scripts/bumble-plan-restoration.test.mjs`
- `momm/scripts/bumble-plan-retirement.test.mjs`
- `momm/scripts/bumble-publication-followup.test.mjs`
- `momm/scripts/bumble-pure-review-probes.test.mjs`
- `momm/scripts/bumble-qualification-ledger.test.mjs`
- `momm/scripts/bumble-qualification-regressions.test.mjs`
- `momm/scripts/bumble-qualification-sensitivity.test.mjs`
- `momm/scripts/bumble-qualification.test.mjs`
- `momm/scripts/bumble-raw-evidence.test.mjs`
- `momm/scripts/bumble-raw-identity-probes.test.mjs`
- `momm/scripts/bumble-release-receipt.test.mjs`
- `momm/scripts/bumble-request.test.mjs`
- `momm/scripts/bumble-review-regressions.test.mjs`
- `momm/scripts/bumble-runtime-boundaries.test.mjs`
- `momm/scripts/bumble-secret-store.test.mjs`
- `momm/scripts/bumble-stage-admission.test.mjs`
- `momm/scripts/bumble-stage-adoption.test.mjs`
- `momm/scripts/bumble-stage-attestation-before.test.mjs`
- `momm/scripts/bumble-stage-capacity.test.mjs`
- `momm/scripts/bumble-stage-headroom.test.mjs`
- `momm/scripts/bumble-stage-probe-evidence.test.mjs`
- `momm/scripts/bumble-stage-recovery.test.mjs`
- `momm/scripts/bumble-stage-release.test.mjs`
- `momm/scripts/bumble-stage-revalidation.test.mjs`
- `momm/scripts/bumble-stage-review-probes.test.mjs`
- `momm/scripts/bumble-stage.test.mjs`
- `momm/scripts/bumble-store-boundaries.test.mjs`
- `momm/scripts/bumble-task-identity.test.mjs`
- `momm/scripts/bumble-task-metadata.test.mjs`
- `momm/scripts/bumble-task-unicode.test.mjs`
- `momm/scripts/bumble-transmission-recovery.test.mjs`
- `momm/scripts/bumble-transport.test.mjs`
- `momm/scripts/bumble-worker-binding.test.mjs`
- `momm/scripts/bumblers-behavior.test.mjs`
- `momm/scripts/bumblers-boundaries.test.mjs`
- `momm/scripts/bumblers-ui.test.mjs`
- `momm/scripts/capabilities.test.mjs`
- `momm/scripts/codex-isolation.test.mjs`
- `momm/scripts/compatibility.test.mjs`
- `momm/scripts/copilot-transport.test.mjs`
- `momm/scripts/cover.test.mjs`
- `momm/scripts/dispatcher-review-regressions.test.mjs` — exact byte mirror of numeric, metadata-header/bounds and disjoint-ID corroboration controls; synthetic data only.
- `momm/scripts/entrypoint.test.mjs`
- `momm/scripts/evidence-location.test.mjs`
- `momm/scripts/expiry-regression.test.mjs`
- `momm/scripts/generation-rounds.test.mjs`
- `momm/scripts/governor-range.test.mjs`
- `momm/scripts/governor-split.test.mjs`
- `momm/scripts/governor.test.mjs`
- `momm/scripts/grok-stream.test.mjs`
- `momm/scripts/guidance.test.mjs`
- `momm/scripts/install-completion.test.mjs`
- `momm/scripts/installations.test.mjs`
- `momm/scripts/invariants.test.mjs`
- `momm/scripts/lock-ownership.test.mjs`
- `momm/scripts/media-bytes.test.mjs`
- `momm/scripts/migrate-legacy.test.mjs`
- `momm/scripts/modality-evaluation.test.mjs`
- `momm/scripts/modality.test.mjs`
- `momm/scripts/path-resolution.test.mjs`
- `momm/scripts/probes.test.mjs`
- `momm/scripts/process-scope.test.mjs`
- `momm/scripts/quotation-diagnostics.test.mjs`
- `momm/scripts/registry-hardening.test.mjs`
- `momm/scripts/review-answer.test.mjs`
- `momm/scripts/reviewer-auth-choice.test.mjs`
- `momm/scripts/reviewer-endpoint.test.mjs`
- `momm/scripts/reviewer-registry.test.mjs`
- `momm/scripts/roles.test.mjs`
- `momm/scripts/run-notices.test.mjs`
- `momm/scripts/sanitizer-source-regression.test.mjs` — synthetic credential-preservation matrix, explicit JavaScript declaration/call controls and HTTP Bearer redaction; no language-parser or universal secret-detection claim.
- `momm/scripts/scheduler.test.mjs`
- `momm/scripts/scorecard-roster.test.mjs`
- `momm/scripts/scorecard.test.mjs`
- `momm/scripts/second-look.test.mjs`
- `momm/scripts/setup-maintenance.test.mjs`
- `momm/scripts/setup-publication-review.test.mjs`
- `momm/scripts/setup-review-regressions.test.mjs`
- `momm/scripts/shutdown.test.mjs`
- `momm/scripts/split.test.mjs`
- `momm/scripts/stabilisation.test.mjs`
- `momm/scripts/transport.test.mjs`
- `momm/scripts/update-claim.test.mjs`
- `momm/scripts/update-clock.test.mjs`
- `momm/scripts/update-receipt.test.mjs`
- `momm/scripts/update-safety.test.mjs`
- `momm/scripts/update.test.mjs`
- `momm/scripts/usage.test.mjs`
- `scripts/ci-runner-report.test.mjs`
- `scripts/doc-consistency.test.mjs`
- `scripts/evidence-home-isolation.test.mjs`
- `scripts/evidence-permissions-native.test.mjs`
- `scripts/evidence-permissions.test.mjs`
- `scripts/information-shutdown.test.mjs`
- `scripts/launch-guard.test.mjs`
- `scripts/ledger-integrity.test.mjs`
- `scripts/ledger-media.test.mjs`
- `scripts/ledger-serving.test.mjs`
- `scripts/ledger-ui.test.mjs`
- `scripts/media-cancellation.test.mjs`
- `scripts/media-preservation.test.mjs`
- `scripts/momm-auth-recovery.test.mjs`
- `scripts/momm-independent-review.test.mjs`
- `scripts/momm-media-contract.test.mjs`
- `scripts/momm-release-pages.test.mjs`
- `scripts/momm-release-privacy.test.mjs`
- `scripts/momm-release-regressions.test.mjs`
- `scripts/momm-site-home.test.mjs`
- `scripts/momm-site-regression.test.mjs`
- `scripts/momm-site-release-consistency.test.mjs`
- `scripts/momm-site-search.test.mjs`
- `scripts/momm-site-technical.test.mjs`
- `scripts/momm-site-videos.test.mjs`
- `scripts/momm-site-visuals.test.mjs`
- `scripts/preview-module.test.mjs`
- `scripts/private-tree-boundary.test.mjs`
- `scripts/public-export.test.mjs`
- `scripts/release-seal-precheck.test.mjs`
- `scripts/reviewer-ux-regressions.test.mjs`
- `scripts/source-hygiene.test.mjs`
- `scripts/version-discovery.test.mjs`
