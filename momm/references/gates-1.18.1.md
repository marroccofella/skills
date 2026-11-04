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
| 2. MOMM review of the whole candidate, governor-recorded complete | Run id | pending |
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
