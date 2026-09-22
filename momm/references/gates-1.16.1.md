# 1.16.1 gate record — not released

This record separates implementation from release evidence. The published release stays 1.16.0.

## Compatibility and lifecycle

| OS | Node 18 legacy | Node 20 legacy | Node 22 primary | Node 24 primary |
| --- | --- | --- | --- | --- |
| Windows | offline CI green | offline CI green | offline CI green; local full run on 22.16.0 | offline CI green (24.x and 24.15.0) |
| macOS | offline CI green | offline CI green | offline CI green | offline CI green |
| Linux | offline CI green | offline CI green | offline CI green | offline CI green |

"Offline CI green" means every job of the workflow passed on the named candidate, read from the job
logs and not from the badge. It is **not** a lifecycle result: no signed install, upgrade, rollback
or re-upgrade has been run on any native machine, so every cell in the lifecycle table below stays
untested. A green offline matrix and a completed lifecycle drill are different claims.

The workflow requests these cells; a configuration entry is not a pass. The results above are:

| Candidate | Workflow run | Result |
| --- | --- | --- |
| `a5a37b5c8b935ca0740aa94e79ada6ee1bc1f616` | [35664942450](https://github.com/marroccofella/skills/actions/runs/35664942450) | 13 of 13 jobs passed |
| `be12bc569ab6ceacc41f6ce544fddf3673818c0d` | 35650200906 | **failed on all 13 jobs**; superseded, do not test |

A later candidate supersedes this table. Populate exact versions, run URLs, commit SHA and receipt
hashes only after reading completed job output.

## Defect found by independent audit of `a5a37b5`, fixed

A link planted inside a reviewed project escaped the attachment check when the project was reached
through an alias of itself: containment was decided on literal paths against a resolved root, so
every component of the aliased path looked "outside" the project and none was inspected. The real
CLI accepted a file from outside the project through that shape. Containment is now decided on real
paths: a component is refused when it is a link and the real location of its parent is the project
or inside it. Folders above the project remain the machine's own layout and are not refused. The
reproduction is in `momm/scripts/media-bytes.test.mjs` and fails against the audited commit.

Node 18 and Node 24 lifecycle drills remain required on Windows, macOS and Linux by charter B.
Node 22 is also a primary lifecycle target; the primary label does not waive Node 18's regression
obligation. Node 20 remains an offline CI compatibility target, not a completed lifecycle claim.
Record the actual machine architecture alongside the exact runtime version in each receipt.

For each required lifecycle cell above, in an isolated user environment, record fresh signed installation,
upgrade from 1.15.1 and 1.16.0, rollback, re-upgrade, damaged/unsigned refusal and interrupted
recovery. End with `--doctor --versions --expect <candidate-version>`. Never replace the owner's
working skill, enable automatic updates or run `evidence --protect` as an agent.

Real signed 1.16.1 lifecycle drills are **blocked pending a reviewed signed candidate artifact
and authorized native-machine runs**. Synthetic transaction tests are not substitutes.

## Still required before tag

- Full candidate suites and exact OS/Node CI outputs.
- Committed-range self-review, all piece quorums and dispositions, tool-produced final receipt.
- Privacy and history scan of the proposed publication.
- Final-tree live image gate ([checklist](image-review-checklist.md)).
- Signed lifecycle receipts and release authorization.

## Website deployment boundary

The existing branch-based GitHub Pages deployment is **not proven gated on the same main
commit's safety run**. Do not describe it as such. Switching the repository Pages source to a
checked Actions deployment is a separate owner-visible publishing change; no Pages setting is
changed by this code patch. Media awaiting human listening approval must remain unlinked.
