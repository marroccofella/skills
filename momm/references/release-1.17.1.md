# MOMM 1.17.1 — release notes

**Sealed; publication pending the signed release workflow.** Until the signed tag `momm-1.17.1` is
published, the current signed release remains 1.17.0. Do not install an unsigned branch as a signed release.

1.17.1 is a patch release with one purpose: the Copilot reviewer works again on Copilot CLI versions
that emit two new events (captured on 1.0.91; 1.0.90 failed the same way). If you do not use the
Copilot route, or your Copilot CLI is older, you are not affected.
Nothing else about reviews, roles, evidence or updates changes.

**Fixed**
- **Copilot reviews were refused on recent Copilot CLI versions.** They add two
  events to the output MOMM reads (`session.warning` and `model.call_final_result`). MOMM accepts only
  a known list of events, so 1.17.0 refused every Copilot answer with "unrecognized event type" and the
  Copilot reviewer was unusable. MOMM now recognises both. Neither is ever treated as an answer, and a
  model call that does not report success is refused.
- **A fenced answer is unwrapped, not refused.** Copilot sometimes returns its whole answer inside one
  Markdown code fence. Every other route already copes with that; the Copilot route refused it as "not
  strict JSON". An answer that is exactly one fenced block is now unwrapped and checked as strictly as
  before. Prose beside the fence, a second block or broken JSON inside is still refused.
- **The refusal now says what it did not recognise.** When a reviewer CLI adds an event in future, the
  message names up to three unrecognised event types (plain names only), so the cause is visible at once.

**If a reviewer still fails after updating**
- `invalid_output` naming an unrecognised event type: the CLI is newer than this MOMM. Report the named
  event in a GitHub issue; do not edit the list locally.
- A Codex "CLI/model compatibility" error: your Codex settings name a model your Codex CLI is too old
  for. Update the CLI with `npm install -g @openai/codex@latest`. MOMM never changes your Codex settings.
- `quota`: an account allowance, not a login problem and not a MOMM fault. Wait for it to reset.

**Known limits.** Unchanged from 1.17.0, see [the 1.17.0 notes](release-1.17.0.md): saved suite reports
can fail to finish in a synchronised folder, no independent tester has run the suites on a personal
macOS or Linux machine, and Codex picture generation still loads your Codex configuration. One more,
found while installing 1.17.0: a leftover `.git/index.lock` in the skills clone stops an update; the
updater rolls back cleanly, and removing the stale lock lets the update run.

Details: [gate record and findings](gates-1.17.1.md) · [Copilot adapter notes](cli/copilot.md)
