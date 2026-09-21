# MOMM 1.16.1 — draft notes, not released

**Current signed release remains 1.16.0.** This draft is not an upgrade instruction or release seal.

The patch strengthens existing review and update behavior: content-based media checks, explicit
capability expiry, separate retry evidence, failed-work accounting, tool-produced verification
records and active-installation conflict reporting. Reviewers remain read-only; the governor
is the only writer. Account logins remain required. Automatic updates remain off.

Media identification checks bounded container structure, not decoded perceptual correctness,
malware safety or every possible encoding. Unsupported/unbounded containers fail closed.
Expired probes require a deliberate re-probe; success on one modality does not prove another.
Unknown usage/cost is not zero. Matching evidence hashes do not prove the adequacy of a test.

The existing installation inventory, dirty-clone guidance, effectiveness scorecard and optional
training export are retained. Scorecards reflect governor rulings, not objective model quality.
Private evidence and project content are not published automatically.

The scope-audit follow-up clears stale update success after a failure and verifies
training-export destinations with the native privacy checker, on Windows as well
as POSIX. A new dedicated destination can be created privately; an existing unsafe
directory or companion file is refused, even with `--force`. Existing permissions
are not changed. The current [acceptance guide](third-party-test-plan-1.16.1.md)
adds the missing retry and ledger-ticket steps.

Final native lifecycle, live image, candidate CI, peer dispositions and publication gates remain
open. See [the gate record](gates-1.16.1.md). Do not install an unsigned branch as a signed release.

Broader workflow checkpoints, managed paid reviewers, new installation-management interfaces,
website films and new modalities are not quietly included in this reliability patch.
