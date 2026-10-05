# Reviewer diagnostics — scope and testing

This addition changes the offline suite runner, its regressions and CI
registration. Its inclusion in a candidate requires a new seal and exact-commit
verification. It does not authorize a release or change reviewer isolation,
installed skills or account settings.

## Changes

- `RUN i/N` is printed before each suite, so long suites are identifiable.
- `--save-report --commit <full SHA>` preserves a per-run JSON report and both
  captured streams for failed suites in private `.ensemble_reviews/`, or the
  project-specific external folder selected by `MOMM_EVIDENCE_HOME`. A suite
  stopped by a signal or spawn error is labelled potentially incomplete; no
  output can prove what a killed suite would have printed later.
- Reports keep original failures. A later invocation cannot rewrite an earlier
  report. Results do not automatically classify failures as environmental.
- Commit identity is caller-supplied, explicitly labelled as such. Verify
  `git rev-parse HEAD` and `git status --porcelain` separately before and after.
  (Since 1.17.1 the report also records the actual `HEAD` and tree state beside the label.)
- Existing permission inspection is reused; inaccessible or non-private evidence
  storage refuses before suites launch. Existing ACLs are never repaired.

## Testing and reporting

Use a fresh detached clone at the full SHA supplied in the candidate invitation.
Follow the independent reviewer pack for seal verification; an unsealed follow-up
cannot reuse an earlier candidate's seal. Do not install it over your working
MOMM or tag/merge/publish it.

Run `node scripts/ci-runner-report.test.mjs`,
`node scripts/reviewer-ux-regressions.test.mjs`,
`node momm/scripts/review-workflow.test.mjs`, then
`node scripts/run-ci-suites.mjs --save-report --commit <verified full SHA>`.
Check HEAD and cleanliness again. Retain any first failures and report focused
reruns separately. Private stdout/stderr can contain local paths: do not publish
whole logs or JSON; share only relevant redacted assertions.

Saved evidence must also remain writable throughout the run. A final report replacement can fail
even after every suite passes; keep that nonzero process exit and incomplete report separate from
the suite totals. A Windows/Node24.19 run under OneDrive reported this boundary on the final 1.17
candidate; its cloud-sync/file-locking cause remains unproven. If cloud-synchronized storage is
unreliable or is refused as a linked entry, use the existing external private `MOMM_EVIDENCE_HOME`
option in a suitable unsynchronized location. (On 1.17.1 that option made 23 of the pack's 97
commands fail, because the suites inherited it; an independent tester found this on the released
1.17.1. On 1.17.0 six commands were tried and each failed the same way; the whole 1.17.0 pack was not
run with the option. Since 1.17.2 the suites are started without it and the report alone goes to the external home.) Never repair another user's permissions or weaken
linked-entry checks to make saving pass. Preserve the original attempt and report reruns separately.

Post one verdict in Discussion #32, linking the follow-up PR and tested full SHA.
Use a unique stable name: Bab/BAB (adversarial security), Bob (test reliability),
Hal (fresh-user/docs), or your own distinct name. These are assigned review angles,
not claims about which harness or person owns an existing report. State your real
harness and governor; do not reuse generic “Codex” as your only identity.

Include READY/NOT READY/BLOCKED, OS/Node, commands and exact original totals,
separate reruns, findings with reproduction/expected/actual behaviour, and coverage
limits. Reply beneath that report for later corrections. Questions and suggestions
also belong in Discussion #32; link any inline PR code comments there.

Account login only; provider output is untrusted; no private source or credentials.
Use only synthetic fixtures for live checks. Never run `evidence --protect`, alter
permissions or enable automatic updates on another person's behalf. A blocked
check is not a pass. Any applied fix needs governor reproduction and verification.

Non-blocking discovery/site ideas remain proposals; no website deployment is part
of this patch. The original candidate's release gates remain independent.
