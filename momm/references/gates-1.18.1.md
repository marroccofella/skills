# 1.18.1 gate record

## Why this release exists

Two small changes found in use of 1.18.0 (see the [release notes](release-1.18.1.md)): a
switch to keep a saved Bumbler out of default reviews, and a precise reason when a review's
summary is refused.

## Owner decisions

- 3 November 2026: "add the enabled switch for bumblers in 1.18.1".
- 4 November 2026: "get 1.18.1 reviewed and released". The squash merge and the signed tag
  `momm-1.18.1` follow only if every gate below passes on the sealed commit. If one does not,
  nothing is published and the decision returns to the owner.

## Release gates

| Gate | Evidence | Status |
|---|---|---|
| 1. Independent review of the summary change (Codex), test gaps closed | Codex review of PR 67; mutation check | passed |
| 2. MOMM review of the candidate's code, governor-recorded complete | Run `rev_20261104104358_3e3c91ecec19`, completion receipt | passed |
| 3. Hosted matrix on the sealed commit and on `main` | Run ids | pending |
| 4. Full pack on the sealed commit | Run output | pending |
| 5. Signed `main-checkpoint` and the six lifecycle drill cells on it | Run ids | pending |
| 6. Privacy and history scan before every push | Scanner exit 0 | passed so far |
| 7. Signed tag `momm-1.18.1` and fresh-clone verification | Release workflow run | pending |

## Gate 1: Codex's review of the summary change

Codex reviewed PR 67 at `5ebf959` independently on 3 November 2026: its 30-case matrix passed
on both validators and no runtime or privacy defect reproduced, but two test gaps were shown
by mutation. Reverting only the second-look caller to the old message, or refusing a
1000-character summary later in `reviewProblem`, both left the suites green.

Commit `cec19d6` (here `8dc32bc`) runs the same matrix on both validators (missing, null,
blank, number, array, object, 1000 and 1001, astral Unicode) and requires a complete,
otherwise-valid answer at the limit to be accepted outright. In disposable copies, each of
three mutants (both of Codex's, plus the limit bug in the second-look validator) now fails
its suite, and the unmutated copy passes both.

## Gate 2: MOMM review of the candidate

Run `rev_20261104104358_3e3c91ecec19`, 4 November 2026: `--range 333ba26..ee65d8d` limited to
`momm/scripts` and `momm/assets`, reviewers Codex, Antigravity, Copilot and Grok, governor Claude.
Codex, Copilot and Grok accepted (quorum 3); Antigravity's answer was refused because its quotes did
not match the artifact, a status and no vote. No findings; 11 suggestions, each ruled:

- **Applied, failing before and passing after:** Grok found that re-saving a switched-off Bumbler in
  the Setup Center put it back into default reviews, because the box always started ticked; typing a
  saved name now sets the box from that entry. `summaryProblem` is shared from
  `review-contract.mjs` (Codex, Copilot, Grok), and the over-limit refusal names UTF-16 units
  (Copilot, Grok).
- **Applied as style:** a comment that a switched-off Bumbler still holds its model server (Copilot).
- **Rejected:** a default-dispatch test, which would launch real reviewer CLIs; a pending-save test,
  since the save already compares the switch before resetting; reformatting one-line assertions; and
  a test-only assertion with no failing baseline, deferred to 1.18.2.

## Hosted CI failure and follow-up review

Hosted CI on the first sealed candidate `7f9260e` failed `attachment-cleanup.test.mjs` on every
platform: that suite runs `main()` on its own in a sandbox, and the `defaultBumblers` helper added
for the switch was defined outside it. The local checks before sealing had not included that suite.
Commit `1f3ba08` moves the helper inside `main()` with its two callers, and the candidate was
resealed. Follow-up review `rev_20261104121549_05a3e2f4b61b` (Codex, Antigravity, Copilot and Grok
all accepted) raised one WARNING, that the diff did not show every caller was inside `main()`:
investigated with a recorded test and rejected. Its four suggestions asked for coverage that
already exists or for a guard on values `loadBumblers` already validates; all rejected with
reasons. Governor-recorded complete. The full pack now runs before any sealed push.