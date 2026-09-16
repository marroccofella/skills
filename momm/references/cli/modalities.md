# Terminal AI CLIs: input/output modalities under account login (no API keys)

Researched 2026-09-13 on the MOMM reference machine (Windows 11). Scope: what each CLI can take IN and produce OUT when run **non-interactively** under the user's own **account login** (ChatGPT, Claude.ai, Google, GitHub, grok.com) with every API-key variable absent.

| CLI | Version | Login state during probes |
| --- | --- | --- |
| OpenAI Codex CLI `codex` | 0.154.0 | ChatGPT (Codex banner: `provider: openai`, model `gpt-6-astra`) |
| Anthropic Claude Code `claude` | 2.1.270 | Claude Max account |
| Google Antigravity CLI `agy` | 1.2.2 | Google account (keyring) |
| Google Gemini CLI `gemini` | 0.59.0 | Google account -> **`IneligibleTierError`** (see Gemini row) |
| GitHub Copilot CLI `copilot` | 1.0.83 | GitHub login, **monthly quota exhausted** -> no live probes possible |
| xAI Grok CLI `grok` (Grok Build) | 1.0.30 stable | grok.com login (`grok models`: "You are logged in with grok.com") |

Evidence levels used in every cell:

- **verified** — a flag quoted from the `--help` capture, or a live headless probe run today under the account login (probe log at the end).
- **documented** — vendor documentation or vendor changelog says so; not in the help capture and not probed.
- **model-only** — the underlying model can, but the CLI exposes no non-interactive path.
- **no** — no path found.

Help captures are cited as `help/<file>:<line>` relative to `momm/references/cli/help/`.

---

## 1. Matrix

### 1a. Input side

