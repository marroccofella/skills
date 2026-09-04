# Observation-mode preflight and diagnostic contract

Read this reference when Mode 2 needs a structured preflight, a browser/canvas
target binding, or an environment-recovery diagnostic. The executable contract
is `scripts/observation-preflight.mjs`; this page defines its fields.

## Preflight input

Run `scripts/observation-preflight.mjs --input <json-file>`. Input uses
`schemaVersion: 1`. The linter checks completeness, recomputable hashes and
internal consistency; it does not independently observe the target or prove
that evidence descriptions are true.

- `targetBinding`: `evidenceClass: "direct"`, a stable `identity`, and the
  content-identity object defined below.
- `actionRequirements`: an explicit boolean `requiresHold`.
- `control`: direct evidence, a stable `actionId`, an action name, structured `beforeState` and
  `afterState` objects, changed-field names whose values actually differ, and a
  description of the observed response. Identical snapshots cannot prove
  control. A declared field may appear or disappear across the action; presence
  itself is a state change. Field identifiers are trimmed and case-folded.
- `visibility`: direct evidence, the complete required-state list, the visible
  subset, and a measurement or semantic-state description. Required and visible
  lists must contain only non-empty string identifiers; malformed entries fail
  closed rather than being discarded. Identifiers are compared after trimming
  whitespace and folding case.
- `observation`: direct evidence and at least two settled samples whose
  `stateSignature` values agree. Use a stable visible state for this gate.
- `outcome`: direct evidence, `observable: true`, and three pairwise-distinct
  structured predicates named `success`, `failure`, and `ambiguity`. Each has
  `id`, `description`, `condition`, and a non-empty `observedFields` array.
  Predicate IDs and normalized conditions must each be pairwise distinct;
  changing only labels or descriptions does not make a condition distinct.
- `heldInput`: mandatory when `requiresHold` is true. It must include direct
  evidence class, the same stable `actionId` as `control`, an action description,
  positive requested and observed durations, capability evidence, guaranteed
  release, directly observed release, and release evidence. The observed duration
  must meet or exceed the requested duration; the contract applies no implicit
  timing tolerance. Omit `heldInput` when `requiresHold` is false; unexpected
  held-input claims fail closed rather than passing unvalidated.

The linter returns `preflight-passed` or `environment-recovery`. Both return
`gameplayEpisodesRecorded: 0` and `targetBindingDigest`, which is a SHA-256
string when the binding is canonically hashable and `null` when input failed
before a binding could be established. An actual episode begins only after
preflight. A persisted diagnostic requires the string form and uses it to reject
a preflight copied from a different target binding.

Choose exactly one CLI mode: `--self-test`, `--input <json-file>`, or
`--diagnostic <json-file>`. Mixed, missing, extra, or unknown arguments are
invalid usage. Exit codes are stable: `0` means the supplied record passed, `1`
means command usage was invalid, and `2` means the record was blocked or the
input file could not be read or parsed. Exit `2` always writes one
machine-readable result object to standard output; malformed records do not emit
a stack trace.

## Target binding

Mode 2 often cannot hash a pure engine. Record stable, redacted source fields
such as target URL/application/route, retrieved asset digests or validators,
action and observer versions, runtime family, viewport, device-pixel ratio,
canvas sizes, iframe boundary, and capture mode.

`contentIdentity` is normative:

```json
{
  "algorithm": "sha256",
  "canonicalization": "json-sorted-keys-v1",
  "sourceFields": {
    "targetUrl": "https://example.test/game",
    "application": "example controlled game",
    "observerVersion": "1.0.0",
    "viewport": "1280x720@1"
  },
  "digest": "64 lowercase hexadecimal characters"
}
```

Compute `digest` over UTF-8 JSON with object keys sorted recursively, no added
whitespace, normal JSON string escaping, and array order preserved. The helper
accepts only JSON-representable nulls, booleans, strings, finite numbers, dense
arrays, and plain objects. It rejects undefined values, functions, symbols,
non-finite numbers, accessors, sparse arrays, cycles, and structures deeper than
100 levels instead of hashing an invalid or ambiguous representation. The
helper recomputes and compares this value. If stable content identity cannot be
derived, record the limitation and do not promote a cross-run trace into the
verified lesson store.

## Environment-recovery diagnostic

Keep diagnostics outside `lessons.json`, for example in
`.myautoness/diagnostics.json`. Run
`scripts/observation-preflight.mjs --diagnostic <json-file>` before persistence.
Every field below is required:

```json
{
  "schemaVersion": 1,
  "recordKind": "environment-recovery",
  "targetBinding": {"evidenceClass": "direct", "identity": "...", "contentIdentity": {}},
  "observedAt": "2026-08-26T22:09:00+01:00",
  "executionBoundary": "browser / shell / iframe / canvas summary",
  "claimClass": "direct",
  "preflight": {
    "schemaVersion": 1,
    "passed": false,
    "episodeAllowed": false,
    "gameplayEpisodesRecorded": 0,
    "recordAs": "environment-recovery",
    "targetBindingDigest": "sha256 of the canonical targetBinding object",
    "blockers": ["no causal control response observed"]
  },
  "blockers": ["no causal control response observed"],
  "failureBoundary": "smallest isolated boundary or unknown",
  "nextRecovery": "one bounded next variation",
  "budget": {"subgoalAttemptsUsed": 1, "sessionAttemptsUsed": 1},
  "cleanup": {"heldInputsReleased": true, "temporarySessionsClosed": true},
  "persistence": {"atomicWrite": "temp-file-rename", "redacted": true},
  "checksum": {
    "algorithm": "sha256",
    "canonicalization": "json-sorted-keys-v1",
    "digest": "sha256 of the canonical record with checksum omitted"
  }
}
```

`claimClass` may be `direct`, `reported`, or `not-established`. `observedAt` must
be a real calendar instant with an explicit timezone. The top-level `blockers`
must canonically match `preflight.blockers`. Attempt counts must be integers
within ten per subgoal and thirty per session, and the session count cannot be
lower than the current subgoal count. The embedded preflight's
`targetBindingDigest` must match the diagnostic's canonical `targetBinding`.
The validator rejects unknown schemas, stale checksums, missing or mismatched
evidence, impossible timestamps,
inconsistent or over-budget records, incomplete cleanup, and non-atomic
persistence declarations. Redact sensitive values, validate, then write a
temporary file and atomically rename it. A
diagnostic can guide a retry but is never replayed as a winning gameplay lesson.

## Real-time tasks

A fixed time-based trace is suitable only when the observable start state,
scheduler conditions and target binding can be restored. Pinball and other
real-time tasks may instead yield environment or human-readable strategy notes.
Do not call those a replayable policy or verified win. If a project needs
state-conditional lessons, define and test that action schema in the project;
do not silently reinterpret a timestamped trace as a reactive policy.
