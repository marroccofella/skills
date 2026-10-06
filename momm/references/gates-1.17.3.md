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
receipt. None is listed yet; until they are, gate 3 is open.

## Carried forward

- The updater does not check whether a review is running from the installed copy while it updates it.
  Candidate for 1.18.
- Preflight and `--doctor` give a reviewer CLI five seconds to print its version; a slower one is
  reported as "Version check inconclusive" and not ready. It is never called not installed, but it is
  the same limit. Candidate for 1.18.
- A harness command that answers every call only after 18 to 30 seconds can exceed the updater's 180
  seconds for one harness when many skills are linked through `gemini skills link`.
- The installers start a harness by its bare name; the path they found is reported, not pinned.
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
