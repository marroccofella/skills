# MOMM 1.17.4 — unsigned candidate testing

Stable remains the signed `momm-1.17.3` release. This branch is for source testing only;
do not replace an installed skill or use the signed updater to install it. A package seal
checks payload integrity, not signing identity, correctness or release readiness.

Use the full 40-character SHA printed by the candidate PR or Discussion #32. Branch names
can move. Clone outside synced folders; inspect the candidate code before executing it.

```text
git clone https://github.com/marroccofella/skills momm-1174-check
cd momm-1174-check
git fetch origin test/momm-1.17.4-public
git checkout --detach <TEST_SHA>
git rev-parse HEAD
git status --porcelain
node scripts/momm-release.mjs --check
node momm/scripts/setup-maintenance.test.mjs
node momm/scripts/setup-review-regressions.test.mjs
node momm/scripts/setup-ui.mjs --self-test
```

Record the process exit status immediately after each test (`$LASTEXITCODE` in PowerShell,
`$?` in a POSIX shell). Then recheck HEAD and clean status. The previous local result is
152 canonical dashboard checks plus 20 standalone probes, not a result promised for every OS.

For wider offline coverage, optionally run:

```text
node scripts/run-ci-suites.mjs --save-report --commit <TEST_SHA> --evidence-home <PRIVATE_EXTERNAL_DIR>
```

The SHA label is caller-supplied, so it does not replace checking HEAD. Preserve the first
result, including save failures, before any separately labelled retry. Never post full logs,
private reports, account identifiers, login links/codes, local paths or credentials.

## Optional interactive walkthrough

After inspecting the server and assets, start `node momm/scripts/setup-ui.mjs` from this
clone. Use only the newly printed local URL; do not post it, because it includes a local
session capability. Close this candidate Setup Center using its Close action afterwards.

First test without spending provider quota: walkthrough expand/collapse, visible percentage
and numerator/denominator, version inventory, Update all confirmation, Cancel and Escape.
Unknown checks must stay unknown. Cancellation must launch nothing.

Actual updates, provider sign-in and Verify after login are optional separate explicit
actions. Verification sends synthetic text to the selected provider. You complete browser
login yourself. A launch receipt must not claim an update or sign-in succeeded. Check native
terminal visibility and the post-action state if you choose these actions; our simulations
did not establish those real-machine outcomes.

## A useful report

Reply in Discussion #32 or issue #57 with OS, Node/CLI versions, exact SHA, chosen command
or button, expected/actual result, exit status, and whether the observation was simulated or
real. State any omitted actions. A scoped negative is useful; it is not universal approval.
Personal-machine macOS/Linux tests and real terminal-launch observations are especially
welcome. Please do not turn an inconclusive timeout into an authentication diagnosis.

1.18 Bumble material is a separate design-review track, not part of this build.
