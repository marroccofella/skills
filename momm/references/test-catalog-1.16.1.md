# 1.16.1 offline test catalog

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

- `momm/scripts/review-claims.test.mjs`
- `momm/scripts/review-workflow.test.mjs`

- `momm/scripts/adapter-cleanup.test.mjs`
- `momm/scripts/antigravity-transport.test.mjs`
- `momm/scripts/attachment-cleanup.test.mjs`
- `momm/scripts/attempts.test.mjs`
- `momm/scripts/bootstrap.test.mjs`
- `momm/scripts/capabilities.test.mjs`
- `momm/scripts/codex-isolation.test.mjs`
- `momm/scripts/copilot-transport.test.mjs`
- `momm/scripts/cover.test.mjs`
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
- `momm/scripts/invariants.test.mjs`
- `momm/scripts/installations.test.mjs`
- `momm/scripts/lock-ownership.test.mjs`
- `momm/scripts/media-bytes.test.mjs`
- `momm/scripts/migrate-legacy.test.mjs`
- `momm/scripts/modality-evaluation.test.mjs`
- `momm/scripts/modality.test.mjs`
- `momm/scripts/path-resolution.test.mjs`
- `momm/scripts/probes.test.mjs`
- `momm/scripts/process-scope.test.mjs`
- `momm/scripts/roles.test.mjs`
- `momm/scripts/quotation-diagnostics.test.mjs`
- `momm/scripts/scheduler.test.mjs`
- `momm/scripts/scorecard-roster.test.mjs`
- `momm/scripts/scorecard.test.mjs`
- `momm/scripts/second-look.test.mjs`
- `momm/scripts/setup-maintenance.test.mjs`
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
- `scripts/doc-consistency.test.mjs`
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
