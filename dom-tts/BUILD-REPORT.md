# Dom TTS 0.5.0-dev.1 build report

## Optional worker isolation and stop outcome

Exact3ccbc8c diagnostic increment passes17/17 in both37191015669/37191013418,
verified from all job outcomes. Foreground Windows reviewer5978388021 verifies
fixed codes;5978389309 separately checks unknown-code/raw-field fallback without
leaking a sentinel. Those receipts retain their exact pin and do not establish
remote hardware or final-byte MOMM quorum.

New test-only acceptance closes the earlier timed-abort synchronization gap: a
fixture instruments failed exclusive lock acquisition and the unchanged production
worker's actual100ms wait-timer registration. Only then does the parent abort.
The competing owner is actual playback with authenticated IPC/lock/status and a
held injected engine; its lock/status bytes remain unchanged, no kill is requested,
and it remains active until explicitly released by the test. Waiting worker reports
stopped and exits; owner subsequently completes and cleans its own lock. Local
Windows Node22.16 PASS; no audio or acoustic timing. Test instrumentation is not a
production worker-path/command option; runtime source is unchanged. Initial missing
test-helper extension failure was corrected before this valid receipt.

At3ec07c2 both37190508980/37190506960 have all eight macOS Intel/ARM jobs and
five Linux jobs successful; Windows completion remains separately checked.
Decoded ARM Node20 job111401492262 reports canonicalized temporary fixture=true
and isolated checks PASS. Original generic logs cannot distinguish link refusal
from socket length; canonicalization and shortening together are the verified
fixture correction, not a weakened production path policy or audio certification.
Worker failure-category regression then fails on3ec (code absent) and passes
after fixed whitelisted codes are propagated; real linked-state and invalid-mode
worker failures carry only state-path-linked/invalid-options respectively, with
the generic public error message preserved. No raw worker error/path/text egress.

Original dc8b5bb CI is not green: all eight macOS jobs in each matrix fail the new
isolation fixture with a sanitized playback refusal; baseline and preceding checks
pass. Both37189835581 and37189833290 finish9/17: all five Linux and four Windows
jobs pass, all eight macOS jobs fail. A local
owned linked-temp-root reproducer fails the original fixture specifically with
that refusal and passes the repaired fixture. Test repair canonicalizes the owned
temporary root, shortens its socket path, retains explicit linked-state refusal,
and adds cancellation with a pre-existing live-owner lock without changing its
bytes. No production ACL/link/socket limit is weakened. Actual macOS successor CI
is required to confirm the fixture correction; the generic original log alone
does not establish its precise underlying privacy/socket failure. Initial private
VM diagnostic harness failures were excluded; the normal-realm before/after run
is the valid reproducer.

External authenticated stop now propagates an explicit stopped result rather than
false completion (07fe439). Its failing-before/passing-after actual IPC fixture
also verifies pending work in both selected sessions is cancelled and late admission
or retry is refused. Independent Windows Node24.15 review5978143632 repeats it.

An optional experimental isolated native player moves preparation, per-call ACL
validation and native playback into a fixed worker thread. It retains the existing
lock/stop routes, restricted environment and bounded inputs. Completion waits for
both an explicit outcome and worker exit; no forced termination shortcut is used.
Local Windows x64 Node22.16 real permission/empty-text fixture passes without audio.
20ms timer measured1133ms in-process versus28ms isolated. A separate public native
SAPI fixture authenticates stop and cancels active/pending work, bytes0, lock absent,
33ms stop-to-queue-idle. No GUI latency, acoustic silence or human hearing verdict.
Supplemental isolation tests run separately from9903 common baseline assertions.
Exact successor CI/review, non-settling/crash containment and live harness gates open.

## Legion integration receipt — 4 October 2026

Current integration is not fully consolidated. docs/dom-tts/FEATURE-PARITY.md tracks
the core, experimental components, recovered legacy controls and authorized future
work separately. Archived source presence is not active feature parity.

Hosted failure preserved: exact8491472 Windows Node18 run37183108521,
job111379459703 passed9903 offline assertions and committed-manifest verification,
then its first install call failed with the explicit 60-second permission-helper
timeout. No ACL refusal or underlying runner cause is established. A diagnostic
timing probe now runs only after Windows CI failure; it does not alter permissions,
disable checks, retry installation or turn the failed step green. Local Windows
x64/Node22.16.0 probe passed: fresh private child1480ms, existing child1364ms.
Local success does not resolve that hosted failure. Keep actual EPERM distinct.
Same exact head's other run37183106417 passes17/17, including Windows Node18;
the failed run is16/17. This establishes inconsistent duplicate-run outcomes, not
a diagnosed OS/Node/runtime cause. Neither receipt is transferred to successor bytes.

