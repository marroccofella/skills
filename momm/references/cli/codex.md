# Codex CLI (`codex`)

OpenAI's terminal agent. MOMM route `codex`, default persona `surgeon`. Installed: codex-cli 0.154.0 via npm (upgraded from 0.147.0 on 2026-09-13). Raw help: [help/codex.txt](help/codex.txt), [help/codex-exec.txt](help/codex-exec.txt), [help/codex-login.txt](help/codex-login.txt).

## Install and update

- npm: `npm install -g @openai/codex` (this machine; `codex doctor` shows the npm package root and `codex.cmd` shim on PATH).
- Official script (macOS/Linux): `curl -fsSL https://chatgpt.com/codex/install.sh | sh`; the same command updates.
- `codex update` updates in place; `codex doctor` diagnoses install, auth, config and runtime health (safe, no model call).
- Docs: https://learn.chatgpt.com/docs/codex/cli (the `developers.openai.com/codex/*` URLs redirect there; the non-interactive-mode and config sub-pages returned 404 on 2026-09-12).

## Authentication

- `codex login` opens the ChatGPT browser flow; `codex login --device-auth` for headless machines; `codex login status` prints the state (`Logged in using ChatGPT`).
- API-key paths exist (`codex login --with-api-key`, `--with-access-token`, `OPENAI_API_KEY`) — MOMM never uses them and strips `OPENAI_API_KEY` from the child environment.
- State lives in `~/.codex` (`CODEX_HOME`): `config.toml`, credentials, session rollouts, `models_cache.json`.

## Non-interactive mode

`codex exec [OPTIONS] [PROMPT]` — prompt from the argument, or from stdin when omitted or `-`; if both, stdin is appended as a `<stdin>` block.

Flags MOMM relies on or should know:

- `--sandbox read-only|workspace-write|danger-full-access` — MOMM uses `read-only`.
- `--skip-git-repo-check` — required outside a Git repository, otherwise: `Not inside a trusted directory and --skip-git-repo-check was not specified.`
- `--color never`; `--json` prints events as JSONL; `-o/--output-last-message <file>`; `--output-schema <file>` constrains the final response.
- `-i/--image <FILE>...` attaches images (MOMM's image modality).
- `-m/--model`, `-c key=value` config overrides, `-p/--profile`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral` (no session files).
- `-a/--ask-for-approval untrusted|on-request|never`; never pass `--dangerously-bypass-approvals-and-sandbox`.

Output: with plain `exec`, stdout carries the session banner (`OpenAI Codex v… session id …`), the echoed prompt, then the reply; MOMM's parser scans for the last balanced JSON object. With `--json`, one event per line and the review is inside the final agent message.

## Configuration

`~/.codex/config.toml` keys seen on this machine: `model`, `model_reasoning_effort`, `personality`, `service_tier`, `notify`, and per-project `[projects.'<path>'] trust_level`. `-c` overrides use dotted keys with TOML values (`-c model="o3"`).

## Observed behaviour (2026-09-12)

- **Configured model newer than the CLI**: with `model = gpt-6-astra` in config, codex 0.147.0 fails every run with `The gpt-6-astra model requires a newer version of Codex. Update the CLI to continue.` It also logs `ERROR codex_models_manager::manager: failed to load models cache: missing field supports_parallel_tool_calls` and rewrites `models_cache.json`. MOMM 1.14.1 classified this as `authentication_required` (wrong); the 1.15 classifier returns `error` (right). The fix is the user's: `codex update` or `npm install -g @openai/codex@latest`.
- **2026-09-13, after `npm install -g @openai/codex@latest` (0.154.0)**: the same config (`model = gpt-6-astra`) runs normally — `codex exec --sandbox read-only --skip-git-repo-check -` answered a one-word probe in one turn (7.2 K tokens; banner shows `reasoning effort: ultra`). The blocker above is cleared; no config change was needed.
- New in the 0.154.0 help: `--worktree` (managed Git worktree), subcommands `agents`, `queue`, `migrate-rollouts`, `--thread-source`; the `untrusted` approval policy is no longer described under `exec --help` (`-a` still accepts values; MOMM never sets it because `--sandbox read-only` governs).
- Review time scales with input: 102 s at 14 KB, 205–341 s at 30–45 KB; it is the slowest route and the one that times out most (17 of 70 completed reviews in the public ledger).
- Highest governor acceptance rate on this project (70 %).

## Adapter notes

Prompt safety: the contract precedes `--- ARTIFACT TO REVIEW ---`; Codex's system prompt is not replaced. `--skip-git-repo-check` is mandatory because MOMM runs it from the user's project which may not be a repo (the temp dir certainly is not).
