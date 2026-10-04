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
