# MOMM 1.17.3 — release notes

**Sealed; publication pending the signed release workflow.** Until the signed tag `momm-1.17.3` is
published, the current signed release remains 1.17.2. Do not install an unsigned branch as a signed release.

1.17.3 is a patch for updating MOMM. Nothing changes in how a review runs. One writer, read-only
reviewers, account logins only and automatic updates off: none of that changes.

**What was wrong**
- On 6 October 2026 an update from 1.17.1 to 1.17.2 on the maintainer's Windows machine stopped twice
  with `Harness replay did not verify momm for gemini`, and its automatic recovery reported
  `Automatic recovery incomplete`.
- After the checkout the updater runs the installer for each harness in the install receipt. The
  installer decided whether a harness command exists by running `<command> --version` with a
  five-second limit, and treated any failure, a timeout included, as "not installed".
- The Gemini CLI was installed and on PATH, but took between 5.5 and 7.7 seconds to print its version
  in four timed runs, while other sessions were busy on the machine. So the installer reported
  `gemini command not installed`, which was false, the updater saw no verified link for a harness its
  receipt lists, and refused. The recovery replays the same harnesses and stopped the same way.
- The retained rollback command, run by hand, worked whenever the command happened to answer in time.
  The same update had worked two days earlier, when it did.

Anyone whose receipt lists a harness whose command takes more than five seconds to print its version
could be stopped this way. Reviews themselves were not affected.

**What changes**
- The installer finds a harness command on PATH instead of timing it. This holds for `gemini`,
  `claude` and `agy` alike, in both copies of the installer.
- `--version` is still asked once, with a limit of 30 seconds. A command that is found but gives no
  answer in that time still counts as installed, and the installer says that it did not answer. Claude
  Code and Antigravity are then linked by their folder links. Gemini is linked by its own
  `gemini skills link`: if that command gives no answer within 30 seconds either, the skill is not
  linked, the installer names the command and does not start it again, and an update stops.
- A command that is not on PATH is skipped as before, and nothing is created for it. A command that is
  found but whose `--version` reports a failure is not linked, as before, and the installer says what
  failed. The words "not installed" are gone.
- When a harness cannot be verified, the updater gives the installer's own reason after `Harness
  replay did not verify`, and after `Installer replay failed` when the installer itself reported a
  failure. It still stops, still claims nothing it could not verify, and still leaves the recovery
  command. When a harness was linked although its command did not print its version, the updater
  says so in a line that begins `Note:`.
- A version check that is ended by a signal is reported as `failed (killed by <signal>)`.
- Onboarding's `--link` gives the installer 180 seconds instead of 45, so a harness command that
  answers nothing ends with the installer's whole reason and not with a stopped installer.
- `updating.md` has a section on what those messages mean, with a table of the outcomes and what to
  check.

**Updating to 1.17.3 from 1.17.2 or earlier**
The updater that runs is the installed one, but it replays the installer of the release it has checked
out, so the installer fix applies during this update. Its messages are still the old ones. If this
update stops for another reason, the automatic recovery replays the older installer and can stop the
old way: run the retained rollback command again when the machine is less busy. The retained recovery
copy stays the older updater until the update after this one.

**Known limits.** A harness command that answers every call, but only after 18 to 30 seconds each,
can still exceed the updater's 180 seconds for one harness when many skills are linked through
`gemini skills link`; onboarding's `--link` has the same 180 seconds. Preflight and `--doctor` still
give a reviewer CLI five seconds to print its version; a slower one is reported as "Version check
inconclusive" and not ready, never as not installed. The updater does not check whether a review is
running from the installed copy while it updates it: do not update while one is. The new code paths
for macOS and Linux were first run on the hosted matrix; the whole pack was run by the maintainer's
harness on Windows only. The limits listed in [the 1.17.2 notes](release-1.17.2.md) stand.

Details: [gate record and finding](gates-1.17.3.md) · [updating](updating.md)
