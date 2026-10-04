# MOMM 1.17.1 plan: every reviewer usable, and failures that explain themselves

Status: **in build, not released.** The current release is 1.17.0 (signed tag `momm-1.17.0`,
3 October 2026). Owner instruction, 4 October 2026: fix the Copilot route, release it as 1.17.1, and
add the twenty reliability improvements below to the same version. The Copilot fix (items F1 to F3) is
kept as separate commits at the base of the branch so it can ship alone if the owner decides so.

One writer; reviewers read-only; account logins only; automatic updates stay off; no privacy check is
weakened; no setting of the user's is changed. Every item has failing-first tests.

## Already built (the Copilot fix)

- **F1.** Copilot CLI events `session.warning` and `model.call_final_result` are recognised; a model
  call that does not report success is refused.
- **F2.** An answer that is exactly one fenced block is unwrapped and parsed strictly.
- **F3.** A refusal for an unrecognised event names it (plain names only).

## Reliability items proposed on 4 October (R1 to R10)

- **R1. Compatibility-aware preflight.** Before review allowance is spent, `--preflight` and dispatch
  say when a route's CLI and configured model are known not to work together. No model call, no
  setting changed. Where a CLI cannot be asked offline, MOMM remembers the last compatibility failure
  it saw for that CLI version and model (private, per machine) and shows it until either changes.
  Done when: a recorded Codex "CLI/model compatibility" failure is shown at the next preflight with the
  update command; it disappears when the CLI version or the configured model changes; nothing is written
  to the user's CLI settings.
- **R2. Versioned adapter regression matrix.** Sanitised output fixtures per supported CLI version
  (success, terminal error, quota, cancelled, fenced answer, unknown event) for every route's parser,
  run by one suite. Done when: the Copilot 1.0.85-shape and 1.0.91-shape fixtures and the Grok 1.0.41
  capture are in the matrix with error cases, and adding a version is adding a folder.
- **R3. Report-storage precheck.** `run-ci-suites.mjs --save-report` checks private permissions and
  write access before the first suite, and checks again when saving. Done when: an unwritable or
  non-private location refuses before any `RUN` line, with the reason.
- **R4. Failed-save recovery.** If the final save fails, the results already held are written to a
  named recovery file in a private location the user approves, without rerunning suites and without
  touching the original attempt. Done when: an injected final-rename failure leaves the original
  report untouched and a `--recover-report` command completes the record elsewhere.
- **R5. Three-part outcome.** The runner's last lines state separately: suites passed, report saved,
  process exit status. Done when: "93 of 93 passed; report not saved; exit 1" is one unambiguous block.
- **R6. Strict option validation.** An unknown or misspelled runner option is refused with the nearest
  valid option, exit 2, nothing run. Done when: `--grpe` is refused and suggests `--grep`.
- **R7. Friendly evidence-location errors.** A refused evidence home says why and gives a safe remedy,
  with no raw trace and no weakened check. Done when: an in-project evidence home, a non-private one and
  a linked one each print one plain message and exit 1.
- **R8. Update lock preflight.** Before an update starts, a Git lock in the skills clone is reported
  with its age and recovery guidance. Age is never treated as proof that it is stale and the lock is
  never removed automatically. Done when: `--dry-run` and `--apply` stop before any change with that
  message, and the retained recovery command is unaffected.
- **R9. Verified checkout identity in reports.** A saved run report records the actual `HEAD` and
  whether the tree was clean, beside the caller-supplied label, clearly distinguished. Done when: a
  label that differs from `HEAD` is recorded as a mismatch and said so in the summary.
- **R10. Stale Setup Center warning.** A running Setup Center whose version differs from the installed
  one says so and asks for a restart. Done when: the page shows the notice after the installed version
  changes under it, and its self-test covers it.

## Items from this release's own failures (S1 to S10)

- **S1. One answer-unwrapping rule for every route.** The whole-answer fence rule lives in one place
  and each adapter's tests use the same matrix. No adapter repairs content.
- **S2. Private shape diagnostics for a non-JSON answer.** When an answer is refused as not JSON, the
  private attempt record keeps its length, whether it starts or ends with a fence, the parser's error
  position and a redacted 80-character prefix. Never the answer.
- **S3. Repeated-status notice.** When a route has returned the same non-success status in its last
  three recorded runs in this project, the report's notices say so and name the likely class (CLI
  change, quota, login). A notice only; nothing is routed on it.
- **S4. Gate-review guard.** A review of a diff file passed as `--input` prints that its findings
  cannot receive a completion receipt for project files and names `--range`. A notice, not a refusal.
- **S5. Real temp paths in tests.** One test helper returns the real, long form of a temp folder;
  the hygiene suite flags a new test that compares `os.tmpdir()` text with a resolved path.
- **S6. Local hygiene mirrors the publish scan.** The source-hygiene suite fails on machine home-path
  literals and credential-looking literals in tracked source, including tests, before any push.
- **S7. Evidence-home hint on a different-owner refusal.** The remediation names `--evidence-home`
  beside `evidence --protect`, with the exact command.
- **S8. Protocol-change summary at the update gate.** When `--apply` stops for `--accept-protocol`, it
  first prints a short list of what changed (files, and headings added or changed in `SKILL.md`), then
  the full diff as now. The gate itself is unchanged.
- **S9. CI shows every failing suite.** The workflow's suite step runs the same runner reviewers use,
  so one push reports all failures. The matrix and the suite list are unchanged.
- **S10. Stable and candidate status line.** The README and the site home state the stable version
  and, when one exists, the candidate under test, each with its link. Generated from the manifest and
  the release catalogue; no hand-edited claim.

## Out of 1.17.1

New reviewer routes, automatic updates, any change to the containment model, discoverability work
beyond S10, and anything that needs a provider call to decide.

## Release gates

1. Local suites and the OS by Node matrix on the sealed commit.
2. Lifecycle drills on the signed checkpoint, upgrading from 1.17.0 and 1.16.1.
3. MOMM range reviews of every change, with per-piece quorum and completion receipts.
4. Privacy and history scan before every push.
5. A live review with every installed reviewer route returning a valid review.
6. Signed tag `momm-1.17.1`, on the owner's instruction of 4 October 2026 to complete and release.
