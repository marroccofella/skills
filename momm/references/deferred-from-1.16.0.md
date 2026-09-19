# Deferred from 1.16.0, by name

The 1.16.0 release gate ruled on 1376 findings and suggestions across 9 runs. It
deferred **42 findings**. An anonymous "deferred to 1.16.1" bag is how a release grows a second
bag, so they are listed here by name with what becomes of each. Only items that break an invariant
the [1.16.1 charter](plan-1.16.1.md) names are promoted; the rest are parked by name and stay parked
unless someone makes the case for one. Generated from the gate ledger on 20 September 2026.

- Promoted into 1.16.1: **13**
- Closed since: **2**
- Parked: **27** (one needs an owner decision)

| Finding | Severity | Gate run | Becomes | Why it was deferred |
| --- | --- | --- | --- | --- |
| `extension-only-media-validation` | WARNING | `2l49` | **1.16.1 A1**: media type from bytes | Known limitation accepted by the owner and disclosed verbatim in review-brief-1.16.0.md:37, release-1.16.0.md and the E7 plan: 'MOMM checks initial media types by filena… |
| `first-probed-prevents-route-level-clear` | WARNING | `4dn1` | **1.16.1 A2**: same rule as above | Repeat of round five [31] and round three [126]. 'The FIRST probed cell of a later run that succeeds clears' is the documented rule (probes.mjs comment above writtenThis… |
| `route-level-clear-only-first-probe` | WARNING | `2l49` | **1.16.1 A2**: re-examined against 'no reuse of a stale cell' | The 'first probed cell' rule is the documented design (probes.mjs comment above propagate) and is pinned by account_level_blockers_cover_every_non_no_cell_of_the_route_a… |
| `clock-stale-last-result` | WARNING | `4dn1` | **1.16.1 B**: updater status must not show an old success after a failure | Reproduced with the real runClockActivity: after a success then a failure, last_result is still the earlier {ok:true} beside last_error. The visible part was handled in… |
| `copilot-403-as-auth` | WARNING | `h6hn` | **1.16.1 C1**: closed outcome set; needs a recorded 403 event first | The references record only the 402 quota_exceeded event; no recorded Copilot 403 event exists to say whether a bare 403 is a dead session or a plan limit. Evidence neede… |
| `runtime-enoent-misclassified` | WARNING | `4dn1` | **1.16.1 C1**: closed outcome set | Plausible mislabel: a non-zero exit whose stderr says ENOENT or 'no such file' reads as not_installed even when the CLI exists but its own config is missing. The stderr… |
| `changelog-omits-major-1-16-surfaces` | NITPICK | `h6hn` | **1.16.1 D**: changelog covers modalities and the private evidence folder | True (no entry for modalities/capabilities or the owner-only evidence folder; entry 3 still describes oversize hunks as governor scope although line splitting is the def… |
| `ledger-ticket-expiry-steps-underspecified` | WARNING | `4dn1` | **1.16.1 D**: test plan names the ticket endpoint | Executable as written: an unused ticket comes from an authorised POST to /api/ledger-ticket, which returns the /ledger?ticket=... address without presenting it (setup-ui… |
| `new-tests-absent-from-verification-list` | NITPICK | `1nkh` | **1.16.1 D**: CONTRIBUTING.md names every suite | True: CONTRIBUTING.md names none of ledger-serving, media-cancellation, media-preservation, momm-release-regressions, reviewer-ux-regressions or the transport and adapte… |
| `test-plan-omits-retry-invalid` | WARNING | `4dn1` | **1.16.1 D**: test plan names the flag | An omission, not a wrong statement. The flag's contract is exercised with zero network by the dispatcher self-test retry_invalid_is_opt_in_once_and_disclosed (multi-revi… |
| `childenv-realpath-fail-open` | WARNING | `97n4` | **1.16.1 E**: PATH entry that cannot be resolved | Same class as finding 0: it needs a user PATH entry that aliases into the project AND cannot be resolved (broken junction, EACCES). Dropping unresolvable PATH entries in… |
| `path-alias-bypasses-project-filter` | WARNING | `97n4` | **1.16.1 E**: PATH entry reaching the project through a junction, symlink or 8.3 name | Real but outside the threat this release closes. It needs an entry on the USER'S OWN PATH that reaches into the project through a junction, symlink or 8.3 alias; content… |
| `posix-relative-path-command-shadowing` | WARNING | `2l49` | **1.16.1 E**: '.' or an empty PATH entry | Needs '.' or an empty entry in the user's own PATH, which a reviewed project cannot set and which exposes every command that user runs. Windows differs because the OS ad… |
| `split-ignores-max-bytes` | WARNING | `4dn1` | **parked, owner decision**: whether an explicit --max-bytes bounds a split run | True as described and deliberate so far: under --split a diff is limited by the 2 MB split hard cap, not --max-bytes (comment above inputLimitFor, the '(split hard cap)'… |
| `audio-prompt-tone-echo` | WARNING | `4dn1` | **parked** | Partly right. A reply that repeats a prompt sentence is refused before any pattern (confirmContent calls classifyReply 'echo' first), and the quoted 'Please note I canno… |
| `darwin-case-sensitive-glob` | WARNING | `h6hn` | **parked** | Cannot be reproduced on this Windows host. The registry globs use the casing the provider CLIs themselves write, so no miss is known; a per-volume case probe belongs to… |
| `detached-child-survives-lock` | WARNING | `1nkh` | **parked** | Real but only after the clock process itself is SIGKILLed mid-apply; not reproducible inside the suites without killing a parent mid-update. The skill updater is indepen… |
| `duplicate-timeout-becomes-cli` | NITPICK | `4dn1` | **parked** | Correct by reading: parseProbeArgs skips only the value after the first --timeout, so a second value becomes a target and the run stops with 'Unknown reviewer CLI: 20' o… |
| `generation-access-failure-accepted` | WARNING | `4dn1` | **parked** | For a generative cell the proof is the artefact: a file the glob finds that is new or changed against the listing taken before the request, written after it started, and… |
| `harvest-lock-key-aliasing` | WARNING | `2l49` | **parked** | Real but already disclosed: plan-1.16.0-e7-modalities.md:48 says the lock is keyed by the glob string and that two differently spelled overlapping globs are not serialis… |
| `header-only-corroboration-too-late` | WARNING | `4dn1` | **parked** | The stated mechanism is wrong: sources are route names and a route is added once, so one route on two pieces cannot corroborate itself (own sliced run of rationalize: ma… |
| `incomplete-bidi-sanitization` | NITPICK | `4dn1` | **parked** | Correct on the facts: U+061C and U+206A to U+206F are not in the unsafe set of inertPathLabel. No consequence for what the label is for: it stops a path from adding line… |
| `invalid-image-harvest-fixture` | WARNING | `4dn1` | **parked** | The fixture matches the production contract it tests. The generation probe verifies that a NEW file appears under the registry's harvest glob and records its sha256 and… |
| `lock-fs-missing-not-enoent` | WARNING | `1nkh` | **parked** | Test-model fidelity: the suite passes 24 of 24 including the free-lock case; making the fake throw ENOENT for an absent file is queued with the 1.16.1 test hardening. |
| `lock-race-stat-identity-not-modeled` | WARNING | `1nkh` | **parked** | A test-model limitation: the production rule is never to steal a lock, so no identity-based removal path exists to exercise; modelling inode change belongs with any futu… |
| `mixed-reviewer-flags-silently-accepted` | WARNING | `4dn1` | **parked** | Reproduced with parseArgs run from a source slice: '--reviewers codex --reviewers auto' (either order) is accepted with reviewers [codex], reviewersExplicit true and rev… |
| `pid-reuse-lock-wedge` | WARNING | `h6hn` | **parked** | Same as gate-3 [160]: not a permanent wedge (clears when the unrelated process exits) and not reproducible on demand. An age rule conflicts with applies that legitimatel… |
| `pid-reuse-stale-lock` | WARNING | `1nkh` | **parked** | Not reproducible on demand (needs the OS to recycle a PID) and self-limiting: the lock is refused only while the unrelated process lives, never permanently. A max-age ru… |
| `pointer-not-retried-after-directory-creation` | WARNING | `4dn1` | **parked** | Documented behaviour with a small gap: the pointer is written only where .ensemble_reviews already exists (comment above createSetupCenterPointer). If the Setup Center i… |
| `pointer-remove-toctou` | WARNING | `2l49` | **parked** | Theoretical only: the pid read and the unlink are two adjacent synchronous calls, so a second Setup Center would have to replace the pointer inside that gap. Node offers… |
| `race-await-deadlock` | WARNING | `4dn1` | **parked** | Test-only, and it cannot hang on the current code: createLedgerWatcher runs one generation at a time (regenerate() returns the in-flight promise, line 1243), so run() is… |
| `remove-timer-done-ignores-plist` | WARNING | `4dn1` | **parked** | Real but narrow: macOS only, and only when launchctl unload succeeds while deleting the user's own plist in their own LaunchAgents folder fails. The result already says… |
| `reports-readdir-swallow` | WARNING | `4dn1` | **parked** | Real but minor. A missing reports folder (ENOENT) is the normal empty state and the note is right for it. Only a folder that exists but cannot be listed (EACCES, or a fi… |
| `schtasks-create-missing-force` | WARNING | `2l49` | **parked** | Plausible (schtasks /Create asks before replacing an existing task), but I could not reproduce it without registering a real scheduled task on this machine, which the ro… |
| `stale-setup-pid-reuse` | WARNING | `1nkh` | **parked** | Needs a crash plus PID reuse plus another service on the same loopback port; the link carries no capability (the launch token never enters setup-center.json) and only lo… |
| `test-deadline-does-not-cover-stalled-fetch` | WARNING | `1nkh` | **parked** | Only a hung request to the page's own loopback server could stall it, and the server bounds the job itself. Adding an abort deadline to api() is a behaviour change for a… |
| `theme-pressed-vs-action-label` | NITPICK | `h6hn` | **parked** | Plausible accessibility polish; needs a screen-reader check before changing the label or pressed semantics. |
| `unbounded-guidance-slurp` | WARNING | `4dn1` | **parked** | Real but only a performance edge. guidanceFileState hashes whatever is at the path; parsing is already bounded (readGuidanceFile uses the 64 KiB reader in guidance.mjs),… |
| `usage-unbounded-readdir` | WARNING | `h6hn` | **parked** | Only a performance concern at tens of thousands of reports; a bounded directory walk can follow the release. |
| `version-timeout-does-not-stop-run` | WARNING | `2l49` | **parked** | Probing with an unknown version is a designed, tested state (version_is_the_printed_semver_whatever_the_exit_code: 'nothing binds to an unknown version'); nothing false… |
| `unpinned-bootstrap-blob-url` | WARNING | `1nkh` | **closed**: pinned to the signed tag in the 1.16.0 sealing commit | No signed tag contains bootstrap.mjs until 1.16.0 is sealed; pinning bootstrap.md to the signed tag is recorded as a sealing step in the release notes' still-owed list. |
| `unpinned-bootstrap-guide` | WARNING | `1nkh` | **closed**: pinned to the signed tag in the 1.16.0 sealing commit | Same as finding 34: the upgrade prompt is pinned to the signed tag at sealing; until then no such tag exists. |

## Deferred suggestions

Reviewers also made 289 suggestions that were deferred rather than applied or rejected. They are
improvements, not defects, so they are not promoted one by one. By theme: test quality (fixtures, fakes, timers, assertions) 99; Setup Center polish 33; documentation and wording 15; refactors and consolidation 7; other 135.
Each has its own ruling and reason in the gate ledger. A suggestion enters a release only through
that release's plan, by name.

## Also parked, from the 1.16.0 notes

Named here so they are not rediscovered as new ideas: `--early-exit` after quorum, per-route caps
learned from the ledger, a higher `--jobs` ceiling, `--split auto`, adaptive timeouts, and
corroboration across divergent finding ids are **1.17 roadmap items** (see `ROADMAP.md`). CRLF
handling in guidance files, `Object.create(null)` for lookup tables, a `0o700` mode on the
guidance sidecar folder on every platform, and synthetic hunk counts in split reports are small
hardening items with no invariant at stake; they are parked.
