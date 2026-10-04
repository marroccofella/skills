# MOMM 1.17.0 — release notes

**Released 3 October 2026.** The signed tag [momm-1.17.0](https://github.com/marroccofella/skills/releases/tag/momm-1.17.0)
names commit `5a3385468011bafabcddc719264783f23d71602e`, the exact sealed candidate tree
squash-merged from PR31. Do not install an unsigned branch as a signed release.

The immutable signed tag retains the pre-publication notes (publication pending) and
the `version-notes` history entry that were sealed before release. This post-release
document and the live release page are the publication record; the signed payload is
not retagged or resealed merely to change its historical notes.

Release evidence: [exact-main CI, 15/15](https://github.com/marroccofella/skills/actions/runs/37139688330),
[signed checkpoint](https://github.com/marroccofella/skills/actions/runs/37140432197),
[six hosted lifecycle cells, 13/13 steps each](https://github.com/marroccofella/skills/actions/runs/37140742192),
and [stable signing and update smoke](https://github.com/marroccofella/skills/actions/runs/37141781211).
Every lifecycle cell exercised recovery from interrupted upgrades from both 1.16.1 and 1.16.0.
Fresh-clone verification validated the Git signature, Rekor entry, expected certificate claims
and sealed payload; an intentionally wrong signing identity was refused.

1.17 keeps one writer and makes everything around it harder to fool. Reviewers stay read-only; the
governor is the only writer; account logins only; automatic updates stay off.

**Safer by default**
- On macOS and Linux, MOMM now launches a reviewer CLI or Git only from a PATH folder outside the project
  you are reviewing, as it already did on Windows. A CLI installed only inside that project is reported as
  not installed. The updater, probes and the Setup Center's helpers follow the same rule. A command
  given as an absolute path is launched only by its real path, and only when both the path as named and
  the real path lie outside the project.
- A `.reviewrules` file that arrives with a cloned repository is ignored until you trust its exact hash.
  MOMM prints the hash and the one command to trust it. (1.16 applied it for one release with a warning.)
- Codex reviews no longer load your Codex MCP servers, global instructions or skills. Your model and
  effort are read from your Codex settings, never changed, and passed explicitly.
- Grok reviews, probes and picture generation all run isolated from your Claude Code and Cursor setup.
- Capability probes are tied to the exact command that earned them, so 1.16.1 never uses evidence it
  cannot act on.
- Optional: set `MOMM_EVIDENCE_HOME` to keep review evidence under your own profile, one folder per
  project, instead of inside the project. Useful on drives whose defaults grant other accounts access.

**Reviews that finish, and say what happened**
- Reports show real reviewer versions again: the readiness check finishes before reviews start.
- Splitting never separates removed lines from the lines that replace them; with Grok reviewing, pieces
  are capped at 20 KB, and Grok's output streams, so a timeout still records what arrived.
- When a reviewer’s quotation fails the exact-text rule, the private attempt record keeps a short
  diagnostic (the failing quote’s hash, length and first 80 characters after redaction).
- A quotation that is exactly inside one side of one diff hunk now counts when it is copied without the
  diff's line markers; a quote that mixes removed and added lines, or spans two hunks, is still refused.
- In an image review, reviewers may cite what they saw by the attachment's hash and a pixel region.
- Findings may carry a claim type (`DEFECT`, `RISK`, `QUESTION`, `IDEA`, `NOISE`). Severity still decides
  what needs reproduction.
- `--cover` lets another requested route cover a reviewer role that failed, never after a login or
  allowance failure, with at most two attempts per piece and role, and never a double vote.
- `--second-look` asks one other route to confirm or refute one disputed claim; the original report is
  never changed.
- Reviewer roles are versioned files with a review date; the adversary role carries a short loophole
  checklist.

**A stricter completion check**
- A decision marked "style" is checked against the actual bytes: commenting out code, editing a tool
  directive or re-indenting Python is not style. A gate review of 1.17 itself found and closed five
  ways code could pass as style (see the gate record).
- An optional mutation record shows a test fails when its fix is reverted.
- The completion validator says when a review is stale because MOMM, its contract or your guidance
  changed since.
- The scorecard adds a roster per route and role, labelled as your project's own decisions.

**Pictures**
- `generation-rounds.mjs` asks every image-capable route for a picture, asks you before each round with
  its cost, sends your words unchanged, has the governor critique the pictures blind against a checklist
  you confirmed, and shows everything in a private local gallery. The ledger now shows generated pictures.
- Grok image generation works: MOMM grants exactly the image tool headless Grok needs.

**Updates and recovery**
- If an update is interrupted, the refusal message prints the exact command to release the stale claim
  (`update.mjs --release-claim <token>`) before `--rollback --yes`. The lifecycle drills now interrupt an
  upgrade on every cell and recover it. Releasing a claim can never remove a newer claim that replaced
  it meanwhile.
- When an evidence folder cannot be verified, the printed repair command is quoted for the shell it
  names (PowerShell or cmd.exe) and includes your evidence home when one is set.

**Known limits.** Blind picture copies keep any provider metadata inside the image file. Model identity
and attachment bytes are reported as unknown in the stale check. Grok video generation is refused while
your Grok account has zero data retention on. Codex picture generation keeps its 1.16.1 command
(`--sandbox workspace-write`, without the review's `--ignore-user-config --ignore-rules`), so it still loads
your Codex configuration; the new isolation covers Codex reviews and the probes that certify them.
A project at a drive or filesystem root cannot complete a review receipt (the check refuses, safely).
If the privacy check fails after picture makers have answered, that generation must be started again.
On a volume without hard links (FAT, exFAT) releasing a stale update claim uses an exclusive copy; that
path is unit-tested but was not run on such a volume. A gate review should be a `--range` review: a
review of a diff file given as `--input` cannot receive a completion receipt for findings that cite
project files.

**Testing and saved-evidence limits.** Independent final-candidate retesting was native Windows;
macOS/Linux suite and lifecycle evidence comes from GitHub-hosted runners, not an outside Unix reviewer
or a long-used personal Unix machine. No independent Unix review is claimed.
[A separate Windows/Node24.19 original run](https://github.com/marroccofella/skills/discussions/32#discussioncomment-18732177)
passed all 93 suites but exited 1 at final saved-report replacement in a OneDrive-synchronized workspace.
That invocation remains a failed process-level run; it is not relabelled as exit 0. Its sync/file-locking
cause is unproven. Report saving fails closed, and linked/non-private evidence storage remains refused.
Use the existing external private `MOMM_EVIDENCE_HOME` option rather than weakening privacy checks;
keep incomplete persistence separate from suite totals. Better persistence diagnostics remain follow-up
work, not a fix in this signed tag. Copilot CLI 1.0.91 can emit an event outside the adapter's closed
vocabulary and be refused as `invalid_output`; it was not counted toward the final 3 October reviews.

Details: [plan](plan-1.17.md) · [gate record](gates-1.17.md) · [reviewer pack](third-party-test-plan-1.17.md) ·
[long-form notes](release-1.17-draft-notes.md)
