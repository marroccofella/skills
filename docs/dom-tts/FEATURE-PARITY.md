# Dom TTS 0.5 consolidation and acceptance matrix

Legion, 4 October 2026. **Not fully consolidated; not release-ready.** This matrix
tracks capability coverage rather than claiming that all recovered code should be
merged verbatim. Legacy copies with the same version differ; archived existence,
installed process presence, working controls and accepted release features are
separate evidence. Existing installations are preserved.

Status: integrated = current core implementation; experimental = isolated draft
component; archived = recovered source outside active runtime; planned = authorized
programme work without delivered implementation; unresolved = missing identity,
provenance or acceptance evidence. Every advertised feature still needs its own tests.

| ID | Capability | 0.5 state | Consolidation or acceptance work remaining |
|---|---|---|---|
| C01 | Direct text, UTF-8 stdin/file, strict CLI | Integrated | Actual supported-harness invocation/permission-context tests |
| C02 | Eight modes and three profiles | Integrated | Broader pronunciation/listener corpus; preserve diagnostics and settings regressions |
| C03 | Tables, diffs, errors, code/command inclusion | Integrated | Stateful handling across streamed deltas and realistic listening |
| C04 | Settings inheritance, explicit false, private state | Integrated | Real legacy-settings translation and per-context routes |
| C05 | Owned playback/stop IPC, crash/lock recovery | Integrated | Native other-platform, device, acoustic-stop and concurrency evidence |
| C06 | Permission validation on every call | Integrated from PR41 | Exact integration CI; check/write-race review; Windows helper timeout investigation |
| C07 | Environment/injection boundaries, sanitized diagnostics | Integrated | Repeat for each new adapter/provider/control surface |
| C08 | Manifest-managed install/upgrade/rollback/uninstall | Integrated | Real default-target EPERM; clean non-admin/second host; Windows ARM |
| C09 | Native SAPI, say and espeak-ng adapters | Integrated source | Native Mac/Linux audio/listening; Intel/ARM and missing-device cases |
| C10 | Selected-transcript final-message narration | Integrated | Completion accounting and delivery omissions in actual harness context |
| S01 | Nonblocking stable-segment queue | Experimental | Connect event input and native owned player; production opt-in path |
| S02 | Bounded UTF-8/JSONL framing | Experimental | Transport/rotation/reconnect integration and first-event evidence |
| S03 | Delivery states and retry/cancel/revocation | Experimental in memory | Controller persistence, ambiguous outcome policy, native cancellation |
| S04 | Immediate host text independent of speech | Chat orchestration adjusted; product integration planned | Measured off/on real harness path; no text held behind playback |
| S05 | Token deltas, sentence chunks and final reconciliation | Planned | Range/grapheme units, revisions/unsaid suffix, ordinals and cross-generation boundaries |
| H01 | Generic event/CLI integration | CLI integrated; event path planned | Reference adapter plus independent consumers and actual end-to-end runs |
| H02 | Claude Code | Strict final-record parser integrated | Supported hooks/stream-json adapter; interactive/headless pinned-version tests |
| H03 | Codex CLI/desktop | Direct/selected-transcript route integrated | Per-final hook/accounting and actual streaming route; separate surface certification |
| H04 | Hermes | Planned, tentative NousResearch identity | Owner confirmation; pinned interface/surface/model tests |
| H05 | Agent and Open Claude | Unresolved identity | Owner repository/product URLs; no guessed compatibility claim |
| H06 | Historical OpenClaw route | Archived proposal/source | Confirm intended product scope; test actual interface, not a command-shape fixture |
| L01 | PowerShell tray and control/settings windows | Archived PR42 | Reviewed active companion with safe argument boundaries and core IPC |
| L02 | Read-last/replay, Start/Stream/All Chats controls | Archived; parity incomplete | Full-text replay; explicit selected-source consent; no silent global scanning |
| L03 | Per-context voice/mode settings | Legacy source varies; planned UI | Verified working inventory and preserved/atomic translated settings |
| L04 | Tray singleton, hotkeys and live settings | Planned repair of legacy gaps | Duplicate owner/hotkey acknowledgement, DPI/keyboard and live-apply tests |
| L05 | Pause/resume, skip and queue editor | Planned | Genuine provider/queue semantics; stop is not resumable pause |
| L06 | Launch-on-login/startup shortcuts | Archived; opt-in planned | Installation ownership, reversible setup and no duplicate narration |
| L07 | Avatar/voice shell/screen switching | Archived; installed copies differ | Provenance/licensing and actual control/route tests; optional module |
| V01 | Voice discovery, speed and mode selection | Core integrated; old UI archived | Coherent UI/API and available-voice validation across providers |
| V02 | Edge/cloud voice path | Archived; optional planned | Explicit remote-text consent, cost/cancel/failure policy; no cloud fallback |
| V03 | Piper/additional local engines | Archived partial interface; planned | Real engine conformance, licensing, downloads/integrity and platform resources |
| V04 | Multilingual speech and pronunciation dictionary | Planned | Engine/language capability matrix and human listening |
| V05 | Duration estimate and resumable long replies | Planned | Measured estimates, provider-specific resume and chunk/timeout tests |
| D01 | Accessible tray/menu-bar desktop controller | Planned using reviewed legacy inventory | Keyboard/screen-reader usability; portable supported-platform controls |
| D02 | Device/Bluetooth/output switching and sleep/resume | Planned | Native hardware and missing-device/recovery tests |
| D03 | Safe setup/repair and signed/provenanced distribution | Core lifecycle integrated; distribution planned | Actual signed artifacts, second-user install, discovery and rollback receipts |
| O01 | Compatibility certification and support service | Planned | Published tested-version receipts and support/update lifecycle |
| O02 | Managed team deployment/settings sync | Planned optional | Separate policy/identity/retention design and staged rollout; no transcript upload default |
| O03 | Consented cloned voice | Planned separate myvoice companion | Rights/consent, reference quality/word accuracy and human acceptance |
| O04 | Microphone/transcription/agent conversation | Archived experimental shell; planned companion | Explicit capture/routing, device indicator, privacy and backend evidence |
| O05 | Spoken interruption/full duplex | Planned, not certified legacy behaviour | Echo/barge-in/latency tests; no automatic microphone activation |

