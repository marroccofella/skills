# Harness compatibility

Use one canonical skill directory. Link or install that directory with the harness's documented mechanism; never copy credentials.

| Harness | Discovery/invocation | Status |
| --- | --- | --- |
| Codex desktop, CLI, IDE | User skills under `~/.agents/skills`; invoke as `$momm` | Standards-compliant core supported |
| Gemini CLI | Run `gemini skills link <skill-directory> --scope user --consent` | Native link verified; current reviewer eligibility must be established by a live account check |
| Claude Code | User skills under `~/.claude/skills` (junction active); adapter flag surface verified on CLI 2.1.233 and 2.1.240 | Verified as governor and as reviewer adapter |
| Antigravity CLI | Workspace skills use `.agents/skills`; global discovery is linked under the documented `~/.gemini/config/skills` and migration-compatible `~/.gemini/antigravity-cli/skills` locations | CLI 1.1.13 and 1.1.19 verified as governor-compatible and as a read-only reviewer adapter |
| Other Agent Skills hosts | Point the documented skill parent at the canonical directory, or use `scripts/install.mjs --custom-dir <parent>` | Supported without harness-specific assumptions |
| Hosts without Agent Skills | Invoke `node "<momm-skill-root>/scripts/multi-review.mjs" --governor other` from the reviewed project | Workflow available, but not native skill discovery |

## Install commands

- Local graphical setup (recommended): `node "<momm-skill-root>/scripts/setup-ui.mjs" --governor <current-harness>`
- Guided first run (readiness, privacy explanation, and exact next actions): `node "<momm-skill-root>/scripts/onboard.mjs" --governor <current-harness> --link`
- Every detected harness at once: `node "<momm-skill-root>/scripts/install.mjs" --target all`
- Individually: `--target codex` (links `~/.agents/skills`), `--target claude` (links `~/.claude/skills`), `--target gemini` (uses the native `gemini skills link`)
- Any other Agent Skills host: `--custom-dir <that-host's-skill-parent>`
- Hosts without skills support: skip discovery, keep the current directory in the reviewed project, and invoke the dispatcher's absolute installed path directly

`<momm-skill-root>` means the absolute canonical directory containing `SKILL.md`. Onboarding returns every follow-up as structured `executable` plus exact `args`; those arrays are authoritative across PowerShell, cmd, Git Bash, POSIX shells, desktop harnesses, and IDE hosts. A shell-tagged `display_command` is human convenience only. After peer collection, every host must edit `pending_file`, invoke the structured finalize argv, run a fresh structured status argv, and relay both `required_user_message` values verbatim. Native skill discovery does not waive the completion gate.

## Adapter status

- Codex reviewer: enabled when Codex is not the governor; run with the installed CLI's read-only sandbox.
- Gemini reviewer: enabled when Gemini is not the governor and run headlessly in plan mode. Account and organization eligibility can change and must be established by a live check. Preserve the provider's `ineligible_tier` result without assuming that re-login, a particular plan, or another route will resolve it.
- Claude reviewer: enabled when Claude is not the governor; verified against CLI 2.1.233 and 2.1.240 (`-p` + `--output-format json` + `--permission-mode plan`). Requires a one-time `claude` browser login; fails closed as `authentication_required` until then.
- Antigravity reviewer: enabled when Antigravity is not the governor; verified against CLI 1.1.13 and 1.1.19 using `--new-project`, `--mode=plan`, `--sandbox`, structured JSON output, and a temporary sanitized artifact. Never add `--dangerously-skip-permissions` or `--disable-slash-commands` to this adapter.
- Copilot reviewer: enabled when Copilot is not the governor; verified against GitHub Copilot CLI 1.0.80 using `-p` + `-s` with a temporary sanitized artifact (stdin is ignored in prompt mode). Containment: `--available-tools=view` (read-only file viewer is the model's only tool), `--no-custom-instructions`, `--disable-builtin-mcps`, `--no-remote-export`, `--add-dir` scoped to the temp directory. Auth is the GitHub keyring login (`copilot login` or an authenticated `gh`); fails closed as `authentication_required` otherwise. GitHub-side 5xx outages are classified as `provider_unavailable` (retry later), not as an auth problem.
- Grok reviewer: adapter shipped, verified against Grok CLI 1.0.5 flag surface (`--prompt-file` carries contract+artifact so the model needs no tools, `--permission-mode plan`, `--disable-web-search`, `--json-schema` constrains output; temp-dir isolation). Auth is `grok login` (xAI account browser flow, or `grok login --device-code`); unauthenticated runs verified to fail closed as `authentication_required` with the provider's own text. Full authenticated review pending first login; defaults to the `innovator` persona.

`All known harnesses` cannot mean every current and future agent product: discovery paths and skill support are product-specific and change over time. Preserve portability by keeping `SKILL.md` standards-compliant, using relative resource paths, and adding only verified links or adapters.
