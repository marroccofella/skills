# MOMM 1.18 authentication policy — development, not installed

Owner direction on 11 October 2026 (Dubai): OAuth is primary/default; users may
explicitly choose an API key for a supported reviewer/API connector. This replaces
the prior OAuth-only development plan. It does not change installed signed 1.17.3.

## Exact hard-constraint diff

Previous:

> Use OAuth/account sessions only. Never provide, request, read, print, or fall back to API keys.

Development replacement:

> Default to OAuth/account sessions. Optional API-key authentication requires an explicit owner-selected qualified API connector, protected secret handling and exact policy/trust/disclosure/logging/budget approvals. Never request keys in chat, print them, place them in prompts/source/logs/subprocess arguments, or automatically fall back from OAuth. Existing CLI adapters remain account-session-based; provider API routes are separate adapters. A saved auth-mode preference is not credential activation, worker qualification or a quorum vote. The 1.18 native path remains gated until those components and approvals are verified.

## Operating rules

- OAuth failure stays an OAuth status. It cannot trigger a key request or key use.
- Key mode is an explicit per-profile choice for a qualified connector. A provider
  without a reviewed key-capable adapter remains unavailable in that mode.
- Credentials are owner-entered through a private authenticated handoff and kept
  in an OS-protected store. The settings registry stores mode/reference/epoch,
  never a key. The ordinary save-profile endpoint must reject credential fields.
- Bind approval to auth mode, provider/endpoint/resource, trust, credential epoch,
  source/fixture disclosure, logging policy and finite budgets. A changed binding
  invalidates approval and qualification before secret access.
- Auth mode, key rotation, connector duplication or account changes do not create
  independent reviewer identities or additional votes. Bumble still has no initial
  release-quorum authority. Baseline independent reports remain sealed first.
- Local revoke means MOMM stops use; it is not proof of remote revocation or of
  completed remote cancellation. Unknown jobs retain their original holds.
- Qualify API and OAuth adapters separately; sharing an endpoint/model is not
  evidence that both transport/auth paths work. No silent plaintext fallback.
- Do not assume every CLI accepts a key. A provider API connector is separate
  from the existing CLI account adapter and must preserve read-only scope/quorum.

## Current evidence and open gates

The saved mode defaults to OAuth, preserves an explicit key choice across restart,
refuses credential imports/automatic fallback and leaves profiles disabled. It is
not live protected key entry, an OAuth login, a provider adapter or qualification.
The native guard remains closed. Synthetic setting/UI tests are not native browser
or multi-OS protected-store proof. Exact activation receipts, broker/UI handoff,
adapter qualification, complete independent source review and final pack remain
required before native live use or any release.

Separately owner-authorized, finite standalone Bab diagnostics may use the existing
private key mechanism during the renewed work window. Those attempts remain outside
MOMM, preserve failures/unknown holds, and confer no native qualification or votes.

That renewed window expired on 11 October; it grants no ongoing dispatch. On
14 October the owner separately approved the narrowly bounded protected-service-key
synthetic shadow scope in `bumble-peer-shadow-1.18.md` (four requests maximum,
1,024 tokens, 180 seconds, sequential, no retries). It is not global OAuth fallback
or activation of the normal native route. Current-source/helper qualification,
exact prior-request reconciliation, shared holds and protected host receipts still
gate use; no real credential read or new live request follows from a saved preference.
