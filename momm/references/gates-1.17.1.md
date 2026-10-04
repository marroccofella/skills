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
  one rule shared by both adapters. The small synthetic check had passed because that answer happened
  to come back bare.
- **A third cause, found by the gate review of this release.** In the review of the runner and the
  records (`rev_20261004085941_a8b4e58041e1`, seven pieces) three Copilot answers were refused as "not
  strict JSON": piece 2 on both attempts, and piece 6 on its first attempt (its retry was accepted).
  The other routes met quorum on every piece, so the review stood; these refusals are recorded here as
  statuses of the Copilot route, separately from that quorum. The private shape record (item S2) showed
  why without keeping the answers: two of the three began with a sentence of narration ("Good, I have
  everything needed to complete the review.") and ended with the fence. The rule now reads an answer
  that holds exactly one fenced block and ignores narration before or after it (text there that is
  itself JSON is a second answer and is refused); the inside is parsed as
  strictly as before. Still refused: a second fenced block, any other line that starts with a fence, an
  unclosed fence, a tilde fence, another language tag, narration around a bare answer or broken JSON
  inside. The third refused answer neither began nor ended with a fence; its shape is otherwise unknown
  and it is still refused. In the first gate review (`rev_20261004083921_b12f1d0fd3bf`) one Copilot
  answer was refused for an invalid finding and accepted on its retry, and Grok timed out on one piece.
- **Evidence.** `copilot-transport.test.mjs` passed 22 of 25 checks on the 1.17.0 code and 25 of 25
  with the event change; the fence check failed first with the production error. With the fence change
  and the review's test suggestions the suite had 29 checks, all passing; with the narration change it has
  30, all passing. A live review of a synthetic
  diff with the patched dispatcher returned valid reviews from Copilot, Codex, Antigravity and Grok.
  The second review of the fix (`rev_20261004063546_38c3f0e783cb`) had all four routes valid.
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
| R10 | A Setup Center running an older version than the installed one says so, names the control that stops it, and after a refresh that fails without the version check keeps the notice, marked as not checked again | `setup-maintenance.test.mjs` |
| S1 | One fence-unwrapping rule for Copilot and Antigravity; the extracting routes are unchanged | `review-answer.test.mjs` |
| S2 | A non-JSON answer leaves a private shape record: its first 80 characters after redaction, and no more of the answer | `review-answer.test.mjs` |
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
| 3. MOMM range reviews of every change, with completion receipts | Receipts | recorded below when complete |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. Live review with every installed reviewer route valid | Report | passed: in `rev_20261004085003_77d89c336993` Codex, Antigravity, Copilot and Grok each returned a valid review of every piece at the first attempt. In the other two range reviews of the whole delta each of the four returned valid reviews, but not of every piece: Grok timed out on one piece of one review, and Copilot was refused on both attempts on one piece of the other. Both are listed by route and piece under Reviews, with the answers that were refused once and accepted on a retry |
| 6. Signed tag `momm-1.17.1` | Release workflow run | approved by the owner's instruction of 4 October 2026, if every gate above passes on the final sealed commit |

## Reviews

Gate 3 is met only when every range review of the 1.17.1 changes is listed here with a complete
receipt. Listed: the two reviews of the Copilot fix and the three range reviews of the whole delta (R1
to R10 and S1 to S10). The closing review of the changes made in triage is added when its receipt is
complete; until it is listed, gate 3 is open.

- `rev_20261004062357_5e1763ad52ff` — the Copilot event fix. Codex, Antigravity and Grok ACCEPT, no
  findings; Copilot `invalid_output` (the fenced answer, finding 1). Six suggestions ruled, three
  applied. Receipt complete.
- `rev_20261004063546_38c3f0e783cb` — the fence fix and its notes. Codex, Antigravity and Copilot
  ACCEPT, Grok MODIFY. One WARNING (that the pattern accepts shapes it should refuse) probed and shown
  not to hold; one NITPICK about wording applied; five suggestions ruled, four applied. Receipt
  complete; it records `stale: dispatcher_sha256` because the review's own follow-up changed the
  dispatcher.

The three range reviews below cover everything between the Copilot fix and the integrated twenty items.
Each reviewer saw the diff in pieces of at most 20 KB; quorum (two valid reviews) was met on every piece.
A route that gave no valid review of a piece does not undo that piece's quorum: the review stands on
the routes that did, and the entry names the route and the piece as a status, not as a finding.
Every WARNING and CRITICAL was either reproduced with a check that fails on the reviewed commit and
passes after the fix, or rejected with a probe that runs the real code path; a green suite alone was
not accepted as a rejection. Every suggestion has a recorded decision. Each receipt records
`stale: dispatcher_sha256` because the fixes changed the dispatcher.

- `rev_20261004083921_b12f1d0fd3bf` — dispatcher, answers, compatibility record, notices and evidence
  location (five pieces). Each of the four routes returned valid reviews, and quorum was met on all
  five pieces. Grok timed out on piece 3 (one attempt), so it gave no valid review of that piece.
  Copilot's answer on piece 2 was refused once for an invalid finding and accepted on its retry.
  13 WARNING: five real and fixed, eight shown not to hold. 52 suggestions ruled, 12 applied.
  Receipt complete.
  Fixed: the compatibility record was written through a temporary file with a predictable name, so an
  entry planted there was written through and moved into the record's place (now a random name,
  created exclusively); a removal planned before the record's lock could erase an entry another run
  had written for the same route (now planned again under the lock); a success given another model hid
  a compatibility failure in the same run; a damaged last line of the review log could be counted as a
  run; and three comments denied that any answer text is kept, beside the code that keeps a redacted
  prefix.
