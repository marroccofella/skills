# 1.17.3 gate record — released 6 October 2026

The signed tag `momm-1.17.3` was published on 6 October 2026 at
`507e5f778110755be91eebc03ef4309538414857`. The release closure at the end records that immutable
payload; these later documentation changes do not retag it or change its seal. Statements below that
say "after the merge" or "still required" are kept as the candidate's history; the closure says what
happened.

## Why this release exists

On 6 October 2026 the owner accepted the protocol change and asked for 1.17.2 to be installed on the
maintainer's machine, which was on 1.17.1. The update stopped twice. The cause is in MOMM's installer
and can stop the update of anyone whose install receipt lists a harness that is slow to start. The
owner instructed the same day that the fix be completed and released as 1.17.3.

## The finding

- **Seen.** `update.mjs --apply --yes --accept-protocol --version 1.17.2` stopped with `Harness replay
  did not verify momm for gemini`, then `Automatic recovery incomplete` with the same reason, and
  printed the retained recovery command. The checkout was back on 1.17.1 and working; a transaction
  record was left and every later update was refused until the retained rollback had been run.
- **Cause.** The updater runs the installer once for each harness scope in the receipt. The installer's
  `commandExists` ran `<command> --version` with a fixed five-second limit and treated a timeout as
  absence. `gemini --version` took 7.4, 7.7 and 5.9 seconds in three consecutive timed runs on that
  machine, which was busy with other sessions, and 5.5 seconds in a fourth, later run. The installer
  therefore printed `gemini command not installed` for a command that is installed and on PATH; a dry
  run of the installer showed exactly that row.
- **How the update was completed.** With no review running from the installed copy, and with the
  Gemini CLI's own relaunch switched off for that one command (`GEMINI_CLI_NO_RELAUNCH=true`), the
  third attempt verified. With the relaunch switched off, `gemini --version` took 4.8, 4.3 and 4.5
  seconds in three timed runs and 3.8 seconds in each of two later ones: inside the five-second limit
  every time. Nothing in MOMM, the receipt, permissions or system settings was changed. That is a
  workaround for one machine, not a fix.
- **Who was affected.** Anyone updating with a receipt that lists a harness whose command takes more
  than five seconds to print its version. Reviews were not affected. The same update had worked on
  4 October, when the command answered in time, so the defect shows only on a slow start.
- **A mistake made while finding it.** Two of the attempts ran while another session had a review
  running from the same installed copy; the files under it were switched and restored. The updater
  does not check for that. It is listed below as carried forward.

## The fix

- Both installers decide that a harness command exists by finding it on PATH with the updater's own
  rule for tools (an absolute PATH entry, its real path checked, nothing from inside the clone), with
  the `.cmd` and `.bat` shims that npm writes counted on Windows for harness commands only.
- `--version` is still asked once, with a limit of 30 seconds. The result is one of four: present;
  absent (not on PATH), skipped and nothing created; found but silent, counted as installed and said
  so; found but failing, not linked and said so.
- What follows for a command that is found but silent depends on how its harness is linked. Claude
  Code and Antigravity get the folder links the installer makes itself. Gemini is linked through its
  own `gemini skills link`, so after a silent version check that command is still run. If a link
  command is silent too, its row is an error that names the command, that skill is not linked, the
  command is not started again for the remaining skills, and an update stops. The outcomes are in one
  table in [updating.md](updating.md).
- The updater's stop message carries the installer's reason. The refusal, the automatic recovery and
  the retained recovery command are unchanged.
- Added in the triage of the gate review: the updater's `Note:` line for a harness that was linked
  although its command did not print its version is printed for receipts written by either
  installer (before the triage, only for the skill installer, `momm/scripts/install.mjs`);
  onboarding's `--link` gives the installer 180 seconds instead of 45; a version check ended by a
  signal is reported as `failed (killed by <signal>)`.

