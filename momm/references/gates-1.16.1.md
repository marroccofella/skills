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

| OS | Node 18 (owed) | Node 20 (not owed) | Node 22 (not owed) | Node 24 (owed) |
| --- | --- | --- | --- | --- |
| Windows | untested | untested | untested | untested |
| macOS | untested | untested | untested | untested |
| Linux | untested | untested | untested | untested |

Every cell is untested: no signed install, upgrade, rollback or re-upgrade has been run on any
native machine. Nothing below changes that until a cell is filled with a receipt.

**Node versions, said once.** Node 22 and Node 24 are the primary targets; Node 18 and Node 20 are
past end of life and are kept as compatibility targets. "Primary" describes support priority, not
which drills are owed: Node 18 and Node 24 lifecycle drills remain required on Windows, macOS and
Linux by charter B, and the primary label does not waive the Node 18 obligation. Node 20 and Node 22
are offline CI targets only, with no lifecycle obligation (charter B: "18 and 24 at least, 20 and 22 in
CI"); a Node 22 cell is filled only if a drill is actually run.

The offline CI table at the top of this section is read from these runs; a configuration entry is not
a pass. Since 24 September the workflow has fifteen jobs: fourteen matrix cells (Windows adds pinned
24.15.0 and 24.19.0) and the site-and-ledger job. Only the fifteen-job rows back the 24.19.0 cell.

| Candidate | Workflow run | Result |
| --- | --- | --- |
| `2fe1e473cb9e1763d53d06e3d02fce5a823357c2` | [36077301341](https://github.com/marroccofella/skills/actions/runs/36077301341) | 15 of 15 jobs passed |
| `7a970f79dd3bcca1e155d8e89058832c5b63625e` | [36061569636](https://github.com/marroccofella/skills/actions/runs/36061569636) | 15 of 15 jobs passed |
| `eea8189dc793f5fb1624374d9b46828b31f8a5a7` | [35735446353](https://github.com/marroccofella/skills/actions/runs/35735446353) | 13 of 13 jobs passed |
| `a5a37b5c8b935ca0740aa94e79ada6ee1bc1f616` | [35664942450](https://github.com/marroccofella/skills/actions/runs/35664942450) | 13 of 13 jobs passed |
| `be12bc569ab6ceacc41f6ce544fddf3673818c0d` | [35650200906](https://github.com/marroccofella/skills/actions/runs/35650200906) | **failed on all 13 jobs**; superseded, do not test |

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
The lab runs had no MOMM deadline, so a run is listed as valid even where it outlasted the old 270 s
budget; inside MOMM the 736 s and 290 s runs would have been cut off.

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

Chosen: the fast model when the account lists it, at medium effort unless the user passes `--effort`:
3 of 3 in the shipped setup (194 to 308 s), and 2 of 2 more with a replaced system prompt (237 to
311 s). Budget: 2x headroom, capped at 360 s unless `--timeout` is explicit, so default and deep Grok
reviews both get 360 s. The first MOMM review on this setup (the delta review of these changes, run
`rev_20260924234524_89d8189794c3`, pieces of 15 KB and 40 KB) was valid on both pieces in 154 s and 22 s. The system
prompt override is not used: no faster, and dearer. Low effort was faster but has one run each, so it
is not the default. Isolation cut the input of a one-line prompt from 19,751 to 17,174 tokens and
start-up from 5.5 to 4.0 s. The Setup Center connectivity budget rose from 240 to 300 s, which covers its own 120 s check base
at 2x (240 s) plus start-up and report time.

Known limits: Grok's skill list cannot be hidden per run (only the user's global config can), so
skills are still advertised to the reviewer but every tool, including the skill tool, is denied. The
report's `requested_effort` records what the user asked for; with the fast model and no `--effort`,
the effective Grok effort is medium. Timings vary between runs by about 1.6x; the budget has 52 s
over the slowest run in the shipped setup. An account without `grok-4.7-build-fast` runs Grok's
default model at its default high effort (736 s measured), which is expected to time out unless the
user passes `--effort medium` or a larger `--timeout`.

## Codex route isolation (25 September 2026)

MOMM's Codex runs pass `-c project_doc_max_bytes=0` and `--disable` for hooks, plugins, apps,
multi_agent and image_generation (all five read false in `codex features list` with those switches,
CLI 0.156.1). One synthetic probe, approved by the owner: a throwaway repository whose `AGENTS.md`
required every review summary to start with a canary token, and a three-line diff that turned an
addition into a subtraction. Codex reviewed it in 14.6 s on the first attempt, returned a valid
REJECT naming the reversed operator, and the canary appeared nowhere in its output. The canary's
absence is consistent with the fix but does not prove Codex would have obeyed it before; the argument
is asserted in `adapter-cleanup.test.mjs`. Still inherited until 1.17: MCP servers, global
instructions and skills, and the model and effort shared with the Codex desktop app.

## Self-review gate: receipt waived by the owner (25 September 2026)

Release gate 3 asks for a self-review of the committed 1.16.1 range with quorum on every piece and a
tool-produced completion receipt. Two full-range runs were made from this machine, governed by Claude
Code, with Codex, Antigravity and Grok reviewing (`--min-success 2`, `--retry-invalid`, deep tier):

| Run | Range | Pieces | Quorum met | Findings / suggestions | Outcome |
| --- | --- | --- | --- | --- | --- |
| `rev_20260925004814_1ed9f58c2c3a` | `momm-1.16.0..2fe1e47`, 150 text paths | 44 (40 KB) | 38 of 44 | 93 / 187 | every item verified and ruled; 39 findings and 34 suggestions applied in `7b1d84c` |
| `rev_20260925131115_6ed35d0bdf89` | `momm-1.16.0..7b1d84c`, 153 text paths | 69 (24 KB) + 2 governor-direct | 61 of 69 | 113 / 301 | every item verified and ruled; the applied items are in the commit that follows `7b1d84c` |

No receipt is possible from either run, because quorum was not met on every piece, and the cause is
route behaviour rather than the reviewed code: Codex's quotations still failed the quotation rule after
look-alikes were allowed (19 times in the second run), and Grok ran past its 360 s budget on dense
pieces (17 times). Each fix round also moves the candidate, and each new run of slice-limited reviewers
produced a fresh set of mostly false findings (all 7 CRITICALs in the second run were false: removal
halves of divided hunks, or declarations outside the slice). The owner accepted these two runs and
their rulings in place of the receipt. The independent review is not waived.

Scope outside the text review, stated so that nothing is presented as reviewed that was not:
- Three binary media files: `docs/momm/momm-poster.jpg`, `docs/momm/films/overview-1.16.0/poster.jpg`
  and `docs/momm/films/overview-1.16.0/walkthrough.mp4`. Each is byte-identical to the file already
  published on `main`, so 1.16.1 changes nothing public in them. The governor looked at both posters;
  `momm-poster.jpg` carries the phonetic spelling "mom skill" and a "local preview" label from the
  film, which belongs to the owner's media pipeline (ideas register). The film is the unlinked,
  noindex preview held for the owner's listening verdict.
- Two hunks the splitter could not divide went to the governor directly: `docs/momm/evidence.html`
  and `docs/momm/releases/1.16.0.html`. Both are generated (`render-momm-site.mjs --check` passes) and
  their stated facts were checked against GitHub: `momm-1.16.0` is `cbd5570`, run 35462025593 is its
  CI matrix and run 35462410210 its signed release workflow, both successful. No defect found.

For 1.17: find out what Codex quotes (failed answers are not stored, so this needs a deliberate
diagnostic run), give Grok a budget that fits dense pieces, and keep piece boundaries from separating
the two halves of a changed line.

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
- Committed-range self-review and dispositions: done (two runs, every item ruled); the per-piece
  quorum and tool-produced receipt are waived by the owner (see "Self-review gate" above).
- Privacy and history scan of the proposed publication.
- Final-tree live image gate ([checklist](image-review-checklist.md)).
- Signed lifecycle receipts and release authorization.
- In the sealing commit, re-pin the bootstrap links in `bootstrap.md`, `upgrade-prompt.md` and the
  install page from `momm-1.16.0` to `momm-1.16.1` (the 1.16.0 tag has no "Getting the verifier"
  section), as the 1.16.0 sealing commit did.

## Website deployment boundary

The existing branch-based GitHub Pages deployment is **not proven gated on the same main
commit's safety run**. Do not describe it as such. Switching the repository Pages source to a
checked Actions deployment is a separate owner-visible publishing change; no Pages setting is
changed by this code patch. Media awaiting human listening approval must remain unlinked.