| CLI | Text | Image (png/jpg) | PDF | Audio | Video | Live microphone / real-time speech |
| --- | --- | --- | --- | --- | --- | --- |
| **codex** | **verified** — `codex exec [PROMPT]`, stdin when omitted or `-` (help/codex-exec.txt:13-16) | **verified** — `-i, --image <FILE>...` "Optional image(s) to attach to the initial prompt" (help/codex-exec.txt:37-38); probe `codex exec -i red.png "...colour?"` -> `Red`; `view_image` tool also in the headless tool list | **no** — `-i` is image-only (docs list PNG/JPEG; BMP/TIFF/SVG/HEIC rejected [1]); PDF feature request openai/codex#1797 still open [2]; only workaround is shelling out to a text extractor | **no** | **no** | **no** — `codex features list` shows `in_app_dictation stable true`, but that is the Codex desktop app; no CLI flag or `/voice` |
| **claude** | **verified** — `-p, --print` (help/claude.txt:164) | **verified** — Read tool: "PNG, JPG, and other image formats are returned as visual content that Claude can see" [3]; probe `claude -p "Use the Read tool on ./red.png..." --tools Read --permission-mode plan` -> `"result":"Red"` | **verified** — Read tool: "Claude reads short .pdf files whole. For PDFs longer than 10 pages, it reads in ranges with a pages parameter" [3]; probe -> `PURPLE ELEPHANT 4471` | **no** — Read tool has no audio type [3] | **no** | **documented, interactive only** — `/voice` hold/tap dictation, "streams your recorded audio to Anthropic's servers", requires "A Claude.ai account" and "A local microphone"; no print-mode path [4]. (`--file file_id:path`, help/claude.txt:93-96, downloads cloud file resources, not local media) |
| **agy** | **verified** — `-p / --print` (help/agy.txt:18-19); stdin is not the prompt; `--input-format stream-json` accepts `text` blocks only [5] | **verified** — probe `agy -p "...use ONLY view_file on red.png..." --new-project --output-format json` -> `"response":"Red"`. Caveat: run from a non-workspace directory the same call was auto-denied (`"denied_actions":[{"action":"read_file","display_name":"ViewFile"}]`), so use `--new-project` or `--add-dir`. Interactive: `Ctrl+V` "Pastes graphic media files" [6] | **verified** — same call on `secret.pdf` -> `"response":"PURPLE ELEPHANT 4471"` | **model-only** — Gemini 3.x accepts audio, but no flag and `view_file` on audio was not probed | **model-only** — as audio | **documented, interactive only** — `/voice` (F5) dictation; `agy mic-serve` "Serve this machine's microphone to a CLI on another host" (help/agy.txt:33) for SSH; docs: "Dictation is disabled in non-interactive print mode (`--print`)" [7] |
| **gemini** | **verified flag** — `-p, --prompt` "non-interactive (headless) mode... Appended to input on stdin" (help/gemini.txt:19) — **but on this consumer login every run fails**: `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` (probe `gemini -l`, 2026-09-13). Only Code Assist Standard/Enterprise licences still work [8] | **documented** — `read_file` "Supports text, images, audio, and PDF" [9]; `read_many_files` returns PNG/JPEG as base64 "provided they are explicitly requested by name or extension" [10]; `@./mockup.png` in the prompt | **documented** — `read_file` [9]; `read_many_files` PDF [10] | **documented** — `read_file` audio [9]; `read_many_files` MP3/WAV [10] | **documented** — `read_many_files` MP4/MOV [10] | **no** |
| **copilot** | **verified** — `-p, --prompt <text>` (help/copilot.txt:149-150); stdin ignored | **verified** — `--attachment <path>` "Attach a file (image or native document) to the initial prompt; only valid in non-interactive mode (can be used multiple times)" (help/copilot.txt:61-64); changelog 1.0.41 2026-05-05 [11]; docs: JPEG, PNG, GIF, WEBP, PDF, HEIC, HEIF [12] | **verified** — same flag ("native document"); docs list `.pdf` [12]; changelog 1.0.64 "Attached images and PDFs persist across session resume" [11] | **no** — not in the supported list [12] | **no** | **documented, interactive only** — changelog 1.0.81 "Use Ctrl+Space to toggle voice dictation", 1.0.71 "/voice devices" [11]; nothing for `-p` |
| **grok** | **verified** — `-p, --single <PROMPT>`, `--prompt-file <PATH>`, `--prompt-json <JSON>` "Single-turn prompt as JSON content blocks" (help/grok.txt:93-105) | **verified** — probe `grok -p "Use read_file on red.png..." --permission-mode plan` -> `Red`; changelog 0.1.211 "`read_file` (images and PDFs) directly in tool-result message", 0.2.68 "Attached images are now saved to real disk paths so the model can read them" [13]; interactive paste png/jpg/gif/webp <= 20 MiB [14] | **verified** — probe on `secret.pdf` -> `PURPLE ELEPHANT 4471` | **no** — no audio-input entry in the whole changelog [13] | **no** | **documented, interactive only** — `/voice` + `Ctrl+Space` speech-to-text (changelog 1.0.11, 0.2.97, 0.2.103 [13]; launched 2026-07-07 for SuperGrok / X Premium+ [15]); `grok doctor` lists "microphone (on builds with audio capture)" |

### 1b. Output side