## Release gates

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. The pack in three ways on the sealed commit (nothing set; `MOMM_EVIDENCE_HOME` inherited; `--save-report --evidence-home`), the three self-tests with the variable set and unset, a dry run of the installer on the machine where the defect was seen, and the OS by Node matrix | Run output and job logs | passed: 98 of 98 in each of the three ways on the sealed commit (Windows, Node 22.16), the evidence home left empty or holding only the runner's own run; the three self-tests passed both ways; a dry run of each installer reported the Gemini command as present (the CLI answered in about four seconds, so the dry run did not meet the slow case, which the suites run with stand-in commands); matrix run 37476338674 passed 15/15 on the sealed commit and run 37485923734 passed 15/15 on `main` |
| 2. Lifecycle drills on the signed checkpoint, upgrading from 1.17.2 and 1.17.1 | Six hosted cells | passed: run 37489577070, six cells, 13/13 steps each, on the signed checkpoint of the merged commit |
| 3. MOMM range reviews of every change, with completion receipts | Receipts | two reviews, each with a complete receipt: see Reviews, which also says what was not reviewed |
| 4. Privacy and history scan before every push | Scanner exit 0 | passed: exit 0, working tree and history clean, before each push of the release branch and of the drills branch |
| 5. Live review with every installed reviewer route valid | Report | see the reviews below, by route and piece |
| 6. Signed tag `momm-1.17.3` | Release workflow run | passed: approved by the owner's instruction of 6 October 2026, if every gate above passes on the final sealed commit; they did, and stable run 37491690164 passed; fresh-clone signature, transparency, identity and payload verification passed |

## Reviews

Gate 3 is met only when every range review of the 1.17.3 changes is listed here with a complete
receipt. Listed: the review of the fix and the release changes, and one last review of the changes
that review led to and of the entries this record had gained by then.

- `rev_20261006114459_9a78d7989ef2` — the fix and the release changes (seven pieces). Quorum is two
  valid reviews of a piece, and it was met on all seven. By piece:
  - Pieces 1, 2, 4, 5 and 7: four valid reviews each, one from each route (Codex, Antigravity,
    Copilot, Grok).
  - Piece 3, which holds the skill installer, the updater and the installer's completion suite: two
    valid reviews, from Codex and Copilot. Antigravity's attempt ended with a provider error (503)
    and Grok's timed out.
  - Piece 6, one of three pieces of the updater's suite: three valid reviews, from Codex, Copilot
    and Grok. Antigravity's attempt timed out.
  - Two of the valid reviews were accepted on a retry, after the first answer was refused because
    a quote did not match the diff: Copilot's of piece 2 and Grok's of piece 6.
  - Three cover reviews were run in the roles left empty (Codex for Antigravity on pieces 3 and 6,
    Copilot for Grok on piece 3). A cover review does not count towards quorum; its findings were
    ruled like any other.

  Verdicts by route: Antigravity ACCEPT, which rests on pieces 1, 2, 4, 5 and 7; Codex and Copilot
  MODIFY; Grok MODIFY, which rests on every piece but 3. 15 WARNING and 8 NITPICK: ten real and
  fixed, thirteen shown not to hold. 61 suggestions ruled, nine applied. Receipt complete.

  The real findings, in the product: for a receipt
  written by the repository installer (the root `install.mjs`) the updater printed no `Note:` for a
  harness that was linked although its command did not print its version (the stop reason was
  never lost; the note now follows either installer); onboarding's `--link`
  gave the installer 45 seconds, less than two silent calls of 30, so a Gemini CLI that answered
  nothing was cut off with only "treated as installed" (it now has 180 seconds and ends with the
  whole reason); and the installers' own comment said a silent command "is linked" without the
  condition for Gemini. In the records: `updating.md` and `harness-compatibility.md` said the same
  for every harness (they now give Gemini apart, `updating.md` in a table), and "six to eight
  seconds" left out two of the four measured runs. In the tests: a variable for the time limit
  spelt in another case on Windows reached the child; the seven-second test could pass for an
  installer that never started Gemini's link command, on the other installer's log; the PATH
  lookup test could not tell a relative or empty entry from an absolute one; the check of the
  updater's time allowance read the wrong number; and the fixture's `git tag` could start a
  signing program on a machine set to sign tags.

  Not real: two claims that the bootstrap links name 1.17.3 before its tag (every release is
  sealed that way); one about the catalogue entry's link to the branch, which is how a candidate
  is listed and is set to the pull request before the seal; one that the release notes were
  missing from the range, made from one piece of it; and nine about the code and tests, each
  answered by running the code. Among those: the tests for the silent, absent and failing cases
  are in the updater's suite, which that reviewer's piece did not hold; the lower time bounds
  cannot fail on a slow machine; the lookup is never called without a command name.
