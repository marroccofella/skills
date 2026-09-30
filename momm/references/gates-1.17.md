# 1.17 gate record — candidate, not released

This record separates implementation from release evidence. The published release stays 1.16.1 until
the signed tag `momm-1.17.0` exists. It names no current commit: a file cannot name its own commit.
The candidate under test is the head of the 1.17 pull request, named in its title and in the 1.17
testing discussion.

## Release gates (from the plan)

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. Local suites and the OS by Node matrix on the commit to tag | Job logs, not the badge | pending |
| 2. Lifecycle drills, including interrupted-upgrade recovery, on the signed checkpoint | Six hosted cells with receipts | rehearsal passed (below); gate pending |
| 3. Self-review of the 1.17 delta with per-piece quorum and a completion receipt | Receipt under the B4 rules | pending |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. One live image review on the final tree, exercising A3 | Receipt | pending (owner quota) |
| 6. Signed tag `momm-1.17.0` | Release workflow run | owner's go-ahead only |

## Reviews during the build

Each design and code change was reviewed with MOMM before it was merged; every finding was reproduced
or rejected with evidence, and every review has a completion receipt in the private ledger:

- `rev_20260928102858_f03fd115a37c` — the plan (deep; 6 WARNINGs reproduced and fixed).
- `rev_20260929140445_1e38c2f73f4e` — guided image generation design.
- `rev_20260929165754_496b047e6898` — Grok route fixes and the ledger's generated-pictures section.
- `rev_20260929211625_0b5ba54cb0e5` — the full committed base, split in six pieces (10 real findings
  fixed; two CRITICALs and one WARNING were split-piece misreads, rejected with investigation evidence).

## Lifecycle drills

Branch `drills/momm-1.17` (never merged) adds an interrupted-upgrade step (plan A6): after each
re-upgrade the drill returns to the older release, starts an upgrade, kills it as soon as the
transaction journal exists, recovers with the retained updater, and verifies the original receipt,
commit and harness.

- **Rehearsal 1, run 36635871345 (published 1.16.1 from 1.16.0 and 1.15.1):** every existing step passed
  on all six cells; the new step failed on all six. Finding: after a crash the update claim stays and
  recovery refuses until someone confirms no updater is running and removes only that claim. This is
  deliberately safe (a process id may be reused), but the documented one-command recovery needed a
  manual step. Response: the drill performs and records that step, and 1.17 adds
  `update.mjs --release-claim <token>`.
- **Rehearsal 2, run 36637157857:** all six cells passed every step, the interrupted-upgrade recovery
  included.
- **Gate run:** on the signed checkpoint of the merged 1.17 candidate; pending.

## Owner decisions

D1 to D10 in the plan were delegated to the recommended options on 29 September 2026, with the instruction
to complete all outstanding items. Quota-spending runs (the Codex isolation probe, the Codex quotation
diagnostic, the self-review and the live image review) are covered by that instruction and disclosed
when run.