## Other reviewer proposals and known gaps

Loopback web controls, a metadata-only conversation ledger, gestures and marketplace
packages appear in PR42's next-programme proposal. They are not delivered features.
Triage their concrete scope with the owner before treating private content retention,
camera access, store publishing or new services as authorized activation. Host/source
identity alone never gives read or narration consent. Keep optional modules separate.

Legacy PR42 at 9fedaa449c3071aacc4aa6e7e7f88cc6ffceb756 supplies an archival packet.
Original distribution provenance and complete installed-copy equivalence remain open.
Its Start-Process argument splitting is peer-reproduced; preserve the archive and fix
in a separately reviewed active companion before transplanting desktop controls.

## Current blockers and ordering

1. Diagnose exact8491472 Windows Node18 installation timeout: helper exceeded60s
   after offline9903 assertions and manifest verification passed. Preserve run37183108521,
   job111379459703; no claim of an ACL refusal or confirmed Node18-specific cause.
   Same exact head's other run37183106417 passes17/17, including Windows Node18.
   Both receipts remain valid; one green duplicate does not erase the timed-out run.
2. Close installation EPERM and policy compatibility with the affected/clean hosts.
3. Connect consent registry, event/delta reconciliation, queue and contained player;
   then build verified legacy control migration against the same core.
4. Certify real harness/platform/listener evidence, including second Windows host and
   native Mac/Linux. Passing fixture/parser/process tests do not certify these.
5. Obtain specific 0.5 MOMM source-sharing authorization and independent exact-byte
   review/dispositions. Approval remains pending; no source dispatch workaround.

Use this matrix as a checklist: each row needs source references, exact tested commit,
result/skip reason and disposition before it can be marked accepted. Nothing in this
document declares full consolidation, signs an artifact or approves stable release.
