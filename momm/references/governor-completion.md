# Close a review with checkable local evidence

This is an offline record validator, not an autonomous code fixer or independent
proof of correctness. Only the governor writes code, chooses tests and records
what actually happened. No command inside a report or decision is executed.

## Workflow

For 1.16.1 candidates, use [the tool-produced check workflow](verification-checks.md) to
record actual test execution rather than transcribing outcomes by hand. The ordinary
completion validator and its limitations still apply. Cumulative attempt audits are separate
coverage records, never automatic completion receipts.

1. Review a project-local file with `--input`, or the exact current Git diff HEAD
   from the repository root. Git paths and the evidence directory must share that
   root; a subdirectory invocation gets an explicit refusal rather than guessed scope.
   Source hashes are captured at dispatch, with a 200-file ceiling. Finding locations such as `file:line` are
   normalized only when they resolve to a file already in that snapshot; this
   does not expand the reviewed scope. New/deleted files during a fix need a new review.
   For diffs, text additions/modifications are supported; stale/filtered patches, binaries, deletions, renames and type
   changes cannot currently receive validated completion. The review may still
   run, but unsupported source scope remains visibly incomplete. For text input,
   keep the file inside the reviewed project. An arbitrary stdin string cannot
   establish final source identity. Media-file lifecycle binding is not covered.
2. Run `node "<installed-momm>/scripts/governor.mjs" --run <run_id>` from that project.
   It returns all `items` even if later evidence is missing. Each stable `item_id`
   binds report bytes, kind, reviewer, index and content; identical suggestion text
   is never enough to identify a decision. Exit 4 means work/evidence is outstanding.
3. Preserve a baseline copy of tested source before changing it. Author your own
   minimal regression; run it on that baseline, record the real output and exit
   status, then fix and run the same test again. Investigate false findings with
   a concrete probe. Never paste or execute an unexamined reviewer snippet.
4. Append one decision per item to `.ensemble_reviews/dispositions.jsonl`. Every
   finding (including a nit) and every suggestion needs a ruling. Applied material
   findings and behavioral suggestions need failing-before/passing-after records;
   style-only changes need a passing after record, and since 1.17 the bytes must show
   they are style (see "Mechanical `style`" below). Rejected findings need
   an investigation record. Rejected suggestions need a reason. Deferred items,
   missing rows and conflicting duplicates remain open; do not add fabricated rows.
5. Write run-level final verification covering every file in `source_snapshot.files`.
   Run the validator again. Only after it succeeds, add `--record`; it saves
   `.ensemble_reviews/completions/<run_id>.json` and rebuilds the private ledger.
   Relay `ledger_url`. An exit 0 validates local records/bytes, not universal safety.
   Re-recording preserves the previous receipt beside it under its content hash.
   Inspect-only output does not claim a freshly rebuilt dashboard link.
   Exit 5 means the receipt was recorded but the dashboard rebuild failed;
   `ledger_url` is null until it is rebuilt. Do not call a stale dashboard current.

Never change a sealed report or its original log entry to make this pass. Legacy
free-form decisions remain viewable but are not certified by this new validator.
If a recorded decision needs correction, preserve the old file privately and
explicitly correct the relevant row; blindly appending a conflicting duplicate
intentionally fails. No history is silently rewritten by the tool.

## Record shapes

All file references are `{ "path": "project-relative/path", "sha256": "64 lowercase hex characters" }`.
Use forward slashes. Files must be bounded local regular files (at most 8 MB each).
Append-only run and decision logs are read in bounded chunks instead of sharing
that whole-file limit. Each JSONL record and the selected run's records remain
limited to 8,000,000 bytes; malformed records anywhere still fail validation.
The entire log is hashed and rechecked, including unrelated records.
Absolute paths, traversal and symbolic links/junctions are refused. Hash exact
bytes, not reconstructed JSON. Save source snapshots, outputs, observations and
decisions in the private evidence directory. Never publish them by default.

Each decision includes:

```json
{
  "run_id": "rev_...",
  "governor": "codex",
  "reviewer": "claude",
  "item_id": "copy from validator items",
  "report_sha256": "copy from validator",
  "input_sha256": "copy from validator",
  "suggestion": "short display label",
  "disposition": "applied",
  "change_kind": "behavior",
  "reason": "What was reproduced and why this decision follows",
  "reproduction": { "path": ".ensemble_reviews/checks/before.json", "sha256": "..." },
  "verification": { "path": ".ensemble_reviews/checks/after.json", "sha256": "..." }
}
```

`disposition`: applied, applied-with-modification, rejected, deferred.
`change_kind`: behavior or style; material findings always require reproduction
regardless of this field. For a combined finding, `reviewer` must name one of its
recorded sources. Add `finding_id` for existing ledger severity attribution.

