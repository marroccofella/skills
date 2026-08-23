# Getting started without surprises

MOMM lets the coding agent you are already using ask other locally installed agent CLIs for read-only peer reviews. Your current agent remains the governor: it is the only writer, and it must reproduce a finding before changing code.

## The easiest first command

From the cloned skills repository:

```text
node momm/scripts/setup-ui.mjs --governor codex
```

Replace `codex` with the agent currently driving the work: `claude`, `antigravity`, `copilot`, `grok`, `gemini`, or `other`. From inside the `momm` directory, omit the leading `momm/`. Supplying the governor at startup prevents any check from accidentally including the active writer. If it is omitted, reviewer checks stay paused until the user chooses the controller in the page.

The local Setup Center opens in the browser and:

- reads one six-provider manifest for Codex, Claude Code, Antigravity, GitHub Copilot, Grok, and optional Gemini;
- checks every route except the selected governor, which is always self-excluded;
- separates the active controller from unified provider cards that combine CLI, account, and model status;
- offers **Quick Setup** to verify every detected session in sequence, while leaving interactive OAuth sign-in as an explicit user action;
- opens visible install or provider-login terminals only after a user click;
- rechecks while the user completes browser OAuth;
- offers a harmless live test for which MOMM supplies no project source or rules; and
- checks skill releases, reviewer CLI updates, model access, runtimes, and relevant environment-variable names; and
- never reads credential contents or asks for API keys.

The server listens only on `127.0.0.1`, rejects non-local clients and cross-origin action requests, requires a random session token for actions, and accepts only fixed provider/action combinations. MOMM supplies no project content during setup. Provider-native saved account instructions or configuration may still apply inside that provider's CLI, so Setup Center discloses this boundary instead of claiming complete provider isolation. A later real peer review does send the user-selected diff or input to the chosen provider, so source-sharing permission must be confirmed before dispatch. The Setup Center cannot be meaningfully hosted as a normal public website because public pages cannot safely launch or inspect local CLIs.

When the user clicks **Verify connection**, MOMM makes one real provider call with a fixed, disclosed synthetic sentence. A one-time IPC capability binds the request to that exact sentence, provider, and controller; the dispatcher rejects direct or arbitrary-input setup-probe attempts. It runs from a newly created operating-system temporary directory, does not load the project's `.reviewrules`, accepts no input file, writes no report or `.ensemble_reviews` ledger entry, and removes the temporary directory afterward. Provider-native saved configuration may still apply. Raw provider diagnostics are scrubbed before display: browser OAuth URLs, authorization/device codes, account identifiers, credential-shaped values, and user-home paths are hidden while the status and next action remain readable. The check proves current connectivity only; it does not grant MOMM access to credentials and it does not prove future availability. Keep every authorization or device code in the provider terminal/browser—never paste one into Setup Center or chat.

## Stay updated

The **Skills & diagnostics** panel shows the four canonical skill families from the `myskills` functional runner: MOMM, myrepo, Yorkshire/yorky, and Promptus/myvoice. Alias names share one row. Functional health, dependency readiness, published version, local-newer state, and repository changes are separate signals—“version current” never means “working.” It offers a safe diff view and guided commit terminal for repository changes; neither action stages or commits automatically. Healthy system details remain collapsed, while active conflicts are expanded and explained. Its read-only checks:

- runs each canonical skill's safe self-test or readiness contract and separately compares local versions with the published manifest;
- checks Claude and Copilot against their npm releases, Grok through `grok update --check --json`, and reports Antigravity's built-in self-updater;
- verifies Node.js, Git, PowerShell on Windows, and the operating system;
- distinguishes provider login from account-specific model availability; and
- reports only the names of API-key, update-control, model, endpoint, and proxy variables that may alter behavior.

It never returns environment values. API-key variables, cloud credentials, and provider endpoint overrides are removed from every provider-facing subprocess. An update is applied only after the user clicks **Update**, confirms the action, and sees the provider's official updater in a visible terminal. Skill updates use `git pull --ff-only`, are offered only for the exact verified checkout, and are withheld when local repository changes are present.

For headless machines or people who prefer the terminal, replace `codex` with the harness currently driving the work:

```text
node momm/scripts/onboard.mjs --governor codex
```

Add `--link` only when the user wants MOMM added to the current harness's skill discovery. Add `--json` for automation.

## Understand the result

