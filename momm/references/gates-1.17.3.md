# 1.17.3 gate record — candidate, not released

This record names no current commit: a file cannot name its own commit. The candidate under test is
the head of the 1.17.3 pull request. The published release stays 1.17.2 until the signed tag
`momm-1.17.3` exists.

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
  installer (before the triage, only for `momm/scripts/install.mjs`); onboarding's `--link` gives
  the installer 180 seconds instead of 45; a version check ended by a signal is reported as
  `failed (killed by <signal>)`.

## Release gates

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. The pack in three ways on the sealed commit (nothing set; `MOMM_EVIDENCE_HOME` inherited; `--save-report --evidence-home`), the three self-tests with the variable set and unset, a dry run of the installer on the machine where the defect was seen, and the OS by Node matrix | Run output and job logs | named in the pull request |
| 2. Lifecycle drills on the signed checkpoint, upgrading from 1.17.2 and 1.17.1 | Six hosted cells | after the merge |
| 3. MOMM range reviews of every change, with completion receipts | Receipts | recorded below when complete |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. Live review with every installed reviewer route valid | Report | see the reviews below, by route and piece |
| 6. Signed tag `momm-1.17.3` | Release workflow run | approved by the owner's instruction of 6 October 2026, if every gate above passes on the final sealed commit |

## Reviews

Gate 3 is met only when every range review of the 1.17.3 changes is listed here with a complete
receipt. One is listed. The last review, of what this one led to and of this record's entries, is
not yet listed; until it is, gate 3 is open.

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

  The real findings, in the product: for a receipt written by the repository installer the updater
  printed no `Note:` for a harness that was linked although its command did not print its version
  (the stop reason was never lost; the note now follows either installer); onboarding's `--link`
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

Owner approval. On 6 October 2026 the owner instructed that 1.17.3 be completed and released. That
instruction is the owner's approval for the signed tag, on condition that every gate passes on the
final sealed commit. If a gate does not pass, the tag is not made and the decision goes back to the
owner.

1. Gate 3 met: every range review listed under Reviews with a complete receipt.
2. Gate 1 on the sealed commit.
3. The squash merge with the sealed tree unchanged, and the matrix green on `main`.
4. The signed `main-checkpoint`, then the six lifecycle drill cells on it.
5. The signed tag, then the publication record.