Optional `role` (1.17): copy the role that reviewer held from the report, `reviewers[].role`, or
`reviewers[].persona` for a report sealed before roles were recorded. The validator refuses a
`role` that is empty or is not a role the report gives the row's `reviewer` for that item: its
`reviewers[]` value for its own suggestions; for a cover's suggestion, the role that cover performed
(the covered role, see Role cover below); for a finding, either of those. Only a finding's `role`
reaches the scorecard: when a finding's row has no `role`, the scorecard takes the reviewer's
`reviewers[].role`, else `reviewers[].persona`,
else, for a route that only covered, its one covered role (none when it covered more than one).
A suggestion's `role` is checked but counted in no roster column, so a cover's suggestion without
one is never credited to the route's native role. The role feeds only the scorecard's
per-route, per-role roster (valid reviews, reproduced claims, false `CRITICAL`, median time, cover
success), which is this project's governor decisions, not a benchmark; nothing routes on it.

Re-typing a claim (peer contract `momm-peer-review/3`). A finding may carry a `claim_type`
(`DEFECT`, `RISK`, `QUESTION`, `IDEA` or `NOISE`; `null` when untyped). The report's merged
type is the most blocking type of its sources. The governor may re-type a finding only in its
decision row, with three fields:

- `claim_type`: the new type, one of the five above;
- `retyped_from`: exactly the report's merged type (`null` for an untyped claim);
- `retype_reason`: a non-empty reason.

A row whose `claim_type` differs from the report's type without both of the other two fields is
refused. So is a `retyped_from` that does not name the report's type. Changing severity follows
the same rule with `severity`, `severity_from` and `severity_reason`. A recorded change is the
governor's judgement on record. It never waives a gate: whether a finding is material, and so
whether it needs failing-before/passing-after evidence, is decided by the report's severity,
whatever its type. These fields apply to findings only; they are refused on suggestion and
`governor_direct` rows. Reports sealed under `momm-peer-review/2` (1.16.x) still validate; their
findings are untyped.

### Mechanical `style` (1.17)

`style` is decided from the bytes, never from the label (`scripts/style-classifier.mjs`,
version `momm-style/1`). For every file the decision's after check binds that differs from
the reviewed bytes, every changed line must be whitespace, or a comment line that is added, removed or
reworded (never code in its old or its new form). Otherwise the item stays unresolved with a reason such as
`change_kind style refused: src/a.js:12 changes code`, `... carries a directive` or
`... file type unclassifiable (...)`; record it as `behavior` with failing-before and
passing-after evidence instead.

- Comment syntax is known for js, mjs, cjs, jsx, ts, tsx (`//`, single-line `/* */`),
  java, c, cpp, cs, go, rs, swift, kt (the same), py, sh, bash, rb, yaml, yml, toml, ps1
  (`#`) and css (single-line `/* */`). Anything else is unclassifiable and needs
  `behavior`: Markdown (owner decision D4), JSON, HTML, unknown or no extension, binary or
  non-UTF-8 bytes, generated files, renamed files, JSX markup, a block comment spanning
  lines, and string forms the classifier does not model.
- A code line turned into a comment, or a comment into code, is behavior. So is a trailing
  comment added to a code line, a comment inside a multi-line string, template or heredoc
  (that is string content), and a comment that carries a tool directive from the versioned
  list (`eslint-disable`, `@ts-expect-error`, `@ts-ignore`, `prettier-ignore`,
  `istanbul ignore`, `c8 ignore`, `noqa`, `type: ignore`, `pragma`, `#!`, `-*- coding`,
  `nolint`, `NOSONAR` and more of the same kind; `STYLE_DIRECTIVES`).
- A code line whose only change is whitespace outside strings is style, except in the
  whitespace-significant py, yaml and yml files, which fail closed. Makefiles and Haskell
  have no listed comment syntax and are unclassifiable.
- The reviewed bytes come from the decision's own `reproduction` before record (for a style
  decision it may pass; it is a baseline copy, not a failing test) or from `input_text` the
  report stored with `--store-input`. Without either, `style` is refused.
- The comparison is cumulative against the reviewed bytes: a style decision cannot cover a
  file that another decision changed in code.

### Recorded mutation (1.17, optional)

An applied decision may add `"mutation": { "path": ..., "sha256": ... }`, a
`checks.mjs --phase mutation` record (see [verification-checks.md](verification-checks.md)):
the same test as the after check, run with only this decision's change reverted, binding the
same files, whose reverted bytes differ from the after check's. It counts only when that run
failed (`exit_code > 0`). The validator reports
`mutation: { applied_decisions, with_mutation_record, mutation_survived, invalid }`.
A record that passed is listed in `mutation_survived` (a warning: the test did not notice
the revert); a malformed one, a different test, or one that reverted nothing is listed in
`invalid` with the reason. None of these refuses completion, and a count is never proof: a
revert that does not build also fails.

