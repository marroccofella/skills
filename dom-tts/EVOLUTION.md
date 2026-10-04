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
