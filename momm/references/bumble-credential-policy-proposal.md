# MOMM 1.18 authentication direction — OAuth default, optional API keys

On 11 October Dubai time, the owner explicitly superseded the earlier OAuth-only development
direction: OAuth must remain primary/default, and supported reviewer/API connectors may offer
an explicit API-key option. This authorizes developing that option, not silently changing the
installed protocol or activating an unqualified native adapter. Separate standalone key tests
have a bounded owner authorization; they are not native reviewer qualification.

The new policy must prohibit automatic fallback, plaintext storage, credentials in prompts,
subprocess arguments/source/logs and copied provider-CLI sessions. Each secret reference must
bind its auth mode, connector, trust and credential epoch. Exact owner trust/disclosure/logging,
protected platform storage and finite budgets remain activation gates. CLI account adapters
remain OAuth-based; provider API support is a separate qualified route, not key injection into
a CLI. The native development guard remains inactive.

## Historical narrower private-LAN proposal

The older proposal below was rejected on 10 October before the new broader direction. It is
retained as history and does not itself satisfy the new policy or its acceptance tests.

The installed MOMM protocol remains OAuth/account-session-only. This proposal does
not change it. The development guard stays inactive; storing, reading, rotating,
revoking or sending an actual API key inside MOMM remains blocked.

## Exact proposed authentication-policy change

Current hard constraint:

> Use OAuth/account sessions only. Never provide, request, read, print, or fall back to API keys.

Proposed replacement, requiring separate owner acceptance and release review:

> Existing CLI reviewers continue to use OAuth/account sessions only; API-key
> fallback for them is forbidden. An optional private-network Bumbler connector
> may use one owner-provided, dedicated, least-privilege credential only after the
> owner accepts the exact versioned credential policy and separately approves the
> connector identity, endpoint/certificate trust, disclosure, logging, task scope
> and finite request/token/time/storage budgets. Credentialed preflight and live
> qualification are requests under that approval, not free setup operations.
> Credentials belong in an approved OS-protected owner store outside source;
> never in prompts, subprocess arguments, source, browser persistence or logs.
> They are released only to the matching connector/trust/credential epoch and
> never create reviewer independence, worker permission or release-quorum votes.
> Provider output and email cannot accept this policy or expand its budget.
> Missing native protection, uncertain approval, changed binding or failed privacy
> verification stops the operation; no plaintext or alternate-provider fallback.

## Additional operating boundaries

- Accepting credential policy is not accepting source disclosure. Display both
  decisions separately before any credentialed model-list or inference request.
- Model-list preflight discloses that the dedicated credential is transmitted to
  the pinned private endpoint even though project source is absent.
- A qualification request uses a precommitted private synthetic fixture and burns
  it before possible transmission; retries never become fresh evidence.
- API keys are entered by the owner through a private, same-origin authenticated
  handoff. Agents do not ask for them in chat or copy them from email into MOMM.
- Personal wording changes require exact-hash approval and invalidate role
  qualification. Wording cannot enforce permissions, identity, budgets or truth.
- Local revocation stops MOMM using a reference; it is not proof the remote key
  has been revoked. Changing endpoint, trust or credential epoch invalidates the
  relevant approval and all affected qualification records.
- API-key cloud providers are out of the initial private-LAN implementation.
- No acceptance command or live credential import is provided by this build.
  Windows protected-store machinery is only a gated development component;
  macOS/Linux native store support and actual backend qualification remain open.