### Stale reviews (1.17)

The validator compares the review with what is installed now and reports
`stale: { stale, changed, unknown, matched }` (field names only). Compared: the report's
`dispatcher_sha256`, `peer_contract_sha256`, `process_scope_sha256` and `governor_sha256`
against the files beside this governor; each guidance route's layers that come from files
(user and trusted project guidance, `.reviewrules`), re-resolved now; and each successful
route's `command_shape_sha256` where the report records one. A route's CLI version and model
cannot be confirmed without running the CLI, and attachments are not kept, so those are
always `unknown`; a field the report does not record is `unknown`, never a match. `stale`
is true only when something recorded differs. A stale review can still be completed, and
the receipt carries the block.

### Role cover (1.17, `--cover`)

A report may carry `covers[]`: another route answering a failed route's
role on one piece. The validator recounts covers and never trusts their flags: a cover must name a
coverable failure (`timeout`, `invalid_output`, `provider_unavailable` or `error`) that the report
records for that route and piece, must be a single invocation within the budget of two per piece and
role (the native attempts and every earlier cover of that role on that piece count), must come from a
route that covers no other role on that piece, and counts toward quorum only if its model family (the
report's `model_families`) is known and new to that piece. A cover claiming a vote the family rule does not give is an error. A successful
cover's suggestions are items like any reviewer's (`reviewer` is the cover route; the `index` is
`cover:<row>:<n>`), and its findings are already merged into `findings` under that route's name.
An optional decision `role` (B6) on a cover's suggestion must be the cover's role (the role it covered);
on a finding it may be the route's own role or a role that route covered successfully. For example, when
`grok` holds `innovator` natively and its cover of `codex` performed `surgeon`, a row on the suggestion
`cover:0:0` may carry `"role": "surgeon"` and is refused with `"role": "innovator"`; a row on a finding
`grok` raised may carry either.

An observation file has this shape (record actual outputs, not these placeholders):

```json
{
  "schema": "momm-check/1",
  "run_id": "rev_...",
  "item_id": "the exact item_id, or run for final verification",
  "report_sha256": "...",
  "input_sha256": "...",
  "phase": "before",
  "exit_code": 1,
  "observed_at": "2026-01-01T00:00:00Z",
  "command_label": "Human-readable command you actually chose and ran",
  "test": { "path": "tests/regression.mjs", "sha256": "..." },
  "output": { "path": ".ensemble_reviews/checks/before.txt", "sha256": "..." },
  "artifacts": [{
    "path": "src/example.mjs", "sha256": "...",
    "snapshot": { "path": ".ensemble_reviews/checks/original.mjs", "sha256": "..." }
  }]
}
```

Before records require a positive nonzero exit and baseline snapshot hashes matching
dispatch source hashes. After records need exit 0, the same test path/hash and a
later timestamp; the tested artifact paths must match. After/investigation/final
artifacts are checked against current bytes. A rejected finding uses phase
`investigation`, exit 0, a real probe/test plus output. If the cited target never
existed, explicitly list its safe relative name in `absent_paths`; the validator
checks it is still absent rather than silently substituting an unrelated file.

The run-level observation lives at
`.ensemble_reviews/verification/<run_id>.json`: same schema, `item_id: "run"`,
`phase: "final"`, exit 0, and every reviewed source file in `artifacts`.
Even a zero-finding review requires it. Changed source needs a corresponding
applied decision. Later source/test/output edits invalidate current completion;
a historical receipt does not override revalidation.

## What this proves—and does not

It verifies the original report/log seal, input binding, recorded gate policy,
unique item decisions, required observation relationships and actual local byte
hashes. It never treats a matching row count as completion. Original reports are
immutable; receipt writes are atomic and all read hashes are rechecked.

A mutation count narrows, but does not settle, whether a test is adequate; a stale block says
what changed since the review, not whether the review is still right.
It cannot prove that an arbitrary chosen test is adequate, that an observation was
honestly recorded, or that a same-user actor did not rewrite the whole local chain.
Reviewed-scope quotations and `review_status: complete` are peer declarations,
not proof of thought. Human/governor judgment remains necessary.

The controlled regression suite runs real authored failing/passing tests against
a seeded defect, with synthetic reviewer replies and no model calls:
`node momm/scripts/governor.test.mjs`. It is not a live-provider benchmark or a
certification of every harness/machine. Keep live route checks separate.
