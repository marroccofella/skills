# Getting started without surprises

MOMM lets the coding agent you are already using ask other locally installed agent CLIs for read-only peer reviews. Your current agent remains the governor: it is the only writer, and it must reproduce a finding before changing code.

## The easiest first command

From the cloned skills repository:

```text
node momm/scripts/setup-ui.mjs
```

From inside the `momm` directory, omit the leading `momm/`. The local Setup Center opens in the browser and:

- checks every reviewer route automatically;
- separates the active controller from unified provider cards that combine CLI, account, and model status;
- offers **Quick Setup** to verify every detected session in sequence, while leaving interactive OAuth sign-in as an explicit user action;
- opens visible install or provider-login terminals only after a user click;
- rechecks while the user completes browser OAuth;
- offers a harmless live test containing no project source; and
- checks skill releases, reviewer CLI updates, model access, runtimes, and relevant environment-variable names; and
- never reads credential contents or asks for API keys.

The server listens only on `127.0.0.1`, rejects non-local clients, requires a random session token for actions, and accepts only fixed provider/action combinations. Setup sends no project content. A later real peer review does send the user-selected diff or input to the chosen provider, so source-sharing permission must be confirmed before dispatch. The Setup Center cannot be meaningfully hosted as a normal public website because public pages cannot safely launch or inspect local CLIs.

## Stay updated

The **Skills & diagnostics** panel groups skills as **Update available**, **Modified locally**, or **Up to date**. It offers a safe diff view and guided commit terminal for local changes; neither action stages or commits automatically. Healthy system details remain collapsed, while active conflicts are expanded and explained. Its read-only checks:

- compares every local skill version in `versions.json` with the published manifest;
- checks Claude and Copilot against their npm releases, Grok through `grok update --check --json`, and reports Antigravity's built-in self-updater;
- verifies Node.js, Git, PowerShell on Windows, and the operating system;
- distinguishes provider login from account-specific model availability; and
- reports only the names of API-key, update-control, model, endpoint, and proxy variables that may alter behavior.

It never returns environment values. An update is applied only after the user clicks **Update**, confirms the action, and sees the provider's official updater in a visible terminal. Skill updates use `git pull --ff-only` and are withheld when local repository changes are present.

For headless machines or people who prefer the terminal, replace `codex` with the harness currently driving the work:

```text
node momm/scripts/onboard.mjs --governor codex
```

Add `--link` only when the user wants MOMM added to the current harness's skill discovery. Add `--json` for automation.

## Understand the result

| State | Meaning | Next step |
| --- | --- | --- |
| `ready` | A harmless live check succeeded | Use it for the first review |
| `detected` | Local OAuth evidence exists but has not been proven live | Click **Verify connection** |
| `login` | CLI exists, but no account session was detected | Run the exact `login` action shown |
| `install` | CLI is not on the current `PATH` | Run the exact `install` action shown, restart the terminal if required, then log in |
| `governor` | This is the agent in control | It is deliberately excluded from reviewers |
| `attention` | The probe is inconclusive | Run `multi-review.mjs --doctor` and inspect the route |

OAuth presence is only local evidence, not proof that a session is live. The Setup Center makes that distinction visible and fails closed with **Needs login** when its synthetic verification finds an expired or shared session.

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
- **Login is still reported absent:** run the exact login command shown, finish the browser flow, and rerun onboarding. Never paste a token into chat.
- **No changes to review:** make or stage a change, or pass `--input <file>`.
- **Provider outage:** wait and rerun. Do not log in again for a `provider_unavailable` result.
- **Source cannot leave the machine:** do not dispatch to external providers; review locally with the governor instead.

Provider setup references: [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started), [Antigravity CLI](https://antigravity.google/docs/cli/install/), [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), and [Grok CLI](https://x.ai/cli).
