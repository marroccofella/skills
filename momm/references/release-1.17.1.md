# MOMM 1.17.1 — release notes

**Released 4 October 2026.** The signed tag [momm-1.17.1](https://github.com/marroccofella/skills/releases/tag/momm-1.17.1)
names commit `06e8d5ad7be9748928a6e8159106bfb86afa582a`, the exact sealed candidate tree
squash-merged from pull request 44. Do not install an unsigned branch as a signed release.

The immutable signed tag retains the pre-publication notes (publication pending) and
the `version-notes` history entry that were sealed before release. This post-release
document and the live release page are the publication record; the signed payload is
not retagged or resealed merely to change its historical notes.

Release evidence: [exact-main CI, 15/15](https://github.com/marroccofella/skills/actions/runs/37215795740),
[signed checkpoint](https://github.com/marroccofella/skills/actions/runs/37216655780),
[six hosted lifecycle cells, 13/13 steps each](https://github.com/marroccofella/skills/actions/runs/37217057197),
and [stable signing and update smoke](https://github.com/marroccofella/skills/actions/runs/37217970225).
Every lifecycle cell exercised recovery from interrupted upgrades from both 1.17.0 and 1.16.1.
Fresh-clone verification validated the Git signature, Rekor entry, expected certificate claims
and sealed payload; an intentionally wrong signing identity was refused.

1.17.1 makes Copilot reviews work again on recent Copilot CLI versions and makes failures explain
themselves. It does not make every route work: a reviewer CLI that is too old for its configured model
is flagged at the next preflight, and you still have to update it. The release began as a fix for the
Copilot reviewer and carries twenty reliability improvements, each found by using 1.17.0 for real.
One writer, read-only reviewers, account logins only and automatic updates off: none of that changes.

**Reviewers that work**
- **Copilot reviews were refused on recent Copilot CLI versions** (captured on 1.0.91; 1.0.90 failed
  the same way). Those CLIs add two events to the output MOMM reads, and MOMM refused every answer as
  "unrecognized event type". Both events are now recognised; neither is ever treated as an answer, and
  a model call that does not report success is refused. If you do not use the Copilot route, or your
  Copilot CLI is older, you were not affected.
- **A fenced answer is unwrapped, not refused.** Copilot sometimes returns its answer inside one
  Markdown code fence, and sometimes writes a sentence before it. An answer that holds exactly one
  fenced block is now unwrapped and checked as strictly as before, on Copilot and Antigravity alike, by
  one shared rule; narration before or after that one block is ignored. Still refused: a second fenced
  block, any other line that starts with a fence, an unclosed fence, a tilde fence, another language
  tag, narration around a bare answer or broken JSON inside. Text beside the block that is itself JSON
  is refused too. Claude, Codex, Gemini and Grok already read such answers and are unchanged.
- **A CLI that is too old for its configured model is flagged before you spend allowance.** When a
  review ends with a CLI/model compatibility error, MOMM remembers it on this machine and the next
  `--preflight` and the next review say so, with the official update command. It makes no model call to
  find out, changes no setting, and forgets the record when the CLI or the model changes or the route
  next succeeds. The Setup Center shows "CLI update needed" on that reviewer's card, never "Sign in".

**Failures that explain themselves**
- A refusal for an unrecognised CLI event names the event (plain names only).
- When an answer is refused as not JSON, the private attempt record keeps its shape: length, whether it
  starts and ends with a fence, the parser's error position and the first 80 characters of the answer
  after redaction. The shape holds no more of the answer than that, and not the parser's message.
- When a route has failed the same way in its last three recorded runs in a project, the report says so
  and names the likely cause. A notice only; nothing is routed on it.
- A diff file passed as `--input` gets a notice that its findings cannot receive a completion receipt
  for project files, and names `--range`.
- A refused evidence location prints one plain line: what was refused, why, and what to do. A refused
  `.ensemble_reviews` also names the evidence-home alternative, quoted for the shell it is shown for.

**Updates**
- An update stops before it changes anything when a Git lock is present in the skills clone. It names
  the lock and its age, says that age does not prove a lock is stale, and tells you how to check and
  remove it yourself. MOMM never removes a lock.
- When a release changes the protocol, the updater prints a short summary (files, and the headings
  that changed in `SKILL.md`) before the full diff. `--accept-protocol` is still required.
- A Setup Center left running across an update says which version it is running and which is now
  installed, and asks you to choose Close Setup Center and start it again. If a later refresh fails
  without checking the versions again, the notice stays and says it was not checked again. Quick Setup
  no longer verifies a reviewer whose card reads "CLI update needed".

**Testing MOMM itself**
- `scripts/run-ci-suites.mjs` refuses an unknown or misspelled option, checks report storage before
  the first suite, and ends with three separate statements: suites passed, report saved, exit status.
  A report that cannot be saved at the end can be recovered to a private folder without rerunning. A
  saved report records the actual `HEAD` and whether the tree was clean beside the label you supplied.
- A versioned fixture matrix runs each reviewer adapter against the output shapes of the CLI versions
  MOMM supports, error cases included. Adding a CLI version is adding a folder.
- The source-hygiene suite fails locally on machine home paths and credential-looking literals, so the
  publish scanner is no longer the first to see them.
- The README and the site home carry one generated status line: the stable version and, when there is
  one, the candidate under test.

**If a reviewer still fails after updating**
- `invalid_output` naming an unrecognised event type: the CLI is newer than this MOMM. Report the named
  event in a GitHub issue; do not edit the list locally.
- A Codex "CLI/model compatibility" error: update the Codex CLI with
  `npm install -g @openai/codex@latest`. MOMM never changes your Codex settings.
- `quota`: an account allowance, not a login problem and not a MOMM fault. Wait for it to reset.

**Known limits.** No independent tester has run the suites on a personal macOS or Linux machine; Unix
coverage is hosted CI. Codex picture generation still loads your Codex configuration. The compatibility
record has no expiry: it clears when the CLI, the model or the outcome changes. The temp-path rule in
the hygiene suite is narrow and sees one line at a time; the shared helper is the real protection. The
other limits listed in [the 1.17.0 notes](release-1.17.0.md) stand.

Details: [plan](plan-1.17.1.md) · [gate record and findings](gates-1.17.1.md) ·
[Copilot adapter notes](cli/copilot.md)
