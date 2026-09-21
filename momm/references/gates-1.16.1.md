# 1.16.1 gate record — not released

This record separates implementation from release evidence. The published release stays 1.16.0.

## Compatibility and lifecycle

| OS | Node 18 legacy | Node 20 legacy | Node 22 primary | Node 24 primary |
| --- | --- | --- | --- | --- |
| Windows | untested final candidate | untested final candidate | local development tests on 22.16.0; final gate pending | untested final candidate (CI also requests 24.15.0) |
| macOS | untested final candidate | untested final candidate | untested final candidate | untested final candidate |
| Linux | untested final candidate | untested final candidate | untested final candidate | untested final candidate |

The workflow requests these cells; a configuration entry is not a pass. Populate exact versions,
run URLs, commit SHA and receipt hashes only after reading completed job output.

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
