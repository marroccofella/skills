# 1.17.1 gate record — candidate, not released

This record names no current commit: a file cannot name its own commit. The candidate under test is
the head of the 1.17.1 pull request. The published release stays 1.17.0 until the signed tag
`momm-1.17.1` exists.

## Why a patch release

One day after 1.17.0, Copilot reviews were being refused. The cause is in MOMM, it affects users whose
Copilot CLI emits the two events described below (seen on 1.0.91; 1.0.90 failed the same way), and
nothing a user can configure works around it. That is the test for a patch: a reviewer route lost to a
CLI update the user is encouraged to install.

## Findings

### 1. Copilot reviews refused on Copilot CLI 1.0.90 and 1.0.91 (fixed here)

- **Seen three times.** 1 October 2026, CLI 1.0.90: `invalid_output` in the last closing review of
  1.17.0 (`rev_20261001053037_fa8acd8ebf1a`), where Copilot was not needed for quorum and the status
  was recorded without being investigated. 4 October 2026, CLI 1.0.91: `invalid_output` in two
  independent reviews on the installed 1.17.0, one governed by Claude
  (`rev_20261004055754_0903db0f1ef5`) and one by Codex. Each time the detail was
  "Copilot machine output refused: unrecognized event type".
- **Cause.** `copilotReviewPayload` accepts a closed list of event types, on purpose: a new event may
  be a new kind of failure. A synthetic capture with MOMM's own flags on 4 October 2026 (one request,
  no project content) showed two types missing from the list: one leading `session.warning`
  (`warningType: "policy"`, a notice that the organisation disables third-party MCP servers) and one
  `model.call_final_result` after each model call (`model`, `isByok`, `result: "success"`).
- **Who is affected.** Users whose Copilot CLI emits either event. `model.call_final_result` was captured
  on 1.0.91; 1.0.90 failed with the same refusal on 1 October but its events were not captured.
  `session.warning` depends on the account's policy. Users on an older CLI, or who do not use the
  Copilot route, are not affected.
- **Fix.** Both types are recognised as bookkeeping and never as an answer; a model call whose result
  is not `"success"` is refused as `invalid_output`; the list stays closed. The refusal names up to
  three unrecognised types, plain lower-case names only; any other name is counted and never echoed.
- **Evidence.** `copilot-transport.test.mjs` passed 22 of 25 checks on the 1.17.0 code and 25 of 25
  with the event change; with the review's test suggestions and the fence change it has 29 checks, all
  passing (the fence check failed first with the production error). A live review of a synthetic diff with the patched dispatcher returned valid reviews
  from Copilot, Codex, Antigravity and Grok, all four finding the planted defect.
- **A second cause, found by reviewing the first fix.** MOMM reviewed the event fix with the patched
  dispatcher (`rev_20261004062357_5e1763ad52ff`). Codex, Antigravity and Grok accepted it with no
  findings; Copilot's events were now read, and its answer was refused twice as "not strict JSON". A
  diagnostic copy of the dispatcher showed why: the whole answer sat inside one Markdown code fence,
  with complete, valid JSON inside. Every other route extracts the object from such an answer; this
  adapter did not. An answer that is exactly one fenced block (three backticks, optionally `json`) is
  now unwrapped and its inside parsed strictly. Still refused: prose beside the fence, a second fenced block, a line inside that starts with a fence, a tilde fence, another language tag or broken JSON inside. The small synthetic check
  had passed because that answer happened to come back bare.
- **Lesson.** A status is not a finding, but a status that repeats is a signal. The 1 October
  `invalid_output` should have been looked at before the release, not after.

### 2. Codex reviews failed on one machine (not a MOMM defect; fixed locally)

The Codex route returned "CLI/model compatibility error". The owner's Codex settings named a model
that Codex CLI 0.157.1 does not support. MOMM's message was correct and named the fix. Updating the
CLI to 0.160.0 with `npm install -g @openai/codex@latest` restored the route; the settings were not
touched. The Codex harness itself kept working throughout, because a governor never reviews its own
work, so the failure was visible only when another harness governed.

### 3. A stale Git lock stops an update (not fixed; recovery works)

Installing 1.17.0 on the maintainer's machine failed at the checkout with "Unable to create
`.git/index.lock`: File exists". The lock was empty, six days old, and no Git process was running. The
updater rolled the checkout back and kept its recovery command; after the lock was moved aside,
`--rollback --yes` verified a clean 1.16.1 and the update then applied. The updater could say
how old a lock is before it starts. Recorded as a follow-up proposal.

### 4. An existing evidence folder owned by another account (worked as designed)

A project's `.ensemble_reviews` folder was refused as `different_owner`. The 1.17 evidence home
(`--evidence-home`) under the user's profile was used instead, with no permission changed.
`evidence --protect` remains the owner's decision.

## Release gates

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. Local suites and the OS by Node matrix on the sealed commit | Job logs | named in the pull request |
| 2. Lifecycle drills on the signed checkpoint, upgrading from 1.17.0 and 1.16.1 | Six hosted cells | after the merge |
| 3. MOMM review of the change with a completion receipt | Receipt | recorded below |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. Live four-reviewer check with the patched dispatcher | Report | passed (finding 1) |
| 6. Signed tag `momm-1.17.1` | Release workflow run | owner's go-ahead only |

## Still required before the tag

1. The matrix green on the sealed commit.
2. The owner's decision to merge, as a squash with the sealed tree unchanged.
3. The signed `main-checkpoint`, then the six lifecycle drill cells on it.
4. The owner's go-ahead for the signed tag.
