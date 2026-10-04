# 1.17 gate record — released 3 October 2026

This record separates implementation from release evidence. The signed tag `momm-1.17.0`
was published on 3 October 2026 at `5a3385468011bafabcddc719264783f23d71602e`.
The release closure below records that immutable payload; these later documentation changes do not
retag it or change its seal. Earlier candidate results and pending statements remain historical.

## Release gates (from the plan)

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. Local suites and the OS by Node matrix on the commit to tag | Job logs, not the badge | final candidate 93/93 clean independent Windows run; exact-main run 37139688330 passed 15/15; earlier 92-suite build results remain below |
| 2. Lifecycle drills, including interrupted-upgrade recovery, on the signed checkpoint | Six hosted cells with receipts | run 37140742192 passed six cells, 13/13 steps each; downloaded receipt digests and checkpoint identity verified |
| 3. Self-review of the 1.17 delta with per-piece quorum and a completion receipt | Receipt under the B4 rules | closed by three receipts over a chain of six reviews (below) |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. One live image review on the final tree, exercising A3 | Receipt | passed, receipt recorded (below) |
| 6. Signed tag `momm-1.17.0` | Release workflow run | explicit owner release instruction; stable run 37141781211 passed; fresh-clone signature, transparency, identity and payload verification passed |

## Reviews during the build

Each design change and the committed base were reviewed with MOMM as they landed; every finding was
reproduced or rejected with evidence, and each of these four reviews has a completion receipt in the
private ledger. The work packages built after the base were reviewed together at gate 3 (below):

- `rev_20260928102858_f03fd115a37c` — the plan (deep; 6 WARNINGs reproduced and fixed).
- `rev_20260929140445_1e38c2f73f4e` — guided image generation design.
- `rev_20260929165754_496b047e6898` — Grok route fixes and the ledger's generated-pictures section.
- `rev_20260929211625_0b5ba54cb0e5` — the full committed base, split in six pieces (10 real findings
  fixed; two CRITICALs and one WARNING were split-piece misreads, rejected with investigation evidence).

## Gate 3: self-review of the 1.17 delta (30 September to 1 October 2026)

Every review below was dispatched by the 1.17.0 candidate itself (deep tier, `--split auto`,
`--retry-invalid`, `--cover`; Claude as governor, so the Claude route is self-excluded). Copilot answered
HTTP 402 (account quota) through most of it; that is a status, never covered and never a re-login.
Every finding and suggestion has a ruling in the private ledger; every applied item has a test that
failed before the fix and passes after it, and every rejected finding has a recorded probe.

| Review | Scope | Quorum | Findings (real / not real) | Suggestions (applied / rejected) | Receipt |
| --- | --- | --- | --- | --- | --- |
| `rev_20260930003709_e5847282134d` | the whole delta as one diff file, 563 KB in 32 pieces | 26 of 32 pieces | 72 (23 / 49) | 129 (29 / 100) | none (below) |
| `rev_20260930032341_021063ca1c1f` | range review: governor, scorecard, setup-ui, split, style-classifier, update | 8 of 10 pieces | 31 (15 / 16) | 40 (13 / 27) | none (below) |
| `rev_20260930034635_c08cfb6df42f` | range review: the other files changed by the first triage | 5 of 5 | 5 (0 / 5) | 17 (6 / 11) | none (below) |
| `rev_20260930053535_a74ddc82ab9b` | range review: governor and scorecard, all 1.17 changes | 4 of 4 | 6 (1 / 5) | 17 (3 / 14) | recorded |
| `rev_20260930054910_0852b507489e` | range review: everything changed since the two reviews above | 3 of 3 | 10 (3 / 7) | 12 (4 / 8) | recorded |
| `rev_20261001053037_fa8acd8ebf1a` | range review: the last 93 lines of fixes | whole, 3 valid reviews | 3 (1 / 2) | 5 (0 / 5) | recorded |

Why three reviews have no receipt, and what closed the gap:

- The first review took a diff file as `--input`. Its source snapshot is that one file, so no check can
  bind the project files its findings cite, and the validator rightly refuses. It also missed quorum
  on six pieces. Its 201 rulings stand as evidence. Lesson recorded: a gate review is a `--range` review.
