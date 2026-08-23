# MOMM 1.10.2 — fully hydrated narrow-view correction

Released 2026-08-23.

MOMM 1.10.2 contains the complete [MOMM 1.10.1 patch artifact](release-1.10.1.md) and closes the remaining narrow-layout edge found only after asynchronous provider status had fully hydrated.

## Patch correction

- Provider names and long status badges now stack within cards at narrow widths instead of competing for one fixed row.
- Mobile provider-name containers may shrink safely, and status badges stay aligned to the card rather than extending into the scrollbar gutter.
- The offline UI release contract now explicitly protects the fully hydrated card header as well as maintenance actions.
- A rendered in-app-browser pass waited for provider and skill-health hydration, expanded system diagnostics, and confirmed `documentElement.scrollWidth === documentElement.clientWidth === 304` with no overflowing DOM element.

No provider route, review input, OAuth policy, setup-probe behavior, terminal action, or public API changed in this patch.

## Verification

The release gate includes 40 dispatcher self-tests, 29 Setup Center self-tests, 16 offline UI contracts, myrepo privacy/secret/history checks, canonical myskills health, syntax checks, `git diff --check`, and the Windows/macOS/Linux × Node.js 18/20/22 GitHub Actions matrix.
