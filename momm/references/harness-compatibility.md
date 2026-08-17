# Harness compatibility

Use one canonical skill directory. Link or install that directory with the harness's documented mechanism; never copy credentials.

| Harness | Discovery/invocation | Status |
| --- | --- | --- |
| Codex desktop, CLI, IDE | User skills under `~/.agents/skills`; invoke as `$momm` | Standards-compliant core supported |
| Gemini CLI | Run `gemini skills link <skill-directory> --scope user --consent` | Native link verified with local Gemini CLI 0.55.1; reviewer requires an eligible enterprise account |
| Claude Code | User skills under `~/.claude/skills` (junction active); CLI 2.1.233 installed | Verified as governor and as reviewer adapter |
| Antigravity CLI | Workspace skills use `.agents/skills`; global discovery is linked under the documented `~/.gemini/config/skills` and migration-compatible `~/.gemini/antigravity-cli/skills` locations | CLI 1.1.13 verified as governor-compatible and as a read-only reviewer adapter |
| Other Agent Skills hosts | Point the documented skill parent at the canonical directory, or use `scripts/install.mjs --custom-dir <parent>` | Supported without harness-specific assumptions |
| Hosts without Agent Skills | Invoke `node scripts/multi-review.mjs --governor other` as a command/tool | Workflow available, but not native skill discovery |

## Install commands

- Every detected harness at once: `node momm/scripts/install.mjs --target all`
- Individually: `--target codex` (links `~/.agents/skills`), `--target claude` (links `~/.claude/skills`), `--target gemini` (uses the native `gemini skills link`)
- Any other Agent Skills host: `--custom-dir <that-host's-skill-parent>`
- Hosts without skills support: skip installation and pipe into `scripts/multi-review.mjs` directly

## Adapter status

- Codex reviewer: enabled when Codex is not the governor; run with the installed CLI's read-only sandbox.
- Gemini reviewer: enabled when Gemini is not the governor; run headlessly in plan mode. CLI 0.55.1 is installed, but individual/Pro/Ultra access was retired (reported as `ineligible_tier`); Standard or Enterprise Gemini Code Assist organization licenses remain supported, and for consumer accounts Antigravity is the successor route.
- Claude reviewer: enabled when Claude is not the governor; verified against CLI 2.1.233 (`-p` + `--output-format json` + `--permission-mode plan`). Requires a one-time `claude` browser login; fails closed as `authentication_required` until then.
- Antigravity reviewer: enabled when Antigravity is not the governor; verified against CLI 1.1.13 using `--new-project`, `--mode=plan`, `--sandbox`, structured JSON output, and a temporary sanitized artifact. Never add `--dangerously-skip-permissions` or `--disable-slash-commands` to this adapter.
- Copilot reviewer: enabled when Copilot is not the governor; verified against GitHub Copilot CLI 1.0.80 using `-p` + `-s` with a temporary sanitized artifact (stdin is ignored in prompt mode). Containment: `--available-tools=view` (read-only file viewer is the model's only tool), `--no-custom-instructions`, `--disable-builtin-mcps`, `--no-remote-export`, `--add-dir` scoped to the temp directory. Auth is the GitHub keyring login (`copilot login` or an authenticated `gh`); fails closed as `authentication_required` otherwise. GitHub-side 5xx outages are classified as `provider_unavailable` (retry later), not as an auth problem.
- Grok reviewer: disabled pending a verified adapter. xAI now ships an official Grok CLI with browser OAuth (x.ai/cli); an adapter requires the CLI installed locally, headless JSON output, an isolated temporary working directory, memory disabled, and a strict read-only tool allowlist — verified before enablement, per the same process every other adapter followed.

`All known harnesses` cannot mean every current and future agent product: discovery paths and skill support are product-specific and change over time. Preserve portability by keeping `SKILL.md` standards-compliant, using relative resource paths, and adding only verified links or adapters.