- The second missed quorum on one `governor.mjs` piece and one `scorecard.mjs` piece. The fourth review
  re-reviewed both files in full, with quorum on every piece, and has its receipt.
- The third met quorum, but later fixes (found by CI on hosted runners) changed files it covered, and
  the validator refuses a receipt while reviewed source has changed without a ruling. The fifth review
  covered exactly those later changes and has its receipt.

The three receipts carry `stale: governor_sha256`: the fixes changed the governor after those reviews,
which is what the stale block exists to say.

Defects this gate found and fixed, with failing-first tests:

- Five ways a code change could pass as `style`: a Rust char literal holding an escape, or a
  character outside the Basic Multilingual Plane; the opening line of a multi-line comment; a
  whitespace-only edit that creates a directive (a cgo `//export`, a Go `// +build`); and Ruby's
  `=end` matched by prefix.
- Launch containment: an absolute command path is now launched only by its real path and only when
  both the path as named and the real path lie outside the reviewed project, in the process scope, the
  probes launcher and the updater; comparisons fold case.
- `update.mjs --release-claim` could remove a claim that replaced the stale one mid-release; it now
  moves the claim aside, compares it, and can only put it back without overwriting.
- A printed Windows repair command could run text injected through an evidence path containing `&`;
  each shell's command is now quoted for that shell.
- A change of picture-input capability between the costed question and the round could attach pictures
  the user was told would not be sent; the round now uses what the question recorded.
- The stale check could report a clean result after an internal error; it now keeps every difference
  found and names the rest unknown.
- `run-ci-suites.mjs --grep` with no match reported success; `--evidence-home -v` took `-v` as the
  folder; the roster ignored check records kept in an evidence home.

Two rulings of the first review were wrong and were corrected by the second: the inline directive
claim and the Rust non-BMP suggestion were first judged harmless, then reproduced as real bypasses
and fixed. Their original rows are kept; the second review's rows are the ruling of record.

### A4.2 diagnostic result

The first review kept 70 private quotation diagnostics. Of Codex's 55 refused quotes, 31 were several
lines of one side of a diff copied without the diff's one-character line markers. 1.17 now accepts a
quote that is exactly inside one side of one hunk (old side, or new side); a quote that mixes removed
and added lines, or spans two hunks, is still refused. Attempt totals for that review: Codex 22 valid
and 38 invalid; Antigravity 26 valid, 16 invalid, 3 errors; Grok 22 valid, 3 invalid, 9 timeouts;
Copilot 32 quota.

### Hosted-runner results

The first two pushes failed on 14 of 15 jobs, each time on tests that pass on the build machine:
hosted Windows runners spell the temp folder as an 8.3 short name while MOMM prints real paths, macOS
resolves `/var` to `/private/var`, and one POSIX error reason changed. All were test defects except the
error reason, which the product now reports correctly. CI stops at the first failing suite, so each
push revealed the next one. Run 36673712090 passed 15 of 15 on the commit before the closing-review
fixes; the sealed commit's run is the one gate 1 reads.

## Live checks (disclosed quota, D6)

- **A2, 30 September 2026:** a synthetic review from the candidate (`rev_20260929232813_42d22e212a6b`)
  returned a valid `momm-peer-review/3` answer (Codex 0.157.1 in preflight, login ok, the planted defect
  found as a typed `DEFECT`), with model and effort read from the user's Codex configuration. MCP
  canary: the user's Codex configuration lists four MCP servers, three of them local processes. The
  process tree of the candidate run, sampled every 250 ms, started none of them; the same run under
  installed 1.16.1 started all three (control).

- **Capability re-probes, 1 October 2026:** the Codex review command changed in 1.17, so its 1.16.1
  evidence read `reprobe` and no route could take an image until re-probed. Synthetic image input was
  verified again for Codex 0.157.1, Antigravity 1.2.14 and Copilot 1.0.90 (each named the test colour;
  Antigravity and Copilot also quoted the planted PDF sentence). No generation was requested.
