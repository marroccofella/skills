# MOMM 1.10.0 — corrective provider authority and setup isolation

Released 2026-08-23.

MOMM 1.10.0 corrects provider routes and makes the Setup Center's authority, verification, and failure boundaries explicit. The current harness remains the sole governor, writer, and verifier; every external CLI remains an untrusted, read-only reviewer.

## What changed

### One six-provider authority

- Added one reviewed provider manifest for Codex, Claude Code, Antigravity, GitHub Copilot, Grok, and optional Gemini.
- Reused that provider identity and route data across Setup Center actions, help links, model selectors, onboarding, and review dispatch.
- Added `--governor <current-harness>` to the documented Setup Center startup. The accepted controllers are `codex`, `claude`, `antigravity`, `copilot`, `grok`, `gemini`, and `other`.
- Paused reviewer checks until a controller is known. The named governor is dynamically self-excluded from every provider view and review request.
- Kept the default review pool at Codex, Claude Code, Antigravity, Copilot, and Grok. Gemini is visible but optional because live account eligibility varies.

### Correct official routes

| Provider | Sign in | View/select models | Official documentation |
| --- | --- | --- | --- |
| Codex | `codex login` | launch `codex`, then `/model` | [CLI](https://learn.chatgpt.com/docs/codex/cli) · [auth](https://learn.chatgpt.com/docs/auth) · [models](https://learn.chatgpt.com/docs/models) |
| Claude Code | `claude auth login` | launch `claude`, then `/model` | [setup](https://code.claude.com/docs/en/setup) · [auth](https://code.claude.com/docs/en/authentication) · [models](https://code.claude.com/docs/en/model-config) |
| Antigravity | launch `agy`; it opens Google sign-in when required | `agy models` or interactive `/model` | [install](https://antigravity.google/docs/cli/install/) · [reference](https://antigravity.google/docs/cli/reference) · [models](https://antigravity.google/docs/cli/headless/) |
| GitHub Copilot | `copilot login` | launch `copilot`, then `/model` | [install](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) · [auth](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli) · [reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| Grok | `grok login` | `grok models` or interactive `/model` | [overview](https://docs.x.ai/build/overview) · [CLI reference](https://docs.x.ai/build/cli/reference) |
| Gemini *(optional)* | launch `gemini`, choose Google sign-in; `/auth` changes it | launch `gemini`, then `/model manage` | [getting started](https://geminicli.com/docs/get-started/) · [auth](https://geminicli.com/docs/get-started/authentication/) · [commands](https://geminicli.com/docs/reference/commands/) |

This release removes the unsupported `agy login` route, replaces Claude's indirect `/login` walkthrough with `claude auth login`, and corrects Copilot `/models` to `/model`. Copilot desktop sign-in is described as a visible browser flow; device-code authentication remains a remote/headless option rather than the assumed default.

### Isolated, non-persistent Setup Center probes

- A connection check now runs from a fresh operating-system temporary directory, outside the user's project.
- The Setup Center supplies only the fixed synthetic sentence and the fixed `setup-center connectivity validation` label. A one-time IPC capability binds that exact payload to its provider and controller; direct or arbitrary-input probe attempts fail closed.
- It ignores project `.reviewrules`, rejects file input and `--store-input`, and marks the report with `setup_probe: true`.
- It deliberately skips report, review-log, disposition, and ledger persistence; the result records `evidence.persisted: false` and `evidence.skipped: isolated_setup_probe`.
- It removes the temporary directory after success, failure, or timeout and redacts that path from returned detail.

The internal `--setup-probe` path is reserved for this exact flow. It is not a shortcut for ordinary reviews. The probe is still one real provider model call. MOMM supplies no repository content, filename, project rule, or stored review evidence, but provider-native saved account instructions or configuration may still apply; the UI states that limitation explicitly.

### Truthful connection states

- “Session detected” means only local account evidence; it does not mean model access was verified.
- Antigravity's shared `~/.gemini` presence is explicitly weak evidence and appears as “Possible session.”
- Terminal onboarding now separates provider-reported live status from presence-only candidates; neither is described as a successful model proof.
- Only a successful isolated synthetic call earns “Verified,” and that result expires.
- Failures retain their terminal status and provider detail. `authentication_required`, `provider_unavailable`, `ineligible_tier`, `timeout`, `missing`, `invalid_output`, `disabled_no_oauth`, `unsupported`, and `error` remain distinct and receive status-appropriate recovery guidance.
- Outages, timeouts, ineligible accounts, CLI execution failures, and malformed output are never rewritten as sign-in failures. CLI failures route to repair guidance, while account-ineligibility failures route to current provider guidance without making absolute plan or tier claims. Every non-success remains a route status, never a review finding.

### Local-only Setup Center

- The server continues to bind only to `127.0.0.1`; it is not a hosted or distributable account portal.
- Mutating requests require the random per-process session token, an allowlisted loopback host, and a same-origin request.
- Provider, action, controller, and skill handoffs are fixed allowlists; the page cannot submit arbitrary shell commands.
- Interactive install, update, and OAuth actions remain visible and user-initiated. Quick Setup never opens sign-in flows automatically.
- Credential files and environment-variable values remain unread. One shared OAuth-only environment policy passes only a reviewed runtime/OAuth allowlist to dispatcher, probe, model, and terminal subprocesses. Unknown ambient values, GitHub tokens, cloud profiles, Bedrock/Vertex selectors, API keys, endpoint overrides, and proxy variables fail closed; deterministic canaries enforce the boundary.
- Provider failures are scrubbed before display or persistence. Browser OAuth URLs, authorization/device codes, account identifiers, credential-shaped values, and user-home paths are replaced with explicit hidden markers while the useful failure class and recovery action remain visible.

### General-release usability

- Functional skill health now comes from the canonical `myskills` runner, not from version equality. MOMM, myrepo, Yorkshire/yorky, and Promptus/myvoice appear once each, with aliases grouped and dependency readiness separate from code health.
- `myskills --quick` is explicitly partial: skipped service/dependency probes report `not_checked`, never “ready” or “all skills working.” A dedicated contract checks the four canonical families, alias grouping, GitHub CLI/auth consistency, dependency aggregation, quick-mode semantics, and code/manifest version alignment in CI.
- Git actions are offered only for an exact, verified skills checkout. Dirty paths, local-newer versions, published versions, and functional failures are independent signals.
- Provider results and recovery steps persist through reload; stale refreshes block automatic verification rather than using old green state.
- Every controller-scoped request carries a backend revision. Controller changes are locked while status, maintenance, or verification work is pending, and late cross-tab responses are rejected instead of overwriting another controller's UI.
- Successful verification jobs are irreversibly invalidated when account evidence changes and repaint at expiry. Maintenance failures suppress old update/model/install actions until a successful retest.
- Closing Setup Center cancels and awaits the complete dispatcher/provider process tree before the page confirms closure. The wrapper deadline exceeds the bounded provider timeout plus its one permitted outage retry.
- Maintenance never reads or serializes `remote.origin.url`, and embedded-token URL fixtures remain redacted. Controller CLI updates and unmatched tool-manifest updates receive named visible rows so every counted update has a recovery action.
- Keyboard focus, semantic progress, persistent alerts, visible focus rings, and 44-pixel targets are release contracts.
- The 320-pixel layout has no horizontal overflow; maintenance actions stack and wrap while the complete controller choice remains readable.

## User-visible startup

From the repository root, replace `codex` with the harness currently controlling the work:

```text
node momm/scripts/setup-ui.mjs --governor codex
```

For a zero-model-call terminal readiness report:

```text
node momm/scripts/multi-review.mjs --preflight --governor codex --pretty
```

The preflight reports installation and account evidence only. A Setup Center verification is an explicit synthetic model call. A real review sends the user-selected input to the selected providers and remains subject to the governor's reproduction and local-verification gate.

## Release verification contract

Publication requires the deterministic dispatcher and Setup Center self-tests, the offline UI release contract, myrepo's zero-network privacy fixtures, canonical `myskills` health, official Agent Skill validation, loopback/host/origin action checks, setup-probe isolation and no-persistence checks, provider-diagnostic redaction, the six-provider/self-exclusion matrix, and `git diff --check`. No release note should claim a provider account is live merely because a CLI or shared session folder was detected.

At documentation handoff, these local, no-provider-call checks passed:

```text
node momm/scripts/multi-review.mjs --self-test
node momm/scripts/setup-ui.mjs --self-test
node momm/scripts/setup-ui-contract-test.mjs
node myrepo/scripts/publish.mjs --self-test
node myskills/scripts/run-all.mjs --pretty
node myskills/scripts/health-contract-test.mjs
git diff --check
```

The in-app-browser acceptance pass also exercised all seven controller choices, validated every official install/auth/model destination, checked keyboard focus and the 320-pixel/desktop layouts, and repeated a live Antigravity failure path. The final live route truthfully returned `timeout`; the result persisted after reload, no authorization or device code appeared in the page, no setup-probe directory was created in the project, and no new review evidence was written. It does **not** claim that the Antigravity account is connected.