| CLI | Text | Image generation (files written) | Video generation | Audio / TTS | Code execution | Web search / browse |
| --- | --- | --- | --- | --- | --- | --- |
| **codex** | **verified** — stdout, `--json` JSONL, `-o <file>`, `--output-schema` (help/codex-exec.txt:93-106) | **verified** — feature `image_generation stable true` (`codex features list`); headless tool list shows `image_gen__imagegen` "Generates images from descriptions and edits existing images"; probe `codex exec --skip-git-repo-check --sandbox workspace-write "Use your image generation tool..."` wrote `%USERPROFILE%\.codex\generated_images\<session-id>\exec-<uuid>.png` (743 KB) under ChatGPT login, no key. Docs: `$imagegen` skill, model gpt-image-2, saved to `$CODEX_HOME/generated_images`, "counts toward your general Codex usage limits... 3-5x faster", `-i` attaches references for edits [16][17]; "No API key required" for the built-in mode [18]. Not on the Free plan [19] | **no** | **no** | **verified** — `--sandbox read-only\|workspace-write\|danger-full-access` governs "model-generated shell commands" (help/codex-exec.txt:53-56); `exec_command` tool in the headless list | **verified** — `--search` "Enable live web search. When enabled, the native Responses `web_search` tool is available" (help/codex.txt:121-123; top-level flag); config `web_search = "cached"\|"live"\|"disabled"`, so for exec use `-c web_search="live"` [20]; headless tool list shows `web__run` "Searches the web, opens pages, and retrieves current information" |
| **claude** | **verified** — `--output-format text\|json\|stream-json`, `--json-schema` (help/claude.txt:120-122, 139-143) | **no** — tools reference lists no generating tool [3]; Claude models do not produce images; only route is a third-party MCP server, which needs that vendor's key | **no** | **no** | **verified** — Bash / PowerShell tools [3]; `--restricted` "removes the built-in tools that run commands or code (Bash, PowerShell, REPL and the other code-running tools)" (help/claude.txt:188-191) | **verified** — `WebSearch` "Performs web searches", `WebFetch` "Fetches content from a specified URL" [3]; `--restricted` names WebFetch (help/claude.txt:191); probe JSON carries `server_tool_use.web_search_requests` |
| **agy** | **verified** — `--output-format text\|json\|stream-json`, `--json-schema` (help/agy.txt:12,17) | **verified** — headless tool list includes `generate_image`; probe `agy -p "Never run any command. Call the generate_image tool once..." --output-format json` -> tool output "Generated image is saved at `%USERPROFILE%\.gemini\antigravity-cli\brain\<conversation_id>\green_circle_<ts>.jpg`" under Google login, no key. Docs: "Nano Banana 2 ... Used by the generative image tool" [21]; saved to "`<appDataDir>/brain/<conversation-id>/`" [22]. Caveats: first attempt returned `API error ... INTERNAL (code 500)`; the agent's attempt to copy the file with `run_command` is auto-denied in headless mode, so copy it yourself afterwards | **no** — no video tool in the list | **no** | **verified** — `run_command` tool in the list; headless auto-denies it unless `permissions.allow` has `command(<target>)` in `~/.gemini/antigravity-cli/settings.json` (stderr hint) or `--dangerously-skip-permissions` [5] | **verified** — `search_web` and `read_url_content` tools in the headless tool list |
| **gemini** | **verified flag** — `-o, --output-format text\|json\|stream-json` (help/gemini.txt:41) — subject to the tier block above | **no under account login** — the only path is the `nanobanana` extension (`gemini extensions install https://github.com/gemini-cli-extensions/nanobanana`, `/generate`, output `./nanobanana-output/`) and it requires `NANOBANANA_API_KEY` [23] -> outside the no-API-key scope; no built-in tool | **no** — no official Veo extension; third-party wrappers only [24] | **no** | **verified flag** — `--approval-mode ... yolo (auto-approve all tools)`, `-s, --sandbox` (help/gemini.txt:23-25); `run_shell_command` tool (docs) | **documented** — built-in `google_web_search` and `google_web_fetch` [25] |
| **copilot** | **verified** — `--output-format text\|json` (JSONL), `-s` (help/copilot.txt:146-148, 172-173) | **no** — nothing in help, help topics or the full changelog [11]; the awesome-copilot `generate-image` skill needs `SKILL_IMAGE_GEN_OPENAI_KEY` / `SKILL_IMAGE_GEN_GEMINI_KEY` [26]; community MCP servers likewise need keys | **no** | **no** | **verified** — `shell(command:*?)` permission rules (help/copilot-help-topics.txt:199-204); `--allow-all-tools` "required for non-interactive mode" (help/copilot.txt:43-46) | **verified** — `web_fetch` built in (changelog 0.0.374 [11]; `url(...)` rules "Applies to the shell and web-fetch tools", help/copilot-help-topics.txt:219; `--allow-url` help/copilot.txt:51-52). `web_search` is served by the **built-in GitHub MCP server** (changelog 1.0.57: "the built-in GitHub MCP server now exposes only the web_search tool" [11]), so `--disable-builtin-mcps` removes it |
| **grok** | **verified** — `--output-format plain\|json\|streaming-json\|streaming-messages-json`, `--json-schema` (help/grok.txt:55-56, 82-91) | **verified** — headless tool list: `image_gen` (prompt, aspect_ratio) and `image_edit` (prompt, image[], aspect_ratio); probe `grok -p "Use the image_gen tool..." --permission-mode acceptEdits --output-format json` wrote `%USERPROFILE%\.grok\sessions\<url-encoded-cwd>\<session-id>\images\1.jpg` under grok.com login. Interactive `/imagine <prompt>` and bundled `imagine` skill (`grok inspect` lists "imagine bundled [collides with /imagine]"; changelog 0.2.20 "Add bundled imagine skill" [13]) | **verified tool, gated** — `image_to_video` (image, prompt, duration 6\|10 s, 480p\|720p) and `reference_to_video` (prompt, up to 7 images, up to 3 preset voices, 1-15 s) are in the headless tool list (changelog 0.2.20 "Add image_to_video and reference_to_video tools" [13]). Probe on `red.png` returned: "Video generation tools are unavailable under zero data retention (ZDR). To enable, either turn off /privacy mode to disable ZDR or supply a user-hosted storage bucket" [27] | **no standalone TTS** — only `reference_to_video` "voices (up to 3 preset voice IDs)" inside a generated video | **verified** — `run_terminal_command` tool; `--disallowed-tools` / `--tools` (help/grok.txt:40-41, 132-133) | **verified** — `--disable-web-search` "Disable web search and web fetch tools" (help/grok.txt:37-38); tool list: `web_search`, `web_fetch`, `open_page`, `x_keyword_search`, `x_semantic_search`, `x_thread_fetch` |

