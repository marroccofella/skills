# MOMM 1.16.1 — release notes

**Released 28 September 2026** as the signed tag `momm-1.16.1` (commit `c381c95`, release workflow run
36362233567: signature, Rekor entry and certificate claims validated; CI matrix run 36360716500).

The patch strengthens existing review and update behavior: content-based media checks, explicit
capability expiry, separate retry evidence, failed-work accounting, tool-produced verification
records and active-installation conflict reporting. Reviewers remain read-only; the governor
is the only writer. Account logins remain required. Automatic updates remain off.

Media identification checks bounded container structure, not decoded perceptual correctness,
malware safety or every possible encoding. Unsupported/unbounded containers fail closed.
Successful probes expire after seven days; an expired cell stays blocked until a deliberate
re-probe. Success on one modality does not prove another.
Unknown usage/cost is not zero. Matching evidence hashes do not prove the adequacy of a test.

The existing installation inventory, dirty-clone guidance, effectiveness scorecard and optional
training export are retained. Scorecards reflect governor rulings, not objective model quality.
Private evidence and project content are not published automatically. Rolling back from 1.16.1 to an
earlier release completes its installation check (the inventory helper is kept with the recovery copy).

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
account has it: 194 to 308 s in three measured runs, inside its 360 s budget. A Codex "model is not supported" failure now
says to update the Codex CLI rather than change the model it shares with the Codex desktop app, and
Codex no longer reads the reviewed project's `AGENTS.md` or runs your hooks, plugins, apps or
multi-agent tools during a review; its model, effort and MCP servers stay as you set them. A failed
route never stores what MOMM sent it. A reviewer's quotation of the reviewed text now counts when it
differs only by typographic look-alikes (curly or straight quotes, dash variants, non-breaking
spaces) or whitespace, which models often retype; any other changed character is still refused.

A reviewed project can no longer choose the executable MOMM runs on Windows, or the Git that
verifies a committed range on any platform. **Known limitation:** on macOS and Linux, reviewer CLIs
are still found through PATH, so a PATH folder inside the reviewed project could supply one.
Review untrusted projects from a shell whose PATH contains no folder inside them; the fix is due in 1.17.

Verified before sealing (details in [the gate record](gates-1.16.1.md)): every offline CI job on the
candidate; an independent bounded review with no candidate defect found; two full-range self-reviews
with every finding ruled (the completion receipt was waived by the owner); and the live image review,
where the review team caught the planted error and passed the correct image, though not every route
caught it every time. Signed install, upgrade and rollback drills on Windows, macOS and Linux run
against the signed checkpoint before publication.

Broader workflow checkpoints, managed paid reviewers, new installation-management interfaces,
website films and new modalities are not quietly included in this reliability patch.
