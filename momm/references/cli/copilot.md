# GitHub Copilot CLI (`copilot`)

GitHub's terminal agent. MOMM route `copilot`, default persona `verifier`. Installed: 1.0.83 via npm (`@github/copilot`; still current on 2026-09-13, help topics re-captured). Raw help: [help/copilot.txt](help/copilot.txt) and the built-in topics [help/copilot-help-topics.txt](help/copilot-help-topics.txt) (`copilot help environment|limits|billing|permissions|config|sandbox`). Docs: https://docs.github.com/copilot/how-tos/copilot-cli (the reference pages fetched on 2026-09-12 covered `copilot login` only).

## Install and update

`npm install -g @github/copilot`; `copilot update [channel]`. Auto-update is on by default except in CI (`CI`, `BUILD_NUMBER`, `RUN_ID`, `SYSTEM_COLLECTIONURI`); `--no-auto-update` or `COPILOT_AUTO_UPDATE=false` disables it.

## Authentication

- `copilot login` — browser flow locally, device-code on remote terminals/CI; options `--host`, `--web-flow`, `--device-code`, `--with-token`.
- Token precedence: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (fine-grained PATs need the "Copilot Requests" permission; `gh auth` OAuth tokens work). MOMM relies on the stored keyring login and does not set tokens.
- State: `~/.copilot/` (`COPILOT_HOME`); with no credential store the token is a plain-text file there.
- `GH_HOST` / `COPILOT_GH_HOST` for GitHub Enterprise hosts.

## Non-interactive mode

`copilot -p "<prompt>"` executes one prompt and exits; `-s/--silent` prints only the agent response. stdin is ignored in prompt mode, so MOMM writes `prompt.txt` into a temp dir and says "Read prompt.txt".

- `--output-format text|json` (`json` = JSONL, one object per line); `--stream on|off`. The 1.16 repair candidate uses JSONL with streaming off: success needs both an `assistant.message` inside a turn closed by `assistant.turn_end` and exactly one `result` event, last in the stream, whose `exitCode` is the number `0`. Process exit 0 without that `result` event is `invalid_output`; any `session.error`, `session.abort`, `is_error: true`, `error` field or non-zero `exitCode` is `error`; an event type outside the known list refuses the whole output. That list was captured from the Copilot CLI version recorded in this file's help capture, so a newer CLI that adds an event type is refused as `invalid_output` until the list is updated: check the installed version first when every Copilot review fails that way. Human-rendered text is not a machine JSON transport.
- Tool visibility vs permission: `--available-tools[=tools...]` and `--excluded-tools` decide what the model can see; `--allow-tool`, `--deny-tool`, `--allow-all-tools` decide prompting. MOMM uses `--available-tools=view --allow-tool=view` so the read-only file viewer is the only tool, plus `--add-dir <tmp>` so it may read the prompt file. `--disallow-temp-dir` would break that.
- Isolation: `--no-custom-instructions` (no AGENTS.md), `--disable-builtin-mcps` (no github-mcp-server), `--no-remote-export` (no session export or remote control), `--log-level none`, `--no-color`.
- `--model`, `--effort none|minimal|low|medium|high|xhigh|max`, `--attachment <path>` (images/documents, non-interactive only), `--max-ai-credits` (soft cap, minimum 30).
- `--allow-all`, `--yolo`, `--allow-all-paths`, `--allow-all-urls` must never appear in the adapter.

## Models listed by `copilot help config` (1.0.83)

`claude-sonnet-5`, `claude-fable-5.1`, `claude-fable-5`, `claude-opus-5`, `claude-opus-4.8[-fast]`, `claude-opus-4.7`, `claude-sonnet-4.6`, `claude-haiku-4.5`, `gpt-5.6-sol|terra|luna`, `gpt-5.5`, `gpt-5.4[-mini]`, `gpt-5.3-codex`, `gpt-5-mini`, `mai-code-1.1-flash`, `mai-code-1-flash-picker`, `gemini-3.8|3.7|3.6|3.5-flash`, `grok-4.5`, `kimi-k3`, `kimi-k2.7-code`. The Kimi entries would give MOMM a Moonshot second opinion under the existing GitHub login. **Probed 2026-09-13**: `--model kimi-k3` and `--model kimi-k2.7-code` both returned `Error: Model "…" from --model flag is not available.` while the default model returned the monthly-quota error, so plan eligibility could not be separated from quota exhaustion — re-probe when the quota resets. Config keys `defaultMode` and `defaultPermissionMode` (`manual|assisted|allow-all`) exist but explicitly do not apply to `-p` runs.

## Billing and limits

Usage is measured in AI credits (legacy plans: premium requests). When the plan's monthly allowance is spent the CLI answers `You have exceeded your monthly quota (Request ID: …)` immediately (about 6 s) — MOMM records it as `error`, not `authentication_required`; logging in again does nothing. Session caps are opt-in via `--max-ai-credits`.

## Observed behaviour

- Median 29 s per review, p90 about 2 min; completes reliably when quota exists.
- Lowest governor acceptance rate on this project (38 %), and the route whose CRITICAL claim on 1.13.0 did not reproduce — which is why its persona demands verbatim quotes.
- 2026-09-12 and 2026-09-13: monthly quota exhausted; every attempt returned the quota error.

## Adapter notes

Independent synthetic captures on Copilot 1.0.85 (16 September 2026) found literal
line wrapping and unescaped quotes in human text output. The malformed answer was
correctly rejected. A direct JSONL comparison preserved parseable answer bytes;
it was one diagnostic sample, not a reliability guarantee. The repair consumes
only the completed assistant message, never tool output or reasoning, and keeps
the full review-contract checks. Unknown events, missing/failing terminal results,
truncation and non-JSON answers fail closed. Existing read-only tool restrictions
remain unchanged. See the [public investigation](https://github.com/marroccofella/skills/pull/4#issuecomment-5700415320).

Copilot occasionally returns a plan instead of the JSON when asked to "follow embedded instructions"; the 1.15.0 prompt wording ("Return the completed JSON review, not a plan") is aimed at that. GitHub 5xx responses classify as `provider_unavailable` and are retried once.
