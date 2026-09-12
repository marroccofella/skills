# Antigravity CLI (`agy`)

Google's terminal agent, successor route for consumer Google accounts after Gemini CLI's individual tiers were retired (2026-06-18). MOMM route `antigravity` (alias `agy`), default persona `adversary`. Installed: 1.2.2 (`agy --version`, 2026-09-13; already current when the other CLIs were upgraded, help text unchanged). Raw help: [help/agy.txt](help/agy.txt). Docs: https://antigravity.google/docs/cli/getting-started, https://antigravity.google/docs/cli/install (fetched); https://antigravity.google/docs/cli/reference documents slash commands and `settings.json`, not flags.

## Install and update

- Windows PowerShell: `irm https://antigravity.google/cli/install.ps1 | iex`; CMD: `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd`. Binary: `C:\Users\<user>\AppData\Local\agy\bin`.
- macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`; binary `~/.local/bin/agy`.
- Installer flags `--skip-aliases`, `--skip-path`. `agy update` updates; `agy install` configures paths and shell settings.

## Authentication

- Local: `agy` reads the OS keyring (Windows Credential Manager, Keychain, Secret Service) and opens the Google browser sign-in when no session exists. Over SSH it prints an authorization URL and accepts a pasted code. `/logout` clears credentials and cache.
- API-key alternative: `modelProvider: gemini` in `~/.gemini/antigravity-cli/settings.json` plus `GEMINI_API_KEY` — MOMM refuses this path and strips `GEMINI_API_KEY`/`GOOGLE_API_KEY`.
- State shares `~/.gemini` with Gemini CLI, which is why preflight reports its auth as "present (weak evidence)".

## Non-interactive mode

`agy -p/--print "<prompt>"` runs one prompt and prints the response; stdin is not the prompt, so MOMM writes the contract and artifact to a `0o600` temp file and asks the agent to read it.

- `--output-format text|json|stream-json`; `--json-schema <schema or path>` enforces structured output (final result only for stream-json).
- `--mode accept-edits|plan` — MOMM uses `plan`; `--sandbox` adds terminal restrictions; `--new-project` isolates the session from any existing project.
- `--print-timeout` (default 5m0s) — MOMM sets it just below its own route budget.
- `--effort low|medium|high`, `--model`, `--add-dir`, `--input-format stream-json`.
- Never add `--dangerously-skip-permissions`; `--disable-slash-commands` conflicted with plan mode in 1.1.13.

Output envelope (json): `{"conversation_id":…,"status":"SUCCESS","response":"<text>","duration_seconds":…,"num_turns":…,"json_schema":{…}}` — the review is inside `response`.

## Observed behaviour (2026-09-04 and 2026-09-12)

- **Empty response on larger prompts**: for inputs of roughly 30 KB and above (and, on 2026-09-12, most 12 KB pieces: 34 of 46) the envelope comes back `"status":"SUCCESS","response":""` with the schema echoed, after 15–60 s. MOMM reports `invalid_output` with that sample. A 300-byte diff succeeds. Likely a prompt-length limit in structured-output mode; the adapter should probe the threshold and fail closed above it rather than spend the time.
- Fast when it works (median 32 s), and its findings on this project are accepted at 58 %.
- Successful antigravity reviews arrive schema-constrained, so they parse cleanly.

## Adapter notes

Prompt text asks the agent to read the temp file and treat its contents as data. The JSON schema passed via `--json-schema` is MOMM's review schema. Print timeout must stay below the dispatcher timeout so the dispatcher, not the CLI, records the outcome.
