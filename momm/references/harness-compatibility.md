# Harness compatibility

Use one canonical skill directory. Link or install that directory with the harness's documented mechanism; never copy credentials.

Version numbers in the table and historical adapter notes record earlier checks,
not the latest available packages or this user's current installation. Use the
Setup Center's explicit version check for current installed/published versions.

| Harness | Discovery/invocation | Status |
| --- | --- | --- |
| Codex desktop, CLI, IDE | User skills under `~/.agents/skills`; invoke as `$momm` | Standards-compliant core supported |
| Gemini CLI | Run `gemini skills link <skill-directory> --scope user --consent` | Native link verified with local Gemini CLI 0.55.1; reviewer requires an eligible enterprise account |
| Claude Code | User skills under `~/.claude/skills` (junction active); CLI 2.1.240 installed | Verified as governor and as reviewer adapter |
| Antigravity CLI | Workspace skills use `.agents/skills`; global discovery is linked under the documented `~/.gemini/config/skills` and migration-compatible `~/.gemini/antigravity-cli/skills` locations | CLI 1.1.19 verified as governor-compatible and as a read-only reviewer adapter |
| Other Agent Skills hosts | Point the documented skill parent at the canonical directory, or use `scripts/install.mjs --custom-dir <parent>` | Supported without harness-specific assumptions |
| Hosts without Agent Skills | Invoke `node scripts/multi-review.mjs --governor other` as a command/tool | Workflow available, but not native skill discovery |

## Install commands

- Local graphical setup (recommended): `node momm/scripts/setup-ui.mjs`
- Guided first run (readiness, privacy explanation, and exact next actions): `node momm/scripts/onboard.mjs --governor <current-harness> --link`
- Every detected harness at once (you must type it — the installer never guesses): `node momm/scripts/install.mjs --target all`
- Individually: `--target codex` (links `~/.agents/skills`), `--target claude` (links `~/.claude/skills`), `--target gemini` (uses the native `gemini skills link`)
- Any other Agent Skills host: `--custom-dir <that-host's-skill-parent>`
- Hosts without skills support: skip installation and pipe into `scripts/multi-review.mjs` directly

## Adapter status

The 1.15 candidate additionally uses flags checked against installed help:
Claude 2.1.233 `--safe-mode` preserves account auth while disabling customizations;
text reviews use no built-in tools and media reviews expose only Read. Grok 1.0.5
uses `--verbatim --no-subagents` without removing plan mode. Copilot 1.0.83 uses
`--stream off` with the existing viewer-only allowlist. Older CLIs lacking these
flags fail closed; flag availability is not a completed-review or liveness test.
The September 12 release gate did not reach quorum: Claude/Grok timed out and
Copilot reported an exhausted monthly quota. Do not represent that attempt as a pass.

September 13 candidate checks used Claude 2.1.270 and Antigravity 1.2.2 for real
source reviews; some Claude replies still failed strict quoted-scope validation.
Grok 1.0.30 was detected, but readiness is not a completed review. Copilot 1.0.80
below describes the original adapter; 1.0.83 above describes the later flag check.
For Grok, the current candidate uses final JSON plus explicit tool deny rules and
a bounded four-turn budget; the historical JSON-schema flag and first-login note
below are not the current adapter contract.

Per-CLI knowledge base (verbatim `--help` captures, docs, config paths, observed failure modes, exact adapter argument vectors): [cli/README.md](cli/README.md).


- Codex reviewer: enabled when Codex is not the governor; run with the installed CLI's read-only sandbox.
- Gemini reviewer: enabled when Gemini is not the governor; run headlessly in plan mode. CLI 0.55.1 is installed, but individual/Pro/Ultra access was retired (reported as `ineligible_tier`); Standard or Enterprise Gemini Code Assist organization licenses remain supported, and for consumer accounts Antigravity is the successor route.
- Claude reviewer: enabled when Claude is not the governor; historical adapter used `-p` + `--output-format json` + `--permission-mode plan`. The candidate adds the containment flags documented above. Requires the provider's browser login when authentication is actually reported missing.
- Antigravity reviewer: enabled when Antigravity is not the governor; verified against CLI 1.1.19 using `--new-project`, `--mode=plan`, `--sandbox`, structured JSON output, and a temporary sanitized artifact. Never add `--dangerously-skip-permissions` or `--disable-slash-commands` to this adapter.
- Copilot reviewer: enabled when Copilot is not the governor; verified against GitHub Copilot CLI 1.0.80 using `-p` + `-s` with a temporary sanitized artifact (stdin is ignored in prompt mode). Containment: `--available-tools=view` (read-only file viewer is the model's only tool), `--no-custom-instructions`, `--disable-builtin-mcps`, `--no-remote-export`, `--add-dir` scoped to the temp directory. Auth is the GitHub keyring login (`copilot login` or an authenticated `gh`); fails closed as `authentication_required` otherwise. GitHub-side 5xx outages are classified as `provider_unavailable` (retry later), not as an auth problem.
- Grok reviewer: adapter shipped, verified against Grok CLI 1.0.5 flag surface (`--prompt-file` carries contract+artifact so the model needs no tools, `--permission-mode plan`, `--disable-web-search`, `--json-schema` constrains output; temp-dir isolation). Auth is `grok login` (xAI account browser flow, or `grok login --device-code`); unauthenticated runs verified to fail closed as `authentication_required` with the provider's own text. Full authenticated review pending first login; defaults to the `innovator` persona.

`All known harnesses` cannot mean every current and future agent product: discovery paths and skill support are product-specific and change over time. Preserve portability by keeping `SKILL.md` standards-compliant, using relative resource paths, and adding only verified links or adapters.
