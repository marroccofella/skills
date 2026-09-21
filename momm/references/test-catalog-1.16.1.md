# 1.16.1 offline test catalog

`momm/scripts/scope-closure.test.mjs` reproduces stale update results, native
owner-only export/refusal (including forced companion overwrite), and checks
the current acceptance guide's retry and ledger-ticket instructions.

`momm/scripts/review-final-regressions.test.mjs` tests exact CI deadline matching and CLI diagnostics.
`momm/scripts/review-refutations.test.mjs` tests disputed review boundaries and independent audit identities.
`momm/scripts/review-followup.test.mjs` tests split-quorum reporting, bounded stdin,
201-file checks, scorecard/export correctness and unreadable-source refusal.

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

`attempts.test.mjs` covers `checks.mjs` and `attempt-audit.mjs`, including real failing/passing
child tests. `review-claims.test.mjs` adds split/start bindings and refusal controls;
`review-workflow.test.mjs` checks this catalog against the suite files on disk.

- `momm/scripts/review-claims.test.mjs`
- `momm/scripts/review-workflow.test.mjs`

- `momm/scripts/adapter-cleanup.test.mjs`
- `momm/scripts/antigravity-transport.test.mjs`
- `momm/scripts/attachment-cleanup.test.mjs`
- `momm/scripts/attempts.test.mjs`
- `momm/scripts/bootstrap.test.mjs`
- `momm/scripts/capabilities.test.mjs`
- `momm/scripts/copilot-transport.test.mjs`
- `momm/scripts/entrypoint.test.mjs`
- `momm/scripts/expiry-regression.test.mjs`
- `momm/scripts/governor-range.test.mjs`
- `momm/scripts/governor-split.test.mjs`
- `momm/scripts/governor.test.mjs`
- `momm/scripts/guidance.test.mjs`
- `momm/scripts/install-completion.test.mjs`
- `momm/scripts/installations.test.mjs`
- `momm/scripts/lock-ownership.test.mjs`
- `momm/scripts/media-bytes.test.mjs`
- `momm/scripts/migrate-legacy.test.mjs`
- `momm/scripts/modality-evaluation.test.mjs`
- `momm/scripts/modality.test.mjs`
- `momm/scripts/path-resolution.test.mjs`
- `momm/scripts/probes.test.mjs`
- `momm/scripts/process-scope.test.mjs`
- `momm/scripts/scheduler.test.mjs`
- `momm/scripts/scorecard.test.mjs`
- `momm/scripts/setup-maintenance.test.mjs`
- `momm/scripts/shutdown.test.mjs`
- `momm/scripts/split.test.mjs`
- `momm/scripts/stabilisation.test.mjs`
- `momm/scripts/transport.test.mjs`
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