- `rev_20261006133939_a3494fcde4c4` — the last review: what the review above led to in the
  installers, the updater, onboarding, the two suites and the records, and this record's entries
  up to then (five pieces). Quorum was met on all five. By piece:
  - Piece 2 (this record, the notes, `updating.md`) and piece 3 (the skill installer, the updater,
    onboarding, the installer's completion suite, two records): four valid reviews each, one from
    each route. Copilot's review of piece 2 was accepted on a retry, after its first answer was
    refused because a quote did not match the diff.
  - Piece 1 (the repository installer and the manifest): three valid reviews, from Codex and
    Copilot at the first attempt and from Grok on a retry after the same kind of refusal.
    Antigravity's attempt ended with an error and no review.
  - Piece 4 (the first part of the updater's suite): three valid reviews, from Codex, Antigravity
    and Copilot. Grok gave no valid review of piece 4: its answer was refused on both attempts
    because a quote did not match the diff.
  - Piece 5 (the rest of the updater's suite): two valid reviews, from Codex and Copilot.
    Antigravity's attempt ended with a provider error (503) and Grok's timed out.
  - Cover reviews, which do not count towards quorum: Codex for Antigravity on pieces 1 and 5,
    both valid; Copilot for Grok on piece 5, refused because a quote did not match the diff.

  Verdicts by route: Codex ACCEPT; Antigravity ACCEPT, which rests on pieces 2, 3 and 4; Copilot
  MODIFY; Grok MODIFY, which rests on pieces 1, 2 and 3. 4 WARNING and 5 NITPICK: two real and
  fixed, seven shown not to hold. 28 suggestions ruled, five applied. Receipt complete.

  Fixed, all in the records: this record now names each installer with its file where it says
  which one lacked the `Note:` line (the two sentences agreed, but a reviewer read "the repository
  installer" as the other file); the Known limits paragraph of the notes is wrapped again;
  `updating.md` says that the updater repeats the installer's remark only when the harness was
  linked all the same; and the last row of its table gives success and silence in sentences of
  their own. Not real: that the manifest contradicts itself, and that it contradicts the
  installer's comment, about an update that stops (a command that is slow to start and a link
  command that never answers are two cases, the code treats them as two, and committed tests run
  both); that onboarding's 180 seconds can be exceeded at the largest limit a caller can set (two
  limits of 60 seconds and 30 for the rest are inside it); that the updater could replace a
  command reported on a link row (no installer reports one there); that the suite's stand-in could
  write into the real home folder (every child gets the fixture's home, and `os.homedir()` follows
  it); and two questions about helpers defined outside the piece a reviewer saw.

Nothing was reviewed after the last review. What changed after it: the four changes it asked for,
listed just above, which are in this record, the notes and `updating.md`; and in this record its
own entry, the opening of this section and the status of gate 3. No product source and no test
changed after the last review. A record cannot carry the review of its own last lines; they are
for the reader to check against the receipts. Each receipt was recorded on the tree that held that
review's own changes; the first binds files that were edited afterwards as described here.

The middle of the fix had fewer reviews than its edges. The skill installer and the updater were
in piece 3 of the first review, which two routes reviewed (Codex and Copilot) with two cover
reviews beside them; the last review, where all four routes reviewed that piece, saw those files
only as the first review's changes to them.

## Carried forward

- The updater does not check whether a review is running from the installed copy while it updates it.
  Candidate for 1.18.
- Preflight and `--doctor` give a reviewer CLI five seconds to print its version; a slower one is
  reported as "Version check inconclusive" and not ready. It is never called not installed, but it is
  the same limit. Candidate for 1.18.
- A harness command that answers every call only after 18 to 30 seconds can exceed the updater's 180
  seconds for one harness when many skills are linked through `gemini skills link`. Onboarding's
  `--link` has the same 180 seconds.
- The installers start a harness by its bare name; the path they found is reported, not pinned. The
  two differ only when a folder inside the clone is ahead on PATH and holds a command of the same
  name.
- On Windows a harness command that is stopped at the limit can leave a child of its own running.

## Still required before the tag

Historical: this section is what the sealed candidate still needed. All five steps were then done; see
the release closure below.

Owner approval. On 6 October 2026 the owner instructed that 1.17.3 be completed and released. That
instruction is the owner's approval for the signed tag, on condition that every gate passes on the
final sealed commit. If a gate does not pass, the tag is not made and the decision goes back to the
owner.

1. Gate 3 met: every range review listed under Reviews with a complete receipt.
2. Gate 1 on the sealed commit.
3. The squash merge with the sealed tree unchanged, and the matrix green on `main`.
4. The signed `main-checkpoint`, then the six lifecycle drill cells on it.
5. The signed tag, then the publication record.

## Release closure — 6 October 2026

The owner instructed the release governor to complete and release 1.17.3. Pull request 51 was marked
ready and squash-merged through the normal path; no administrative override or alternative route was
used. The squash commit `507e5f778110755be91eebc03ef4309538414857` has exactly the tree of candidate
`f6c4ee38ab5660570632b913043b7fca6f1cc48d`. Both commits have the tree
`bf5525502e56e58d816c792907ad6b3add95d3ed`. The seal is unchanged:
`293f121275c6b4d39dd1665e09450cf96bb4921e35a083ec3405e3a12dcf89ab`.

- Sealed candidate, on Windows, Node 22.16: the pack passed 98 of 98 with nothing set (under an 8.3
  short temp path), 98 of 98 with `MOMM_EVIDENCE_HOME` inherited (the home was empty afterwards), and
  98 of 98 with `--save-report --evidence-home` (the home held only the runner's own run). The
  dispatcher, Setup Center and ledger self-tests passed with the variable unset and set. A fresh clone
  of the pushed branch passed the seal check; the pack was not run again in that clone. The hosted
  matrix on the sealed commit:
  [run 37476338674](https://github.com/marroccofella/skills/actions/runs/37476338674), 15/15: the fourteen matrix cells and the
  `site-and-ledger` job.
- The installer on the machine where the defect was seen: a dry run of each installer for Gemini, from
  the sealed tree, reported the command as present. The Gemini CLI answered in about four seconds in
  those two runs, so they did not meet the slow case. The slow and the silent cases are run by the
  suites, with stand-in commands.
- Exact-main CI: the same matrix on `main`,
  [run 37485923734](https://github.com/marroccofella/skills/actions/runs/37485923734), 15/15 on
  `507e5f778110755be91eebc03ef4309538414857`. It is the run the catalogue entry names as
  `matrix_run`, as for 1.17.2 and 1.17.1. The hosted runs of this matrix, on the branch and on
  `main`, are the only place the new code paths ran on macOS and Linux.
- Signed checkpoint: [run 37488121871](https://github.com/marroccofella/skills/actions/runs/37488121871); tag
  `momm-main-507e5f778110755be91eebc03ef4309538414857`.
- Lifecycle drills: [run 37489577070](https://github.com/marroccofella/skills/actions/runs/37489577070) on that checkpoint;
  six hosted cells (Windows, macOS and Linux, Node 18 and 24), 13/13 steps each: fresh signed install,
  signed installs of 1.17.2 and 1.17.1, upgrade, rollback, re-upgrade and recovery from an interrupted
  upgrade from each, and refusal of a damaged payload.
- Signed stable release: [run 37491690164](https://github.com/marroccofella/skills/actions/runs/37491690164), published
  2026-10-06T16:00:00Z. The updater smoke on the genuine signature (preview and apply) passed in that run.
- Fresh-clone verification of the tag: `gitsign verify-tag` with the expected workflow identity
  validated the Git signature, the Rekor entry and the certificate claims; the same command with
  another repository's identity was refused; `scripts/momm-release.mjs --check` passed on the tag's
  checkout; the live `versions.json` on `main` names 1.17.3 with this seal.

What this release did not have. No report from an independent tester of the sealed candidate was on
pull request 51 or in Discussion 32 when both were read just after the tag was made; the sealed
candidate had been public for under two hours when the tag was made (from 14:07 to 15:59 UTC).
The whole pack in the three ways was run on Windows only; on macOS and Linux the evidence is the
hosted matrix. The drills are GitHub-hosted runners, not the owner's machines, and no drill meets a
slow harness command. The update that failed on 6 October
was not repeated from 1.17.2 to 1.17.3 on the maintainer's machine before the tag; that install
follows the release and needs the owner's acceptance. The skill installer and the updater had two
valid reviews of the fix itself, as the Reviews section says.

This publication record was reviewed once, as the range from the released commit to the record
(`rev_20261006160312_1a7d2739fcd0`): four valid reviews, one from each route (Codex, Antigravity,
Copilot, Grok), each at the first attempt. Codex, Antigravity and Grok ACCEPT; Copilot MODIFY. One
WARNING: that the catalogue names the wrong run as `matrix_run`. The field is right, and the
wording of this closure that led to the reading is changed. Six suggestions ruled, two applied.
Receipt complete. What that review led to, and this paragraph, were not reviewed.
