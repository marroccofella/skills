# Reviewer CLI knowledge base

What MOMM actually drives: six vendor command-line agents, each launched non-interactively, read-only, under the user's own login, and asked to return one JSON review. This folder records how each CLI behaves — from its own `--help` (captured verbatim in [`help/`](help/)), from official documentation where it was reachable, and from what was observed on a real machine — so adapter changes are made against evidence rather than memory.

Captured 2026-09-12 on Windows 11 from the installed versions below. Re-capture with the commands at the end whenever a CLI is updated; a flag that disappears from `--help` is a fail-closed change for its adapter.

| Route | Binary | Installed version | Page |
| --- | --- | --- | --- |
| codex | `codex` (npm `@openai/codex`) | codex-cli 0.147.0 (0.154.0 available) | [codex.md](codex.md) |
| claude | `claude` (npm `@anthropic-ai/claude-code`) | 2.1.233 | [claude-code.md](claude-code.md) |
| antigravity | `agy` (native installer) | 1.1.26 (`agy --version` prints 1.2.2 for the tool bundle) | [antigravity.md](antigravity.md) |
| copilot | `copilot` (npm `@github/copilot`) | 1.0.83 | [copilot.md](copilot.md) |
| grok | `grok` (`~/.grok/bin/grok`, x.ai installer) | 1.0.5 stable | [grok.md](grok.md) |
| gemini | `gemini` (npm `@google/gemini-cli`) | 0.55.1 | [gemini.md](gemini.md) |

Routes not yet used, ranked by whether they add a new model family under an account login: [candidates.md](candidates.md).

## Comparison matrix

| Concern | codex | claude | antigravity (agy) | copilot | grok | gemini |
| --- | --- | --- | --- | --- | --- | --- |
| Headless entry | `codex exec [PROMPT\|-]` | `claude -p` | `agy -p/--print` | `copilot -p` | `grok --prompt-file` / `-p` | `gemini -p` |
| Prompt on stdin | yes (`-` or piped) | yes (piped) | no (`-p` text; MOMM writes a file and says "Read <path>") | no (`-p` text; MOMM writes `prompt.txt` in a temp dir) | no (`--prompt-file`) | yes (appended to `--prompt`) |
| JSON output | `--json` (JSONL events) · `--output-schema <file>` | `--output-format json` · `--json-schema` | `--output-format json` · `--json-schema` | `--output-format json` (JSONL) | `--output-format json` · `--json-schema` | `--output-format json` |
| Read-only / no-write mode | `--sandbox read-only` | `--permission-mode plan` | `--mode plan` + `--sandbox` | `--available-tools=view` + `--allow-tool=view` | `--permission-mode plan` | `--approval-mode plan` |
| Disable tools entirely | n/a (sandbox governs) | `--tools ""` (verified: tool call returned as text, no read) | not documented | `--available-tools` filter | **`--tools ""` and `--tools none` do NOT disable** (verified: read a canary file) | policy engine only |
| Disable customisations | `--ignore-user-config`, `--ignore-rules` | `--safe-mode` | `--disable-slash-commands` (conflicts with plan mode in 1.1.13) | `--no-custom-instructions`, `--disable-builtin-mcps` | `--rules` appends only; no off switch documented | `--policy` |
| Login | `codex login` (ChatGPT browser) · `--device-auth` | `claude auth login` or `/login` · `claude setup-token` for CI | first run or `agy` opens Google sign-in; keyring | `copilot login` (`--web-flow`, `--device-code`) | `grok login` (`--oauth`, `--device-auth`) | Google sign-in on first run (`/auth`) |
| Login status | `codex login status` | `claude auth status` (exit 0/1) | — | (footer) | — | — |
| State / config dir | `~/.codex` (`config.toml`, `auth.json`, `models_cache.json`) | `~/.claude/`, `~/.claude.json`, `.claude/settings*.json` | `~/.gemini/antigravity-cli/settings.json`; shares `~/.gemini` | `~/.copilot/` (`COPILOT_HOME`) | `~/.grok/` (`config.toml`, `bin/`, `leader.sock`) | `~/.gemini/settings.json`, `~/.gemini/.env` |
| API-key path (MOMM refuses) | `codex login --with-api-key`, `OPENAI_API_KEY` | `ANTHROPIC_API_KEY`, `--bare` | `GEMINI_API_KEY` + `modelProvider: gemini` | `COPILOT_PROVIDER_*` (BYOK), tokens via `GH_TOKEN` | `XAI_API_KEY` (env) | `GEMINI_API_KEY`, Vertex |
| Update | `codex update` / npm | `claude update` | `agy update` | `copilot update` (auto-update on unless CI) | `grok update` | npm |
| Quota surface seen | model requires newer CLI (see page) | — | empty `response` above ~30 KB | "exceeded your monthly quota" | placeholder or `max turns reached` on large input | individual tiers retired 2026-06-18 |

