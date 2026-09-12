# Grok CLI (`grok`, "Grok Build")

xAI's terminal agent. MOMM route `grok`, default persona `innovator`. Installed: grok 1.0.5 (5115b46bc9) stable at `~/.grok/bin/grok.exe` (the dispatcher resolves this path directly because the installer's PATH change may not reach a long-lived session). Raw help: [help/grok.txt](help/grok.txt), [help/grok-login.txt](help/grok-login.txt), [help/grok-agent.txt](help/grok-agent.txt). Official docs: https://x.ai/cli (403 to automated fetch on 2026-09-12) — the `--help` capture is the reference of record.

## Install and update

- Windows: `irm https://x.ai/cli/install.ps1 | iex`; other platforms via https://x.ai/cli.
- `grok update` checks for or installs a version; `grok doctor` checks terminal support; `grok inspect` shows the configuration discovered for a directory.
- State: `~/.grok/` (`config.toml`, sessions, `leader.sock`, `bin/`); `grok du` reports disk use.

## Authentication

`grok login` — `--oauth` (auth.x.ai browser flow) or `--device-auth` (alias `--device-code`) for headless machines; `grok logout` clears credentials. Unauthenticated runs fail closed with a structured "Not signed in" error that MOMM classifies as `authentication_required`. An `XAI_API_KEY` environment path exists; MOMM strips it.

## Non-interactive mode

`grok --prompt-file <path>` (or `-p/--single "<prompt>"`, `--prompt-json`) runs a single turn and prints to stdout.

- `--output-format plain|json|streaming-json|streaming-messages-json`; `--json-schema` implies json and constrains the model.
- `--permission-mode default|acceptEdits|auto|dontAsk|bypassPermissions|plan` — MOMM uses `plan`; `--no-plan` disables plan mode; `--sandbox <profile>` (env `GROK_SANDBOX`).
- `--disable-web-search` removes web search and fetch tools.
- `--tools <TOOLS>` "Built-in tools to allow (comma-separated)" and `--disallowed-tools <TOOLS>` "Built-in tools to remove". **Verified 2026-09-12: neither `--tools ""` nor `--tools none` disables tools** — with both, a prompt to read `canary.txt` returned the file's contents. The documented way to remove tools is `--disallowed-tools` by name; `--allow`/`--deny` are permission rules.
- `--verbatim` sends the prompt exactly as given (otherwise a large prompt may be summarised/"offloaded"); `--no-subagents`; `--max-turns N`; `--reasoning-effort` (alias `--effort`); `--model`; `--rules` appends to the system prompt; `--system-prompt-override`.

Output envelope (json): `{"text":"…","stopReason":"end_turn"|"tool_use"|"cancelled",…,"thought":"…"}`; the review is inside `text`.

## Observed behaviour

- Small inputs: real reviews in 10–40 s.
- Large inputs with the 1.14.1 adapter (schema mode, no `--verbatim`): on ~30 KB and up it returns a placeholder such as "Reading the full artifact before reviewing" or "The supplied review request is truncated" in seconds — reject these on the record — or times out (15 of 46 pieces at a 150 s base on 2026-09-12).
- 1.15.0 candidate adapter (`--verbatim --no-subagents --tools "" --max-turns 1`): a 28 KB chunk fails in 18 s with `Error: max turns reached` because the model spends its single turn deciding to inspect files; without the turn cap it narrates "I'll inspect the surrounding code" and runs until cancelled. Tools remain enabled either way (see above), so plan mode is the only containment.
- Median 21 s, p90 about 5 min in the public ledger; acceptance rate 55 %.

## Adapter notes

Grok is the route most sensitive to prompt size. Give it `--verbatim`, keep artifacts small (about 12 KB pieces worked), do not cap turns at one, and never claim tools are disabled unless `--disallowed-tools` has been verified with a canary read.
