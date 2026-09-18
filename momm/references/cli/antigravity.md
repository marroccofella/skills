# Antigravity CLI (`agy`)

Google's terminal agent, successor route for consumer Google accounts after Gemini CLI's individual tiers were retired (2026-06-18). MOMM route `antigravity` (alias `agy`), default persona `adversary`. Installed: 1.2.2 (`agy --version`, 2026-09-13; already current when the other CLIs were upgraded, help text unchanged). Raw help: [help/agy.txt](help/agy.txt). Docs: https://antigravity.google/docs/cli/getting-started, https://antigravity.google/docs/cli/install (fetched); https://antigravity.google/docs/cli/reference documents slash commands and `settings.json`, not flags.

## Install and update

- Windows PowerShell: `irm https://antigravity.google/cli/install.ps1 | iex`; CMD: `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd`. Binary: `%LOCALAPPDATA%\agy\bin`.
- macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`; binary `~/.local/bin/agy`.
- Installer flags `--skip-aliases`, `--skip-path`. `agy update` updates; `agy install` configures paths and shell settings.

## Authentication

- Local: `agy` reads the OS keyring (Windows Credential Manager, Keychain, Secret Service) and opens the Google browser sign-in when no session exists. Over SSH it prints an authorization URL and accepts a pasted code. `/logout` clears credentials and cache.
- API-key alternative: `modelProvider: gemini` in `~/.gemini/antigravity-cli/settings.json` plus `GEMINI_API_KEY` — MOMM refuses this path and strips `GEMINI_API_KEY`/`GOOGLE_API_KEY`.
- State shares `~/.gemini` with Gemini CLI, which is why preflight reports its auth as "present (weak evidence)".

## Non-interactive mode

`agy -p/--print "<prompt>"` runs one prompt and prints the response; ordinary stdin does not replace that prompt argument. MOMM 1.16 uses exactly one of two invocations, never a mix. **Text-only review:** no `-p` in argv at all; argv carries `--new-project --input-format stream-json --output-format stream-json --print-timeout <s> --mode=plan --sandbox`, and stdin carries one JSON line `{"event":"user","message":{"content":"<instruction + review contract + artifact>"}}` followed by EOF, so source never travels in process arguments. **Review with media:** `-p "<short instruction naming the private prompt file and the staged media>"`, plus `--add-dir <scratch> --output-format json --json-schema <schema>`; stdin is empty and the prompt body is read from the private file.

- `--output-format text|json|stream-json`; `--json-schema <schema or path>` enforces structured output with `--output-format json`. Do not add it to the text-only `stream-json` invocation: on agy 1.2.4 that combination returned an empty or partial SUCCESS at the print deadline, so MOMM omits the native schema there and validates the final answer itself.
- `--mode accept-edits|plan` — MOMM uses `plan`; `--sandbox` adds terminal restrictions; `--new-project` isolates the session from any existing project.
- `--print-timeout` (default 5m0s; the value is a duration in seconds with the `s` suffix, for example `175s`, unlike MOMM's own millisecond timeouts) — MOMM sets it just below its own route budget.
- `--effort low|medium|high`, `--model`, `--add-dir`, `--input-format stream-json`.
- Never add `--dangerously-skip-permissions`; `--disable-slash-commands` conflicted with plan mode in 1.1.13.

Output envelope (json): `{"conversation_id":…,"status":"SUCCESS","response":"<text>","duration_seconds":…,"num_turns":…,"json_schema":{…}}` — the review is inside `response`.

## Why `response` comes back empty (root cause, established 2026-09-13)

The empty envelope is **not** a prompt-size limit. It is the agent being auto-denied a tool permission in headless mode and exiting without a final answer. Evidence, all from the CLI's own state under `~/.gemini/antigravity-cli/`:

1. **stderr says so** — every empty run writes (MOMM's report shows only "stderr 307 bytes" and never surfaced the text):
   `jetski: no output produced — a tool required the "read_file" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json … Alternatively, re-run with --dangerously-skip-permissions`
2. **The conversation databases** (`conversations/<id>.db`, SQLite, table `steps`) show the trail. A failing run on 2026-09-13 (MOMM run `rev_20260912224530_4o8x`, conversation `f7c7b9a2…`): `view_file prompt.txt` ×3 → `list_dir` of the temp project → `find_by_name *multi-review*` in the temp dir (nothing) → `find_by_name multi-review.mjs` across **`<drive>:\projects`** (allowed; the 30 s `Error running find: context deadline exceeded` in the log) → `view_file <repo>\momm\scripts\multi-review.mjs` → `permission check failed for read_file … user denied permission` → stream stopped, `response:""`. Other empty runs end on `read_file <home>`, `grep_search <home>`, `run_command node -e …` or `run_command Get-ChildItem ..\momm-*`, all auto-denied. Runs that stay inside the temp project answer normally.
3. **The trigger is the model change, not MOMM.** The CLI log label switched from `Gemini 3.7 Flash (High)` to `Gemini 3.8 Flash (High)` between 14:05 and 16:45 local on 2026-09-02; the first empty review in the ledger is 16:55 that day. Across 202 August MOMM conversations 3 roamed outside the temp dir and 10 ended on a denied step (5 %); from 2 September onward 8 of 13, 8 of 10, 20 of 35 … 47 of 78 (12 September) ended denied. The adapter's argument vector is byte-identical to the August one apart from prompt wording, and August reviews succeeded at 108–149 KB in 40–60 s.
4. **Plan mode is now "planning mode"**: the prompt is expanded to `/plan …` and the system text asks the agent to *create a detailed implementation plan artifact and get user approval before making code changes*. That invites investigation of the files the diff names. It is what `--mode=plan` means in agy 1.2.x; it is not a read-only tool filter.

What the sandbox does and does not contain (verified from the same trails): reading file **contents** outside the temp project is denied; `find_by_name` and `list_dir` **outside** the project are allowed, so file *names* under the project drive and the user's home can reach the model; `run_command` is denied. Read-only containment holds; "nothing else is looked at" does not.

Size correlation was a red herring: tonight's 12 KB pieces split 7 success / 7 empty / 1 timeout, and the deciding factor was whether the model chose to look for files it could not read.

**Controlled probes (agy 1.2.2, 2026-09-13):** the exact MOMM vector with MOMM's real schema on a 10 KB diff succeeded (1 turn, 44 s); without `--mode=plan` it also succeeded (3 turns); without `--sandbox` it produced the empty envelope with the stderr hint above (so the sandbox is not the cause — roaming is). Text mode and no-schema mode both returned reviews. A/B result for the prompt-side remedy is recorded below when complete.

**A/B on the prompt-side remedy (agy 1.2.2, 2026-09-13, piece-06 artifact — the one that provoked the roaming above, 4 runs each):**

| Prompt | Outcome | Tool trail |
| --- | --- | --- |
| Current MOMM wording | 3 of 4 reviews; 1 empty envelope (`run_command` auto-denied, stderr hint) | 1 to 19 tool calls per run: repeated `view_file`, `find_by_name`, `grep_search`, one `run_command` |
| Current wording + *"The prompt file is the complete input: do not search, list, or read any other file or directory, and do not run commands. Files named in the diff are not available; review only the text supplied."* | 4 of 4 reviews, each 2 turns, 49–51 s | one `view_file` of the prompt, then the answer |

Eight runs is a small sample, but the mechanism and the trails agree: telling the model up front that nothing else exists removes the roaming that headless mode then denies. Adapter recommendations for the author: add that sentence to the antigravity `-p` text; surface the CLI's stderr hint in `invalid_output` detail instead of "stderr 307 bytes"; treat `--mode=plan` as a permission profile, not as proof the agent only reads; keep `--sandbox` (without it the same roaming still ends empty).

## Observed behaviour (2026-09-04 and 2026-09-12, before the cause was known)

- **Empty response**: MOMM reports `invalid_output` with the envelope `"status":"SUCCESS","response":""`; on 2026-09-12, 34 of 46 pieces. See the root-cause section above; the "prompt-length limit" hypothesis recorded here earlier was wrong.
- Fast when it works (median 32 s), and its findings on this project are accepted at 58 %.
- Successful antigravity reviews arrive schema-constrained, so they parse cleanly.

## Adapter notes

The 16 September text-only transport repair is based on an independent bounded
comparison on agy 1.2.4: removing the schema alone still timed out; direct delivery
then completed once; stdin streaming subsequently returned a complete result.
Restoring native schema enforcement in that stdin control returned an empty,
partial response at the print deadline despite native exit zero and SUCCESS.
These samples do not prove universal reliability or permanent schema failure.
The repair retains new-project/plan/sandbox and mandatory local contract/scope
validation, but omits the optional native schema for text-only streams. It accepts
only the final object-valued SUCCESS result with a nonempty strict-JSON answer;
progress, unknown events, missing results and partial-output deadline warnings
are refused. Source stays off process arguments. Media routing is unchanged.
See [official stdin protocol](https://antigravity.google/docs/cli/headless/#stream-prompts-from-stdin)
and the [public diagnostic](https://github.com/marroccofella/skills/pull/4#issuecomment-5700434342).

For media, prompt text asks the agent to read the private file and attached media; `--json-schema` is MOMM's review schema. For text-only input, the complete contract and artifact travel in the stdin user event. Print timeout stays below the dispatcher timeout; a native partial-output timeout is still failure even if the native exit is zero.
