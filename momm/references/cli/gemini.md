# Gemini CLI (`gemini`)

Google's open-source terminal agent. MOMM route `gemini` — opt-in only, default persona `fresheyes`. Installed: 0.59.0 via npm (upgraded 2026-09-13; help text unchanged). Raw help: [help/gemini.txt](help/gemini.txt). Docs: https://geminicli.com/docs/cli/headless/ and https://geminicli.com/docs/get-started/authentication/ (fetched 2026-09-12); the configuration page under `/docs/cli/configuration/` returned 404.

## Why it is opt-in

Gemini CLI was replaced by Antigravity CLI on 2026-06-18 for unpaid-tier and Google One users. Individual/Pro/Ultra access reports `ineligible_tier`; Standard or Enterprise Gemini Code Assist organization licences remain supported. Consumer accounts should use the `antigravity` route.

## Authentication

- Sign in with Google (recommended), `GEMINI_API_KEY`, or Vertex AI (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_API_KEY`). MOMM strips the key variables and relies on the Google login; `/auth` inside a session switches method.
- Credentials and `.env` cache under `~/.gemini/` (`%USERPROFILE%\.gemini\` on Windows); settings in `~/.gemini/settings.json` (`selectedAuthType`).

## Non-interactive mode

`gemini -p/--prompt "<prompt>"` runs headless; piped stdin is appended to the prompt (also triggered automatically in a non-TTY).

- `--output-format text|json|stream-json` — `json` returns one object with `response`, `stats` and optional `error`; `stream-json` emits `init`, `message`, `tool_use`, `tool_result`, `error`, `result` events.
- `--approval-mode default|auto_edit|yolo|plan` — MOMM uses `plan` (read-only); never `--yolo`/`-y`.
- `--skip-trust` trusts the workspace for the session (needed headless); `--sandbox`; `--include-directories`; `--policy`/`--admin-policy` files; `--allowed-tools` is deprecated in favour of the policy engine.
- Multimodal: `@file` references in the prompt text let the model read images, PDFs, audio and video — MOMM's widest media route.
- `--raw-output` disables sanitisation of model output (allows ANSI); do not use it.
- Exit codes: 0 success, 1 general/API error, 42 input error, 53 turn limit exceeded.

## Adapter notes

Argument vector: `--approval-mode plan --skip-trust --output-format json --prompt "<instruction>"` with the contract and artifact on stdin. Media are referenced from the prompt with `@<staged file>`.
