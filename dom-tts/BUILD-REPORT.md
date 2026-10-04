# Dom TTS 0.5.0-dev.1 build report

## Legion integration receipt — 4 October 2026

Integration branch codex/dom-tts-0.5-programme starts at PR #41's exact head
1337e670536161475b6070510232231932109923. Legion independently ran self-test
on Windows x64 / Node 22.16.0: 9,706 common assertions passed, six POSIX-only
checks skipped. Native windows-privacy.cjs passed broad-parent/new-child protection,
broad-existing refusal, junction refusal and same-process changed-ACL revalidation.
These are directory/privacy results, not new audio or listening evidence.

Removed an obsolete comment describing the now-removed cache; runtime behaviour is
unchanged from the reviewed PR #41 head. EVOLUTION.md records the owner's expanded
programme and newly published legacy handoff. The regenerated source manifest must
verify on the resulting commit; final integration hosted CI remains pending until
dispatched. Prior exact-head successes and failures below remain historical receipts.

PR #42's legacy source is archival and was not installed or executed as a live tray.
Independent MOMM quorum, native Mac/Linux audio, final-candidate second Windows host,
listening/acoustic timings, installation EPERM and policy compatibility remain open.

4 October 2026, Asia/Dubai. Development candidate authored by Legion (Codex).
Base: 75ba1ce6bd9653cd62264bb954ee17e6cb943075, 0.4.0-dev.2 / PR #39.
Only bug fixes, safety improvements and migration/acceptance documentation.
See EVOLUTION.md for the feedback disposition and release sequence.

## Verification performed locally

| Check | Result |
|---|---|
| Baseline reproductions | Same ten-group evolution test on unchanged dev.2: nine groups fail on Windows; POSIX group skips on Windows |
| Fixed evolution regressions | All ten groups pass locally; POSIX mode test requires hosted/native POSIX execution |
| Offline suite, Node 22.16.0 and 24.19.0 | 9,703 counted assertions pass |
| Corpus | 64 short synthetic inputs + 30 realistic synthetic multi-paragraph replies across eight modes; no claim of a collected real-chat or listening corpus |
| Assertion count | 8,640 chunk-property checks, 512 short-input comparisons, 240 multi-paragraph comparisons, 311 other counted checks |
| Install lifecycle | Pass; meaningful mode/profile/inclusion settings retained; injected stage-rename refusal restores the prior install |
| Real worker boundary | Pass: synthetic environment canary excluded and owned child stops within 1,000 ms; Node stand-in, not native audio |
| Windows native directory privacy | Pass: broad-parent/new-child protection, broad-existing empty refusal, junction refusal, changed-ACL revalidation in a fresh process |
| Windows native SAPI safety | Pass on one Windows x64 host / Node 22.16.0: playback, busy refusal, stop 43 ms to process exit, unrelated PID survives, hostile speech/voice no sentinel, invalid voice fails |
| Diagnostics | No synthetic sentinel in native diagnostics; privacy and 500 ms stop bound now affect the native pass verdict |

The original privacy fixture attempted an unnecessary owner rewrite and failed
with PrivilegeNotHeldException. The fixture was corrected to modify only the DACL
and passed; that original attempt was not a runtime privacy failure.

Five corpus expectations were inspected and updated for the intended diagnostic
selection changes. Expected values are implementation-derived synthetic fixtures,
not independent listening verdicts. Stand-in worker tests exercise actual processes
and IPC but do not certify say/espeak-ng binaries, sound devices or acoustic latency.

## Follow-up: permission cache removed

Addresses the residual same-process permission-cache finding from the independent
Windows retest (discussion #38). The Windows ACL check now runs on every call; no
marker file or in-process memory stands in for it. Production callers each check once
per run, so the runtime cost is unchanged from 0.5.0-dev.1 for direct speech; the
watcher, support bundle and recovery command behave the same way.

| Regression test | Before (0.5.0-dev.1 runtime) | After |
|---|---|---|
| Same folder, same process, ACL change with marker untouched | Fail: check skipped | Pass: refused |
| Replacement at a checked path with a matching forged marker | Fail: check skipped | Pass: refused |
| Forged marker in a fresh process | Pass (already fixed in 0.5.0-dev.1) | Pass |
| Every call runs the permission helper | Fail | Pass |
| Native: real ACL change, recheck in the same process (Windows CI) | Not reached: the offline suite failed first | See PR results |

Assertion counts are now reported per platform: on Linux, 9,706 run on every platform
plus 6 POSIX-only; on Windows, the same 9,706 with those 6 skipped.

## Exact-head CI and independent review

0.4 base historical CI passed all 17 jobs. The 0.5 workflow runs portable tests,
committed-manifest verification, installation, real worker containment and Windows
native directory probes. All 17 jobs passed at implementation commit 62aa8121d99533fd26447057e0fda785f50b44fd in [run 37158327770](https://github.com/marroccofella/skills/actions/runs/37158327770). This later report/README receipt commit must obtain its own exact-head checks; see PR #40 for current results.

MOMM preflight found the four configured OAuth routes present. The first 0.5 dispatch
was rejected by automatic approval review: prior sharing approval explicitly covered
0.4, not the new 0.5 payload. No source was sent by that rejected call. Specific
0.5 source-sharing approval was requested; quorum and findings are pending.
Private MOMM evidence, runtime state, settings, transcripts, recordings and local
archives are excluded from Git. No stable release approval is claimed.

## Remaining gates and scope

PowerShell execution policy is respected. A policy refusal now gives a specific,
sanitized explanation; the skill does not silently bypass it. Hal's restricted-policy
native compatibility case is not claimed resolved by this diagnostic improvement.

The host-specific default install EPERM root cause remains unknown. An actionable
message and rollback test improve refusal behavior without claiming that host fixed.

Still required: exact-candidate green hosted CI, independent final-byte review and
dispositions, native macOS/Linux engines and audio, second Windows host/clean
non-admin evidence, human listening and acoustic timings, device/sleep/load cases,
and agent-in-loop scoring. Windows ARM64 is unverified. No global session watcher,
tray, microphone, cloud provider or Duplex feature was added. Default spoken replies
remain a separately configured host preference. Do not merge or tag as stable until
the evidence gates and owner's release decision are satisfied.
