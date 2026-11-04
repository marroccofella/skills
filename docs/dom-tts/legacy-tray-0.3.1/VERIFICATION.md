# Verification receipt: 2026-10-04

Scope: isolated documentation/source handoff; installed skills, startup settings,
watchers, microphones and audio were not changed or exercised.

- Windows / Node 24.15.0: packet verifier PASS, 53 source/provenance files hashed.
- All 30 archived JavaScript sources pass node --check.
- All 11 archived PowerShell scripts parse without errors; none executed by parser.
- Historical UI smoke script PASS for 37 declared command surfaces, without
  LaunchSafeActions. This is path/argument-shape checking, not GUI interaction.
- Original hashes retained; only two documented publication sanitizations differ.
- Text scan found no owner home paths, private LAN addresses, common GitHub/OpenAI/
  AWS token patterns or private-key blocks in the packet. This bounded scan is
  not proof that every imaginable secret format is excluded.
- Live read-only host inventories: Bob 49 / Bab 43 files; normalization removed
  a remote PowerShell serialization wrapper before comparison. 19 shared paths
  identical, 21 shared paths differ, 9 Bob-only, 3 Bab-only. Private settings,
  transcripts, audio and process command lines were not published.
- Bob process inventory found one global watcher and two tray-entry processes;
  per-user global/tray Startup shortcuts exist. Actual hotkey/icon operation was
  not observed. No independent Bab reviewer statement or screenshot obtained.

Not tested by this receipt: live provider synthesis/playback, human hearing,
microphone capture, true token streaming, GUI DPI/accessibility, new-core native
PR41 checks, default-target install, signed executable, stores or local web app.
The proposed web/ledger and streaming contracts are specifications, not features
implemented by the source snapshot. Development publication is not stable approval.

## Fresh archival review: 2026-11-04

Hal (H-A-L), isolated checkout of archive head
`9fedaa449c3071aacc4aa6e7e7f88cc6ffceb756`:

- Packet verifier passes all 53 source/provenance hashes; its JavaScript
  syntax checks pass. The verifier only invokes `node --check`.
- All 11 archived PowerShell scripts parse without errors; none was executed.
- A fresh bounded scan of all 62 packet files found no Windows user-home path,
  private LAN/Tailscale endpoint, common GitHub/OpenAI/AWS credential pattern,
  private-key block or email address. This is not a universal secret detector.
- No installer, watcher, online provider, microphone or archived support
  collector was started. No GUI/audio/platform functionality is certified.
- The README now labels the 4 October main/branch inventory as historical and
  points to merged PR #69 and stable-release gate issue #70. The archived source
  bytes, original hashes and packet manifest are unchanged.