- **Gate 5, 1 October 2026:** live image review `rev_20261001054320_25255d5248c2` on the final code. One
  synthetic picture (1248 by 832, a generated test image of graffiti on a town hall) was attached to a
  four-line brief. Codex and Antigravity returned valid reviews (quorum 2 of 2, both `ACCEPT`, no
  findings). Both quoted the brief and added an observation naming the attachment by its sha256;
  Antigravity's carried a pixel region inside the image, so A3 was exercised end to end. Two
  suggestions were ruled; the receipt is recorded and is not stale.

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
- **Gate run:** run 37140742192 on the signed checkpoint of the merged 1.17 candidate; six of six cells passed (closure below).

## Required at the candidate handoff (historical)

1. The OS by Node matrix green on the sealed commit (named in pull request 31).
2. Independent reviewers test that pinned commit with the [reviewer pack](third-party-test-plan-1.17.md)
   and report in the candidate-testing discussion; every reported defect is reproduced before it is
   fixed, and any fix makes a new candidate.
3. The owner's decision to merge; the squash must carry the sealed tree unchanged.
4. The signed `main-checkpoint`, then the six lifecycle drill cells on it (gate 2), including the
   interrupted-upgrade recovery.
5. The owner's go-ahead for the signed tag `momm-1.17.0` (gate 6).

## Owner decisions

## 2 October 2026: consolidated diagnostics candidate

The owner authorised consolidation of PR31 and PR33 into one candidate, not
signing or publication. The diagnostics addition is included on top of the
original sealed tree. The new candidate's exact SHA and seal are pinned in PR31
and Discussion32; results for `511b68b` or `03ddacc` remain historical and are not
silently relabelled as results for the new candidate.

- Governor reproduced the ignored `MOMM_EVIDENCE_HOME` setting with a failing
  fixture, then fixed it using existing evidence-location and privacy checks.
- Reviewer instructions now describe saved original reports, separate reruns,
  caller-supplied commit labels, and private external storage. Roadmap wording
  no longer incorrectly declares the addition permanently unsealed.
- Review `rev_20261002114832_fd5c1def0507` lacked quorum (one invalid response);
  its evidence is retained, not counted as a completed gate.
- Review `rev_20261002115241_439ff819f9de` covered the entire diagnostics delta
  with two valid external reviews (Claude MODIFY, Antigravity ACCEPT). Its local
  completion receipt validates all decisions and final reviewed file hashes.
  A reproduced lost-console-output defect was fixed with a failing-first test.
  Non-blocking suggestions were explicitly rejected with reasons/probes.
- The validator proves local record/hash consistency, not independent execution
  or universal safety. Windows forced termination is reported as an exit rather
  than a POSIX signal; real Unix signal coverage is not claimed locally.
- Exact sealed-candidate CI and independent review are required afresh. Earlier
  green CI and the lifecycle rehearsal do not substitute for those gates.
- Signed main checkpoint, all six lifecycle cells including interrupted recovery,
  and stable signed publication remain pending owner authorisation.

D1 to D10 in the plan were delegated to the recommended options on 29 September 2026, with the instruction
to complete all outstanding items. Quota-spending runs (the Codex isolation probe, the Codex quotation
diagnostic, the self-review and the live image review) are covered by that instruction and disclosed
when run.

## 3 October 2026: reviewer-found test defect in the 59f18f9 candidate

Two independent final-candidate runs of `59f18f9` were posted in Discussion32 on
2 October 2026: Codex-Win24 (Node 24.15) 92 of 93, NOT READY; Claude-Fable-Win11
(Node 22.16) 93 of 93, then NOT READY after reproducing the failure. The failing
suite was `update-clock.test.mjs`, "production path: CLI installed versions are
read, cached, and turn into update_available", `2 !== 1`.

- Cause, two parts, both test wiring: the assertion counted Codex version reads
  with `/codex/i` over the whole executable path, so an Antigravity launcher
  below a folder named after the Codex desktop package (its redirected
  `LOCALAPPDATA`) counted as a Codex read; and `createUpdateClock` resolved the
  launcher path with `cliBinary(cli)`, which read `process.env` although the test
  had injected `env: {}`. The updater itself read each CLI once; no runtime or
  installation defect was shown.
