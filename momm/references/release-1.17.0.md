# MOMM 1.17.0 — release notes

**Sealed; publication pending the signed release workflow.** Until the signed tag `momm-1.17.0` is published, the current signed release
remains 1.16.1. Do not install an unsigned branch as a signed release.

1.17 keeps one writer and makes everything around it harder to fool. Reviewers stay read-only; the
governor is the only writer; account logins only; automatic updates stay off.

**Safer by default**
- On macOS and Linux, MOMM now launches a reviewer CLI or Git only from a PATH folder outside the project
  you are reviewing, as it already did on Windows. A CLI installed only inside that project is reported as
  not installed. The updater, probes and the Setup Center's helpers follow the same rule.
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
  directive or re-indenting Python is not style.
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
  upgrade on every cell and recover it.

**Known limits.** Blind picture copies keep any provider metadata inside the image file. Model identity
and attachment bytes are reported as unknown in the stale check. Grok video generation is refused while
your Grok account has zero data retention on. Codex picture generation keeps its 1.16.1 command
(`--sandbox workspace-write`, without the review's isolation), so it still loads your Codex configuration;
the new isolation covers Codex reviews and the probes that certify them.

Details: [plan](plan-1.17.md) · [gate record](gates-1.17.md) · [reviewer pack](third-party-test-plan-1.17.md) ·
[long-form notes](release-1.17-draft-notes.md)
