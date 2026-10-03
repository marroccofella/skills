# Grok CLI (`grok`, "Grok Build")

xAI's terminal agent. MOMM route `grok`, default persona `innovator`. Installed: grok 1.0.30 (04b7ffed98c6) stable at `~/.grok/bin/grok.exe` (upgraded from 1.0.5 on 2026-09-13; help text unchanged for every flag MOMM uses) (the dispatcher resolves this path directly because the installer's PATH change may not reach a long-lived session). Raw help: [help/grok.txt](help/grok.txt), [help/grok-login.txt](help/grok-login.txt), [help/grok-agent.txt](help/grok-agent.txt). Official docs: https://x.ai/cli (403 to automated fetch on 2026-09-12) — the `--help` capture is the reference of record.

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
- `--tools <TOOLS>` "Built-in tools to allow (comma-separated)" and `--disallowed-tools <TOOLS>` "Built-in tools to remove". **Verified 2026-09-12: neither `--tools ""` nor `--tools none` disables tools** — with both, a prompt to read `canary.txt` returned the file's contents. Re-verified on 1.0.30 (2026-09-13): `--tools ""` still returned the canary in two turns (model `grok-4.6-build`, 28.7 K input tokens). The documented way to remove tools is `--disallowed-tools` by name; `--allow`/`--deny` are permission rules.
- **`--disallowed-tools` verified 2026-09-13 (1.0.30)**: removing `read_file` alone fails session start with `Requirements unsatisfied: GrokBuild:search_replace … requires a Read tool in the toolset` (the error names the tool ids `GrokBuild:read_file`, `GrokBuild:search_replace`). Removing `read_file,search_replace,write_file,create_file,edit_file,bash,shell,list_files,glob,grep,search_files` starts (16.5 K input tokens — the toolset did shrink), the model still announces "I'll read that file now", and the run ends `stopReason: "cancelled"` after one turn **with no canary contents in the output**. So the read is prevented, but a reviewer that decides to read wastes its run; the prompt must say up front that no tools exist and the artifact is inline, and `cancelled` must map to `invalid_output`. Only the two ids quoted in the error are confirmed names; the others in that list may be ignored silently.
- **Permission rules work too, and end cleanly (verified 2026-09-13, 1.0.30)**: the 1.15.0 candidate vector `--verbatim --no-subagents --deny Read --deny Grep --deny Bash --deny Edit --deny MCPTool --deny WebFetch --deny WebSearch --max-turns 4 --output-format json --permission-mode plan --disable-web-search` against the canary prompt returned `text: "…The file read was blocked, so I will try another way…NO-TOOLS"`, `stopReason: "end_turn"`, 3 turns, no canary contents. So `--deny <Name>` matches Grok tools by capability name even though its internal ids are `GrokBuild:*`, and the model recovers and answers instead of being cancelled. Prefer this form; it costs two extra turns, which is why `--max-turns 1` could never work.
- `--verbatim` sends the prompt exactly as given (otherwise a large prompt may be summarised/"offloaded"); `--no-subagents`; `--max-turns N`; `--reasoning-effort` (alias `--effort`); `--model`; `--rules` appends to the system prompt; `--system-prompt-override`.

Output envelope (json): `{"text":"…","stopReason":"end_turn"|"tool_use"|"cancelled",…,"thought":"…"}`; the review is inside `text`.

Reviews since 1.17 (A4.3) use `--output-format streaming-json` so a timeout still records first output, bytes, event count and the last event type.

Streaming-json shape (verified: captured 29 September 2026, Grok CLI 1.0.41, synthetic prompt, `--permission-mode plan --deny '*'`; `scripts/fixtures/grok-streaming-json-1.0.41.jsonl`, 54 lines, session and request ids zeroed). Every line is a bare JSON object with a `type`:

- `available_commands` (`tools`, `commands`), `thought` (`data`: a reasoning chunk) and `usage` (`usage`, `signature`): no answer text.
- `text`: `{"type":"text","data":"<chunk>"}`; the answer is the `data` values joined in order.
- one final `{"type":"end","stopReason":"end_turn","sessionId":…,"requestId":…,"usage":{…},"num_turns":…,"total_cost_usd":…,"modelUsage":{…}}`.

There is no JSON-RPC wrapper and no ACP `agent_message_chunk`, whatever the help's "one ACP session update per line" suggests. `scripts/grok-stream.mjs` joins the `text` data, requires the one `end` line last with `stopReason` `end_turn`, and rebuilds the json envelope above. When Grok exits normally the stream decides the result, in this order:

1. Anywhere in the stream, a line that is not a JSON object with a string `type` makes the whole answer `invalid_output` (it is never skipped).
2. Otherwise the lines are read in order and the first of these wins: an `error` line, or a line marked as an error, makes the run an `error`, even after the `end`; any other line after the `end` (a second `end` included) makes it `invalid_output`.
3. A line of an unknown type decides nothing: it is counted and ignored (after the `end`, rule 2 applies).
4. After the last line, a missing `end`, or an `end` whose `stopReason` is not `end_turn`, is `invalid_output`.

Usage and cost are read from the `end` line. In the capture Grok declined the synthetic canned-verdict prompt, so its answer is a sentence, not JSON.

## Observed behaviour

- Small inputs: real reviews in 10–40 s.
- Large inputs with the 1.14.1 adapter (schema mode, no `--verbatim`): on ~30 KB and up it returns a placeholder such as "Reading the full artifact before reviewing" or "The supplied review request is truncated" in seconds — reject these on the record — or times out (15 of 46 pieces at a 150 s base on 2026-09-12).
- 1.15.0 candidate adapter (`--verbatim --no-subagents --tools "" --max-turns 1`): a 28 KB chunk fails in 18 s with `Error: max turns reached` because the model spends its single turn deciding to inspect files; without the turn cap it narrates "I'll inspect the surrounding code" and runs until cancelled. Tools remain enabled either way with `--tools ""` (see above). That was the state of the 1.15.0 candidate adapter; containment today is the verified `--deny` permission rules and `--disallowed-tools` described above together with plan mode, not plan mode alone.
- Median 21 s, p90 about 5 min in the public ledger; acceptance rate 55 %.

## Adapter notes

Grok is the route most sensitive to prompt size. Give it `--verbatim`, keep artifacts small (about 12 KB pieces worked), do not cap turns at one, and disable tools with the `--deny <Name>` permission rules the dispatcher uses (verified above; the run ends `end_turn`) rather than `--tools ""` (verified ineffective on 1.0.5 and 1.0.30). `--disallowed-tools read_file,search_replace,…` also stops the read (verified above) but ends the run `cancelled`, which MOMM rejects as `invalid_output`. Re-run the canary probe after every Grok update.
