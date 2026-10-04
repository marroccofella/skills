# Dom TTS 0.5 consolidated reviewer progress

Legion, 4 October 2026. Canonical coordination: [discussion38](https://github.com/marroccofella/skills/discussions/38).
This record consolidates findings and dispositions, not approval to merge or release.

## Source stack and ownership

| PR | Scope / pin | Ownership and disposition |
|---|---|---|
| 35 | 0.3.2 baseline, fd2811e | Historical draft; preserve original defect receipts |
| 39 | 0.4 dev2, 75ba1ce | Claude: tables/corpus, Windows CI, recovery/workflows |
| 40 | 0.5 core fixes, da5c228 | Legion; stacked on39, draft |
| 41 | Remove permission cache/marker, 2874e4d | Claude; incorporated into Legion integration, shared PR unmerged |
| 43 | Experimental queue/framer, parity and diagnostics, 0841b23 | Legion integration; no production streaming hook yet |
| 42 | Legacy tray archival packet, 9fedaa4 | Separate archive; not active runtime or installation |

Review dependencies in order39 →40 →41 →43 if later authorized to merge. PR42
remains separate. No reviewer branches are overwritten by Legion.

## Consolidated findings and work queue

| Finding / evidence | Disposition | Next accountable work |
|---|---|---|
| Four original defects: dropped prose, decrement for dash, oversized chunks, silent watcher loss | Core regressions retained; independent Linux and Windows receipts are separately pinned | Preserve real-reply/listening coverage; avoid equating generated assertion counts with corpus size |
| Writable public-metadata marker and same-process permission cache | Removed by41; tests-only54be078 failed before fix1337e67; comment-only2874e4d follows | Keep per-call fail-closed permission enforcement |
| Windows install check exceeded60s at8491472 | Original attempt1 run37183108521 failed; duplicate37183106417 passed; attempt2 passed unchanged bytes; cause open | Preserve all attempts; passing rerun is not a root-cause repair |
| e630232 diagnostic successor | Both37183666336 and37183664235 verified17/17 successful jobs | Diagnostics are evidence collection, not a root-cause repair |
| Default-target EPERM and PowerShell policy failures | Open; disposable install success is not affected-host reproduction | Affected host and clean non-admin host/VM investigation; preserve installation and actionable refusal |
| Missing legacy tray/settings source | PR42 packet recovered; original distribution provenance and installed-copy parity open | Legion packet verification and active migration; source existence does not prove working controls |
| Legacy Start-Process splits script paths/text arguments | Peer reproduced; archival code preserved | Reproduce and fix in active companion before transplanting controls |
| Same-generation A0/B0/late-A1 ordering | Reproduced locally; sealed predecessor fix8491472 independently retested | Adapter must surface refusals; provider ordinals/cross-generation rewrites still open |
| Partial UTF8/JSONL, replay, bounds and revocation | Experimental45 queue/152 framing assertions; included in9903 common total | Connect selected-source consent, admission checkpoint, native player and reconciliation |
| Installed0.4 omitted final narration, sandbox lock EPERM, short-chunk120s timeout, uncollected launches | Separate field report18739938; not closed by successor kernel tests | Per-harness hooks, execution-context tests, owned cleanup and terminal delivery accounting |
| Periodic progress displayed without periodic speech calls | Separate field report18740201; orchestration omission, not engine failure | Explicit ongoing-job adapter and acceptance specification; no automatic chat surveillance |
| Human listening, native Mac/Linux, second Windows host, acoustic timings, agent-in-loop | Open | Obtain measured platform/harness/listener receipts |
| 0.5 MOMM review quorum | Open; specific source-sharing authorization pending | No provider dispatch until explicit authorization; no fabricated review result |

The install-stage-in-protected-backup proposal in [Claude's consolidation](https://github.com/marroccofella/skills/pull/41#issuecomment-5977462307)
is recorded as a proposal, not a fix. ACL inheritance, destination validation,
replacement/race boundaries and launch savings require review and tests before use.
Do not infer cold-start causation solely from the observed helper timeout.

The timeout also occurred at0841b23 on hosted Windows Node22.23.3 in
run37184057862/job111382217450. Failure-only diagnostics then passed with
33414ms new-child and23371ms existing-child checks. Thus the failure is not
confined to Node18; its internal cause remains open. The diagnostic now measures
command-body time and approximate launch/exit overhead separately. Missing timing
on timeout remains null; no raw helper output or directory path is published.
These measurements instrument the diagnostic only, not production permissions.

## Independent receipts and remaining acceptance

At e630232, Bob BHB reports Windows x64/Node24.19.0,42 manifest hashes,
9903 common assertions/six POSIX skips, disposable installation and650/560ms
permission probe passes ([receipt](https://github.com/marroccofella/skills/pull/43#issuecomment-5977447101)).
Another reviewer reports Node24.15 probe531/447ms
([receipt](https://github.com/marroccofella/skills/pull/43#issuecomment-5977443020)).
Legion's Node22.16 probe1480/1364ms is a separate local receipt. None explains
the hosted timeout, proves an acoustic result or certifies real harness integration.

The PR merge49c50dca and head8491472 have the identical tree
c38477d0e55ee0d13ac21282b84839a13be14fd2; record the actual checkout commit
and run attempt as well as candidate head. The current0841b23 documentation
successor's CI was still running at this snapshot; older green runs are not its receipt.

Periodic acceptance additionally requires singleton announcer ownership, sample
identity/deduplication, stale/missing samples, bounded/coalesced backlog, per-event
terminal status, cancellation plus owned-player stop, and at-most-once final notice.
Persist metadata only by default. See NARRATION-ACCEPTANCE.md for the delivery cases
and FEATURE-PARITY.md for all legacy/current/proposed feature states.

Real generic/Claude Code hooks remain untested. Hermes identity is tentative;
the owner's Agent/Open Claude identities are unresolved. Optional voices, desktop,
accessibility and services remain programme items rather than delivered features.
