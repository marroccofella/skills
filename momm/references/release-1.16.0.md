# MOMM 1.16.0 — measurement, ratings, guidance, throughput, upkeep

Status: **released 19 September 2026** as the signed tag `momm-1.16.0` (commit `cbd5570`, release
workflow run 35462410210: signature, Rekor entry and certificate claims validated; genuine signed
preview and apply passed). Built from 1.15.1 starting 2026-09-13. The consolidated
candidate and its gate record are on [PR #7](https://github.com/marroccofella/skills/pull/7);
the independent-audit conversation is on [PR #4](https://github.com/marroccofella/skills/pull/4)
and the audit repairs came from [PR #6](https://github.com/marroccofella/skills/pull/6) and
[PR #8](https://github.com/marroccofella/skills/pull/8).
A version string never establishes a release; the signed `momm-1.16.0` tag does. The text below
the summary is the dated record as it was written, so it speaks of a candidate.
Plan: [plan-1.16.0.md](plan-1.16.0.md).

## In short

- **Every review reports what it cost**: tokens and cost per reviewer where the provider reports
  them, in the report, the private ledger and the Setup Center.
- **Reviewers get a report card**: rate a review after triage; the ledger shows ratings from five
  runs up and 30-day route reliability from ten runs up.
- **Big diffs no longer time out**: `--split` cuts a diff into pieces, judges quorum per piece,
  and hands anything too large to the governor to check directly. Nothing is dropped.
- **Standing guidance behind a trust gate**: project guidance is sent only after you trust that
  exact file by its hash.
- **Media goes only where it can be read**: a capability registry records which route accepts
  images, audio or video; an expired capability is blocked until re-probed; probes send synthetic
  material only and need consent. MOMM checks initial media types by filename extension, not file
  contents. Malformed or mislabelled files may still proceed; downstream rejection is not guaranteed.
- **Windows is safer**: the evidence folder is created private, and a `git.exe` or `taskkill.exe`
  planted in the project under review is never started, on any supported Node version: MOMM
  resolves every tool to an absolute path itself.
- **Updates stay yours**: `update --check-all`, an event-driven update clock, and an
  automatic-update setting that is off by default and that an agent never turns on.
- **`--retry-invalid` (opt-in)**: a reviewer answer rejected as invalid output is asked for once
  more; validation is never loosened and every retry is written into the report.

Details are under [What a user notices](#what-a-user-notices) and
[E7](#e7--modality-registry-and-capability-aware-routing).

## Upgrading from 1.15

- Use the [installation and upgrade prompt](https://marroccofella.github.io/skills/momm/releases/upgrade.html);
  the signed-tag preview and explicit apply are unchanged. Logins, other skills and private
  ledgers are preserved.
- **Windows:** run `node "<installed-momm>/scripts/multi-review.mjs" evidence --status` in each
  existing project; where the evidence folder is reported as not private, the owner runs
  `evidence --protect` once. An agent never runs it for you.
- Automatic updates remain off unless you turn them on in the Setup Center.

## How it was verified, and what was not

The candidate reviewed itself in nine gate runs through its own dispatcher (Codex, Antigravity
and Grok, two-review quorum per piece). All 1,376 findings and suggestions were ruled on and
logged; 42 findings were deferred and are [listed by name](deferred-from-1.16.0.md). Every piece
of the candidate against `main` reached quorum **cumulatively over reruns, not in one run**, and
the reports cannot show which piece passed on which attempt. Two independent reviewers reported
the candidate ready on Windows; a third passed every offline check and was stopped at the live
step by a provider quota.

What this release did **not** prove. The ten-job CI matrix was reported green on the reviewed
head, but on the Windows Node 18 and 20 jobs one failing test was hidden by how a CI step reported
results, and the defect it guarded (a planted `git.exe` being started on those runtimes) was found
and fixed only after the go-ahead, before the tag. Install, upgrade, rollback and re-upgrade were
exercised by the release workflow's isolated drill, not on real machines. Media types are checked
by filename extension only. These are the debts [1.16.1](plan-1.16.1.md) exists to pay. The
sections below are the dated record, in full, including what went wrong along the way.

## Independent retest follow-up (18 September 2026)

- Reopening a valid private Setup Center launch link in the same tab now reloads
  through the ordinary authenticated bootstrap. It does not mint a session or
  bypass server authorization. Unrelated and malformed fragments do not reload.
- Private ledger tables retain readable column widths inside labelled,
  keyboard-focusable horizontal scroll regions. Short values stay together;
  prose can wrap. Page containment alone is not treated as proof of readability.
- Attachment regression failures retain child status, signal, error code, elapsed
  time, unchanged timeout and output byte counts before parsing; raw diagnostics,
  capability values and local paths are not printed by that failure summary.
- Media regression progress explicitly marks each completed case PASS or FAIL;
  an END marker alone is no longer ambiguous. These are diagnostic improvements,
  not a claim that BAB's native suite timeouts are resolved. Local passes do not
  invalidate her failures; bounded independent retesting remains required.

These changes remain candidate repairs pending exact-source peer review,
cross-platform CI and the signed release/install lifecycle.

## Independent-audit repair pass (17 September 2026)

Credit: Bab PA (the independent reviewing personal agent) used controlled tests
to distinguish product defects from unavailable accounts and test-host limitations.
See the [independent test report](https://github.com/marroccofella/skills/pull/4#issuecomment-5713628509)
for its exact environment, revision and limits. The following repairs still require final
source review, independent retest and the release gates below.

- An inconclusive CLI version check stays unknown, rather than reporting that the
  CLI is absent and suggesting reinstall or login.
- Served ledgers revalidate on reload and return an explicit unavailable response
  when rebuilding fails, rather than serving an old validation page as current.
  Damaged records and missing modern reports are visible integrity warnings;
  valid records remain available. Evidence tables have their own keyboard-focusable
  horizontal scroll region on narrow screens.
  Follow-up concurrency controls cover both scheduled/on-demand timer orders and
  requests arriving after an older rebuild has already read its inputs. Those
  later requests await a fresh rebuild, not merely the older run's completion.
  A subsequent real-HTTP regression also covers the serving layer: late readers
  queue behind a started rebuild rather than bypassing the watcher's barrier by
  sharing the earlier HTTP promise. Three failure/success orderings failed before
  the repair and passed afterward in `scripts/ledger-serving.test.mjs`.
  Setup Center reviewer-card headings and status badges wrap at narrow widths.
- Metadata-only update commands allow natural shutdown after output flush, with
  a bounded fallback. Review and mutating-command termination are unchanged.
  Bab PA's matched Windows controls passed on `da7c0ab` for the previously observed
  native assertion (12 native cases across Node 24.18 and 24.19; linked report above).
  Related repository checks are `scripts/information-shutdown.test.mjs` and
  `momm/scripts/shutdown.test.mjs`. This is scoped independent evidence, not a
  universal crash-free claim or closure of the separate modality-suite timeout.
- Missing or malformed package seals refuse before expensive package hashing.
  This is not a valid-seal hashing performance improvement or signed-release proof.
- Release test, 18 September (fresh clone, Windows 11): the permission check below made the
  candidate unusable on the test machine. `.ensemble_reviews` was created with a plain mkdir, which
  inherits the parent's access list, and then had to be private; every project on a data drive
  inherits access for other local accounts, and the profile temp and Documents folders carried
  groups added by a desktop sandbox, so no directory could run a review and every existing
  evidence folder was refused. CI stayed green because the suites injected a fake inspector.
  Fixed: on Windows a folder MOMM creates itself now gets its private access list at creation
  (the same CreateDirectoryW path the scratch folders use); an existing folder is still only
  inspected, and the refusal now names the reason in words and the owner's remedy. A new explicit,
  owner-invoked `multi-review.mjs evidence (--status | --protect)` restricts an existing
  `.ensemble_reviews` (Access section only, no ownership change, never any other directory).
  Native tests now run the real inspector against a MOMM-created folder under a broadly
  readable project and against the protect action; eight synthetic checks cover the decisions.
  **Upgrade note for Windows:** after moving from 1.15, run `evidence --protect` once in each
  existing project whose evidence folder is reported as not private.
- Release gate, 18 September (run `rev_20260918172020_ehti`, the 392 KB delta since the last gated
  tree through the candidate's own dispatcher with `--split`, Codex, Antigravity and Grok, two-review
  quorum per piece): quorum on 9 of 12 pieces, 31 findings and 67 suggestions, every one ruled on and
  logged. Real and fixed, each with a failing test first: `evidence --protect` would have changed the
  access list of a hard-linked file at its other location too (reproduced on Windows), so it now
  surveys the whole tree first and refuses hard links, links, junctions and special files before
  anything is changed, and on POSIX changes modes by verified descriptor rather than by path; the
  ledger showed a stored report whose bytes no longer match the digest sealed in its run record, and
  now withholds it with a warning; PowerShell helpers receive pure-ASCII JSON on stdin so a
  non-ASCII project path survives an OEM console code page; skill tests import nothing outside
  `momm/`, so they run from an installed skill; version banners with a `v` prefix parse; the Setup
  Center keeps its launch capability when the session reply omits it. Rejected with evidence: two
  "syntax error" criticals (artefacts of the diff being cut into pieces; `node --check` passes and
  the braces match), the claim that `Get-Acl -LiteralPath` is unsupported (it is, and the native
  suite passes), and several "untested" claims whose tests exist and fail when the rule is removed.
  The condensed third-party test plan regained its fail-closed controls, and the CLI reference pages
  now state the exact Antigravity argv and stdin, the Copilot JSONL success events and which command
  classes use the Windows post-flush delay.
- Release halt and launch-guard correction, 19 September: after the owner's go-ahead the sealed
  candidate was squash-merged to `main` (`434dd1a`) and the push-event CI failed on Windows Node 20.
  Two real problems, both missed until then. First, **Node 18 and Node 20 on Windows ignore
  `NoDefaultCurrentDirectoryInExePath`**, so on those runtimes the dispatcher still started a
  `git.exe` planted in the reviewed project; Node 22 and 24 honour it, which is why the governor's
  machine and all three independent confirmations (Node 22.16, 24.18, 24.15) passed the control.
  Second, **CI hid it**: the step that runs 27 suites used the Windows default shell, where only
  the last command's exit code counts, so the repository's own planted-`git.exe` test had been
  failing unseen on the Windows Node 18 and 20 jobs on every head since round four. "10 of 10
  green" was overstated for those two jobs; the logs show this was the only hidden failure. Nothing
  was tagged or published. Fix: MOMM no longer hands a bare command name to spawn on Windows. The
  shared launch chokepoint (`process-scope.mjs`, `windowsTool`) resolves every tool itself: system
  tools from System32, anything else from absolute PATH entries outside the working directory, and a
  name found nowhere becomes a path that cannot exist, so the launch fails as ENOENT. With a shell
  the shell is `System32\cmd.exe` by absolute path and the child carries the variable, which
  `cmd.exe` honours on every Windows. The direct launch sites got the same treatment (the governor's
  `git`, the Setup Center's terminal and browser openers, the ledger opener, the update clock), the
  dispatcher's PATH search ignores relative entries, and the CI step now runs under `bash`, which
  stops at the first failing suite. The guard variable stays as a second layer. The fix went through its own
  delta review (run `rev_20260919182102_p7hw`, three valid reviews): Codex and Grok both raised one
  real gap, that a PATH entry of `.`, a relative entry, or an entry inside the project would still
  let `cmd.exe` choose a planted file for shell launches; every child now gets a PATH without such
  entries. One finding was wrong (the fixture does define `realpathSync.native`; the suite passes
  here and in CI). CI run 35460503759 shows the planted-`git.exe` test passing on Windows Node 18
  and Node 20, read from the job logs rather than the badge.
- Final delta, 19 September (run `rev_20260919104506_po1k` on `b8cef55`: the three round-six fixes,
  10 KB, one piece, `--retry-invalid` on): Codex ACCEPT, Antigravity ACCEPT, Grok ACCEPT, no
  findings, no retry needed. Five suggestions ruled on and logged, none applied, so the reviewed
  head did not change. Across the chain `1nkh`, `h6hn`, `2l49`, `4dn1`, `po1k` every piece of the
  candidate against `main` has had a two-review quorum and every finding and suggestion has a logged
  ruling. Two limits: quorum was reached cumulatively over reruns rather than in one run of the
  whole source, and `governor.mjs --record` cannot issue its completion receipt for these runs
  because it accepts only `git diff HEAD` or a file input as the source snapshot, while the gate
  reviewed committed ranges from stdin. The sealing commit on top of `b8cef55` changes no behaviour: under `momm/scripts/` it renames two
  synthetic test-fixture values (`"lowercase"` and `"registry"`, assigned to token-named keys in
  `probes.test.mjs` and the Setup Center self-test) to `fixture-…`, because the myrepo publication
  scan rightly refuses anything shaped like an inline credential and is never waived. It also adds
  these lines, pins the bootstrap links to the signed tag, extends the
  manifest change list and regenerates the pages.
- Gate rerun six, 19 September (run `rev_20260919102005_4dn1` on `076232c` with `--retry-invalid`:
  the 6 pieces that missed quorum plus the round-five changes, 484 KB in 18 pieces, same three
  routes, 81 minutes): **quorum on 18 of 18 pieces**, the first run in which every piece was covered.
  19 of 54 first answers were rejected as invalid output (35%, the same rate as before); each was
  re-sent once and 15 came back valid, so 50 of 54 reviews counted. The report lists every retry.
  56 findings and 118 suggestions, all 174 ruled on and logged: 3 fixed, 35 rejected with evidence,
  18 deferred to 1.16.1. Both marked critical repeat earlier rounds and were rejected again after
  fresh checks: oversize hunks are `governor_direct` by design (the report lists each one,
  `outstanding.complete` stays false, and `governor.mjs` refuses completion until the governor
  records direct coverage for each; `governor-split.test.mjs` 11 of 11), and the Setup Center session
  (measured over loopback on the real server: 403 without the token, 403 with a wrong one, 200 with
  the launch token; the page sends the fragment token on its first request). The one code defect:
  a version scan already running when an apply finished could refill the Setup Center cache with
  the old versions; scans are now tied to an epoch that an apply advances. Two CLI reference
  sentences were corrected (the Grok page recommends the `--deny` rules the dispatcher uses; the
  1.15.0 candidate's `--tools ""` form never shipped). What remains for the review gate is the
  small delta these three fixes create.
- Owner decision on closing the gate, 19 September: keep the exact-quote contract strict and add an
  opt-in `--retry-invalid`. A review whose answer is rejected as invalid output is re-sent once to
  the same route; an outage was already retried once, and auth failures, retired tiers, timeouts
  and hard errors still never retry. It is off by default because it spends provider quota. The
  second answer passes the same validation, a valid review is never retried, and the report
  discloses every retry (`gate_policy.retry_invalid`, `attempts`, `retried_after`,
  `first_attempt_detail`, `retried_pieces`). Self-tests pin the exact call counts: one call without
  the flag, two with it, never three.
- Gate rerun five, 19 September (run `rev_20260919044643_2l49` on `b598bb5`: the 7 pieces that
  missed quorum plus the round-four changes, 644 KB in 23 pieces, same three routes, 77 minutes):
  quorum on 17 of 23 pieces, so the gate has still **not passed**. 76 findings and 116 suggestions,
  all 192 ruled on and logged: 20 findings fixed or their tests strengthened (each reproduced first), 49 rejected with
  evidence, 7 deferred. All 4 marked critical were wrong: two said Copilot attachment names reach `cmd.exe`
  (staged files are renamed `attachment-<n><ext>` in a private folder, and Copilot is launched as
  `node.exe` plus the verified package entry without a shell; a `.cmd` shim with no verifiable
  package is refused; checked with a folder named `bin & echo BIN_INJECTED`); the two stale comments
  that caused the reading are corrected; one said the Setup Center cannot start a session (the token
  arrives in the launch URL fragment and is sent on the first request: 403 without it, 200 with
  it); one said `clockPost` returns nothing (it returns its value; the reviewer saw a cut piece).
  Real defects fixed: a lock file holding an impossible process id was read as a live owner for
  ever; a failed update left its error showing after a later success; removing the macOS timer left
  its plist, so the timer came back at next login; the updater looked for a tool on the parent's
  PATH instead of the child's; null settings threw a bare TypeError; a failed version read lost its
  reason when a probe ran; after an apply the Setup Center showed the old installed versions for up
  to ten minutes; a ledger rebuild that threw left the previous exit code beside the error; Copilot
  output that is not an event stream could be pattern-matched as a login problem and echoed;
  `--jobs 2foo` was read as 2; a modality probe record with an unreadable time stayed "latest" for
  ever; `x.constructor` was accepted as a media extension (inherited property lookup; routing
  refused it later); the privacy scanner missed upper-case URL schemes (a false positive that failed
  closed, not a leak). CI found a clock-dependent probe test on macOS Node 20 (fixed in `734cfe6`).
  One protocol slip to record: while checking `--timeout`, a triage agent ran the dispatcher with
  `--timeout -5` in a scratch folder; the parser clamps that to one second, so Codex was started
  for about one second against a two-byte dummy file containing `x`, then timed out. No project
  source was sent. Reviewer reliability across the five gate runs: 285 reviews succeeded and 120
  failed (30%); 70 of the 120 were exact-quote contract rejections. At that rate roughly one piece
  in five misses a two-of-three quorum in any single run, which is what every rerun has shown, so
  reruns alone will not make every piece pass in one run. How to close the gate is the owner's
  decision and is not changed here.
- Full-source gate rerun, 19 September (run `rev_20260919023950_h6hn`: the 12 pieces that missed
  quorum plus every file the round-three fixes touched, 826 KB in 28 pieces, same three routes):
  quorum on 21 of 28 pieces, so the gate has still **not passed**; the seven misses were again
  reviewer-output failures, not outages. 92 findings and 176 suggestions, all 268 ruled on and logged:
  34 findings fixed, 52 rejected with evidence, 6 deferred. Of 3 marked critical, 2 were real. First,
  a Windows launch hijack: for a direct launch of a bare command name (`git`, `taskkill`), Windows
  looks in the **calling** process's current directory before PATH, and MOMM runs inside the project
  under review. Reproduced on Windows 11 with Node 22.16 by planting a `taskkill.exe` and then a
  `git.exe` (copies of `node.exe`) in a scratch project: both were started. Setting
  `NoDefaultCurrentDirectoryInExePath` only in the child's environment does not help, because the
  lookup happens in the parent. Fix: every script that starts a process sets that variable on its
  own process with one inline line (`momm/scripts/launch-guard.mjs` holds the explanation and the
  reference implementation; an import was tried first and broke scripts that run as single copied
  files, so the guard is inline); System32 tools are launched by absolute path as well;
  `scripts/launch-guard.test.mjs` fails if a process-launching script lacks the guard. Second, with
  an injected hint-only skill source the automatic-update pass re-ran the signed updater on every
  pass because the hint survived a successful apply; the hint is now cleared. The third (oversize
  scope "never dispatched") repeats a round-three item and is the designed `governor_direct` path.
  Other real defects fixed: a stale update lock was removed by path rather than captured by rename;
  the Windows scheduled-task command was built as one string; project guidance was protected
  against a link at the leaf but not in a parent directory; `--timeout` accepted values Node turns
  into a 1 ms timer; `guidance --trust` accepted a short digest prefix; and a dead early read of
  `.reviewrules` in the dispatcher, which bypassed the guidance layer's no-follow checks, is removed.
  A Windows Node 22 CI flake in the legacy-migration suite (fixture blob delivered in a pack rather
  than loose) now has a layout-independent fixture.
- Full-source gate, 19 September (run `rev_20260919000938_1nkh`: the whole candidate against `main`,
  1.85 MB across 109 files, 59 pieces, Codex, Antigravity and Grok, two-review quorum, 186 minutes):
  quorum on 47 of 59 pieces, so the gate has still **not passed**. Every miss was a reviewer-output
  problem (26 of 45 failed reviews were exact-quote contract rejections, the rest malformed JSON);
  no provider outage and no MOMM fault. 200 findings and 334 suggestions, all 534 ruled on and logged:
  75 findings fixed (each reproduced with a failing test first), 116 rejected with evidence, 9
  deferred. Of 11 marked critical, 3 were real: rollback refused a link whose target was the same
  place spelled differently; merging a split run with zero pieces threw; `--strict` did not fail a
  run whose split route was only partly reviewed. The other 8 were artefacts of the diff being cut
  into pieces, designed behaviour with its test cited, or not reproducible on this machine (a real
  junction unlinks cleanly under Node 22 on Windows 11). One artefact was self-inflicted: MOMM's own
  secret redaction rewrote a test variable named `secret` into `[REDACTED]`, which a reviewer then
  read as invalid syntax; the variables are renamed. Real defects fixed elsewhere: a `.cmd` planted
  in the working directory could run in place of a real tool during version checks; paths containing
  `%NAME%` broke command launches; a grandchild holding pipes turned a 700 ms timeout into 9 s; the
  automatic-update pass continued after the owner switched it off while it waited for its lock; a
  failed version re-read ran an updater twice; probe and updater children inherited credential-shaped
  variables the dispatcher withholds; a Copilot 5xx was classified as a login problem; an unrelated
  extra input file was staged and sent in a chain; a pre-existing file could verify a generative
  probe; an untrusted oversize `.reviewrules` aborted the review instead of being dropped; project
  guidance files were read through links; the guidance sidecar directory was created without an
  owner-only mode on POSIX; four Setup Center colour pairs were below readable contrast; the public
  Updates page still said no automatic-update setting exists. BAB's reported migration "timeout" was
  reproduced as a slow, silent suite (55 to 64 s, 28 tests); it now prints per-test progress.
- Gate rerun, 18 September (run `rev_20260918185005_hwu4`: the pieces that missed quorum plus every
  file the fixes touched): quorum on 11 of 13 pieces, so the gate has still **not passed**; the two
  misses are reviewer quotes failing the exact-quote contract, not provider or MOMM failures. No
  Codex review was lost to the scratch check this time, and the report records `scratch_access` for
  Codex. 23 findings and 64 suggestions, all ruled on and logged. Real and fixed with a failing
  test first: a file swapped for a hard link between the protect survey and the change (the script
  now holds each entry by handle, without delete sharing, across the change); a rejected launch
  token that stayed in the Setup Center tab's storage; a ledger change during a rebuild costing
  three rebuilds instead of two; `evidence` accepting unknown or contradictory flags; a test
  fixture that accepted a directory which gained an entry before protection; several tests that a
  mutant survived. Rejected with native evidence on this machine: the repeated claim that
  `Get-Acl -LiteralPath` is unsupported under PowerShell 5.1, and two claims that the sandbox
  allowance could not work (a single tolerated group does come back as an array, and the
  dispatcher accepts the inspector's shape; both are now pinned by native tests). Kept by design:
  locks are never stolen on PID or age, and recovery stays explicit.
- Found by the gate itself: on Windows the Codex CLI grants its own `CodexSandboxUsers` group
  read access to its working folder as soon as the model runs a sandboxed command (reproduced 2 of 2;
  never with a prompt that runs nothing). The post-run scratch check then discarded the review,
  which cost 4 of 12 Codex reviews and quorum on three pieces. The scratch must still start strictly
  private; afterwards, for the Codex route only, a rule for a principal whose account name is
  `CodexSandboxUsers` and whose rights are read-and-execute only is tolerated, the review is accepted
  and the report records it (`scratch_access` on the reviewer entry, `scratch_access_routes` in the
  evidence block). Write access, any other account, any other route and the durable evidence folder
  are refused exactly as before. Matching is by account leaf name, which is the documented limit of
  this allowance.
- The dispatcher checks project evidence-folder permissions before collecting
  review input and checks again before persistence. Unavailable or ambiguous
  protection refuses without changing existing permissions. A late persistence
  failure remains visible in the stdout report. Mode bits alone do not establish
  Windows privacy. Standalone ledger generation, completion recording and media
  execution also refuse unverified evidence storage. Reviewer prompt and attachment
  staging now uses a separately protected, newly allocated temporary directory,
  outside the durable evidence tree. Windows protection is applied at creation;
  existing workspace permissions are not reset. The scratch boundary is checked
  again before cleanup; failed verification or cleanup prevents a successful
  review result. A provider changing its scratch permissions therefore does not
  contaminate the permanent ledger's permission tree. Native synthetic tests cover
  separation, changed scratch permissions, refusal and cleanup; live-provider and
  final cross-platform acceptance remain release gates.
  Checks describe access rules at inspection time, not immunity to later permission
  changes, privileged access, provider-owned caches or a compromised user account.
- The Setup Center requires a private launch capability for its API, including
  session and status reads. Open its terminal-provided private link; the browser
  removes the fragment and retains the capability in tab-scoped session storage.
  Ledger navigation uses a short-lived, single-use ticket. Do not share the launch
  link. The public website and saved base dashboard URL carry no capability.
  Loopback HTTP and browser-bootstrap regression tests cover unauthorized reads,
  ticket reuse and malformed URLs; these are not OS-level isolation guarantees.
- Explicit Grok cancellation no longer certifies a recognition answer or appears
  only as missing generated output. Cancellation cause remains unknown unless
  separately established. Auxiliary 429 warnings alone do not invalidate a
  completed answer, prove exhausted quota or authorize automatic retries.
  Terminal cancellation envelopes without a text field also override earlier
  successful-looking answers (`scripts/media-cancellation.test.mjs`).
- Generated media already produced by a cancelled, timed-out or nonzero-exit step
  is retained and hashed where harvesting succeeds, without converting that step
  into success or forwarding its output to the next step. Synthetic preservation
  tests are not image-quality or live-provider evidence.
  If a media run cannot save its terminal report, it explicitly reports that the
  saved status is stale. Artifacts are retained; the original error is available
  as the non-enumerable `cause` on `MOMM_MEDIA_EVIDENCE_WRITE`, not copied into
  public diagnostic output. A distinct persistence failure is kept privately as
  `write_cause`; public `evidence.write_error_code` uses a fixed safe vocabulary
  (unknown codes become `unknown`). Neither private cause is JSON-serialized.
  The refusal regressions are in `momm/scripts/modality.test.mjs`.
  The last successful step now saves its terminal state in one checkpoint, and
  failed steps do not rewrite an unchanged terminal report. Synthetic success
  and failure cases each went from three saves to two (initial plus terminal).
  Every remaining save retains its fresh permission check; no permission result
  is cached. Independent timing acceptance is still required.
  A follow-up coalesces the initial running-report save with the first dispatch
  boundary, after input staging and any harvest-lock wait. The native regression
  reproduced four permission inspections for a one-step run before the repair
  and requires three afterward: project preparation, checked pre-dispatch save,
  and a fresh post-provider save. Both durable checkpoints remain; preparation
  errors still enter terminal-state handling. This removes a redundant empty-run
  inspection, not a privacy boundary. The 180-second suite budget is unchanged.
  During preparation, before the first dispatch checkpoint, the allocated run
  directory may not yet have `report.json`. A hard process kill in that window
  can leave a retained preparation directory without a status record; do not
  infer completion or delete its artifacts. Caught preparation failures still
  write an error report. This is not crash-atomic preparation or fsync durability.

The new deterministic controls use synthetic inputs; the native inspector runs, the real-HTTP serving regression and the matched Windows shutdown controls named above are real executions and are stronger than that. They do not substitute for retained live
generation, independent image critique, final-source quorum, exact-head CI,
publication privacy scans, or signed clean-install/upgrade/rollback proof.
The independent Windows modality-suite timeout remains open: repeated ACL
inspection subprocesses dominated the measured runtime. Passing runs on another
machine do not erase that failure; privacy checks are not skipped or cached to
make the test pass.

## Final candidate retest (15 September 2026)

### Lock recovery safety correction

Capability, trust, guidance-editor and media-harvest locks no longer automatically
delete an existing record based on a dead PID, malformed contents or age. A
concurrent writer can replace the record between inspection and deletion; a
second PID/inode check does not make that operation atomic. The regression covers
dead, unpublished and malformed records across all four lock sites, positive
acquisition controls, and bounded retries when contended records disappear.
Normal writers still serialize and release their own locks.

Final repair review also added a typed privacy refusal when Windows' system
directory is unavailable, and made Claude media audit labels disclose their
effective tool list without including prompts or file paths. Synthetic
failing-before/passing-after tests cover both corrections; this is not a claim
of live-provider or cross-platform release certification.

This intentionally changes crash recovery: stop all MOMM writers (including older
installed versions), independently confirm they are stopped, then remove only the
specific abandoned lock identified by the diagnostic and retry. Do not delete
the associated state, trust file or media. PID/age alone is not sufficient. Mixed
old/new workers are not a supported upgrade state; older workers can still steal
locks. These cooperative locks are not an OS isolation boundary against another
process running under the same account.

Core only: the separate MOMM World project is not included. Publication, signed
installation/upgrade/rollback proof and the exact-final cross-platform matrix
remain release gates; this section does not claim that 1.16.0 is already stable.

- Two real text → image → description chains completed through the Codex route.
  Four earlier images and both new images were retained with prompts, run IDs
  and SHA-256 hashes in private evidence. No images are published by this release.
  A description alone was not counted as prompt compliance.
- Claude and Antigravity both returned usable MODIFY reviews of the exact paired
  images. The revision improved hat size and lighting, but both found an ear/brim
  intersection that the governor also observed. This is not evidence of perfect
  image generation or cross-machine provider reliability.
- An earlier Antigravity attempt ended with a provider capacity error and did not
  count toward quorum. Terminal error envelopes now retain their error status
  even when followed by telemetry; nested answers in failed envelopes remain
  rejected. Deterministic regressions cover the envelope variants.
- The optional image-region field now agrees between the strict provider schema
  and local validation. Malformed coordinates are refused, not silently discarded;
  existing text reviews do not need the additive field.
- Public-document privacy regressions discover new guide/reference files. The
  sitemap uses an explicit sibling-guide catalogue, excluding scratch pages.
  These checks supplement the mandatory publication secret and history scans.
- Documentation and tests agree that automatic updates and automatic protocol
  acceptance are separate, off-by-default settings. Neither was enabled during
  this retest. Human permission is required before changing either.
- Follow-up (16 September): an expired Claude OAuth session exposed a missing
  diagnostic match. It now receives `authentication_required`, an official login
  hint and safe recovery text instead of an echoed provider envelope. A synthetic
  failing-before/passing-after regression preserves timeout/outage precedence.
  The last live gate reached only 1/2 reviewers; the final two-reviewer gate and
  exact-final CI remain outstanding. Forty-one local suites/checks passed under
  normal Windows permissions; this is not macOS/Linux live-provider coverage.

## What a user notices

- **Every review reports what it cost.** `reviewers[].usage` carries each CLI's own token and cost figures (Claude and Grok: full usage and USD; Codex: total tokens, model and CLI version from its `tokens used` line; Antigravity and Copilot: nothing, and the report says so), plus a labelled `input_estimate`. `usage_totals` is per route only; the ledger shows "k of n reported", never a zero for missing data.
- **Reviewers get a report card.** After triage, `ledger.mjs --rate <run_id> <reviewer> <1-5> --tags …` records how the review read; the ledger shows mean rating (from five ratings up), tag frequencies, and a 30-day completion table by route and input size with a recommendation only once ten dispatches exist. Early exits and governor-direct pieces are excluded from completion rates.
- **Standing guidance.** `.momm/guidance.json` per project (trusted once by hash: `multi-review.mjs guidance --trust <sha>`), `~/.momm/guidance.json` per user, `--guidance route=text`, `--guidance-file`, `--guidance-governor`. Persona stays a selector; every other layer appends; per-block and per-route budgets; the report keeps hashes only and the text lives in `.ensemble_reviews/guidance/<run>.json`. `.reviewrules` is now a guidance layer with a one-release trust grace.
- **Big diffs stop timing out by hand.** `--split auto|<KB>` packs files by directory affinity into pieces, repeats only file headers, reviews every piece through a bounded scheduler (`--jobs`), judges quorum per piece, merges one parent report with per-piece outcomes, divides a hunk larger than the ceiling (a whole new file, for instance) at line boundaries into consecutive valid sub-hunks so routes read every line of such a hunk. The one exception is a hunk in which a single line is itself larger than the ceiling: no route reads that hunk, and it goes whole to the governor as `governor_direct` scope rather than being dropped or fragmented (`--no-line-split` keeps every over-ceiling hunk governor-direct). Header-only quotes never corroborate.
- **Dashboards.** Setup Center and ledger follow the system theme with a toggle. Setup Center gains a guidance editor with an effective-prompt preview (artifact replaced by a placeholder), a usage panel, an automatic-updates card, batch CLI update with one confirmation, and auto-regeneration of the ledger while it is open.
- **Updating.** `update --check-all` lists the skill, every reviewer CLI (installed, latest, package-manager-owned), and each route's last successful review. The event-driven update clock checks sources only when due, with conditional GETs (a 304 costs nothing), doubling intervals when nothing changes and tightening after a release, triggered by reviews, Setup Center use, or an optional OS timer. Automatic updates are **off by default**; when enabled they apply only signature-verified skill releases and official CLI updaters, never bypass a failed verification, keep protocol changes behind explicit acceptance unless that toggle is also on, and run containment probes after every CLI change.

## Live measurement

| Artifact | Method | Wall clock | Quorum |
|---|---|---|---|
| 135 KB 1.15 gate diff, 3 routes | manual lanes, 15 hand-cut pieces (2026-09-13 00:41) | ~26 min | 5 of 15 pieces |
| Same diff, `--split 12 --jobs 6` (run rev_20260913134425_f4kn) | one command, 15 pieces, 37 successful route reviews (Codex 14, Antigravity 14, Grok 9) | 36.6 min | 15 of 15 pieces |

Reading: quorum coverage tripled, wall clock was slower. The scheduler ran at most six reviewer processes (the hard cap) where the hand-cut lanes ran nine, and Codex needs about 100 s per 12 KB piece, so throughput is bounded by concurrency, not by splitting. Per route: Codex 14 of 15 pieces, Antigravity 14 of 15, Grok 9 of 15 (six exact-quote rejections). Usage was recorded for Codex (149 K tokens across 14 pieces) and Grok (578 K across 9); Antigravity reports none. Tuning for the next candidate: allow `--jobs` up to 9 when three or more routes are active, and let per-route caps come from the ledger.

## E7 — modality registry and capability-aware routing

Added to the candidate on 2026-09-13 evening at the owner's direction: MOMM must know what each CLI can take in and produce so the governor routes each job to a route that can do it, and so a job needing several modalities can be composed across routes without weakening the review core. Design in [plan-1.16.0-e7-modalities.md](plan-1.16.0-e7-modalities.md) (revision 3 after two momm reviews, `rev_20260913200258_g63x` and `rev_20260913200824_pd6p`, 28 findings applied and logged); live capability research with probe log in [cli/modalities.md](cli/modalities.md).

- `references/capabilities.json`: the shipped baseline, 6 routes × 12 cells; a cell is `verified` only when a help capture names the flag (file:line and version recorded), `documented` from vendor documentation, `model-only` or `no`. The only baseline blocker is Antigravity's headless `run_command` allowlist. `capabilities.mjs` validates it (docs-only `verified` is rejected), reads the per-machine overlay `~/.momm/capabilities-<machine>.json` (written only by probes; entries bound to machine, CLI version and login identity; expiry by blocker class: quota 24 h, zdr/allowlist/auth_tier/missing_flag 7 days, probe_failed until the next probe), and exposes the effective matrix. Expired or invalidated entries become blocker `reprobe`; a blocker never clears by time alone. 19 tests.
- `modality.mjs plan --need <chain> --prompt <text>` is pure and names, per step, the routes that can serve it, the blockers in the way and the exact clearing action; `run --plan <file> --consent` executes a chain through each route's non-interactive mode with the user's prompt immutable on every step, artefacts bound through the input cell's argv template, and **step-scoped harvest**: a snapshot of the harvest glob before the step, only files new or changed afterwards are staged (sha256, `momm-media/1` report under `.ensemble_reviews/media/<run>/`), and a step that produced nothing fails the chain. 17 tests including two concurrent runs staying separate.
- `probes.mjs <cli> --modalities [--consent]`: synthetic PNG, PDF and one-second tone, each asserting the reply describes the planted content so a generic answer never counts; gate detection from the reply (zdr, auth_tier, quota, allowlist, missing_flag); a deterministic disclosure before any generation; blocked cells skipped with exec never called; a failed probe keeps the baseline level and records `probe_failed`, never `no`. 12 new tests plus a real-registry round trip (probe_failed → level stands → success clears → CLI upgrade reads `reprobe`).
- Dispatcher: `MODALITY_SUPPORT` is now the baseline projection with a self-test that fails on drift; attachment routing reads the effective cell and binds `requires` (Antigravity `--new-project` plus `--add-dir`, Copilot `--attachment`) or refuses with `missing_flag`; `--reviewers auto` is the intersection of routes that can take every attachment and refuses with per-modality options when empty; `--capabilities [--json]`; the report carries `capabilities_used` with level, blocker and source per route and modality. 8 new self-tests (94 total).
- Setup Center: `GET/POST /api/capabilities` and a Modalities panel — chips at the four levels, blocker badges with clearing actions, probe inputs per route, probe generation only with consent and the exact disclosure echoed back, a planner form. 11 new self-tests and 5 maintenance tests.
- E7 gate: run `rev_20260913213315_o8c2`, the staged E7 diff (344 KB) through `--split auto --jobs 6` with a 600 s budget; 13 pieces, quorum met on all 13; Codex 13/13, Antigravity 12/13, Grok 8/13 (five contract rejections), Copilot 0/13 (quota). 49 findings (0 CRITICAL, 42 WARNING, 7 NITPICK; eight corroborated by two or three routes) and 87 suggestions. Every finding was reproduced with a failing test first by three fixers working per file area, then fixed: 47 applied, 2 applied with modification (the audio refusal gate reuses the canary refusal pattern instead of widening it; the recovery probe for `probe_failed`/`reprobe` cells is a design rule, everything else stays skipped), none rejected. Suggestions: 60 applied, 6 with modification, 19 rejected with reasons, 2 deferred (media-content validation in the runner; a consent allow-list handed to the probe worker). Suites after: capabilities 40, modality 30, probes 44, dispatcher self-test 99, Setup Center self-test 69, maintenance 73; the CI-equivalent run passes every step except the legacy installer dry-run on this machine (existing links). All 136 decisions are logged against the run with the governor's item ids and report/input hashes; `governor.mjs --run` joins every row to its obligation and reports one remaining gap, the `momm-check/1` verification manifests, which no gate in this candidate has produced yet (the 1.15 completion validator is stricter than the evidence this release records; sealing it is listed under still owed). Reviewer ratings recorded (Codex 5, Antigravity 4, Grok 3).
- Live on this machine (2026-09-14 00:02, `probes.mjs <cli> --modalities` for all six routes, input probes only, no generation): 12 overlay entries. Codex image, Claude image and PDF, Antigravity image and PDF, Grok image and PDF answered with the planted colour or sentence and are `verified` here; Gemini returned `IneligibleTierError` and carries `auth_tier`; Copilot returned "exceeded your monthly quota" and carries `quota`. The derived pipelines then read: image critique codex, claude, antigravity (gemini and copilot blocked); PDF critique claude, antigravity; audio critique none. Disclosure: each probe sent one synthetic 64×64 PNG, one synthetic one-page PDF and, where the cell exists, one synthetic one-second tone to the provider under the account login; nothing from any project was included. Gap found by this run and fixed after it: an account-level blocker (`auth_tier`, `quota`) recorded on the probed cells left the route's unprobed cells routable, so the matrix advertised "video critique: gemini"; route-level blockers now cover every non-`no` cell of the route.
- Empirical run-through (2026-09-14 00:20–00:35, this machine, account logins, every artefact kept under the session scratchpad and `.ensemble_reviews/media/`):
  - CI: run [34786375037](https://github.com/marroccofella/skills/actions/runs/34786375037) on `865e645` passed all nine jobs after two portability fixes (a not-yet-existing file compared against a realpath'd directory; a lock owner that stayed a zombie during a synchronous wait on POSIX).
  - Re-probing Gemini after the route-level rule landed: `route_level` applied `auth_tier` to `input.text`, `input.video`, `output.text`, `output.code_exec`, `output.web`; `--capabilities` then reads "video critique: none — blocked: gemini (auth_tier)" where it had advertised Gemini. The first re-probe wrote nothing because `gemini --version` exited non-zero while still printing `0.59.0`; the version is now the printed semver whatever the exit code (test `version_is_the_printed_semver_whatever_the_exit_code`).
  - Registry-routed review with an attachment: run `rev_20260913222755_hom7`, a synthetic red PNG (sha256 `a65fd901…`) attached to a six-line diff that only mentions blue, `--reviewers auto`. `reviewers_auto.selected` = codex, antigravity (claude self-excluded as governor; gemini `auth_tier`; copilot `quota`; grok `missing_flag`); `capabilities_used` names the image cells as overlay-sourced. Both reviewers reported the colour the diff never stated ("the supplied banner is red"; "matching the attached red.png banner"), one corroborated finding `red-banner-colour-omitted`.
  - Cross-route chain: `modality.mjs plan --need {"chain":["text","image","text"]}` chose codex for both steps (candidates codex, antigravity, grok for generation; codex, claude, antigravity for critique; gemini and copilot listed with their blockers); `run --consent` produced `media_20260913222639_3df629d2`: step 1 harvested one PNG (745,440 bytes, sha256 `5a864ac9…`, a solid green triangle on white, inspected), step 2 replied "a plain, solid green triangle centred on a white background"; the prompt hash is recorded and no prompt text travelled in argv. Then run `rev_20260913223154_t928` attached that Codex-generated PNG to an Antigravity-only review of a diff claiming "A blue square logo": Antigravity's finding `mismatched-logo-alt-text` says the constant "contradicts the attached green triangle logo asset" — one route generated, another route judged.
  - Negative controls: `--reviewers gemini --attach` was not dispatched ("blocker auth_tier … source overlay; routes that could: codex, claude, antigravity"); `--reviewers grok --attach` was not dispatched ("adapter cannot satisfy --cwd {dir} … blocker missing_flag"). Neither sent anything to the provider.
  - Setup Center, served live on 127.0.0.1: the Modalities panel rendered six routes with 79 chips; the panel header reported 11 blockers on this machine and the badges captured were six `auth_tier` on Gemini, two `quota` on Copilot and one structural `allowlist` on Antigravity, each route's last probe time and verdict, and the per-route probe and generation buttons.
  - Disclosure of provider traffic in this run-through: six input-probe sets (synthetic PNG, PDF and tone), two further Gemini probe sets, three review dispatches (codex, antigravity ×2), one consented image generation and one image description on codex. Copilot's quota and Gemini's tier were refused before any content was processed.
- Readiness audit (independent session, 2026-09-14, folder `momm-1.16-recursive-test-20260914`, verified here against sources on 2026-09-15): its four open issues and the six media-runner regressions were reproduced on this branch with failing tests first, then fixed. (1) Recursion depth: `MULTI_LLM_REVIEW_DEPTH` is parsed by one strict parser at entry and in the child environment; `-1`, `0.5` and `garbage` now refuse with exit 1 instead of proceeding, and a negative parent can no longer become a child depth of zero (self-test `recursion_depth_fails_closed`; live spawn checks recorded). (2) A saved plan that is not possible refuses with the typed `MOMM_PLAN_BLOCKED` whether or not `blocked_by` is present or well-formed. (3) Hashing the initial artefacts now sits under the run's terminal-state handling, so an unreadable input ends the saved report as `error`, never `running`. (4) The recorded step level is the weakest live cell the run checked, with the plan's stale claim kept beside it as `plan_level`. Media runner (patches captured from the `momm-1.16.0-evaluation-20260914` working tree, reviewed and folded in; the legal-review profile in that tree is separate work and was not taken): an empty plan is a typed refusal; steps must use the modality vocabulary and each step's inputs must be produced by the previous one; initial inputs must be regular files of the required modality; a text step's answer is the route's isolated non-empty reply, never blank stdout, an error envelope or provider metadata. Both `modality.mjs` and `capabilities.mjs` now detect their entrypoint by real path, so they work through the harness's linked skill directories (verified through a directory junction). New suite `modality-evaluation.test.mjs` (6 checks) runs in both workflows; `modality.test.mjs` gains three audit tests. The README badge now names the candidate version so `momm-release.mjs --check` reaches the seal check. Not taken from the audit: it also reports that the earlier gates lack `momm-check/1` verification manifests, which is already listed under still owed. Independent verification of `2647054` (same session, 2026-09-15): the four fixes confirmed by 25 controls and 35 local suites, CI run 34948279181 green, PR #4 mergeable; 11 follow-up findings rejected with reasons, 2 deferred. Known limitation carried into the release: MOMM checks initial media types by filename extension, not file contents. Malformed or mislabelled files may still proceed; downstream rejection is not guaranteed (a synthetic text file named `fake.png` completed a chain in the independent check). Content validation stays deferred. Independent verification of the documentation commit `394f41f` followed: CI run 34949846033 green on all nine jobs, so release approval can cite that head and not only its predecessor.
- Both directions, live (2026-09-15, this machine and account only; evidence for these routes, not all reviewers or modalities). Forward, a generation → description smoke test: `modality.mjs` chain text → image → text on the Codex route (run `media_20260915090046_bd21d99e`, 75 s) produced a 2.28 MB PNG (sha256 `bca6aa14…`) of a tabby cat in a brown fedora and the same route described it consistently; that description does not establish image quality or prompt compliance, since both steps used one route. Reverse, the critique that does: the image attached to a prose brief with `--governor other --reviewers auto` (run `rev_20260915091159_itvh`) fanned out to every image-capable route — codex, claude, antigravity; gemini excluded by `auth_tier`, copilot by `quota` (re-probed first: still exhausted), grok by `missing_flag`. Claude (MODIFY 0.78, 66 s) and Antigravity (MODIFY 0.95, 217 s) independently found the same real defect, no ears under the hat, plus an oversized brim, hard rather than soft light, no brim shadow and weightless hat contact; Codex (ACCEPT 0.93, 52 s) missed all of it. The governor confirmed six of seven findings by inspection and deferred the single-source pupil claim; ratings recorded (Claude 5, Antigravity 4, Codex 2). Protocol correction, recorded rather than hidden: that run was governed by the Claude harness but dispatched with `--governor other`, so Claude reviewed as a peer of its own governor; its row in that run is the governor's own route and is not independent evidence, and the corroborated defect stands on Antigravity plus the governor's inspection. `--governor other` is valid only when the controlling harness is genuinely none of the named routes. Two gaps this run exposed, both listed for 1.16.1 with safeguards in the plan: the rationaliser kept `ears-hidden-under-hat` and `missing-cat-ears` as separate single-source findings (agreement 0) although they are one observation, so corroboration should recognise the same observation across ids without merging, rewriting or dropping originals, and until then agreement 0 means "no id-level corroboration", not disagreement; and a route whose overlay entry has expired to `reprobe` is excluded from `--reviewers auto` until someone runs the probe by hand, which is the correct fail-closed default: any automatic re-probe still spends provider quota and may only run with a disclosure and explicit permission. The governor's completion check also notes this run has no dispatch-time source snapshot because the brief lived outside the project tree; a brief kept in the repository would bind.
  - Regeneration from that feedback (2026-09-15, run `media_20260915093052_36cd5466`, Codex, 61 s, 2.13 MB PNG, sha256 `0d453e86…`): prompt rewritten to name visible ears, a small hat sitting high, a brim shadow, fur compression, diffuse overcast light and symmetrical eyes. Critique of the result with the governor correctly excluded (`--governor claude --reviewers auto`, run `rev_20260915093602_whbi`, codex MODIFY 0.85 in 73 s, antigravity MODIFY 0.95 in 229 s): ears, light, hat size and eyes now pass; both routes independently reported the missing fur compression under the brim (again as two ids, agreement 0), Antigravity added an ear-base/brim clipping and stray whiskers, and its "not child-sized" finding was rejected by the governor as a prompt-wording ambiguity. Dispositions and ratings logged. Same evidence limits as before: this machine, this account, these routes.
  - Third round (run `media_20260915094319_2a019812`, Codex, 134 s, 2.17 MB PNG, sha256 `d4f19a0c…`; critique `rev_20260915094814_9vi1`, governor excluded, codex MODIFY 0.96 in 62 s, antigravity REJECT 0.95 in 160 s): the prompt named a visible gap between ears and brim and a fur dent along the brim line; the result overlapped both ears and still showed no compression, both defects reported independently by both routes (again under different ids). Antigravity's CRITICAL was recorded as WARNING by the governor: a prompt-compliance miss in a generated image. Conclusion across three rounds: the photorealistic goal is met each time; contact physics was never achieved by prompt wording alone; round two is the best image. A summary of the whole candidate for the independent Codex review is in [review-brief-1.16.0.md](review-brief-1.16.0.md).
- Decisions recorded: Grok media is not bound in the review adapter because its containment is `--deny Read`, so its image and PDF cells route as `missing_flag` until a staged-files-only read grant exists; no login identity is computed yet (the overlay treats it as not checked); generative probes run through `runModalityProbes`, the runner stays the chain executor. Both CI workflows run the two new suites.

## Deferred from the plan, on purpose

- `--early-exit` after quorum: needs in-flight cancellation inside `runProcess`; the scheduler already supports it, the dispatcher does not yet call it.
- Adaptive per-route timeouts from ledger seconds-per-KB: pieces scale with the existing size-based timeout; the E2 buckets exist so the next release can learn from them.
- `--split auto` stays opt-in until five live runs over 100 KB beat the manual baseline and the coverage fixture shows at most 10 % loss.

## Verification record (candidate, 2026-09-13)

- Local suites: 15 test files plus 5 self-tests, all green after fixes (`usage`, `guidance`, `split`, `scheduler`, `update-clock`, `probes` added to both CI workflows; OS matrix CI not yet run — the branch is unpushed).
- Release gate: run `rev_20260913143455_cx2r`, the 337 KB code diff of this branch reviewed through the new `--split 12 --jobs 6` by Codex, Grok and Antigravity; 24 pieces, quorum 2 met on all 24, 49.6 min; 66 findings (3 CRITICAL, 58 WARNING, 5 NITPICK) and 157 suggestions. Rulings: 45 applied with a failing test first, 5 applied with modification, 11 rejected (chunk artefacts or not reproduced), 5 nitpicks deferred, all suggestions carried forward. Reviewer ratings recorded with `ledger.mjs --rate`.
- Governor-direct scope: 7 hunks larger than the ceiling (whole new files) were reviewed whole as their own artifacts (runs `rev_20260913144450_tkrr`, `_144544_g83d`, `_144715_1e05`, `_145221_8nez`, `_145408_oxfr`, `_145943_7tl5`, `_150604_byvj`); 56 findings including 4 CRITICALs (probes held-by-prompt-echo and launcher verdict; guidance cross-file trust and untrusted-file crash; update-clock lock crash), 41 applied, 8 applied with modification, 1 rejected, nitpicks deferred. Two runs that missed quorum on timeouts were re-run against the fixed code with a 600 s budget.
- Line-split (rule 2b, consolidation branch off 85dc444, 2026-09-18; not published). Cause of the failed final-source quorum attempts: the splitter never divided a hunk, so a whole new file over the ceiling was one `governor_direct` hunk that no route read, and reviewing it whole produced prompts that routes rejected or timed out on. Measured offline with zero model calls on the full `momm/scripts` + `SKILL.md` source as a diff from the empty tree (1,461,308 bytes, 45 files, 40 KB ceiling): before, 13 pieces and 11 governor-direct hunks holding 984,267 bytes (67% of the source) outside every route; after, 43 pieces, 0 governor-direct hunks, every piece within the ceiling, and `reassemble()` restores every original hunk byte for byte. Each part carries the file header, a recomputed `@@` range and the section heading; the reviewer contract tells a route it is reading part N of M so that out-of-excerpt definitions are not reported as missing; `report.split.line_split` and per-piece `line_split` are additive. Defaults, stated once: the dispatcher (`multi-review.mjs --split`) divides over-ceiling hunks unless `--no-line-split` is given; the `splitDiff()` library function divides only when called with `lineSplit: true`, so existing callers and the earlier splitter tests are unchanged. A hunk in which one line is itself larger than the budget is never fragmented: the whole hunk stays `governor_direct`. The file name inside the excerpt notice is artifact text and is reduced to one quoted line without control characters (review `rev_20260918172733_7uos`, Codex, reproduced with a failing check first). Parts are balanced (cuts planned on the running total, the budget as the hard limit) after a live run left a 1.5 KB tail beside an 8 KB part. Peer review, three split runs by Codex, Antigravity and Grok with Claude as governor (`rev_20260918172733_7uos`, `rev_20260918174726_lc1e`, `rev_20260918181522_68d0`; the second and third divided a hunk live, 0 governor-direct): 19 findings, 10 applied (each material one reproduced by a failing test first: prompt-injection through a hostile path including NEL and bidirectional characters, a part overflowing the ceiling with a multi-byte section heading, parts of two assemblies merging, missing or duplicated parts merging silently, a Copilot stream hiding a signed-out stderr), 2 applied with modification, 7 rejected as chunk artefacts, repeats or by design (a context-only part is a valid review excerpt; parts are never applied as patches). Tests: eleven splitter cases and five dispatcher self-test checks; the first six were also shown to fail under seeded defects. Not yet done: a full-source review at two-reviewer quorum using this rule, which is the release gate it exists to unblock.
- Copilot failure classification (consolidation branch, 2026-09-18; reproduced live with Copilot CLI 1.0.83). The route failed on every piece with a bare `error` whose detail was the first 1,200 characters of Copilot's private JSONL stream, installed skill names included, and no cause. Run by hand, the terminal event was `session.error` with `errorType: quota`, HTTP 402. A non-zero Copilot exit is now classified only from the structured fields of that event, in fixed sentences: quota or rate limit (named as an account limit, not an authentication problem), authentication (401/403), provider outage (5xx), otherwise the error kind and exit code. Stream text is never echoed and never drives the outage or login patterns, because tool results inside it contain the artifact; when the stream holds no error event, stderr alone is classified, so a signed-out CLI still yields the login guidance. Two self-test checks failed before the change and pass after it.
- Pre-release audit (author, snapshot cd40254, 2026-09-13): ten items reproduced (nine integration gaps plus the transport test, item 10). Reconciled against the branch head: (1) per-piece quorum in the completion validator — fixed, sealed-fixture suite `governor-split.test.mjs`; (2) rating rows broke validation — fixed, well-formed `review_rating` rows are ignored by the validator and malformed ones are errors; (3) all-oversize input crashed the dispatcher — fixed, the report persists with `not_dispatched` routes and finite quorum; (4) trusting one hash trusted the companion file — fixed earlier (165cf8b); (5) dashboard apply skipped the containment probe — fixed, the production probe runs per updated CLI and an unverified route is never shown as ready; (6) governor_direct scope had no completion obligation — fixed, it is an item needing investigation evidence (new `reviewed` disposition); (7) events did not apply updates — implemented as the owner decided: events apply only when the toggle is on, and SKILL.md and the plan now say so; (8) passive clock checks ignored opt-outs — fixed, only manual and setup.check override them; (9) sidecar failure polluted the NDJSON stream — fixed, structured event plus evidence field; (10) transport test — fixed earlier (21f9faf). Audit notes: the preview is renamed "guidance preview" with its omissions stated; usage is now parsed for invalid replies too.
- Incident during verification (2026-09-13 18:02): re-running the audit's adversarial script against the fixed head, its fixture enabled the toggle with a fake "update available", and the clock's command path applied with its default executors, running a real `npm install -g @openai/codex@latest` and a real probe. Codex was already 0.154.0, so nothing changed. Fixed the same hour: the command path applies only after a check that actually ran and never with real executors when a harness injects a clock; regression test added.
- OS matrix CI on the pushed branch ([draft PR #4](https://github.com/marroccofella/skills/pull/4)):
  - Six runs failed in turn on runner assumptions the suites had baked in, each fixed by making the assertion environment-independent rather than skipping it: (1) clock tests inherited the runner's `NO_UPDATE_CHECK`; (2) the updater's review-log path test compared against macOS `/private` real paths; (3) the probes tree-kill test detached a grandchild on POSIX; (4) a Windows 8.3 temp path in the update table assertion; (5) the manifest still said 1.15.1; (6) the 1.16.0 changelog entry was missing from the release catalogue.
  - The seventh run, [34780254256](https://github.com/marroccofella/skills/actions/runs/34780254256) on `2fa8bac`, passed all nine jobs: self-test on ubuntu-latest, macos-latest and windows-latest × Node 18.x, 20.x and 22.x.
  - That head merges `main` (the 1.15.1 release record and the walkthrough page work). The conflicts were the generated pages and the release catalogue, resolved by taking main's catalogue plus the 1.16.0 version-notes entry and regenerating. The visuals test on main asserted the CURRENT STABLE banner unconditionally and now follows the catalogue's publication state.
  - GitHub runs no `pull_request` checks while a PR conflicts with its base, which is why the run before the merge never appeared. A green matrix on one head is evidence for that head only: every commit after `2fa8bac` (the E7 work and anything the gate changes) needs its own full matrix run (nine jobs then, ten since the Windows Node 24 job was added on 16 September), and the SHA that `momm-release.mjs --prepare` seals must be the one whose matrix passed — the release workflow does not run the matrix itself; it refuses to sign unless a completed, successful self-test run already exists for that exact commit on the push event (main after merge), so a green PR run is necessary but not what the seal checks.
- Sealing checklist item from the full-source gate (done in the sealing commit): pin the bootstrap links in `bootstrap.md` and `upgrade-prompt.md` to the signed `momm-1.16.0` tag (they point at `main` until a tag containing `bootstrap.mjs` exists).
- Written on 15 September as "still owed before release", kept as history. What became of each item is in
  the dated entries above: privacy and history scans, independent confirmations, the signed tag and
  the live pages were completed before or at release on 19 September; `momm-check/1` completion
  receipts for gate runs on committed ranges were not produced and are a stated limit, carried to
  1.16.1. [Added 25 September 2026: the E7 modality work shipped in 1.16.0 (section above); the
  public evidence page was not refreshed and remains the dated 4 September snapshot; the Grok
  exact-quote rejection rate was carried to 1.16.1, which accepts typographic look-alikes in
  quotations (owner decision, 25 September 2026).] The original line: `momm-check/1` completion evidence for the gate runs (verification manifests and before/after checks per decision, so `governor.mjs --run` reports complete), privacy scan on the final head, signed tag via the release workflow (`momm-release.mjs --prepare` seals the manifest entry; it is unsealed on the branch, so the updater refuses 1.16.0 by design until then), public evidence refresh, the E7 modality work below, and the 1.15-era holds that remain open (Grok exact-quote rejection rate; evidence-cap streaming is in 1.15.1).

## Suggestions carried forward

157 gate suggestions and 52 direct-review suggestions are recorded as `deferred` rows in the private ledger against their run ids. Themes worth scheduling for 1.16.1: per-route caps learned from the ledger and a higher `--jobs` ceiling when three or more routes run; `--early-exit` once in-flight cancellation exists in `runProcess`; synthetic-diff hunk counts in the probe fixture; CRLF normalisation for JSON guidance; `Object.create(null)` maps in the guidance resolver; sidecar directory mode 0o700.
