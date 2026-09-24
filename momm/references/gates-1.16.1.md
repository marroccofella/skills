# 1.16.1 gate record — not released

This record separates implementation from release evidence. The published release stays 1.16.0.

## Compatibility and lifecycle

### Offline CI (the workflow's own jobs)

| OS | Node 18 | Node 20 | Node 22 (primary) | Node 24 (primary) |
| --- | --- | --- | --- | --- |
| Windows | offline CI green | offline CI green | offline CI green; local full run on 22.16.0 | offline CI green (24.x, 24.15.0 and 24.19.0) |
| macOS | offline CI green | offline CI green | offline CI green | offline CI green |
| Linux | offline CI green | offline CI green | offline CI green | offline CI green |

"Offline CI green" means every job of the workflow passed on the named candidate, read from the job
logs and not from the badge. It is **not** a lifecycle result.

`24.x` is whatever patch the runner happens to hold that day: on 23 September 2026 it resolved to
**24.20.0**, so the matrix had never once run 24.19, the version on which a reviewer reported an
attachment-cleanup timeout. A green `24.x` column was therefore not evidence about 24.19. Windows
now pins 24.15.0 and 24.19.0 alongside `24.x` so each reported runtime is actually exercised.
It is **not** a lifecycle result. A green offline matrix and a
completed lifecycle drill are different claims, so they have separate tables.

### Installation lifecycle (signed install, upgrade, rollback, re-upgrade, damaged-payload refusal)

| OS | Node 18 | Node 20 | Node 22 | Node 24 |
| --- | --- | --- | --- | --- |
| Windows | untested | untested | untested | untested |
| macOS | untested | untested | untested | untested |
| Linux | untested | untested | untested | untested |

Every cell is untested: no signed install, upgrade, rollback or re-upgrade has been run on any
native machine. Nothing below changes that until a cell is filled with a receipt.

**Node versions, said once.** Node 22 and Node 24 are the primary targets; Node 18 and Node 20 are
past end of life and are kept as compatibility targets. "Primary" describes support priority, not
which drills are owed: Node 18 and Node 24 lifecycle drills remain required on Windows, macOS and
Linux by charter B, and the primary label does not waive the Node 18 obligation. Node 20 is an offline CI target only, with no lifecycle
obligation.

The workflow requests these cells; a configuration entry is not a pass. The results above are:

| Candidate | Workflow run | Result |
| --- | --- | --- |
| `eea8189dc793f5fb1624374d9b46828b31f8a5a7` | [35735446353](https://github.com/marroccofella/skills/actions/runs/35735446353) | 13 of 13 jobs passed |
| `a5a37b5c8b935ca0740aa94e79ada6ee1bc1f616` | [35664942450](https://github.com/marroccofella/skills/actions/runs/35664942450) | 13 of 13 jobs passed |
| `be12bc569ab6ceacc41f6ce544fddf3673818c0d` | 35650200906 | **failed on all 13 jobs**; superseded, do not test |

**No row here is "the current candidate".** This table is CI history: each row is a fact about one
past run. The candidate under test is the head of
[PR #18](https://github.com/marroccofella/skills/pull/18) and of `release/momm-1.16.1`, and is named
in that PR's title and in Discussion #22 — pointers that move with the branch.

This file deliberately does not name the current commit, because it cannot: writing a SHA into a
file changes the commit, so the value is stale the moment it is committed. That mistake was made
three times on this release; `scripts/doc-consistency.test.mjs` now fails if a "(current)" marker
reappears here. Populate exact versions, run URLs, commit SHA and receipt
hashes only after reading completed job output.

## Defect found by independent audit of `a5a37b5`, fixed

A link planted inside a reviewed project escaped the attachment check when the project was reached
through an alias of itself: containment was decided on literal paths against a resolved root, so
every component of the aliased path looked "outside" the project and none was inspected. The real
CLI accepted a file from outside the project through that shape. Containment is now decided on real
paths: a component is refused when it is a link and the real location of its parent is the project
or inside it. Folders above the project remain the machine's own layout and are not refused. The
reproduction is in `momm/scripts/media-bytes.test.mjs` and fails against the audited commit.

Record the actual machine architecture alongside the exact runtime version in each receipt.

For each required lifecycle cell above, in an isolated user environment, record fresh signed installation,
upgrade from 1.15.1 and 1.16.0, rollback, re-upgrade, damaged/unsigned refusal and interrupted
recovery. End with `--doctor --versions --expect <candidate-version>`. Never replace the owner's
working skill, enable automatic updates or run `evidence --protect` as an agent.

Real signed 1.16.1 lifecycle drills are **blocked pending a reviewed signed candidate artifact
and authorized native-machine runs**. Synthetic transaction tests are not substitutes.

## Grok route measurements (25 September 2026)

Same 5 KB review each time (the delta `238584b..7a970f7`), Grok CLI 1.0.41; the reviewed text is project
source already public on PR #18. Wall time is the whole CLI run; "valid" means MOMM accepted the review.

| Model | Effort | Setup | Runs | Wall time | Valid | Cost per run |
|---|---|---|---|---|---|---|
| grok-4.7 | high (Grok default) | inherited | 1 | 736 s | 1 of 1 | $0.14 |
| grok-4.7 | medium | inherited | 1 | 395 s | 0 of 1 | n/a |
| grok-4.7 | low | inherited | 1 | 153 s | 1 of 1 | $0.05 |
| grok-4.7-build-fast | high | inherited | 1 | 290 s | 1 of 1 | $0.22 |
| grok-4.7-build-fast | medium | inherited | 1 | 201 s | 1 of 1 | $0.14 |
| grok-4.7-build-fast | low | inherited | 1 | 134 s | 1 of 1 | $0.12 |
| grok-4.7-build-fast | medium | isolated, every tool denied | 3 | 194 to 308 s | 3 of 3 | $0.14 to $0.19 |
| grok-4.7-build-fast | medium | isolated, own system prompt | 2 | 237 to 311 s | 2 of 2 | $0.17 to $0.21 |

Chosen: the fast model when the account lists it, at medium effort unless the user passes `--effort`
(5 of 5 valid, 194 to 311 s), with 2x headroom on the 180 s base (360 s, the existing cap). The system
prompt override is not used: no faster, and dearer. Low effort was faster but has one run each, so it
is not the default. Isolation cut the input of a one-line prompt from 19,751 to 17,174 tokens and
start-up from 5.5 to 4.0 s. The Setup Center connectivity budget rose from 240 to 300 s to match.

Known limits: Grok's skill list cannot be hidden per run (only the user's global config can), so
skills are still advertised to the reviewer but every tool, including the skill tool, is denied. The
report's `requested_effort` records what the user asked for; with the fast model and no `--effort`,
the effective Grok effort is medium. Timings vary between runs by about 1.6x; the budget has 49 s
over the slowest measured run.

## Accepted risk (owner decision, 24 September 2026)

On macOS and Linux, MOMM starts reviewer CLIs (`codex`, `claude`, `grok` and the others) by name,
so the operating system searches PATH. If the user's own PATH contains a folder inside the project
being reviewed (for example one added by direnv, or a virtual environment activated inside it), a
file in that project could be launched in place of the reviewer. Windows is not affected: every
launch there is resolved to an absolute path outside the project. The Git that verifies a
committed range is resolved that way on every platform. Deferred to 1.17; tracked in the
[ideas register](ideas-register.md). Until then, review untrusted projects from a shell whose
PATH contains no folder inside them.

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
