# Dom TTS next programme: cross-harness desktop and local web control

Status: owner-requested specification, not completed capabilities or stable
release approval. Existing Standard installation remains untouched.

## Layers and consent boundaries

1. Small offline speech core: trusted native providers, text normalization,
   bounded chunk queue, authenticated interruption and privacy-checked state.
2. Harness adapters: versioned event contracts, explicit consented source roots,
   capability discovery, reconnect/cursor reconciliation, no UI/binary injection.
3. Per-user desktop companion: singleton tray, settings, hotkeys, diagnostics,
   launcher and updates; no admin requirement for normal speech.
4. Local web control: loopback service, desktop-issued authentication/session,
   source registry, contexts, conversation ledger and read-only observability.
5. Optional extensions: cloud voices, avatar/gesticulation, Duplex, remote workers.
   Separate consent and dependencies; failure never disables Standard Mode.

## Streaming contract

```json
{
  "schema": 1,
  "harness": "generic",
  "sessionId": "opaque-local-session",
  "turnId": "opaque-turn",
  "messageId": "opaque-message",
  "eventId": "opaque-event",
  "sequence": 1,
  "kind": "delta",
  "phase": "assistant",
  "text": "Public fixture only.",
  "timestamp": "2026-10-04T00:00:00Z"
}
```

Kinds: delta, snapshot, final, cancelled, failed. Adapters must declare whether
they produce token deltas, completed progress messages or only final messages.
No adapter is called streaming merely because it polls a JSONL file.

Host display must never await the speech queue. Publish written response/events
first; enqueue asynchronously. Parsing, chunk planning and playback are separate
workers. Maintain order per turn, fair scheduling across sessions and bounded
queue bytes/chars. Final-only is the default privacy-preserving mode; progress
speech and context capture are explicitly enabled.

Stable sentence/paragraph boundaries are spoken once. Track acknowledged prefix
and event/message identity; never dedupe different sessions solely by text hash.
Carry incomplete UTF-8/JSONL bytes. Reconnect resumes acknowledged offsets; file
replacement/truncation enters reconciliation instead of silently skipping data.
Snapshots rewriting an unspoken tail can replace it; rewriting spoken content
must produce a correction event or final-only fallback, not repeat the whole turn.
Final reconciliation speaks only a validated unsaid suffix. Cancellation invalidates
the turn generation so late synthesis cannot leak onto audio. Provider retry
must not acknowledge failed chunks; an acknowledgement means actual completion,
not spawn success. Recovery never replays old chats without consent.

Separate stop speech, stop watching, pause queue, resume, skip and clear actions.
Critical priority interrupts lower-priority narration by an explicit policy;
optional resume uses the unspoken remainder, not replaying acknowledged chunks.

## Harness and store matrix

| Target | Current evidence | Required next evidence |
| --- | --- | --- |
| Codex desktop/CLI | Explicit final transcript adapter; old global watcher | Versioned events/progress support, app discovery, restart and real end-to-end receipt |
| Claude Code | Final end_turn transcript adapter | Verify actual hooks, cancellation and stream surfaces for pinned CLI version |
| OpenClaw | Legacy agents/main/sessions watcher source | Real pinned transcript/event schema, multi-agent roots and reconnect fixtures |
| Vermes/Hermes | Identity unresolved; Hermes proposed in discussion | Owner identifies exact product/repository, then official integration/store route |
| Generic agents | Normalized consented event interface planned | Contract validator, malformed/out-of-order/replay fixtures and one real producer |
| Windows/macOS/Linux | Native provider core candidates and CI | Native listening, stop, device/sleep and install receipts per declared architecture |

Skills/plugins/stores have different schemas. Ship adapter-specific packages from
one tested runtime version; do not assume one ZIP is accepted by every store.
Codex marketplace availability, Claude marketplace/plugin support, OpenClaw store
and Hermes distribution must each be verified against official current docs before
submission. Do not market untested fixture-only support as full compatibility.

## Desktop and web controls

Tray: one per-user runtime owner; show provider, current context, pending count,
warning/failure and source state. Menu: speak selection/last complete message,
stop only speech, watching on/off, pause/resume/skip/clear, settings, doctor,
open local web console, optional extensions and quit. Detect hotkey conflicts
and show actionable errors. Preserve unknown config fields, validate values,
write atomically and acknowledge live apply with runtime version/config revision.

Web app first screen is an operational console, not marketing: Sources, Sessions,
Queue, Voices, Settings, Diagnostics. Filters by harness/project/session/agent;
explicit selected/all-consented scope. Show both selected and actual fallback
provider/voice. Speed, mode, code inclusion, speech phase, priority, queue size,
source consent and microphone status are distinct controls. Keyboard navigation,
screen-reader labels, high DPI and narrow screens are release tests.

Conversation ledger defaults to metadata-only. Content capture is opt-in per
source and separately from speech permission. Fields: local opaque source/turn/
message IDs, adapter/schema version, project/context alias, timestamps, phase,
revision, acknowledgements and provenance. Optional content is local encrypted
storage with key protected by OS facilities, explicit retention, delete/export,
redaction and excluded paths. No cloud transcript upload, public telemetry or
private source capture merely to populate a dashboard. Storage key availability
is a separate locked state, not a plaintext fallback.

Context/gesticulation: expose only declared context and animation cues from
speech state/severity. Face/camera/screen sensing is separately opt-in; no inference
that an avatar implies accurate emotion, identity, camera access or legal advice.

Web service: loopback only, reject foreign Host/Origin, authenticate reads and
writes, protect CSRF, fixed allowlisted commands, bounded JSON bodies, no arbitrary
shell/path endpoints, CSP and DOM text rendering instead of untrusted HTML.
No permissive CORS or LAN binding by default. SSE/WebSocket authorization and
backpressure follow the same rules. A signed desktop launcher issues a scoped
session; do not embed persistent secrets in URLs, source or logs. Diagnostics
export is an allowlist, never an arbitrary tail of user logs.

## Distribution and incremental release policy

Use one runtime, three delivery routes: platform skill/plugin package, signed
Windows installer and developer portable archive. Inno Setup is a proposed
Windows packaging choice, not proof of an existing compiled artifact. Bundle
runtime/dependencies for public Windows builds; sign and publish SHA256 and
provenance. Per-user version directories, staged install, validated manifests,
settings migrations, rollback and reversible uninstall are required.

Publish reviewable development commits/PRs first. Stable/public install channel
cannot advance solely because the owner asked for momentum. Exact-head automated
checks, privacy/security review, independent final-byte agreement, clean install/
upgrade/repair/uninstall, native audible receipts and store schema checks gate
each advertised capability. Show missing/unsupported features in UI. Updates
require explicit channel/consent and preserve production until rollback verified.

Delivery order: (1) provenance and source handoff, (2) stop/display/queue contract,
(3) consented adapters and real harness receipts, (4) tray parity and settings,
(5) local control/metadata ledger, (6) signed installer/store packaging,
(7) separately consented content ledger/avatar/Duplex extensions.