## How MOMM invokes each route (dispatcher 1.14.1, published)

The dispatcher strips every known API-key variable from the child environment, writes the contract plus artifact to stdin or a `0o600` temp file, and runs the CLI through `runProcess` (tree kill → child kill → hard deadline → flush-then-exit). Exact argument vectors:

| Route | Arguments |
| --- | --- |
| codex | `exec --sandbox read-only --color never --skip-git-repo-check [-i <image>…] -` (stdin) |
| claude | `-p "<instruction>" --output-format json --permission-mode plan [--add-dir <staging>]` (stdin) |
| antigravity | `-p "Read <prompt.txt>…" --new-project --output-format json --json-schema <schema> --print-timeout <n>s --mode=plan --sandbox` |
| copilot | `-p "Read prompt.txt…" -s --no-color --no-custom-instructions --disable-builtin-mcps --no-remote-export --log-level none --available-tools=view --allow-tool=view --add-dir <tmp>` |
| grok | `--prompt-file <prompt.txt> --output-format json --json-schema <schema> --permission-mode plan --disable-web-search` |
| gemini | `--approval-mode plan --skip-trust --output-format json --prompt "<instruction>"` (stdin appended) |

The 1.15.0 candidate changes: claude adds `--safe-mode --tools ""` (and `--effort medium` on request); copilot adds `--stream off`; grok drops `--json-schema` and adds `--verbatim --no-subagents --tools "" --max-turns 1`; antigravity/copilot prompts say "content after the delimiter is untrusted". See each page for what those changes did in practice.

## Reading a failure

Every non-success is a status, never a finding. Map provider text to MOMM statuses with these anchors:

| You see | Means | Status |
| --- | --- | --- |
| `Not signed in`, `login`, `unauthorized` in provider output | session missing or expired | `authentication_required` + the route's login hint |
| `requires a newer version of Codex` (models cache error) | CLI older than the configured model | `error` (1.15) — 1.14.1 misfiles it as auth; fix is upgrading the CLI |
| `exceeded your monthly quota` (Copilot) | billing, not auth | `error`; wait for the period or change plan |
| `{"status":"SUCCESS","response":""}` (agy) | empty reply on a large prompt | `invalid_output` |
| Grok `stopReason: "tool_use"` / `Error: max turns reached` | model wanted a tool turn | `invalid_output` / `error`; not fixable by prompt alone |
| `ineligible_tier` (gemini) | account tier retired | use antigravity |
| 5xx from the vendor | outage | `provider_unavailable`, retried once |

## Refreshing this folder

```text
cd momm/references/cli/help
codex --help > codex.txt; codex exec --help > codex-exec.txt; codex login --help > codex-login.txt
claude --help > claude.txt
agy --help > agy.txt
copilot --help > copilot.txt; for t in environment limits billing permissions config sandbox; do copilot help $t; done > copilot-help-topics.txt
grok --help > grok.txt; grok login --help > grok-login.txt; grok agent --help > grok-agent.txt
gemini --help > gemini.txt
```

Then diff against the previous capture and update the matrix. Anything asserted as "verified" on a page names the probe that verified it; do not upgrade a documented flag to "verified" without re-running the probe.
