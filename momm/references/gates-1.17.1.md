# 1.17.1 gate record — candidate, not released

This record names no current commit: a file cannot name its own commit. The candidate under test is
the head of the 1.17.1 pull request. The published release stays 1.17.0 until the signed tag
`momm-1.17.1` exists.

## Why this release exists

One day after 1.17.0, Copilot reviews were being refused. The cause is in MOMM, it affects users whose
Copilot CLI emits the two events described below (seen on 1.0.91; 1.0.90 failed the same way), and
nothing a user can configure works around it. On 4 October 2026 the owner instructed that the fix be
released as 1.17.1 and that twenty reliability improvements go into the same version. The scope and a
"done when" for each item are in the [plan](plan-1.17.1.md).

## Findings that started it

### 1. Copilot reviews refused on recent Copilot CLI versions (fixed)

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
- **A second cause, found by reviewing the first fix.** MOMM reviewed the event fix with the patched
  dispatcher (`rev_20261004062357_5e1763ad52ff`). Codex, Antigravity and Grok accepted it with no
  findings; Copilot's events were now read, and its answer was refused twice as "not strict JSON". A
  diagnostic copy of the dispatcher showed why: the whole answer sat inside one Markdown code fence,
  with complete, valid JSON inside. Claude, Codex, Gemini and Grok extract the object from such an
  answer; the Copilot and Antigravity adapters did not. An answer that is exactly one fenced block
  (three backticks, optionally `json` in any case) is now unwrapped and its inside parsed strictly, by
  one rule shared by both adapters. Still refused: prose beside the fence, a second fenced block, a
  line inside that starts with a fence, a tilde fence, another language tag or broken JSON inside. The
  small synthetic check had passed because that answer happened to come back bare.
- **Evidence.** `copilot-transport.test.mjs` passed 22 of 25 checks on the 1.17.0 code and 25 of 25
  with the event change; the fence check failed first with the production error. A live review of a
  synthetic diff with the patched dispatcher returned valid reviews from Copilot, Codex, Antigravity
  and Grok. The second review of the fix (`rev_20261004063546_38c3f0e783cb`) had all four routes valid.
- **Lesson.** A status is not a finding, but a status that repeats is a signal. The 1 October
  `invalid_output` should have been looked at before the release, not after. Item S3 now makes MOMM
  say so itself.

### 2. Codex reviews failed on one machine (not a MOMM defect; fixed locally, then generalised)

The Codex route returned "CLI/model compatibility error". The owner's Codex settings named a model
that Codex CLI 0.157.1 does not support. MOMM's message was correct and named the fix. Updating the
CLI to 0.160.0 with `npm install -g @openai/codex@latest` restored the route; the settings were not
touched. The Codex harness itself kept working throughout, because a governor never reviews its own
work, so the failure was visible only when another harness governed. Item R1 now shows such a failure
at the next preflight, before allowance is spent.

### 3. A stale Git lock stopped an update (now caught before anything changes)

Installing 1.17.0 on the maintainer's machine failed at the checkout with "Unable to create
`.git/index.lock`: File exists". The lock was empty, six days old, and no Git process was running. The
updater rolled the checkout back and kept its recovery command; after the lock was moved aside,
`--rollback --yes` verified a clean 1.16.1 and the update then applied. Item R8 now stops the update
before it starts, names the lock and its age, and never removes it.

### 4. An existing evidence folder owned by another account (worked as designed; message improved)

A project's `.ensemble_reviews` folder was refused as `different_owner`. The 1.17 evidence home
(`--evidence-home`) under the user's profile was used instead, with no permission changed.
`evidence --protect` remains the owner's decision. Item S7 now names the evidence-home alternative in
that refusal.

## What the twenty items are, and where each is proven