Experimental queue increment: scripts/experimental/narration-queue.js is an in-memory
stable-segment kernel with an injected player, not a production watcher/engine path.
45 deterministic queue assertions pass: admission during unresolved playback,
duplicate/conflicting replay, sequence gaps, selected-session/role boundaries,
retry, cancellation, bounded history/bytes, round-robin service and failure ordering.
Selected-session revocation and UTF-8 byte limits also have deterministic checks.
The bounded JSONL framer adds 152 assertions: every two-part Unicode byte split,
incomplete data, strict UTF-8, malformed JSON/record shape and size/count limits.
The queue exposes typed per-segment delivery states, without raw speech/provider errors.
Reviewer ordering finding (PR43 comment5977260726) reproduced locally as A0,B0,A1
with late A1 admitted/completed. Its failing-before fixture was then repaired by
sealing a predecessor when a new message is admitted in the same generation. New
late text is refused for adapter reconciliation; exact replay and retained retries
remain supported. Cross-generation/provider ordinals are not implemented.
The full Windows Node 22.16.0 suite now reports 9,903 common assertions, with six
POSIX checks skipped. No new native speech, real harness or acoustic receipt exists.
The first test invocation failed because the new module did not yet exist; this is
new-feature red/green evidence, not a reproduced defect in the former queue.
Specific MOMM sharing approval/quorum remain pending; this implementation is draft.
Neither component is connected to production narration. Installed-0.4 omissions,
permissions, timeouts and missing completion receipts (discussion18739938) are not
claimed resolved by isolated framing/queue tests.

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

An installer optimization (stage inside the checked backups folder, eecca32) was reverted
after an independent native Windows reproduction: a private backups folder whose ACL
entries are not inheritable passes its check, but a stage created inside it, and the
installed destination, are not private. The stage again gets its own explicit permission
check; the native test that reproduces the failure now passes.

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
# Native timeout completion correction — draft

Legion reproduced a native.runChild boundary at a16403b with a harmless owned Node
stand-in and the120s timer shortened to1s only inside an isolated test process.
Timeout rejection occurred before worker exit and cleared the owned handle.
The correction requests stop at timeout but retains ownership until worker exit;
only then does it report the timeout. Late chunk progress cannot restart the timer.
New regression fails before/passes after;9903 common Windows assertions/six POSIX
skips and real-worker environment/stop stand-in checks pass. This is process evidence,
not acoustic stop, an explanation of the earlier short-reply timeout, or listening
certification. A non-settling worker/cancellation channel remains a containment gate;
the implementation does not fabricate successful cleanup on a watchdog deadline.
Exact-candidate CI and independent review remain pending for this draft correction.

Playback now accepts an optional AbortSignal in its dependency context for queue
adapters. It uses the existing owned stop path; pre-aborted requests refuse before
privacy/state work, waiting lock acquisition checks cancellation, and active abort
updates stopped status only after the supplied player settles. Listener and lock
cleanup are retained. The new injected-player regression fails before/passes after;
9903 Windows assertions/six skips, worker stop and timeout regressions pass.
This is cancellation plumbing, not a connected native streaming adapter or measured
acoustic stop. Current direct CLI behavior has no new automatic source/harness hook.

### Owned-worker IPC failure regression (Legion, 4 October)

On predecessor 1e730929d60028395bb4ffa4f5126e63db769c2e, an injected start-send callback failure using an actual owned Node worker reported failure and cleared ownership before worker exit. The disposable fixture cancelled its own worker afterward. The new regression fails before the fix and passes after: retain the IPC error, request owned cancellation and settle on worker exit. Windows x64 / Node 22.16: focused IPC, timeout and AbortSignal checks pass; offline suite 9,903 assertions passes, six POSIX checks skipped. No audio or private text in the new fixture. Hosted exact-candidate CI and independent final-byte review remain pending. General child error events, never-settling cancellation, crash/descendant containment and acoustic silence are not certified by this result.

Synchronous-send follow-up: an injected throw previously rejected with raw error before exit and bypassed exit-listener registration. Register listeners before sending, catch the throw, retain ownership and sanitize as Native speech IPC failed while requesting owned cancellation. Actual-worker synchronous regression fails before/pass after; callback/timeout regressions and Windows9903/six skips pass. Stop-send throws/disconnected channels, general child error events and non-settling/crash cases remain separate open boundaries. New exact-head CI/review pending.
