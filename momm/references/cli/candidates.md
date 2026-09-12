# Candidate reviewer routes not yet used

Surveyed 2026-09-12 against each product's own documentation. MOMM's route policy is unchanged: a route must run headless, read-only, return one JSON review, and authenticate through the user's own account login — never an API key. "Login" below means a browser or device-code flow that stores a session on the machine.

What makes a candidate worth adding is a **model family MOMM cannot already reach** (its current five routes cover OpenAI, Anthropic, Google, GitHub's model pool, and xAI). Routes that only re-sell those families add a harness, not a second opinion.

## Eligible now: account login, headless, read-only controls

| CLI | Vendor / models | Login | Headless | Read-only control | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Kimi Code CLI** (`kimi`) | Moonshot, Kimi K2 family — a new family | `kimi login` with a Kimi subscription; credentials in `~/.kimi-code/`; API key optional for pay-per-token | `kimi -p "<prompt>"`, JSONL streaming | Approval/tool controls per its reference (verify `--help`) | **Best new-family candidate.** Install: `irm https://code.kimi.com/kimi-code/install.ps1 \| iex` |
| **Mistral Vibe** (`vibe`) | Mistral, Devstral models — a new family | First-run wizard signs in with a Mistral account in the browser and stores credentials; API key is the alternative | `vibe --prompt "…" --output json --max-turns N` | `--agent plan` (approval behaviour), `--enabled-tools` exact/glob/regex allowlist, `--trust` | **Strong candidate**: native JSON output, tool allowlist, turn cap |
| **Cursor CLI** (`agent` / `cursor-agent`) | Cursor's pool: GPT, Claude, Gemini, Cursor Composer | `agent login` (Cursor account) on a developer machine; CI uses `CURSOR_API_KEY` | `agent -p --output-format json\|stream-json` | Without `--force`/`--yolo` changes are only proposed, not applied | Useful as a **Composer** route (Cursor's own model); otherwise re-sells families MOMM has |
| **Kiro CLI** (`kiro-cli`, was Amazon Q) | AWS-hosted Claude (Bedrock), Kiro plans | `kiro-cli login` — Builder ID, Google, GitHub or IAM Identity Center; new Q free-tier enrolment closed 2026-05-15 | `kiro-cli chat --no-interactive` | `--trust-tools` allowlist | Same model family as Claude; only worth it for AWS-licensed users |
| **Auggie** (`auggie`) | Augment, Claude/GPT-backed | `auggie login` (browser; `--no-tui` for headless; `auggie token print` for CI) | `auggie --print --quiet "…"` | Permission flags per its reference | Adds Augment's context engine, not a new family |
| **Cline CLI** (`cline`) | Cline provider (many models incl. free tiers), plus `openai-codex` and `oca` via OAuth | `cline auth cline` / `cline auth openai-codex` — explicit browser auth; non-interactive runs fail fast without saved credentials (good) | `cline -p "…"` (plan mode) and `cline --json` NDJSON; `git diff \| cline "Review…"` | Plan mode is planning-only; `--yolo` is the opposite | Interesting as a **multi-model OAuth hub**; the model behind `cline` provider must be pinned per run |
| **OpenCode** (`opencode`) | Any provider on models.dev; subscription logins for Anthropic, OpenAI, GitHub Copilot, Google | `opencode auth login` (stores `~/.local/share/opencode/auth.json`) | `opencode run --format json --model provider/model --agent <name>` | Agents can be defined without tools; `--auto` is the opposite | A way to reach the same accounts from one CLI; no new family |

Not eligible any more: **Qwen Code** — Qwen OAuth and its free tier ended 2026-04-15; it now needs an Alibaba Coding Plan key or a third-party endpoint.

Note on Grok: the existing route's `--tools` flag does not disable tools (see [grok.md](grok.md)); any new route must be checked the same way with a canary-file read before its containment is described.

## Good models, but API key only (outside MOMM's policy)

| CLI / route | Models | Why it is out |
| --- | --- | --- |
| **Qwen Code** (`qwen`) | Qwen3-Coder | Coding Plan API key or custom endpoint since April 2026 |
| **Zhipu `zcode`** and the GLM Coding Plan | GLM-4.7 / GLM-5 | Plan key; also drives Claude Code forks by key |
| **DeepSeek** | DeepSeek V4 | No official CLI; community agents (Deep Code CLI, Reasonix) use the API key |
| **MiniMax MMX-CLI** | MiniMax coding and multimodal models | Token plan / API key |
| **Factory Droid** (`droid exec`) | Claude, GPT, Gemini via Factory | `droid exec` requires `FACTORY_API_KEY` even though the TUI has `/login`; its read-only default and `--output-format json` are otherwise ideal |
| **Aider**, **Goose**, **Crush**, **`llm`** | Any provider | Key-based multi-provider tools; `llm` is a good pure-model (no agent) reviewer if a key policy ever changes |

## Third category: local models, no login and no key

- **`codex exec --oss --local-provider ollama\|lmstudio`** — the existing Codex adapter can run an open model locally with no account at all (flag present in codex 0.147.0 `--help`). Nothing leaves the machine.
- **`ollama launch claude\|codex\|opencode --model <local>`** — Ollama drives Claude Code, Codex or OpenCode against a local model; `ollama signin` exists but local use needs no account.
- Recommended local models for review-style tool use in 2026: Qwen3-Coder, Mistral-Small, DeepSeek-Coder, GLM-4.7-flash (per community benchmarks; verify quality on your own diffs).
- Fit for MOMM: a `local` route would be the only one where "nothing leaves the machine" is literally true, at the cost of weaker reviews; it belongs behind an explicit `--reviewers local` opt-in with the model name recorded in the report.

## Suggested order of work

1. Kimi Code CLI and Mistral Vibe — genuinely new model families with account logins and JSON output. Capture their `--help`, verify read-only containment with the canary-read probe, add adapters.
2. A local route through `codex --oss` — no new vendor, no new auth, and a privacy story the page can state honestly.
3. Cursor (Composer) and Cline (as a hub) only if a reviewer behind them is otherwise unreachable.

Sources: Qwen Code authentication docs (qwenlm.github.io), Kimi Code docs (moonshotai.github.io/kimi-code), Cursor CLI headless and output-format docs (cursor.com/docs/cli), Factory Droid Exec docs (docs.factory.ai), Mistral Vibe CLI docs (docs.mistral.ai/vibe), Cline CLI README (github.com/cline/cline), Kiro CLI docs (kiro.dev/docs/cli) and the Amazon Q end-of-support notice (aws.amazon.com/blogs/devops), Auggie docs (docs.augmentcode.com/cli), OpenCode CLI docs (opencode.ai/docs/cli), Ollama CLI docs (docs.ollama.com/cli).
