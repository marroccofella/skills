# MOMM 1.17.4 — setup feedback stabilization

**Candidate; publication pending.** The intended signed tag is `momm-1.17.4`.
Do not install an unsigned branch as a signed release. Stable remains 1.17.3 until
the signing workflow and public verification complete.

This patch responds to [issue #57](https://github.com/marroccofella/skills/issues/57).
Its report did not establish that every sign-in button failed; investigation reproduced
missing persistent action feedback, hidden shared-account caveats and weak timeout recovery.

- A terminal action leaves tab-local fixed-field feedback. Launch acceptance is not login
  success; detached terminal/browser completion remains unobserved. Lost responses are
  unconfirmed, with advice to check before retrying.
- Cards distinguish local OAuth evidence from a successful synthetic live check and identify
  weak/shared Antigravity evidence. Confirmed or uncertain new launches invalidate old success;
  confirmed non-launches preserve it, and expired-authentication evidence is never erased.
- Copy a safe login command without launching it; after finishing login yourself, choose
  Verify after login. That explicit check uses one synthetic provider request, not project source.
- An inconclusive version check has a zero-model discovery retry, a version command and
  fresh-terminal/PATH guidance. It is not relabelled as missing installation or expired login.
- Optional CLI updates are separate from authentication, quota, tier and outage recovery.
- Copy an action receipt containing only provider/action/launch status/unobserved completion.
  It contains no command, account identifier, OAuth detail, local path or raw diagnostic.
- Fixed refusal reasons survive without raw errors. Pending checks say Live check running,
  and historical launch receipts stop giving login instructions after successful verification.
  Launch observation is bounded, without automatically retrying an uncertain action.

- A sticky status line shows the number of live-verified reviewers and its percentage;
  installation hints do not count as successful connections. An empty pool is not 100%.
- Update all available CLIs is visible above the dashboard and in maintenance. It uses
  explicit command confirmation, skips unknown update routes and stops on unconfirmed
  outcomes. Cancel and Escape dispatch nothing.
- An expandable walkthrough explains checking, updating, signing in and verifying;
  it does not claim a launched terminal completed an update or login.

No change to reviewer membership, model choice, review parsing, quorum, read-only policy,
OAuth-only authentication, automatic-update defaults or signed-update trust checks.

Known limits: receipts are tab-local and disappear on reload; launch PID acceptance cannot
certify visible windows or provider login completion. Tests use synthetic route/job states;
no provider account was logged in by the governor. Native Unix interactive-login coverage
remains separate from hosted regressions. The preflight version-probe budget is unchanged.

Testing this unsigned candidate: [testing guide](testing-1.17.4.md).
Details: [gate record](gates-1.17.4.md) · [setup guidance](getting-started.md)
