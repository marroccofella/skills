# MOMM 1.10.1 — complete release artifact and narrow-view fix

Released 2026-08-23.

MOMM 1.10.1 is the complete patch artifact for the corrective 1.10 line. It contains every security, containment, provider-authority, and Setup Center change described in the [MOMM 1.10.0 notes](release-1.10.0.md), plus the post-release corrections below.

## Patch corrections

- Removed the rigid 320-pixel body minimum that could create a narrow horizontal scrollbar when the browser's vertical scrollbar reduced the usable content width.
- Added a release-contract assertion that prevents the rigid minimum width from returning; a rendered in-app-browser check confirms `scrollWidth === clientWidth` at the narrow panel size.
- Corrected the public verification text to report the final 40 dispatcher self-tests and 29 Setup Center self-tests.
- Clarified the setup-probe boundary: its capability is issued and consumed once within a Setup Center instance. It is not an OS-backed identity claim against another same-user process. The dispatcher still accepts only the fixed disclosed synthetic sentence, so this internal route cannot carry project source.

No provider route, review payload, OAuth policy, or user action changed in this patch.

## Verification

The release gate includes:

```text
node momm/scripts/multi-review.mjs --self-test
node momm/scripts/setup-ui.mjs --self-test
node momm/scripts/setup-ui-contract-test.mjs
node myrepo/scripts/publish.mjs --self-test
node myskills/scripts/health-contract-test.mjs
git diff --check
```

GitHub Actions repeats the complete safety suite on Windows, macOS, and Linux with Node.js 18, 20, and 22 before publication.
