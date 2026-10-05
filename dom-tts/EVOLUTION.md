# Dom TTS 0.5 evolution and acceptance

0.5.0-dev.1 is a bug-fix development candidate based on 0.4.0-dev.2 commit
75ba1ce6bd9653cd62264bb954ee17e6cb943075 (PR #39). It does not expand the product
into cloud voices, microphones, Duplex, global transcript discovery or a tray app.

## Acceptance order

1. Preserve the four baseline regressions and repair narration/settings defects.
2. Require committed-manifest verification, meaningful settings upgrade checks,
   guarded recovery, native Windows directory boundaries and real worker containment.
3. Run exact-candidate portable CI on all 17 OS/Node cells; preserve failed runs.
4. Obtain native engine and audio receipts, human listening and acoustic timings,
   agent-in-loop scores, and independent review on the exact integration candidate.
5. Only after those gates and the owner's release decision, prepare stable artifacts
   and migration instructions. A passing development CI run is not a stable release.

## Scope decisions from the feedback

| Feedback | 0.5 disposition |
|---|---|
| Failure hidden by terminal-summary | Fixed: errors precede warnings/progress; FAILED, failure and fatal share a diagnostic matcher. |
| Retained settings ignored | Fixed: inclusion flags, profile/mode/provider inherit settings; explicit CLI values win, including false. |
| Git status list lost | Fixed for filename/path status records; ordinary prose remains prose. |
| Persistent permission marker trusted | Fixed: no marker or in-process cache; Windows ACLs and POSIX modes are checked on every call. Windows checks retain the 60-second bound. |
| Recovery/new-playback race | Cleanup holds the same exclusive playback lock; tests require ownership during cleanup. |
| PATH shadowing | Reject relative and project-local entries and links resolving into the project. Other absolute PATH entries remain user-trusted; package-managed scripts/symlinks are supported. |
| PowerShell execution policy | Report a specific sanitized blocked-policy error. Keep -File; do not silently bypass policy or adopt unreviewed inline execution. Restricted-policy audible compatibility remains open. |
| Native verdict omits privacy/latency | Fixed: diagnostics privacy and a 500 ms process-exit bound participate in the Windows verdict. |
| Real default-target EPERM | Add a destination-refusal message and interrupted-stage rollback test. The reported host-specific failure is not claimed reproduced or resolved. |
| Missing legacy features | Document coexistence and exclusions; do not recreate them in a bug-fix core. |
| Claude records without end_turn | Keep the documented strict adapter; use direct invocation or normalized generic records for unsupported schemas. No guessed final-message detection. |

## Migration and coexistence

The skill ID remains dom-tts. Legacy read-aloud/plugin installations are separate
products and are never overwritten. Disable their narration using their own controls
before enabling Dom TTS to avoid duplicate speech. The Dom TTS installer previews,
upgrades, retains a backup, rolls back and reversibly uninstalls only managed dom-tts
directories; use --dry-run first. Rollback restores the backed-up settings snapshot,
so settings changed after upgrade should be exported privately before rollback.

Compatible local settings are retained and tested with real values. Legacy edge or
Piper settings/voices do not migrate automatically: select an available native voice
from doctor and provider auto. No cloud fallback is enabled. Windows 0.5 uses a new
private runtime namespace; old runtime state is not copied. POSIX retains its existing
private state location. The source manifest is integrity metadata, not a signature.

Default spoken final replies are a host instruction preference, not a background
watcher. Each host needs the skill, an audio engine and that preference installed.
The consented watcher still reads one selected transcript only.

## Owner-authorized programme follow-up (4 October 2026)

The owner has expanded the future 0.5 programme beyond this bug-fix candidate.
This does not retroactively claim delivery of additional features in dev.1.
Stages: close core defects; recover legacy source and migration; independent text
display and asynchronous speech streaming; generic/named harness adapters; accessible
desktop controls; richer content/local voices; optional managed services, cloud
voices, consented cloned-voice and microphone companions. Each stage needs separate
review and acceptance evidence. Core local narration remains usable independently.

PR #41 removes the permission cache and marker on branch
claude/dom-tts-0.5-permission-check. Legion independently tested its exact commit
1337e670536161475b6070510232231932109923 on Windows x64 / Node 22.16.0:
9,706 common offline assertions passed, six POSIX-only checks were explicitly
skipped, and native same-process changed-ACL refusal passed. This supports closing
the reproduced cache shortcut on that commit; it does not certify all privacy races
or later integration commits. Keep its failing-before CI receipt 37179287075.

The legacy tray handoff is archival PR #42 at
9fedaa449c3071aacc4aa6e7e7f88cc6ffceb756, not an installation or stable release.
Discussion #38 identifies a PowerShell WinForms companion and differing same-version
legacy installations. Original distribution provenance and independent GUI/listening
evidence remain open. Inspect/review archived source before transplanting controls.

Next work: asynchronous queue/event contract and legacy feature matrix, then pinned
Claude Code and generic real-harness tests. Hermes tentatively means NousResearch's
Hermes Agent; the owner's "Agent" and "Open Claude" identities remain unresolved.
No newly named harness compatibility is certified. Do not await playback completion
on the text-rendering path. Distinguish complete-message narration from token deltas.

Experimental progress: an injected-player stable-segment queue now has 45 deterministic
checks for nonblocking admission, bounded memory/history, fair selected-session service,
failure ordering, replay, retry and cancellation.
Selected-session revocation clears retained queue text and refuses later admission;
limits are UTF-8 bytes. Native/adapter revocation remains a separate integration gate.
Bounded strict UTF-8/JSONL framing has 152 checks; per-segment delivery states are
queryable in memory. It is not wired to production speech or watchers; event transport, delta segmentation, native cancellation and real
harness certification are still future increments. The production API is unchanged.

Coordination evidence:
https://github.com/marroccofella/skills/discussions/38#discussioncomment-18739772
