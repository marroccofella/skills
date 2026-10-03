# Compatibility evidence

| Layer | Windows x64 | Windows ARM64 | macOS Intel | macOS Apple Silicon | Linux x64/ARM64 |
|---|---|---|---|---|---|
| Portable Node logic | Local tests | Same source; not native-tested | CI configured | CI configured | CI configured |
| Speech adapter | SAPI; local native test required per build | SAPI; unverified host | /usr/bin/say; unverified audio | /usr/bin/say; unverified audio | espeak-ng; engine/audio prerequisites; unverified audio |
| Stop transport | Named pipe | Named pipe | Unix socket | Unix socket | Unix socket |
| Skill | SKILL.md + command interface | Same | Same | Same | Same |

Node 18/20/22/24 are in the offline CI matrix; test results on this machine
must be recorded separately. CI configuration is not a hosted CI pass.
No architecture-specific npm modules or model SDKs are required.

Codex: native Agent Skills install and Codex JSONL adapter.
Claude Code: native Agent Skills install; strict end_turn JSONL adapter.
Other harnesses/models: stdin/file/text command interface, documented custom
skill directory, or normalized generic JSONL producer. Native discovery and
automatic transcript export must be verified per harness; model identity does
not affect the speech runtime. There is no promise of automatic integration
with every current or future product.

Release gates: complete native audio/stop/device/sleep tests on two Windows
machines (one clean non-admin), native macOS Intel/ARM and Linux test receipts,
>=95% agent trigger scoring with zero false capability claims, and listener
meaning/usefulness targets from the supplied test plan. Microphone, cloud voices,
voice cloning and Duplex remain outside the core.