- Reproduced before the fix on a host whose own path contains no "codex", by
  running the suite with `LOCALAPPDATA` pointed at a disposable folder named like
  `OpenAI.Codex_probe` holding an empty `agy\bin\agy.exe` (exit 1); a neutral
  folder name passed (exit 0).
- Fix: the clock passes its own `env` to `cliBinary` (production still passes
  `process.env`; the Setup Center builds its clock with the default); the count
  is by executable name. A new test builds the Codex-named local-data folder in
  its fixture, injects it as the clock's environment and checks that one read per
  CLI is counted by name and that, on Windows, the Antigravity path comes from the
  injected environment. It failed before the fix and passes after; the original
  reproduction also passes after the fix.
- The first re-pin, `e12172f` (seal 249870e5…33fe), failed its own exact-commit
  run and hosted CI on `source-hygiene.test.mjs`: this record carried a raw
  backspace byte where a Windows path was written through a tool that decodes
  escapes. The byte is replaced, the pack was run on the sealed tree before the
  next push, and `e12172f` is historical.
- The second re-pin, `6272f4b` (seal 9efd2c52…4735), passed 93 of 93 locally and on
  the hosted macOS and Linux runners but failed on every hosted Windows runner: the
  new regression compared the resolved Antigravity path with the fixture folder by
  string prefix, and the runners' temp folder is an 8.3 short path while the resolver
  returns the long real path. Reproduced locally with a short-named temp folder; the
  test now compares real paths. `6272f4b` is historical.
- This changes the tree: the `59f18f9` seal and its reviewer results are
  historical. The change needs its own MOMM review with a completion receipt, a
  new seal, exact-candidate CI and a fresh independent retest before any further
  gate.

Historical requirement satisfied by the final re-pin: `eeec034` carries the new seal
`2c3a737b20c2499684d9c2ff05df53bbe3c6629ebfaaf986d00585ba3541c49c`,
exact-candidate CI 37118795270 and the fresh independent retest linked below.
The maintainer's completion receipts are also listed in the closure. "Unchanged" below
means unchanged between this final candidate, squash merge and stable tag, not unchanged from `59f18f9`.

## Release closure — 3 October 2026

The owner explicitly instructed the release governor to finish and publish. PR31 was marked ready
and squash-merged through the normal approval path; no administrative override or alternative route
was used. The squash commit `5a3385468011bafabcddc719264783f23d71602e` has exactly candidate
`eeec0346cde66cd9a89ac215664d095b10a61566`'s tree
`f64a24fa8c76a57acfd6bc8083df4f3cceedb293`. The seal is unchanged:
`2c3a737b20c2499684d9c2ff05df53bbe3c6629ebfaaf986d00585ba3541c49c`.