| Item | What is now true | Suite |
| --- | --- | --- |
| R1 | A remembered CLI/model compatibility failure is shown at preflight and dispatch; no model call, no setting changed | `compatibility.test.mjs`, `setup-maintenance.test.mjs` |
| R2 | Each adapter is run against fixture output of supported CLI versions, errors included | `adapter-matrix.test.mjs` |
| R3 | Report storage is checked before the first suite and again at save | `scripts/ci-runner-report.test.mjs` |
| R4 | A failed final save leaves the attempt untouched and can be recovered elsewhere | `scripts/ci-runner-report.test.mjs` |
| R5 | The runner ends with suites passed, report saved and exit status, separately | `scripts/ci-runner-report.test.mjs` |
| R6 | An unknown runner option is refused with the nearest valid one | `scripts/ci-runner-report.test.mjs` |
| R7 | A refused evidence location prints one plain line with the reason and a safe remedy | `evidence-location.test.mjs`, `shutdown.test.mjs` |
| R8 | An update stops on a Git lock before any change; the lock is never removed | `update.test.mjs`, `stabilisation.test.mjs`, `update-claim.test.mjs` |
| R9 | A saved report records the actual `HEAD` and tree state beside the supplied label | `scripts/ci-runner-report.test.mjs` |
| R10 | A Setup Center running an older version than the installed one says so | `setup-maintenance.test.mjs` |
| S1 | One fence-unwrapping rule for Copilot and Antigravity; the extracting routes are unchanged | `review-answer.test.mjs` |
| S2 | A non-JSON answer leaves a private shape record, never the answer | `review-answer.test.mjs` |
| S3 | Three recorded runs with the same failure produce a notice | `run-notices.test.mjs` |
| S4 | A diff file given as `--input` gets a notice naming `--range` | `run-notices.test.mjs` |
| S5 | A real-temp-path helper for tests, and a narrow lint rule | `scripts/source-hygiene.test.mjs` |
| S6 | Machine paths and credential-looking literals fail the local hygiene suite | `scripts/source-hygiene.test.mjs` |
| S7 | A refused `.ensemble_reviews` names the evidence-home alternative, quoted per shell | `scripts/evidence-permissions.test.mjs` |
| S8 | The update gate prints a summary of protocol changes before the full diff | `update.test.mjs` |
| S9 | One CI run names every failing suite | `scripts/ci-runner-report.test.mjs` |
| S10 | README and site home carry one generated stable/candidate status line | `scripts/momm-site-home.test.mjs`, `scripts/momm-site-release-consistency.test.mjs` |

## Release gates

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. Local suites and the OS by Node matrix on the sealed commit | Job logs | named in the pull request |
| 2. Lifecycle drills on the signed checkpoint, upgrading from 1.17.0 and 1.16.1 | Six hosted cells | after the merge |
| 3. MOMM range reviews of every change, with completion receipts | Receipts | recorded below |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. Live review with every installed reviewer route valid | Report | passed on the Copilot fix (finding 1) |
| 6. Signed tag `momm-1.17.1` | Release workflow run | owner's instruction of 4 October 2026 |

## Reviews

- `rev_20261004062357_5e1763ad52ff` — the Copilot event fix. Codex, Antigravity and Grok ACCEPT, no
  findings; Copilot `invalid_output` (the fenced answer, finding 1). Six suggestions ruled, three
  applied. Receipt complete.
- `rev_20261004063546_38c3f0e783cb` — the fence fix and its notes. Codex, Antigravity and Copilot
  ACCEPT, Grok MODIFY. One WARNING (that the pattern accepts shapes it should refuse) probed and shown
  not to hold; one NITPICK about wording applied; five suggestions ruled, four applied. Receipt
  complete; it records `stale: dispatcher_sha256` because the review's own follow-up changed the
  dispatcher.

## Still required before the tag

1. The matrix green on the sealed commit.
2. The squash merge with the sealed tree unchanged, and the matrix green on `main`.
3. The signed `main-checkpoint`, then the six lifecycle drill cells on it.
4. The signed tag, then the publication record.
