# MOMM 1.16.1 — draft notes, not released

**Current signed release remains 1.16.0.** This draft is not an upgrade instruction or release seal.

The patch strengthens existing review and update behavior: content-based media checks, explicit
capability expiry, separate retry evidence, failed-work accounting, tool-produced verification
records and active-installation conflict reporting. Reviewers remain read-only; the governor
is the only writer. Account logins remain required. Automatic updates remain off.

Media identification checks bounded container structure, not decoded perceptual correctness,
malware safety or every possible encoding. Unsupported/unbounded containers fail closed.
Expired probes require a deliberate re-probe; success on one modality does not prove another.
Unknown usage/cost is not zero. Matching evidence hashes do not prove the adequacy of a test.

The existing installation inventory, dirty-clone guidance, effectiveness scorecard and optional
training export are retained. Scorecards reflect governor rulings, not objective model quality.
Private evidence and project content are not published automatically.

The scope-audit follow-up clears stale update success after a failure and verifies
training-export destinations with the native privacy checker, on Windows as well
as POSIX. A new dedicated destination can be created privately; an existing unsafe
directory or companion file is refused, even with `--force`. Existing permissions
are not changed. The current [acceptance guide](third-party-test-plan-1.16.1.md)
adds the missing retry and ledger-ticket steps.

Reviewer routes: MOMM now tells you when a reviewer CLI is behind its latest release, after preflight
and at the end of a review, with its update command, an off-by-default automatic option and the Setup
Center for guidance. Grok runs isolated from your Claude Code and Cursor setup (no imported
instructions, skills, MCP servers or memory; every tool denied) and uses its faster serving when your
account has it, so reviews finish instead of timing out. A Codex "model is not supported" failure now
says to update the Codex CLI rather than change the model it shares with the Codex desktop app. A failed
route never stores what MOMM sent it.

A reviewed project can no longer choose the executable MOMM runs on Windows, or the Git that
verifies a committed range on any platform. **Known limitation:** on macOS and Linux, reviewer CLIs
are still found through PATH, so a PATH folder inside the reviewed project could supply one.
Review untrusted projects from a shell whose PATH contains no folder inside them; the fix is due in 1.17.

Final native lifecycle, live image, candidate CI, peer dispositions and publication gates remain
open. See [the gate record](gates-1.16.1.md). Do not install an unsigned branch as a signed release.

Broader workflow checkpoints, managed paid reviewers, new installation-management interfaces,
website films and new modalities are not quietly included in this reliability patch.