- `rev_20261004085003_77d89c336993` — updater and Setup Center (three pieces). All four routes
  returned a valid review of every piece at the first attempt.
  8 WARNING and 4 NITPICK: six real and fixed, six shown not to hold. 35 suggestions ruled, 13
  applied. Receipt complete. Fixed: the protocol summary at the consent gate read a fence closer with
  an info string as a closer, reported a file whose sections had only changed places as "none added,
  removed or changed", and treated a `SKILL.md` it could not read as empty (it now stops with Git's
  error); the lock message says how many locks it does not name; Quick Setup no longer verifies a
  reviewer whose card reads "CLI update needed"; a console that cannot be written to no longer fails
  a refresh.
- `rev_20261004085941_a8b4e58041e1` — suite runner, hygiene suite, records and site status line (seven
  pieces). Each of the four routes returned valid reviews, and quorum was met on all seven pieces.
  Copilot's answers were refused as not strict JSON on two pieces (finding 1, third cause): on piece 2
  on both attempts, so it gave no valid review of that piece, and on piece 6 once, accepted on its
  retry. Every other route and piece was valid. 4 CRITICAL, 18 WARNING
  and 6 NITPICK: twenty real and fixed, eight shown not to hold. 62 suggestions ruled, 19 applied.
  Receipt complete. None of the four CRITICAL findings held: three said a function was undefined or a
  Windows tool was called on every platform, one said an import path was invalid, and each was
  disproved by running that path (the functions are declared later in the same file; the path
  exists). Fixed: `--recover-report` could be redirected by a link put in the destination's place
  after its check (the destination is now resolved and checked again, and written by its real path);
  every save of a run report retries a refused rename, not only the last; the destination is compared
  by file identity, and by case only on Windows and macOS; a run id must have the UUID form; the
  release catalogue must be in ascending version order before a status line is rendered; a README with
  CRLF line endings is accepted; and the plan, this record and the release notes were corrected where
  they said more than the code does.

Two changes were made by the governor after triage, each with a test that failed first, and are covered
by the closing review: the narration rule (finding 1, third cause) and the mark on a stale Setup Center
notice after a failed refresh (R10). Four triage check scripts were edited by the governor before any
fix was merged, so that the same bytes hold on the reviewed commit and on the final tree: three rules
pinned wording that those two changes replaced, and one belonged to a suggestion whose change another
packet made. Ten suggestions that one packet had declined as outside its files are recorded as applied,
because the neighbouring packet made exactly that change under a finding of the same review.

## Found in triage and carried forward

- The capability overlay (`momm/scripts/capabilities.mjs`, outside this release's reviewed range) still
  writes through a temporary file with a predictable name, the pattern fixed here for the
  compatibility record. Candidate for 1.18.
- An evidence home with a file among its parent folders is refused without a reason. Candidate for
  1.18.
- `--recover-report` cannot exclude a link placed between its last check and the write itself; the
  window is two adjacent calls.
- The case regression test for `--recover-report` can fail first only on a case-sensitive file system;
  it first ran on the hosted Linux cells, not in triage. The link form of the temporary-file test ran
  with a plain file on the triage machine, where file links cannot be created.
- The Git-lock claims about reflog locks were checked with one Git version (2.53 on Windows); the
  check repeats on whatever Git runs the suite.
- The third refused Copilot answer of the gate review had a shape the record could not tell apart
  (neither starting nor ending with a fence); if it recurs, the shape record will show it again.

## Still required before the tag

Owner approval. On 4 October 2026 the owner instructed that 1.17.1 be completed and released with the
Copilot fix and all twenty improvements. That instruction is the owner's approval for the signed tag,
on condition that every gate passes on the final sealed commit. If a gate does not pass, the tag is
not made and the decision goes back to the owner.

1. Gate 3 met: every range review listed under Reviews, each with a complete receipt.
2. The matrix green on the sealed commit.
3. The squash merge with the sealed tree unchanged, and the matrix green on `main`.
4. The signed `main-checkpoint`, then the six lifecycle drill cells on it.
5. The signed tag, then the publication record.