### 1c. Hand-off to a different model family (under the same login)

| CLI | Other families reachable | Evidence |
| --- | --- | --- |
| **copilot** | Anthropic, OpenAI, Google (`gemini-3.8/3.7/3.6/3.5-flash`), xAI (`grok-4.5`), Moonshot (`kimi-k3`, `kimi-k2.7-code`), Microsoft (`mai-code-*`) via `--model` | **verified list** help/copilot-help-topics.txt:382-407; Kimi probe on 2026-09-13 returned "not available" while the quota was exhausted, so plan eligibility is unproven |
| **agy** | Anthropic (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`) and OpenAI open-weights (`gpt-oss-120b-medium`) alongside Gemini via `--model` | **verified** — `agy models` output 2026-09-13 |
| **codex** | Local open models: `--oss --local-provider lmstudio\|ollama` (no account at all) | **verified flag** help/codex-exec.txt:43-48 |
| **gemini** | `gemini gemma` "Manage local Gemma model routing" (same family, local) | **verified flag** help/gemini.txt:10 |
| **claude** | none — `--model` is Anthropic only; Bedrock/Vertex/Foundry need their own credentials (help/claude.txt:44-48) | **no** |
| **grok** | none — `grok models`: `grok-4.6`, `grok-4.5` | **verified** probe |
| Hubs (not primary) | OpenCode (`opencode auth login` per provider), Cline (`cline auth openai-codex`) reach the same accounts from one CLI; Kimi Code CLI and Mistral Vibe add new families with their own logins | see `references/cli/candidates.md` |

---

## 2. Pipeline compositions that work today (named invocations)

All paths verified headless on 2026-09-13 unless marked otherwise.

1. **Prompt -> image (Codex)**
   `codex exec --skip-git-repo-check --sandbox workspace-write --ephemeral -o out.txt "Create <description> $imagegen; then copy the generated file into the cwd as hero.png"`
   -> original at `%USERPROFILE%\.codex\generated_images\<session-id>\exec-<uuid>.png`, copy in cwd (the agent's shell does the copy; `workspace-write` is required for that). Add `-i ref.png` to edit/guide.

2. **Prompt -> image (Grok)**
   `grok --cwd <dir> -p "Use the image_gen tool to create <description>. Reply with the absolute path of every file written." --output-format json --permission-mode acceptEdits --no-subagents`
   -> `%USERPROFILE%\.grok\sessions\<url-encoded-cwd>\<session-id>\images\1.jpg` (path is echoed in `text`). `image_edit` takes reference images for edits.

3. **Prompt -> image (Antigravity, Nano Banana 2)**
   `agy -p "Never run any command. Call the generate_image tool once to create <description>. Quote the tool's output verbatim." --output-format json --print-timeout 3m`
   -> `%USERPROFILE%\.gemini\antigravity-cli\brain\<conversation_id>\<name>_<ts>.jpg`. Copy it yourself (headless auto-denies `run_command`). Expect occasional `INTERNAL (code 500)` retries.

4. **Image -> video (Grok) — gated**
   `grok --cwd <dir> -p "Use the image_to_video tool on frame.png with duration 6 and resolution_name 480p and prompt '<motion>'" --output-format json --permission-mode acceptEdits`
   Works only after the account's ZDR gate is cleared: run `/privacy` interactively to turn ZDR off, or configure an S3-compatible bucket in `~/.grok/managed_config.toml` [27]. On this account the tool returned the ZDR error, so the chain **prompt -> image (1/2/3) -> video (4)** is possible in principle but was not completed here. `reference_to_video` adds up to 7 reference images and up to 3 preset voices (speech inside the clip).

5. **Image or PDF -> text/JSON critique** (five routes, all verified except Copilot which is help-verified only)
   - `codex exec -i shot.png --skip-git-repo-check --sandbox read-only "<question>"`
   - `claude -p "<question about ./shot.png or ./doc.pdf>" --tools Read --permission-mode plan --permission-prompts none --output-format json`
   - `agy -p "Use only view_file on shot.png|doc.pdf ..." --new-project --output-format json`
   - `grok -p "Use read_file on shot.png|doc.pdf ..." --permission-mode plan --output-format json`
   - `copilot -p "<question>" --attachment shot.png --attachment doc.pdf -s --available-tools=view` (quota permitting)

6. **Web research -> structured text**
   - `codex exec -c web_search="live" --skip-git-repo-check --sandbox read-only --output-schema schema.json "<question>"`
   - `claude -p "<question>" --tools WebSearch,WebFetch --json-schema '<schema>' --output-format json`
   - `agy -p "<question; use search_web/read_url_content>" --output-format json --json-schema schema.json`
   - `grok -p "<question>" --output-format json --json-schema '<schema>'` (web_search/web_fetch/x_search on by default; `--disable-web-search` turns them off)
   - `copilot -p "<question>" --allow-url=<domain>` (web_fetch built in; web_search needs the built-in GitHub MCP server enabled)

7. **Image round-trip edit**: generate with (1)/(2)/(3), then feed the file back — Codex `-i out.png "$imagegen make it darker"`, Grok `image_edit` with `image:[path]`, agy `generate_image` with `ImagePaths` (up to three absolute paths [22]).

8. **Cross-family second opinion under one login**: `copilot -p ... --model gemini-3.8-flash|grok-4.5|kimi-k3` (list verified, availability per plan unproven) or `agy -p ... --model claude-sonnet-4-6|gpt-oss-120b-medium` (verified list).

**Not possible today under account login with these six CLIs:** audio or video *input* (only Gemini CLI documents it, and Gemini CLI refuses consumer logins — pre-transcribe with ffmpeg/whisper and feed text); any text-to-speech output; image or video generation from Claude Code, Copilot CLI or Gemini CLI; live microphone input in any headless run.

---

## 3. Owner's claims — confirmed / refuted

| Claim | Verdict | One-line reason |
| --- | --- | --- |
| "Codex can generate an image" | **CONFIRMED (verified)** | `image_generation` is a stable, default-on feature (`codex features list`); the `image_gen__imagegen` tool is present in `codex exec` and wrote `~/.codex/generated_images/<session>/exec-<uuid>.png` under the ChatGPT login with no API key. |
| "Copilot can generate an image" | **REFUTED** | No image-generation flag, tool or changelog entry exists in copilot 1.0.83 [11]; every route (awesome-copilot `generate-image` skill, community MCP servers) needs an OpenAI or Gemini API key [26]. (Live probe blocked by the exhausted monthly quota.) |
| "Grok can turn an image into a video" | **CONFIRMED as a tool, GATED in practice** | `image_to_video` (image, prompt, 6/10 s, 480p/720p) is in the headless tool list; the probe was refused with "Video generation tools are unavailable under zero data retention (ZDR)" — it needs `/privacy` off or a user-hosted storage bucket [27]. |
| "Gemini CLI can generate images (Nano Banana) and read audio/video" | **HALF-REFUTED** | Audio/video *reading* is documented (`read_file` "images, audio, and PDF" [9]; `read_many_files` MP3/WAV/MP4/MOV [10]). Image generation is **not built in** — it is the `nanobanana` extension and requires `NANOBANANA_API_KEY` [23]. On top of that the consumer Google login is rejected outright (`IneligibleTierError`, probed today). Nano Banana under an account login is reachable through **agy's `generate_image`**, not Gemini CLI. |
| "Claude Code cannot generate images" | **CONFIRMED** | The tools reference lists no generating tool [3]; Claude models have no image output; the `--tools` set (help/claude.txt:248-252) has nothing to enable. |

---

## 4. Probe log (2026-09-13, this machine, all under account login, API-key env vars absent)

| # | Command (abridged) | Result |
| --- | --- | --- |
| P1 | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral "list your tools"` | tools include `image_gen__imagegen`, `web__run`, `view_image`, `exec_command`, `apply_patch` |
| P2 | `codex features list` | `image_generation stable true`, `browser_use stable true`, `computer_use stable true`, `in_app_dictation stable true` |
| P3 | `codex exec ... -i red.png "dominant colour?"` | `Red` |
| P4 | `codex exec --sandbox workspace-write "... image generation tool ... blue circle ... copy to cwd"` | wrote `%USERPROFILE%\.codex\generated_images\01a09c4f-...\exec-de87c3da-....png` + `blue-circle.png` (743,539 bytes) |
| P5 | `codex exec ... -i secret.pdf "text inside?"` | `-i` swallowed the prompt as a second path ("No prompt provided via stdin") — `-i` is variadic; no PDF path |
| P6 | `claude -p "Read ./red.png..." --tools Read --permission-mode plan --permission-prompts none --safe-mode --output-format json` | `"result":"Red"`, `is_error:false` |
| P7 | same on `secret.pdf` | `PURPLE ELEPHANT 4471` |
| P8 | `agy -p "list your tools" --new-project --output-format json` | `view_file run_command manage_task send_message schedule invoke_subagent define_subagent manage_subagents write_to_file replace_file_content generate_image read_url_content search_web find_by_name grep_search list_dir ask_question` |
| P9 | `agy -p "view_file red.png"` (cwd = scratch dir, no `--new-project`) | empty response; `denied_actions: read_file/ViewFile` (workspace-root rule) |
| P10 | `agy -p "ONLY view_file red.png" --new-project` | `"response":"Red"` |
| P11 | `agy -p "ONLY view_file secret.pdf" --new-project` | `"response":"PURPLE ELEPHANT 4471"` |
| P12 | `agy -p "generate_image green circle, save in cwd" --mode accept-edits` | `API error ... INTERNAL (code 500)`; `denied_actions: command/RunCommand` |
| P13 | `agy -p "Never run any command. Call generate_image once ..."` | `Generated image is saved at %USERPROFILE%\.gemini\antigravity-cli\brain\0177a355-...\green_circle_1789329146922.jpg` |
| P14 | `agy models` | Gemini 3.8/3.7/3.6 Flash, 3.1 Pro, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` |
| P15 | `gemini -l` | `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` |
| P16 | `copilot -p "list your tools" -s --available-tools=view` | `You have exceeded your monthly quota` |
| P17 | `grok -p "list your tools" --permission-mode plan --output-format json` | `web_search open_page ... run_terminal_command read_file ... web_fetch image_gen image_edit image_to_video reference_to_video write` with parameter descriptions |
| P18 | `grok --cwd <dir> -p "read_file red.png colour" --permission-mode plan` | `Red` |
| P19 | `grok --cwd <dir> -p "read_file secret.pdf text"` | `PURPLE ELEPHANT 4471` |
| P20 | `grok --cwd <dir> -p "image_gen yellow circle" --permission-mode acceptEdits` | `%USERPROFILE%\.grok\sessions\C%3A%5C...%5Cgrokgen\01a09c51-...\images\1.jpg` |
| P21 | `grok --cwd <dir> -p "image_to_video red.png 6 s 480p"` | "Video generation tools are unavailable under zero data retention (ZDR). To enable, either turn off /privacy mode to disable ZDR or supply a user-hosted storage bucket (see https://docs.x.ai/build/settings/zdr-video-storage)." |
| P22 | `grok models` / `grok inspect` | `grok-4.6 (default)`, `grok-4.5`; skills include `imagine bundled [collides with /imagine]` |

Test files: `probe/red.png` (64x64 solid red), `probe/secret.pdf` (one line "PURPLE ELEPHANT 4471"), both in this scratchpad.

---

## Sources

Local (help captures re-taken 2026-09-13): `momm/references/cli/help/{codex,codex-exec,claude,agy,gemini,copilot,copilot-help-topics,grok,grok-agent}.txt`; per-CLI notes `README.md`, `codex.md`, `claude-code.md`, `antigravity.md`, `gemini.md`, `copilot.md`, `grok.md`, `candidates.md` in the same folder.

1. https://codex.danielvaughan.com/2026/03/28/codex-cli-image-workflows/ (image formats; `codex exec --image`)
2. https://github.com/openai/codex/issues/1797 (PDF support, open)
3. https://code.claude.com/docs/en/tools-reference (Read/WebSearch/WebFetch/Bash; no generative tool)
4. https://code.claude.com/docs/en/voice-dictation
5. https://antigravity.google/docs/cli/headless/
6. https://antigravity.google/docs/cli/reference
7. https://antigravity.google/docs/cli/commands/voice/
8. https://geminicli.com/docs/get-started/authentication/ (via `references/cli/gemini.md`) and local probe P15
9. https://geminicli.com/docs/tools/file-system/
10. https://google-gemini.github.io/gemini-cli/docs/tools/multi-file.html
11. https://github.com/github/copilot-cli/blob/main/changelog.md (entries 1.0.41, 1.0.57, 1.0.64, 1.0.71, 1.0.76, 1.0.79, 1.0.81, 0.0.374, 0.0.333)
12. https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview
13. https://x.ai/build/changelog (fetched with curl; entries 0.1.211, 0.2.20, 0.2.27, 0.2.68, 0.2.97, 0.2.111, 1.0.1, 1.0.5, 1.0.6, 1.0.11, 1.0.18)
14. https://toolsbase.dev/en/reference/grok-build-commands (`/imagine`, `/imagine-video`, paste limits — third-party)
15. https://cryptobriefing.com/grok-build-speech-to-text-coding/
16. https://learn.chatgpt.com/docs/image-generation
17. https://learn.chatgpt.com/docs/cli/reference
18. https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md
19. https://github.com/openai/codex/pull/17153 (image_generation default-on, merged 2026-04-16) and https://codex.danielvaughan.com/2026/04/27/codex-cli-image-generation-gpt-image-2-visual-development-workflows/
20. https://developers.openai.com/codex/config-reference (web_search modes)
21. https://antigravity.google/docs/models/
22. https://dev.to/googleai/elevating-antigravity-agent-skills-part-2-image-generation-2jno
23. https://github.com/gemini-cli-extensions/nanobanana
24. https://anycap.ai/page/en-US/blog/gemini-cli-image-video-guide (third-party; no native Veo)
25. https://geminicli.com/docs/tools/web-search/
26. https://github.com/github/awesome-copilot/blob/main/skills/generate-image/SKILL.md
27. https://docs.x.ai/build/settings/zdr-video-storage
