# GitHub Copilot CLI (`copilot`)

GitHub's terminal agent. MOMM route `copilot`, default persona `verifier`. Installed: 1.0.83 via npm (`@github/copilot`). Raw help: [help/copilot.txt](help/copilot.txt) and the built-in topics [help/copilot-help-topics.txt](help/copilot-help-topics.txt) (`copilot help environment|limits|billing|permissions|config|sandbox`). Docs: https://docs.github.com/copilot/how-tos/copilot-cli (the reference pages fetched on 2026-09-12 covered `copilot login` only).

## Install and update

`npm install -g @github/copilot`; `copilot update [channel]`. Auto-update is on by default except in CI (`CI`, `BUILD_NUMBER`, `RUN_ID`, `SYSTEM_COLLECTIONURI`); `--no-auto-update` or `COPILOT_AUTO_UPDATE=false` disables it.

## Authentication

- `copilot login` — browser flow locally, device-code on remote terminals/CI; options `--host`, `--web-flow`, `--device-code`, `--with-token`.
- Token precedence: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (fine-grained PATs need the "Copilot Requests" permission; `gh auth` OAuth tokens work). MOMM relies on the stored keyring login and does not set tokens.
- State: `~/.copilot/` (`COPILOT_HOME`); with no credential store the token is a plain-text file there.
- `GH_HOST` / `COPILOT_GH_HOST` for GitHub Enterprise hosts.

## Non-interactive mode

`copilot -p "<prompt>"` executes one prompt and exits; `-s/--silent` prints only the agent response. stdin is ignored in prompt mode, so MOMM writes `prompt.txt` into a temp dir and says "Read prompt.txt".

- `--output-format text|json` (`json` = JSONL, one object per line); `--stream on|off` (1.15.0 candidate passes `off` for a single final text).
- Tool visibility vs permission: `--available-tools[=tools...]` and `--excluded-tools` decide what the model can see; `--allow-tool`, `--deny-tool`, `--allow-all-tools` decide prompting. MOMM uses `--available-tools=view --allow-tool=view` so the read-only file viewer is the only tool, plus `--add-dir <tmp>` so it may read the prompt file. `--disallow-temp-dir` would break that.
- Isolation: `--no-custom-instructions` (no AGENTS.md), `--disable-builtin-mcps` (no github-mcp-server), `--no-remote-export` (no session export or remote control), `--log-level none`, `--no-color`.
- `--model`, `--effort none|minimal|low|medium|high|xhigh|max`, `--attachment <path>` (images/documents, non-interactive only), `--max-ai-credits` (soft cap, minimum 30).
- `--allow-all`, `--yolo`, `--allow-all-paths`, `--allow-all-urls` must never appear in the adapter.

## Billing and limits

Usage is measured in AI credits (legacy plans: premium requests). When the plan's monthly allowance is spent the CLI answers `You have exceeded your monthly quota (Request ID: …)` immediately (about 6 s) — MOMM records it as `error`, not `authentication_required`; logging in again does nothing. Session caps are opt-in via `--max-ai-credits`.

## Observed behaviour

- Median 29 s per review, p90 about 2 min; completes reliably when quota exists.
- Lowest governor acceptance rate on this project (38 %), and the route whose CRITICAL claim on 1.13.0 did not reproduce — which is why its persona demands verbatim quotes.
- 2026-09-12: monthly quota exhausted for the whole day; every attempt returned the quota error.

## Adapter notes

Copilot occasionally returns a plan instead of the JSON when asked to "follow embedded instructions"; the 1.15.0 prompt wording ("Return the completed JSON review, not a plan") is aimed at that. GitHub 5xx responses classify as `provider_unavailable` and are retried once.
