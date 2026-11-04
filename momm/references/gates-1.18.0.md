# 1.18.0 gate record — released 3 November 2026

The signed tag `momm-1.18.0` was published on 3 November 2026 at 00:08:38 UTC on `4ef1698`, the squash
merge of sealed candidate `ca3efd2` with its tree unchanged. This record was completed after the tag;
later documentation changes do not retag the release or change its seal.

## Why this release exists

1.18 makes Bumblers ordinary reviewers: lower-powered open models the owner runs, reached
over the tailnet or loopback with no credential, reviewing through the same prompt,
containment, validation, evidence and statuses as every CLI reviewer. A valid Bumbler review
is one vote; an unusable one is a status. The [release notes](release-1.18.0.md) say what
changed and what the first Bumbler, Bab, actually achieved.

## Owner decisions

- 1 November 2026: Claude became lead developer and sole writer of client source, with Codex
  as independent reviewer, Bab as the SB2 operator and Hal as independent verifier.
- 1 November 2026: "the main point of 1.18 is Bumblers as reviewers and Bab is a Bumbler";
  Bumblers "need to be genuine reviewers on release, not ignored".
- 2 November 2026: Bab's engine keeps two 64k contexts in parallel; no rest between requests;
  longer answers.
- 2 November 2026: "fold 1.17.4 in, native is out, go ahead and release". 1.17.4 is not
  released separately; its Setup Center fixes ship in 1.18. Native transport is not part of
  1.18. The squash merge and the signed tag `momm-1.18.0` are approved on condition that every
  gate below passes on the sealed commit. If one does not, nothing is published and the
  decision returns to the owner.

## Release gates

| Gate | Evidence | Status |
|---|---|---|
| 1. Final review of the Bumbler code, governor-recorded complete | Run `rev_20261102161835_b21cc084fe09`, completion receipt | passed |
| 2. Hosted matrix on the sealed commit and on `main` | Run ids | passed: sealed `ca3efd2` run 41520225936, 15/15 (Windows 22.x re-run after a 4-minute step timeout on a slow runner, every test in that step having passed); `main` `4ef1698` push run 41539145899, 15/15 |
| 3. Full pack on the sealed commit, locally and by Hal independently | Run output | passed: 182/182 locally (Windows, Node 24.22.1, spaced TMP) and 182/182 by Hal (Windows, Node 24.19.0, fresh clone, 650 tracked files unchanged), each on `ca3efd2`, with Hal's fresh-clone seal check and site check |
| 4. Signed `main-checkpoint` and the six lifecycle drill cells on it | Run ids | passed: checkpoint run 41546981968 (`momm-main-4ef1698…`); lifecycle run 41547634368 on drills commit `128e96a`, six GitHub-hosted cells (Windows, macOS, Linux; Node 18 and 24), 13/13 steps each, upgrading from 1.17.3 and 1.17.2, receipts audited by Hal |
| 5. Privacy and history scan before every push | Scanner exit 0 | passed: exit 0, tree and history clean, before every push of the release branch and the drills branch |
| 6. Signed tag `momm-1.18.0` and fresh-clone verification | Release workflow run | passed: signing run 41549965633, gitsign good signature from the main release-workflow identity, Rekor entry and certificate claims validated; a fresh clone of the tag resolves to `4ef1698` and `momm-release.mjs --check` verifies seal `716f749e…`. GitHub's own tag label reads verified false (bad_cert), as it does for `momm-1.17.3`: it does not validate these keyless certificates |

## Final review

Run `rev_20261102161835_b21cc084fe09`, 2 November 2026: `--range 585785c..6bac6af` limited to
`bumbler-route.mjs`, `bumbler-client.mjs` and `multi-review.mjs`, split into 17 pieces,
reviewers Codex, Antigravity, Copilot, Grok and Bab, governor Claude. Quorum was met on every
piece. Codex gave 17 valid pieces, Antigravity 12, Copilot 14, Grok 15 and Bab 1 (two timed
out at 590 seconds and, under the stop rule Bab's operator set, the other 13 were not sent).

The governor triaged 30 findings and 131 suggestions. Every CRITICAL and WARNING has a recorded
check made with `checks.mjs`. Six defects were reproduced and fixed, each failing before and
passing after:

- A secret written inside a call or arrow in a declaration reached reviewers unredacted, a
  regression from earlier 1.18 work. The exemption now holds only when what is passed contains
  no token of eight or more characters mixing letters and digits.
- A Bumbler finding whose quotes failed could merge with a verified finding, count as agreement
  and raise its severity. It now stands alone and keeps `quotes_unverified`.
- An invalid Bumbler answer's display sliced to 20 findings before dropping blanks.
- A save deleted a stale temp file it had not created and then failed.
- `--max-bytes` accepted fractions below one.
- A comment contradicted the `parallel` setting.

Twenty-four findings were rejected after an investigation check showed the claim does not hold,
including both of Bab's CRITICAL findings, which were wrong diagnoses. All 131 suggestions have a
recorded ruling; none changed code, and refactors and further tests are kept for 1.18.1. The
governor validator returned complete with no errors or unresolved items, and the receipt was
recorded.

## Release audit and follow-up review

Codex's release audit of the fixes reproduced that a quoted secret inside a call or arrow in a
declaration named `password`, `secret`, `api_key` or `bearer` still reached reviewers, for
example `const password = identityFunction("...")`. 1.17.3 had the same gap; it was not a
regression, but the first fix claimed more than it covered. A further sanitizer pattern now
redacts a quoted literal of eight or more characters mixing letters and digits further along
such a statement. Follow-up run `rev_20261102184704_8fce240dccfd` (Codex, Antigravity, Copilot,
Grok) reviewed that change and found that a secret after a quoted first argument still leaked;
that was fixed with a failing-before, passing-after check, and the governor recorded the run
complete. A false CRITICAL arose because MOMM redacts its own review input, so reviewers saw
the test fixtures already masked.

The owner then asked for a test run with Bumblers and the other reviewers together. Run
`rev_20261102201920_fdeaaa82fd97` reviewed that change with Codex, Antigravity, Copilot, Grok and Bab
(one request of at most 1024 tokens; her answer was cut off at that limit, so it gave no vote).
Copilot's suggestion that the new pattern was slow on long lines was reproduced: a 300,000-character
line of key/value pairs took about 18 seconds, against 2 ms in 1.17.3. The pattern's reach is now
bounded and the same lines take under 20 ms. Its CRITICAL claim that a call's name is lost inside a
declaration was not reproduced; outside a declaration the older pattern redacts the call, as in
1.17.3, which over-redacts rather than leaks. The governor recorded the run complete.

Known limit: a quoted secret made only of letters, or assigned under a name other than those
four, is not redacted. Redaction is a safeguard, not a guarantee; do not review files that hold
live credentials.

## Independent testing

Hal, on his own machine (Windows, Node 24.19), ran the full pack on `6bac6af`: 182 of 182
commands passed, with every tracked file unchanged. On the fixes he ran the self-test, the
Bumbler route, governor and workflow suites: all passed. Bab tested the Bumbler route live and
checked every published head against the source. Codex independently verified the busy-wait,
deadline and rest repairs. Their results on the sealed commit are added below when they arrive.