- Final fix review: [PR31's record](https://github.com/marroccofella/skills/pull/31) reports completed
  range-review receipts for `rev_20261003093951_48c8c55d4d6f`,
  `rev_20261003100145_02368b57ccd7` and `rev_20261003103820_60a0810d78ff`, the last on the sealed tree.
  These are the maintainer's review records, not new reviews or independent executions by this release session.
- [Independent Codex-Win24 retest](https://github.com/marroccofella/skills/discussions/32#discussioncomment-18730095):
  fresh clean detached clone at eeec034, Windows x64, Node 24.15, original 93/93, exit 0; no defects found within that scope.
- [Exact-main CI 37139688330](https://github.com/marroccofella/skills/actions/runs/37139688330): 15/15 successful jobs.
  The release governor freshly verified the clean merged tree and seal.
- [Checkpoint workflow 37140432197](https://github.com/marroccofella/skills/actions/runs/37140432197): created
  `momm-main-5a3385468011bafabcddc719264783f23d71602e`. Local gitsign 0.17.1 verified the Git signature,
  Rekor entry and expected workflow identity, issuer, repository, ref and exact commit.
- [Lifecycle workflow 37140742192](https://github.com/marroccofella/skills/actions/runs/37140742192):
  the never-merged drills branch was advanced to the reviewed 1.17 code and checkpoint target;
  its existing helper and workflow were unchanged. All six cells passed 13/13 steps.
- [Stable workflow 37141781211](https://github.com/marroccofella/skills/actions/runs/37141781211):
  passed release checks and the genuine signed update smoke, then signed and published `momm-1.17.0`.
  The [public release](https://github.com/marroccofella/skills/releases/tag/momm-1.17.0) is neither draft
  nor prerelease, published at 2026-10-03T17:50:26Z.
- A separate fresh clone verified the annotated stable tag at the exact commit with gitsign 0.17.1:
  Git signature, Rekor entry (index 3075437977), certificate claims and sealed payload passed;
  an intentionally wrong certificate identity was refused.
- MyRepo 1.3.2's offline safety self-test, working-tree and outgoing-history scans passed before
  publication. No path/secret waiver was used; private evidence and full logs were not published.

Downloaded lifecycle receipts and their SHA-256 sidecars were checked, not just the job badges.
Every cell tested fresh signed installation, signed installs of 1.16.1 and 1.16.0, upgrade, rollback,
re-upgrade, interrupted-upgrade recovery from each old release, and tampered-payload refusal with
the installation unchanged. Recovery restored the original commit, receipt version and harness
inventory. All twelve interruptions occurred at the recorded `prepared` stage; the drill confirmed
the exact killed updater was dead and manually released only its claim before retained-updater recovery.
This is not a power-loss test or evidence for every possible interruption stage.

| Hosted OS / architecture | Node | Steps | Receipt SHA-256 |
| --- | --- | --- | --- |
| macOS arm64 | 18.20.8 | 13/13 | `dd88e0041446d7316e88bbcac2c3f835970c0792a379ea51e96d1c5df327c7a0` |
| macOS arm64 | 24.20.0 | 13/13 | `59944c7b68eab56e5ee01643457162547234cb308120602551488aa88a6b092c` |
| Linux x64 | 18.20.8 | 13/13 | `8b76ece25ae91439602a3a44bdf2b83e5ade62137ea8c3937ed977d5b7bd6a8e` |
| Linux x64 | 24.21.0 | 13/13 | `d61a9823b00f4397f1e184218c87b5780d8e4a39ee3861297331b379f17f7a31` |
| Windows x64 | 18.20.8 | 13/13 | `ba42b263b9e196570ec6bcd8c96c6732906e205d1da61bd3e835ed9ec7c1aaae` |
| Windows x64 | 24.21.0 | 13/13 | `cfa54adc9895277ce8056cc7aafc6d9b3086c24b32951e8b69794878adf11acd` |

**Coverage and reporting limits, not silently closed.** Independent final-candidate review was
Windows only. macOS/Linux evidence is from real but clean, short-lived GitHub-hosted runners;
no outside Unix reviewer or long-used personal Unix machine was tested.
[The separate Node 24.19 report](https://github.com/marroccofella/skills/discussions/32#discussioncomment-18732177)
records 93/93 suites but overall exit 1 at final saved-report replacement under OneDrive. It remains
a failed invocation. The sync/file-locking cause is unknown. A bounded governor synthetic final-rename
EPERM injection reproduced nonzero exit with incomplete final persistence, preserved the previous
original report and left complete temporary JSON separate; this was not a OneDrive reproduction.
A separate native Windows/Node 22.16 focused saved-report check passed 1/1, exit 0, not a full 93 rerun.
The [governor assessment](https://github.com/marroccofella/skills/discussions/32#discussioncomment-18734008)
classifies this as a non-blocking storage limitation: persistence and linked-entry checks fail closed,
and external private evidence storage is already supported. Better diagnostics remain deferred;
no product fix or permission bypass is claimed. Copilot CLI 1.0.91's refused event vocabulary remains a
separate follow-up and was not counted toward final review quorum.

**What this release session changed.** It performed the owner-authorized merge, signed checkpoint,
drill target/branch preparation, stable publication and fresh verification; it then updated release
metadata, documentation and generated site status. It did not author the candidate implementation
fixes, change the signed source/seal, install skills, repair another user's permissions or manufacture
an independent Unix review. Reviewer findings and maintainer fixes retain their original attribution.

The generated pages are in this repository's `docs/momm/`, including
`docs/momm/releases/1.17.0.html`. They accompany this documentation-only record;
the peer-review input covers the authored files, while deterministic renderer and site checks
cover the generated HTML. This record does not claim a separate website feature change.