| State or result | Meaning | Next step |
| --- | --- | --- |
| **Verified** / `success` | The isolated synthetic call succeeded; no evidence was persisted | The route is ready for a real review now |
| **Session detected** | Local OAuth evidence exists but has not been proven live | Click **Verify connection** |
| **Possible session** | A shared local folder suggests a session, but the evidence is weak | Verify before relying on it |
| **Sign in** / `authentication_required` | The CLI exists, but the session is absent or expired | Run the exact sign-in action shown, then verify again |
| **Install** / `missing` | The CLI is not on the current `PATH` | Run the shown installer, restart the terminal if required, then sign in |
| **Provider unavailable** / `provider_unavailable` | The provider failed transiently; this is not an auth diagnosis | Wait and retry; do not sign in again merely because of an outage |
| **Account not eligible** / `ineligible_tier` | The signed-in account cannot use that route | Follow the provider-specific eligibility help or choose another reviewer |
| **Check timed out** / `timeout` | The isolated call did not finish before its deadline | Retry once, then inspect network/provider health |
| **Unreadable response** / `invalid_output` | The CLI returned output that MOMM could not safely accept | Retry, then run `multi-review.mjs --doctor` if it repeats |
| `disabled_no_oauth` | The route cannot run under MOMM's OAuth-only policy | Choose another OAuth-capable route; never add an API key |
| `unsupported` | The installed adapter or account cannot perform this review | Choose another supported reviewer and retain the status as reported |
| **Check failed** / `error` | The route failed without a safer classification | Inspect the shown detail; do not assume login is the cause |
| **Governor** / `self_excluded` | This is the agent in control | Nothing; self-exclusion is the integrity boundary |

OAuth presence is local evidence, not proof that a session is live. MOMM preserves the provider's actual terminal result instead of turning every failure into “Needs login.” A non-success result is a route status, never a review finding.

## Run the first review

Start with one ready reviewer and an explicit minimum-success gate:

```text
node momm/scripts/multi-review.mjs --governor codex --reviewers antigravity --min-success 1
```

With no `--input`, MOMM reviews `git diff HEAD`. It sends the sanitized diff to the selected provider, so confirm that the provider is allowed to receive the source before dispatching. To review a specific patch or text artifact, use `--input <file>`.

The governor then reproduces plausible findings, authors any fixes itself, runs local checks, and records an explicit disposition for every improvement suggestion. Reviewer consensus prioritizes investigation; it is never permission to edit.

## A low-stress team rollout

1. Pin a reviewed MOMM version or repository commit.
2. Run onboarding without `--link` first; use `--link` only after confirming the detected harness.
3. Bring one provider online, run a small non-sensitive review, and inspect the report.
4. Add providers gradually and set `--min-success` to the release quorum your team requires.
5. Keep `.ensemble_reviews/` ignored. It is private, per-machine telemetry and may reference internal code.
6. Never put provider API keys into CI for MOMM. Its supported trust model is local OAuth/account sessions only.

## Common recovery steps

- **Command still missing after install:** open a new terminal so the updated user `PATH` is loaded, then rerun onboarding.
- **Login is still reported absent:** run the exact login command shown, finish the browser flow, and rerun onboarding. Never paste a token, authorization code, or device code into chat.
- **No changes to review:** make or stage a change, or pass `--input <file>`.
- **Provider outage:** wait and rerun. Do not log in again for a `provider_unavailable` result.
- **Source cannot leave the machine:** do not dispatch to external providers; review locally with the governor instead.

## Official account and model routes

| Provider | Sign in | View/select models | Official help |
| --- | --- | --- | --- |
| OpenAI Codex | `codex login` | launch `codex`, then `/model` | [CLI](https://learn.chatgpt.com/docs/codex/cli) · [authentication](https://learn.chatgpt.com/docs/auth) · [models](https://learn.chatgpt.com/docs/models) |
| Claude Code | `claude auth login` | launch `claude`, then `/model` | [setup](https://code.claude.com/docs/en/setup) · [authentication](https://code.claude.com/docs/en/authentication) · [models](https://code.claude.com/docs/en/model-config) |
| Google Antigravity | launch `agy`; browser sign-in opens when needed | `agy models` or interactive `/model` | [install](https://antigravity.google/docs/cli/install/) · [reference](https://antigravity.google/docs/cli/reference) · [models](https://antigravity.google/docs/cli/headless/) |
| GitHub Copilot CLI | `copilot login` | launch `copilot`, then `/model` | [install](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) · [authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli) · [reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| Grok | `grok login` | `grok models` or interactive `/model` | [overview](https://docs.x.ai/build/overview) · [CLI reference](https://docs.x.ai/build/cli/reference) |
| Gemini CLI (optional) | launch `gemini` and choose Google sign-in; `/auth` changes it | launch `gemini`, then `/model manage` | [getting started](https://geminicli.com/docs/get-started/) · [authentication](https://geminicli.com/docs/get-started/authentication/) · [commands](https://geminicli.com/docs/reference/commands/) |

Antigravity does not expose a supported `agy login` command, and current Copilot uses `/model`, not `/models`. Gemini remains optional because current account eligibility varies; rely on live verification rather than assuming eligibility from a local folder or plan name.
