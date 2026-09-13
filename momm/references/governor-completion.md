# Close a review with checkable local evidence

This is an offline record validator, not an autonomous code fixer or independent
proof of correctness. Only the governor writes code, chooses tests and records
what actually happened. No command inside a report or decision is executed.

## Workflow

1. Review a project-local file with `--input`, or the exact current Git diff HEAD
   from the repository root. Git paths and the evidence directory must share that
   root; a subdirectory invocation gets an explicit refusal rather than guessed scope.
   Source hashes are captured at dispatch. For diffs, text additions/modifications
   are supported; stale/filtered patches, binaries, deletions, renames and type
   changes cannot currently receive validated completion. The review may still
   run, but unsupported source scope remains visibly incomplete. For text input,
   keep the file inside the reviewed project. An arbitrary stdin string cannot
   establish final source identity. Media-file lifecycle binding is not covered.
2. Run `node <installed-momm>/scripts/governor.mjs --run <run_id>` from that project.
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
   style-only suggestions need passing final verification. Rejected findings need
   an investigation record. Rejected suggestions need a reason. Deferred items,
   missing rows and conflicting duplicates remain open; do not add fabricated rows.
5. Write run-level final verification covering every file in `source_snapshot.files`.
   Run the validator again. Only after it succeeds, add `--record`; it saves
   `.ensemble_reviews/completions/<run_id>.json` and rebuilds the private ledger.
   Relay `ledger_url`. An exit 0 validates local records/bytes, not universal safety.

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

It cannot prove that an arbitrary chosen test is adequate, that an observation was
honestly recorded, or that a same-user actor did not rewrite the whole local chain.
Reviewed-scope quotations and `review_status: complete` are peer declarations,
not proof of thought. Human/governor judgment remains necessary.

The controlled regression suite runs real authored failing/passing tests against
a seeded defect, with synthetic reviewer replies and no model calls:
`node momm/scripts/governor.test.mjs`. It is not a live-provider benchmark or a
certification of every harness/machine. Keep live route checks separate.
